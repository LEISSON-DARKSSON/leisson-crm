// ULESANNE 8: hangete API-marsruudid.
//
// Marsruuti EI TOESTA voti. Plaani naidistest kusis ainult, kas objektis on rida
// 'GET /api/hanked' - see laheb roheliseks ka siis, kui marsruut viskab iga paringu
// peale erindi. Siin KUTSUTAKSE iga marsruut labi (volts req/res, volts readBody)
// ja vaadatakse staatuskoodi ja keha.
//
// Baas laheb os.tmpdir()-i alla (monteeritud kettal SQLite lukustust ei toeta).
// Vorku EI kasutata. PARIS protsesse EI kaivitata: extraRoutes votab vastu
// vabatahtliku spawnFn-i, mis antakse startRun-ile edasi - sama seem, mida
// lib/hanked-runs.mjs ise juba kasutab (test/gate-hanked-runs.mjs).
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { extraRoutes, JOOKSE_LIMIIT, LOGI_SABA } from '../lib/routes2.mjs';
import { migrateHanked, upsertHange, hangeDetail, HANKE_STATES } from '../lib/hanked.mjs';
import { cleanupOrphans, runsView } from '../lib/hanked-runs.mjs';
import { ROOT } from '../lib/env.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'hanked-api-'));
let jrk = 0;

function testDb() {
  const db = new DatabaseSync(join(TMP, 'a' + (++jrk) + '.sqlite'));
  db.exec('PRAGMA foreign_keys = ON');
  migrateHanked(db);
  return db;
}

// Valelaps: pid on olemas, vooge ei ole. Loeb kutseid, et "paris protsessi ei
// tekkinud" oleks MOODETUD, mitte usutud.
function valeSpawn(pid = 4242) {
  const f = (...a) => { f.kutseid++; f.argv.push(a); return { pid: pid++, stdout: { on() {} }, stderr: { on() {} }, on() {} }; };
  f.kutseid = 0; f.argv = [];
  return f;
}

// Uks marsruudikutse. Tagastab { kood, keha } - tapselt selle, mida klient naeb.
async function kutsu(db, votme, { keha = {}, readBody, spawnFn, veavoog } = {}) {
  let vastus = null;
  let vastuseid = 0;
  const routes = extraRoutes(db, {}, {
    json: (_res, kood, data) => { vastuseid++; vastus = { kood, keha: data }; },
    readBody: readBody || (async () => keha),
    mail: {},
    spawnFn,
  });
  const marsruut = routes[votme];
  assert.ok(marsruut, 'marsruut puudub: ' + votme);
  const vana = console.error;
  if (veavoog) console.error = (...a) => veavoog.push(a.map(String).join(' '));
  try { await marsruut({}, {}); } finally { if (veavoog) console.error = vana; }
  assert.equal(vastuseid, 1, votme + ' peab vastama TAPSELT uks kord, vastas ' + vastuseid);
  return vastus;
}

const marsruudid = (db) => extraRoutes(db, {}, { json: () => {}, readBody: async () => ({}), mail: {} });

// --- A: marsruudid on registreeritud (plaani juhtum) -------------------------
{
  const db = testDb();
  const r = marsruudid(db);
  for (const k of ['GET /api/hanked', 'GET /api/hanked/runs', 'POST /api/hanked/run',
    'POST /api/hanked/stop', 'POST /api/hanked/state', 'POST /api/hanked/note',
    'POST /api/hanked/detail']) {
    assert.ok(r[k], 'marsruut puudub: ' + k);
    assert.equal(typeof r[k], 'function', 'marsruut ei ole funktsioon: ' + k);
  }
  // Olemasolevad marsruudid ei tohi kaduda.
  assert.ok(r['GET /api/stats'] && r['POST /api/bulk/run'], 'vanad marsruudid peavad alles jaama');
  db.close();
  console.log('PASS hanked API: marsruudid registreeritud');
}

// --- B: GET /api/hanked annab paris andmed ----------------------------------
{
  const db = testDb();
  upsertHange(db, { ref: '314159', title: 'Eneseabiprogramm', segment: 'nišš', deadline: '2026-10-13' });
  const v = await kutsu(db, 'GET /api/hanked');
  assert.equal(v.kood, 200);
  assert.equal(v.keha.hanked.length, 1, 'hanked peab tulema baasist');
  assert.equal(v.keha.hanked[0].ref, '314159');
  assert.equal(v.keha.hanked[0].state, 'uus');
  // tasks tuleb cmdView-st, mitte paljast CMD-st: nupp peab teadma, kas skript on olemas.
  assert.equal(typeof v.keha.tasks.sync.label, 'string');
  assert.equal(v.keha.tasks.sync.valmis, true, 'agent/hanked-sync.mjs on kettal');
  // ULESANNE 12 on tehtud: agent/hanked-history.mjs on kettal, seega nupp "Lae
  // ajalugu" on valmis. `valmis` tuleb KETTALT (cmdView existsSync), seega see
  // rida muutus ise - kasitsi hoitav lipp oleks siia vaikselt valeks jaanud.
  assert.equal(v.keha.tasks.history.valmis, true, 'agent/hanked-history.mjs on kettal (ulesanne 12)');
  assert.ok(Array.isArray(v.keha.runs), 'runs peab olema massiiv');
  // Seisude nimekiri tuleb serverilt, et vaade ei hoiaks oma koopiat.
  assert.deepEqual(v.keha.states, HANKE_STATES, 'states peab tulema serverilt');
  db.close();
  console.log('PASS hanked API: GET /api/hanked annab hanked, tasks, runs ja states');
}

// --- C: POST /api/hanked/state ----------------------------------------------
{
  const db = testDb();
  upsertHange(db, { ref: 's1', title: 'Veebileht' });

  const ok = await kutsu(db, 'POST /api/hanked/state', { keha: { ref: 's1', state: 'valmistun' } });
  assert.equal(ok.kood, 200);
  assert.equal(ok.keha.ok, true);
  assert.equal(db.prepare('SELECT state FROM hanked WHERE ref=?').get('s1').state, 'valmistun',
    'marsruut peab baasi PARISELT muutma');

  const vale = await kutsu(db, 'POST /api/hanked/state', { keha: { ref: 's1', state: 'banaan' } });
  assert.equal(vale.kood, 400, 'tundmatu seis on 400');
  assert.match(vale.keha.error, /Tundmatu seis/);

  const puudub = await kutsu(db, 'POST /api/hanked/state', { keha: { ref: 'ei-ole', state: 'vaatan' } });
  assert.equal(puudub.kood, 404, 'olematu hange on 404, mitte 400');

  const tyhi = await kutsu(db, 'POST /api/hanked/state', { keha: {} });
  assert.equal(tyhi.kood, 400, 'puuduv keha on 400');

  // Massiiv objekti asemel peab kukkuma KEHA valve taga, mitte juhuslikult viide()
  // peal - muidu laheb valve eemaldamine margatamatult labi.
  const massiiv = await kutsu(db, 'POST /api/hanked/state', { keha: [{ ref: 's1', state: 'vaatan' }] });
  assert.equal(massiiv.kood, 400, 'massiiv objekti asemel on 400');
  assert.match(massiiv.keha.error, /oodati JSON-objekti/, 'keha kuju valve peab olema see, mis kukutab');
  const number = await kutsu(db, 'POST /api/hanked/state', { keha: 42 });
  assert.equal(number.kood, 400);
  assert.match(number.keha.error, /oodati JSON-objekti/);
  assert.equal(db.prepare('SELECT state FROM hanked WHERE ref=?').get('s1').state, 'valmistun',
    'vigane paring ei tohi baasi puutuda');
  db.close();
  console.log('PASS hanked API: seis 200 / 400 / 404');
}

// --- D: POST /api/hanked/note ------------------------------------------------
{
  const db = testDb();
  upsertHange(db, { ref: 'n1', title: 'Veebileht' });

  const ok = await kutsu(db, 'POST /api/hanked/note', { keha: { ref: 'n1', note: 'Küsi majutuse kohta' } });
  assert.equal(ok.kood, 200);
  assert.equal(db.prepare('SELECT note FROM hanked WHERE ref=?').get('n1').note, 'Küsi majutuse kohta');

  const tyhjaks = await kutsu(db, 'POST /api/hanked/note', { keha: { ref: 'n1', note: '   ' } });
  assert.equal(tyhjaks.kood, 200);
  assert.equal(db.prepare('SELECT note FROM hanked WHERE ref=?').get('n1').note, null,
    'tuhi markus on NULL, mitte tuhi string');

  const vale = await kutsu(db, 'POST /api/hanked/note', { keha: { ref: 'n1', note: { a: 1 } } });
  assert.equal(vale.kood, 400, 'mitte-string markus on 400');
  assert.match(vale.keha.error, /Vigane märkus/);

  const puudub = await kutsu(db, 'POST /api/hanked/note', { keha: { ref: 'ei-ole', note: 'x' } });
  assert.equal(puudub.kood, 404);
  db.close();
  console.log('PASS hanked API: markus 200 / 400 / 404');
}

// --- E: POST /api/hanked/detail ----------------------------------------------
// score_why on NULL ridadel, mida sunk ei ole puutunud. JSON.parse(null) annab
// null, MITTE massiivi - vaade teeks siis .map()-i null-i peal ja detailpaneel
// jaaks tuhjaks ilma uhegi veata.
{
  const db = testDb();
  upsertHange(db, { ref: 'd1', title: 'Puutumata' });                       // score_why = NULL
  upsertHange(db, { ref: 'd2', title: 'Skooritud' });
  db.prepare('UPDATE hanked SET score=55, score_why=? WHERE ref=?')
    .run(JSON.stringify(['+40 · sobiv segment: nišš', '+15 · maksumus 45 000 €']), 'd2');
  upsertHange(db, { ref: 'd3', title: 'Katkine JSON' });
  db.prepare('UPDATE hanked SET score_why=? WHERE ref=?').run('{katki', 'd3');
  upsertHange(db, { ref: 'd4', title: 'JSON, aga mitte massiiv' });
  db.prepare('UPDATE hanked SET score_why=? WHERE ref=?').run('"lihtsalt tekst"', 'd4');

  const a = await kutsu(db, 'POST /api/hanked/detail', { keha: { ref: 'd1' } });
  assert.equal(a.kood, 200);
  assert.equal(a.keha.hange.ref, 'd1');
  assert.deepEqual(a.keha.why, [], 'score_why = NULL peab andma tuhja MASSIIVI, mitte null-i');

  const b = await kutsu(db, 'POST /api/hanked/detail', { keha: { ref: 'd2' } });
  assert.equal(b.keha.why.length, 2);
  assert.match(b.keha.why[0], /sobiv segment/);
  assert.equal(b.keha.hange.score, 55);

  for (const ref of ['d3', 'd4']) {
    const v = await kutsu(db, 'POST /api/hanked/detail', { keha: { ref } });
    assert.equal(v.kood, 200, ref + ': katkine score_why ei tohi paringut maha votta');
    assert.deepEqual(v.keha.why, [], ref + ': katkisest score_why-st tuleb tuhi massiiv');
  }

  const puudub = await kutsu(db, 'POST /api/hanked/detail', { keha: { ref: 'ei-ole' } });
  assert.equal(puudub.kood, 404);
  const tyhi = await kutsu(db, 'POST /api/hanked/detail', { keha: {} });
  assert.equal(tyhi.kood, 400, 'viitenumbrita paring on 400');

  // hangeDetail on ka otse eksporditud (ulesanne 13 laiendab teda).
  assert.deepEqual(hangeDetail(db, 'd1').why, []);
  db.close();
  console.log('PASS hanked API: detail parsib score_why ja ei kuku NULL-i peal');
}

// --- F: POST /api/hanked/run -------------------------------------------------
{
  const db = testDb();
  const spawnFn = valeSpawn();

  const a = await kutsu(db, 'POST /api/hanked/run', { keha: { cmd: 'gate' }, spawnFn });
  assert.equal(a.kood, 200);
  assert.equal(a.keha.state, 'käib');
  assert.equal(a.keha.cmd, 'gate');
  assert.equal(typeof a.keha.id, 'number', 'id peab joudma kliendini numbrina');
  assert.equal(spawnFn.kutseid, 1, 'tapselt uks lapsprotsess');

  // Lukk: teine kohe jargnev paring annab 409 ja SAMA jooksu id.
  const b = await kutsu(db, 'POST /api/hanked/run', { keha: { cmd: 'gate' }, spawnFn });
  assert.equal(b.kood, 409, 'lukk peab andma 409, mitte 400');
  assert.equal(b.keha.runId, a.keha.id, 'runId peab osutama KAIVALE jooksule');
  assert.match(b.keha.error, /käib juba/);
  assert.equal(spawnFn.kutseid, 1, 'luku taga ei tohi teist protsessi tekkida');

  // Teine kask tohib paralleelselt kaia.
  const c = await kutsu(db, 'POST /api/hanked/run', { keha: { cmd: 'sync' }, spawnFn });
  assert.equal(c.kood, 200);
  assert.equal(spawnFn.kutseid, 2);

  // Valmimata skript: eestikeelne 400, mitte toores Node-i viga. ULESANNE 12 tegi
  // history valmis, seega valmimata on nuud ainult docs (ulesanne 14).
  const d = await kutsu(db, 'POST /api/hanked/run', { keha: { cmd: 'docs' }, spawnFn });
  assert.equal(d.kood, 400);
  assert.match(d.keha.error, /ei ole veel valmis/);

  // Ja vastupidi: ajaloo import KAIVITUB nupust ning saab oma argumendid kaasa.
  const e = await kutsu(db, 'POST /api/hanked/run', { keha: { cmd: 'history', args: { kuud: 1 } }, spawnFn });
  assert.equal(e.kood, 200, 'ajaloo import peab nupust kaivituma');
  assert.equal(e.keha.cmd, 'history');
  assert.ok(spawnFn.argv.at(-1)[1].includes('--kuud=1'), 'argument peab lapseni jouma');

  // Sisendi valve.
  const vigased = [
    [{ cmd: 'rm' }, /Tundmatu käsk/],
    [{ cmd: 'constructor' }, /Tundmatu käsk/],          // prototuubi reostuse valve
    [{ cmd: 'toString' }, /Tundmatu käsk/],
    [{}, /Tundmatu käsk/],                               // puuduv keha
    [{ cmd: 'gate', args: ['ref', '1'] }, /massiiv/],    // massiiv objekti asemel
    [[{ cmd: 'gate' }], /oodati JSON-objekti/],          // keha ise on massiiv
    [{ cmd: 'docs', args: { ref: { a: 1 } } }, /Vigane argumendi väärtus/],
    [{ cmd: 'docs', args: { 'ref=x': '1' } }, /Vigane argumendi nimi/],
    [{ cmd: 'docs', args: { ref: 'a=b' } }, /võrdusmärki/],
    [{ cmd: 'docs', args: { ref: 'x'.repeat(300) } }, /liiga pikk/],
  ];
  for (const [keha, muster] of vigased) {
    const v = await kutsu(db, 'POST /api/hanked/run', { keha, spawnFn });
    assert.equal(v.kood, 400, 'vigane sisend ' + JSON.stringify(keha).slice(0, 60) + ' peab andma 400, andis ' + v.kood);
    assert.match(v.keha.error, muster);
  }
  // Kolm onnestunud kaivitust (gate, sync, history) - vigane sisend ei lisa neljandat.
  assert.equal(spawnFn.kutseid, 3, 'vigane sisend ei tohi uhtegi protsessi kaivitada');
  db.close();
  console.log('PASS hanked API: kaivitus 200, lukk 409 runId-ga, vigane sisend 400');
}

// --- G: POST /api/hanked/stop ------------------------------------------------
{
  const db = testDb();
  const spawnFn = valeSpawn();
  const tapetud = [];
  const a = await kutsu(db, 'POST /api/hanked/run', { keha: { cmd: 'gate' }, spawnFn });

  const s = await kutsu(db, 'POST /api/hanked/stop', { keha: { id: a.keha.id } });
  assert.equal(s.kood, 200);
  assert.equal(s.keha.ok, true);
  assert.equal(db.prepare('SELECT state FROM hanke_runs WHERE id=?').get(a.keha.id).state, 'katkestatud');

  // Sama id teist korda: jooks ei kai enam. Vastus on aus, mitte erind.
  const teine = await kutsu(db, 'POST /api/hanked/stop', { keha: { id: a.keha.id } });
  assert.equal(teine.kood, 200);
  assert.equal(teine.keha.ok, false);
  assert.match(teine.keha.error, /ei käi/);

  for (const id of [undefined, null, 'banaan', NaN, {}, [1], 1.5, 0, -3, '12abc']) {
    const v = await kutsu(db, 'POST /api/hanked/stop', { keha: { id } });
    assert.equal(v.kood, 400, 'id=' + JSON.stringify(id) + ' peab andma 400, andis ' + v.kood);
    assert.match(v.keha.error, /Vigane jooksu id/);
  }
  // Numbriline string on lubatud - JSON-ist tuleb ta nii kui naa.
  const str = await kutsu(db, 'POST /api/hanked/stop', { keha: { id: String(a.keha.id) } });
  assert.equal(str.kood, 200);
  assert.equal(tapetud.length, 0);
  db.close();
  console.log('PASS hanked API: stop 200 / 400 vigase id peal');
}

// --- H: koormus ja jarjekindlus ----------------------------------------------
// Ulesanne 10 POLLIB jooksude seisu iga kahe sekundi tagant. runsView annab rea
// TAISKUJUL: log kuni 4000 margi x 5 jooksu = 20 KB IGA paringu peale. Nimekirja
// laheb logi SABA, taislogi ainult sinna, kus teda paritakse.
{
  const db = testDb();
  const pikk = 'x'.repeat(4000);
  const logi = (i) => pikk + 'LOPP' + String(i).padStart(2, '0');
  for (let i = 0; i < 12; i++) {
    db.prepare(`INSERT INTO hanke_runs (cmd,args,state,started,finished,log,boot_id)
      VALUES ('gate','{}','tehtud',datetime('now'),datetime('now'),?,'muu')`).run(logi(i));
  }
  const nimekiri = await kutsu(db, 'GET /api/hanked');
  const jooksud = await kutsu(db, 'GET /api/hanked/runs');

  assert.deepEqual(Object.keys(nimekiri.keha.runs[0]).sort(), Object.keys(jooksud.keha.runs[0]).sort(),
    'GET /api/hanked ja GET /api/hanked/runs peavad andma SAMA kuju');
  assert.equal(nimekiri.keha.runs.length, jooksud.keha.runs.length, 'sama piir molemas otspunktis');
  assert.equal(jooksud.keha.runs.length, JOOKSE_LIMIIT);

  for (const r of jooksud.keha.runs) {
    assert.equal(r.log, undefined, 'taislogi ei tohi pollivasse otspunkti minna');
    assert.equal(r.boot_id, undefined, 'serveri kaivituse UUID ei kuulu ule juhtme (oma juba utleb selle)');
    assert.equal(typeof r.oma, 'boolean', 'oma peab alles jaama - "Peata" nupp soltub sellest');
    assert.ok(typeof r.logTail === 'string', 'logi saba peab alles jaama (punane rida vajab teda)');
    assert.ok(r.logTail.length <= LOGI_SABA, 'saba pikkus: ' + r.logTail.length);
    assert.match(r.logTail, /LOPP\d+$/, 'saba peab tulema logi LOPUST');
    assert.equal(r.logPikkus, logi(0).length, 'taislogi pikkus peab jaama nahtavaks');
  }
  const baidid = Buffer.byteLength(JSON.stringify(jooksud.keha));
  assert.ok(baidid < 12000, 'polliv otspunkt peab jaama alla 12 KB, on ' + baidid + ' B');
  db.close();
  console.log('PASS hanked API: polliv otspunkt on kerge ja kahe otspunkti kuju on sama (' + baidid + ' B)');
}

// --- I: e.message ei lekita SQL-i ega failiteid ------------------------------
{
  const db = testDb();
  upsertHange(db, { ref: 'v1', title: 'Veebileht' });
  // Baasiviga on SISEMINE: node:sqlite paneb sonumisse SQL-lause ja veeruniimed.
  const katkine = {
    prepare(sql) {
      if (/UPDATE hanked SET state/.test(sql)) {
        throw new Error('SQLITE_ERROR: no such column: xyz in "UPDATE hanked SET state = ? WHERE ref = ?" '
          + '(C:\\Users\\gert\\Desktop\\LEISSON.CREATIVE\\crm\\data\\crm.sqlite)');
      }
      return db.prepare(sql);
    },
    exec: (...a) => db.exec(...a),
  };
  const veavoog = [];
  const v = await kutsu(katkine, 'POST /api/hanked/state', { keha: { ref: 'v1', state: 'vaatan' }, veavoog });
  assert.equal(v.kood, 500, 'tundmatu sisemine viga on 500, mitte 400');
  const tekst = JSON.stringify(v.keha);
  for (const leke of ['SQLITE', 'UPDATE hanked', 'crm.sqlite', 'C:\\', 'no such column']) {
    assert.ok(!tekst.includes(leke), 'kliendile lekkis "' + leke + '": ' + tekst);
  }
  assert.match(v.keha.error, /^[A-ZÄÖÜÕ]/, 'veateade on eestikeelne lause: ' + v.keha.error);
  assert.ok(veavoog.join(' ').includes('no such column'),
    'paris pohjus peab jouma SERVERI logisse, mitte kaduma: ' + JSON.stringify(veavoog));
  db.close();
  console.log('PASS hanked API: sisemine viga jaab serverisse, klient saab 500 ja eestikeelse lause');
}

// --- J: katkine keha ---------------------------------------------------------
{
  const db = testDb();
  const syntaks = await kutsu(db, 'POST /api/hanked/state', {
    readBody: async () => { throw new SyntaxError('Unexpected token } in JSON at position 5'); },
  });
  assert.equal(syntaks.kood, 400, 'vigane JSON on 400, mitte 500');
  assert.ok(!/Unexpected token/.test(JSON.stringify(syntaks.keha)), 'ingliskeelne parseri viga ei lahe kliendile');

  const suur = await kutsu(db, 'POST /api/hanked/run', {
    readBody: async () => { throw new Error('Päring liiga suur'); },
  });
  assert.equal(suur.kood, 400);
  assert.match(suur.keha.error, /liiga suur/);

  const muu = await kutsu(db, 'POST /api/hanked/note', {
    readBody: async () => { throw new Error('ECONNRESET read /dev/fd/7'); },
  });
  assert.equal(muu.kood, 400);
  assert.ok(!/ECONNRESET|dev\/fd/.test(JSON.stringify(muu.keha)), 'voo viga ei lahe kliendile: ' + JSON.stringify(muu.keha));
  db.close();
  console.log('PASS hanked API: katkine keha annab 400 ilma ingliskeelse prahita');
}

// --- K: server.mjs kaivitusjarjekord -----------------------------------------
// cleanupOrphans lugeb hanke_runs-ist. Enne migrateHanked-i kutsutuna viskab ta
// "no such table" ja kuna see on mooduli tasemel, EI KAIVITU server uldse.
{
  const toores = new DatabaseSync(join(TMP, 'toores.sqlite'));
  assert.throws(() => cleanupOrphans(toores), /no such table/i,
    'ilma migratsioonita peab cleanupOrphans kukkuma - seega jarjekord loeb');
  migrateHanked(toores);
  assert.equal(cleanupOrphans(toores), 0, 'parast migratsiooni tootab');
  toores.close();

  const src = readFileSync(join(ROOT, 'server.mjs'), 'utf8');
  const kood = src.split('\n').filter((r) => !/^\s*\/\//.test(r)).join('\n');
  const iInit = kood.indexOf('initSales(db)');
  const iMig = kood.search(/^\s*migrateHanked\(db\)/m);
  const iOrb = kood.search(/cleanupOrphans\(db/m);
  assert.ok(iMig > 0, 'server.mjs peab kutsuma migrateHanked(db)');
  assert.ok(iOrb > 0, 'server.mjs peab kutsuma cleanupOrphans(db)');
  assert.ok(iInit > 0 && iMig > iInit, 'migrateHanked kaib initSales(db) JARELE');
  assert.ok(iOrb > iMig, 'cleanupOrphans kaib migrateHanked-i JARELE, muidu "no such table"');
  // boot_id tuleb hanked-runs.mjs mooduli tasemelt (BOOT_ID) - server.mjs ei pea
  // teda tekitama. Kui keegi hakkab teda server.mjs-is genereerima, on see teadlik muudatus.
  assert.ok(!/BOOT_ID\s*=/.test(kood), 'boot_id sunnib lib/hanked-runs.mjs-is, mitte server.mjs-is');
  console.log('PASS hanked API: migrateHanked -> cleanupOrphans jarjekord on lukus');
}

// --- L: autentimine ----------------------------------------------------------
// POST /api/hanked/run KAIVITAB protsessi - see on faili koige ohtlikum otspunkt.
// Kaitse ei ole marsruudi sees, vaid server.mjs-i uldvalves (host + CSRF + ainult
// 127.0.0.1). Seega peab see valve olema marsruudi valiku EES.
{
  const src = readFileSync(join(ROOT, 'server.mjs'), 'utf8');
  const kood = src.split('\n').filter((r) => !/^\s*\/\//.test(r)).join('\n');
  const iHost = kood.indexOf("'Host ei ole lubatud'");
  const iCsrf = kood.indexOf('x-crm-csrf');
  const iRuuter = kood.indexOf('if (routes[key])');
  assert.ok(iHost > 0 && iCsrf > 0 && iRuuter > 0, 'valved ja ruuter peavad olemas olema');
  assert.ok(iHost < iRuuter, 'host-valve peab olema marsruudi valiku ees');
  assert.ok(iCsrf < iRuuter, 'CSRF-valve peab olema marsruudi valiku ees (POST /api/hanked/run kaivitab protsessi)');
  assert.match(kood, /server\.listen\(cfg\.port,\s*'127\.0\.0\.1'/, 'server kuulab AINULT localhostis');
  // Hangete marsruudid tulevad extraRoutes-ist samasse `routes` objekti - ehk
  // sama valve taha. Eraldi, valvest moodaminevat kasitlust ei tohi olla.
  assert.ok(!/api\/hanked/.test(kood.slice(iRuuter)), 'hangete marsruute ei tohi valvest mooda kasitleda');
  console.log('PASS hanked API: kaivitusotspunkt on sama valve taga mis koik teised POST-id');
}

// --- M: runsView ja marsruut annavad sama jooksu ------------------------------
{
  const db = testDb();
  const spawnFn = valeSpawn();
  const a = await kutsu(db, 'POST /api/hanked/run', { keha: { cmd: 'gate' }, spawnFn });
  const v = await kutsu(db, 'GET /api/hanked/runs');
  const rida = v.keha.runs.find((r) => r.id === a.keha.id);
  assert.ok(rida, 'kaivitatud jooks peab nimekirjast leiduma sama id-ga');
  assert.equal(rida.state, 'käib');
  assert.equal(rida.oma, true, 'oma jooks - "Peata" nupp saab midagi teha');
  assert.equal(rida.id, runsView(db)[0].id, 'id kuju peab kahel teel kokku langema');
  db.close();
  console.log('PASS hanked API: kaivitatud jooks on nimekirjas sama id-ga');
}

// --- N: verdikt tuleb API-st kaasa ------------------------------------------
// Tabel naitas ainult arvu ja ALLTOOVOTT oli nahtamatu (teda EI SAA punktidest
// tagasi arvutada). Verdikt on nuud baasis - ta peab ka ule juhtme tulema.
{
  const db = testDb();
  upsertHange(db, { ref: 'w1', title: 'Veebileht', segment: 'nišš' });
  db.prepare('UPDATE hanked SET score = 40, verdict = ? WHERE ref = ?').run('ALLTÖÖVÕTT', 'w1');

  const nimekiri = await kutsu(db, 'GET /api/hanked');
  assert.equal(nimekiri.keha.hanked[0].verdict, 'ALLTÖÖVÕTT', 'nimekiri peab verdikti kaasa andma');
  const detail = await kutsu(db, 'POST /api/hanked/detail', { keha: { ref: 'w1' } });
  assert.equal(detail.keha.hange.verdict, 'ALLTÖÖVÕTT', 'detail peab verdikti kaasa andma');
  assert.equal(detail.keha.hange.score, 40, 'punktid jaavad verdikti korvale alles');
  db.close();
  console.log('PASS hanked API: verdikt tuleb nimekirja ja detaili vastusesse');
}

// --- O: sakimark tuleb /api/state vastusest ----------------------------------
// Mark ilmus varem alles parast esimest sakiklikki, sest teda arvutas ainult
// vaade. load() jookseb iga 60 s ja ta EI TOHI selleks kogu hangete nimekirja
// parida - vastuses on UKS COUNT.
{
  const src = readFileSync(join(ROOT, 'server.mjs'), 'utf8');
  const kood = src.split('\n').filter((r) => !/^\s*\/\//.test(r)).join('\n');
  const i = kood.indexOf('function state()');
  const j = kood.indexOf('const routes = {');
  assert.ok(i > 0 && j > i, 'state() peab server.mjs-is olema');
  const keha = kood.slice(i, j);
  assert.match(keha, /hankedKiireid:\s*kiireidLoend\(db\)/,
    'state() peab andma kiireloomuliste loenduri (uks COUNT, mitte kogu nimekiri)');
  assert.doesNotMatch(keha, /listHanked\(/, 'load() ei tohi kogu hangete nimekirja kaasa vedada');
  assert.match(kood, /import \{[^}]*kiireidLoend[^}]*\} from '\.\/lib\/hanked\.mjs'/,
    'loendur tuleb lib/hanked.mjs-ist, mitte server.mjs-i oma SQL-ist');
  console.log('PASS hanked API: sakimark tuleb /api/state loendurist');
}

console.log('');
console.log('Värav gate-hanked-api: kõik plokid rohelised.');
