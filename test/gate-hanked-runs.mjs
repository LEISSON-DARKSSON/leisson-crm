// ULESANNE 7: kaivitaja lukuga, orbude koristus ja lapse stdout-i lugemine.
//
// Baas laheb OS-i tmp-kausta - monteeritud kettal SQLite lukustust ei toetata
// (sama pohjus mis gate-hanked.mjs-is).
//
// MIKS SIIN ON PARIS LAPSPROTSESSE. Kolme asja EI SAA mockiga toestada:
//   1. 'exit' vs 'close' - mock ei tekita torujuhet, seega ei tekita ka viivitust,
//      mille tottu 'exit' joudis enne viimaseid logiridu;
//   2. logipuhverduse VOIT - naiivne "loe-muuda-kirjuta iga rea peale" tuleb valja
//      alles paris ridade voos;
//   3. kaks kirjutajat - lapse BEGIN IMMEDIATE hoiab paris kirjutuslukku, mida
//      mock ei hoia.
// Vorku EI kasutata: lapsed on ajutised skriptid tmp-kaustas.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { open } from '../lib/db.mjs';
import { migrateHanked } from '../lib/hanked.mjs';
import { CMD, BOOT_ID, LOG_MAX, RIDA_MAX, cmdView, startRun, finishRun, stopRun,
  cleanupOrphans, runsView } from '../lib/hanked-runs.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'hanked-runs-'));
let jrk = 0;

function testDb() {
  const db = new DatabaseSync(join(TMP, 'r' + (++jrk) + '.sqlite'));
  db.exec('PRAGMA foreign_keys = ON');
  migrateHanked(db);
  return db;
}

// Valelaps: loeb kutseid, et "teist protsessi ei teki" oleks MOODETUD, mitte usutud.
function valeSpawn(pid = 4242) {
  const f = (...a) => { f.kutseid++; f.argv.push(a); return { pid, stdout: { on() {} }, stderr: { on() {} }, on() {} }; };
  f.kutseid = 0; f.argv = [];
  return f;
}

// Baasikirjutuste loendur. Sama liides mis DatabaseSync (prepare/exec), seega
// koik moodulifunktsioonid tootavad selle peal muutmata kujul.
function loendur(db) {
  const arv = { kirjutusi: 0, busy: 0 };
  return {
    arv,
    proxy: {
      prepare(sql) {
        const st = db.prepare(sql);
        const kirjutus = /^\s*(insert|update|delete)/i.test(sql);
        return {
          run: (...a) => {
            if (kirjutus) arv.kirjutusi++;
            try { return st.run(...a); } catch (e) { if (/busy|locked/i.test(String(e && e.message))) arv.busy++; throw e; }
          },
          get: (...a) => st.get(...a),
          all: (...a) => st.all(...a),
        };
      },
      exec: (s) => db.exec(s),
    },
  };
}

const oota = (ms) => new Promise((r) => setTimeout(r, ms));

async function ootaLopp(db, id, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const r = db.prepare('SELECT * FROM hanke_runs WHERE id = ?').get(id);
    if (r && r.state !== 'käib') return r;
    if (Date.now() - t0 > ms) throw new Error('jooks ' + id + ' ei loppenud ' + ms + ' ms jooksul');
    await oota(20);
  }
}

// Ajutine lapsskript. Spawn-funktsioon antakse startRun-i sisse, seega valge
// nimekiri (CMD) jaab puutumata - laps on ikka paris protsess.
function skript(nimi, kood) {
  const p = join(TMP, nimi);
  writeFileSync(p, kood);
  return p;
}
const lapseks = (tee, env = {}) => () => spawn(process.execPath, [tee], { env: { ...process.env, ...env } });

const viimaneRida = (log) => String(log || '').trim().split('\n').pop();

// ---------------------------------------------------------------------------
// A (plaan 1): uks jooks korraga kasu kohta.
// KORVALEKALDE plaanist: teine paralleelne kask on 'gate', mitte 'history' -
// agent/hanked-history.mjs ei ole veel olemas (ulesanne 12) ja startRun keeldub
// puuduvast skriptist (vt K). Plaani naidiskood oleks spawninud olematu faili.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const fake = valeSpawn();
  const r1 = startRun(db, 'sync', {}, { spawnFn: fake });
  assert.equal(r1.state, 'käib');
  assert.throws(() => startRun(db, 'sync', {}, { spawnFn: fake }), /käib juba/, 'teist jooksu ei alga');
  assert.equal(fake.kutseid, 1, 'luku taha jaanud paring EI TOHI teist protsessi tekitada');
  const r2 = startRun(db, 'gate', {}, { spawnFn: fake });
  assert.equal(fake.kutseid, 2, 'teine kask tohib paralleelselt kaia');
  finishRun(db, r1.id, { ok: true, rows: 41 });
  const v = runsView(db);
  assert.equal(v.find((x) => x.id === r1.id).state, 'tehtud');
  assert.equal(v.find((x) => x.id === r1.id).rows, 41);
  assert.equal(v.find((x) => x.id === r2.id).state, 'käib');
  // Lukk vabaneb: sama kask tohib uuesti alata.
  const r3 = startRun(db, 'sync', {}, { spawnFn: fake });
  assert.ok(r3.id > r1.id);
  db.close();
  console.log('PASS runs: üks jooks korraga käsu kohta');
}

// ---------------------------------------------------------------------------
// B (plaan 2): serveri taaskaivitus ei jata spinnerit.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  startRun(db, 'sync', {}, { spawnFn: valeSpawn(999999) });
  const n = cleanupOrphans(db, { alive: () => false });
  assert.equal(n, 1);
  assert.match(runsView(db)[0].error, /taaskäivitati/);
  assert.equal(runsView(db)[0].state, 'katkestatud');
  db.close();
  console.log('PASS runs: serveri taaskäivitus ei jäta spinnerit');
}

// ---------------------------------------------------------------------------
// C (p1): lukk on AATOMNE - ta peab pidama ka siis, kui kontroll vahele jatta.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const lisa = (cmd, state) => db.prepare(
    "INSERT INTO hanke_runs (cmd,args,state,started) VALUES (?,?,?,datetime('now'))").run(cmd, '{}', state);
  lisa('sync', 'käib');
  assert.throws(() => lisa('sync', 'käib'), /UNIQUE constraint failed/,
    'kontrollist moodaminek EI TOHI teist kaib-rida sisse lasta');
  lisa('sync', 'tehtud');
  lisa('sync', 'viga');
  lisa('gate', 'käib');
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM hanke_runs WHERE state='käib'").get().c, 2,
    'lukk kaib UHE kasu kohta, mitte kogu tabeli peale');
  db.close();
  console.log('PASS runs: 409-lukk on osaline unikaalindeks, mitte kaks lauset');
}

// ---------------------------------------------------------------------------
// C2 (p1): vana baas, kus juba on kaks paralleelset kaib-rida - migratsioon peab
// indeksi ikka peale saama, muidu server ei kaivitu enam uldse.
// ---------------------------------------------------------------------------
{
  const db = new DatabaseSync(join(TMP, 'vana.sqlite'));
  db.exec(`CREATE TABLE hanke_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cmd TEXT NOT NULL, args TEXT, state TEXT NOT NULL,
    started TEXT NOT NULL, finished TEXT, progress TEXT, rows INTEGER, log TEXT, error TEXT, pid INTEGER)`);
  for (let i = 0; i < 3; i++) {
    db.prepare("INSERT INTO hanke_runs (cmd,args,state,started) VALUES ('sync','{}','käib',datetime('now'))").run();
  }
  migrateHanked(db);
  const kaib = db.prepare("SELECT * FROM hanke_runs WHERE state='käib'").all();
  assert.equal(kaib.length, 1, 'vanad dublikaadid suletakse, uusim jaab');
  assert.equal(kaib[0].id, 3, 'alles jaab UUSIM, mitte suvaline');
  assert.match(db.prepare('SELECT error FROM hanke_runs WHERE id = 1').get().error, /taaskäivitati/);
  assert.ok(db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='index' AND name='idx_runs_kaib'").get(),
    'indeks peab vanal baasil olemas olema');
  assert.ok(db.prepare('PRAGMA table_info(hanke_runs)').all().some((c) => c.name === 'boot_id'),
    'boot_id lisatakse ALTER TABLE-ga, mitte umberehitusega');
  db.close();
  console.log('PASS runs: migratsioon lisab luku ka vanale baasile');
}

// ---------------------------------------------------------------------------
// D (p1): kui spawn ise kukub, ei tohi lukk baasi kinni jaada.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  assert.throws(() => startRun(db, 'sync', {}, { spawnFn: () => { throw new Error('ENOENT'); } }),
    /ENOENT|Käivitamine/, 'spawni viga tuleb edasi anda');
  const r = db.prepare('SELECT * FROM hanke_runs ORDER BY id DESC').get();
  assert.notEqual(r.state, 'käib', 'kukkunud kaivitus ei tohi lukku kinni hoida: ' + r.state);
  const uus = startRun(db, 'sync', {}, { spawnFn: valeSpawn() });
  assert.equal(uus.state, 'käib', 'lukk peab olema vaba');
  db.close();
  console.log('PASS runs: kukkunud käivitus ei jäta lukku kinni');
}

// ---------------------------------------------------------------------------
// E (p2): PARIS lapsprotsess ja lopetamise SUNDMUS.
//
// MOODETUD, MITTE EELDATUD. Kaks jooksuaega, molemad paris lapsega:
//   Linux / Node 22.23.2 ja Windows / Node 25.6.1, 200 ... 200 000 rida
//   (kuni 8 MB) ja vanem vahepeal 1,5 s sunkroonselt blokeeritud:
//   TAVALISELT VALJUVA lapse puhul nagid 'exit' ja 'close' TAPSELT sama hulga
//   baite. Plaani vaide "exit kaotab viimased read" EI reprodutseeru nii.
//   Vahe tuleb valja siis, kui lapse stdout jaab LAPSELAPSELE: Linuxis naeb
//   'exit' voogu ilma viimase reata ja 'close' koos sellega (poordtest kukub).
//   Windowsis ei joua paritud kirjutus ULDSE kohale - seega seal seda juhtumit
//   ei saa kusida ja plokk E2 jaab ausalt vahele.
// Otsus: 'close'. Ta on ainus, mis on oige ka lapselapse korral, ja ta ei ole
// kunagi halvem - Node lubab 'exit' ajal voo veel lahti olla.
const MURA = skript('mura.mjs', `
import { spawn } from 'node:child_process';
const n = Number(process.env.RIDU || 1200);
for (let i = 1; i <= n; i++) process.stdout.write(JSON.stringify({ progress: 'rida ' + i, rows: i }) + '\\n');
if (process.env.LAPSELAPS === '1') {
  // Lapselaps parib stdout-i ja kirjutab PARAST lapse surma.
  spawn(process.execPath, ['-e', 'setTimeout(() => process.stdout.write("LOPPRIDA\\\\n"), 400)'],
    { stdio: ['ignore', 'inherit', 'ignore'] }).unref();
} else {
  process.stdout.write('LOPPRIDA\\n');
}
`);

{
  const db = testDb();
  const r = startRun(db, 'sync', {}, { spawnFn: lapseks(MURA, { RIDU: '40000' }) });
  const lopp = await ootaLopp(db, r.id);
  assert.equal(lopp.state, 'tehtud', 'edukas laps annab tehtud: ' + lopp.error);
  assert.equal(viimaneRida(lopp.log), 'LOPPRIDA',
    'VIIMANE logirida peab kohal olema: ' + JSON.stringify(String(lopp.log).slice(-120)));
  assert.equal(lopp.rows, 40000, 'viimane progressirida annab rows-i');
  assert.ok(String(lopp.log).length <= LOG_MAX, 'logi on lubatud pikkuses: ' + String(lopp.log).length);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanke_runs').get().c, 1,
    'uks jooks = uks rida (exit + close ei tohi kaks korda kirjutada)');
  db.close();
  console.log('PASS runs: päris lapse 1,5 MB väljundist ei kao ükski rida');
}

// E2: lapselaps hoiab stdout-i - AINUS juhtum, kus 'exit' ja 'close' lahknevad.
if (process.platform === 'win32') {
  console.log('VAHELE (win32) runs: päritud stdout sulgub lapsega, rida ei jõua kunagi kohale');
} else {
  const db = testDb();
  const r = startRun(db, 'sync', {}, { spawnFn: lapseks(MURA, { RIDU: '200', LAPSELAPS: '1' }) });
  const lopp = await ootaLopp(db, r.id);
  assert.equal(lopp.state, 'tehtud', 'edukas laps annab tehtud: ' + lopp.error);
  assert.equal(viimaneRida(lopp.log), 'LOPPRIDA',
    'lapselapse rida peab kohal olema (close, mitte exit): ' + JSON.stringify(String(lopp.log).slice(-120)));
  db.close();
  console.log('PASS runs: lapselapse viimane rida ei kao (close, mitte exit)');
}

// ---------------------------------------------------------------------------
// F (p3): logi puhverdatakse. Naiivne "loe-muuda-kirjuta iga rea peale" MOODETAKSE
// samade ridade peal, et voit ei oleks lubadus vaid number.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const { proxy, arv } = loendur(db);
  const r = startRun(proxy, 'sync', {}, { spawnFn: lapseks(MURA, { RIDU: '1200' }) });
  const lopp = await ootaLopp(db, r.id);
  assert.equal(lopp.state, 'tehtud');
  const puhverdatud = arv.kirjutusi;

  // Naiivne vordlus: tapselt see, mida plaani naidiskood teeb - iga rea peale uks
  // SELECT + UPDATE logile ja progressireale veel uks UPDATE.
  const db2 = testDb();
  const { proxy: p2, arv: a2 } = loendur(db2);
  const id2 = p2.prepare("INSERT INTO hanke_runs (cmd,args,state,started) VALUES ('sync','{}','käib',datetime('now'))")
    .run().lastInsertRowid;
  for (let i = 1; i <= 1200; i++) {
    p2.prepare('UPDATE hanke_runs SET progress = ?, rows = COALESCE(?, rows) WHERE id = ?').run('rida ' + i, i, id2);
    const vana = p2.prepare('SELECT log FROM hanke_runs WHERE id = ?').get(id2)?.log ?? '';
    p2.prepare('UPDATE hanke_runs SET log = ? WHERE id = ?').run((vana + 'rida ' + i + '\n').slice(-LOG_MAX), id2);
  }
  const naiivne = a2.kirjutusi;
  console.log('   mõõdetud: naiivne ' + naiivne + ' baasikirjutust · puhverdatud ' + puhverdatud);
  assert.ok(naiivne >= 2400, 'naiivne peab olema kaks kirjutust rea kohta: ' + naiivne);
  assert.ok(puhverdatud * 20 < naiivne,
    'puhverdatud jooks peab olema kordades odavam: ' + puhverdatud + ' vs ' + naiivne);
  db.close(); db2.close();
  console.log('PASS runs: logi puhverdatakse vanema mälus');
}

// ---------------------------------------------------------------------------
// G (p4): rida ilma reavahetuseta ei tohi puhvrit piiramatult kasvatada.
// ---------------------------------------------------------------------------
{
  const PIKK = skript('pikk.mjs', `
const n = Number(process.env.MARKE || 400000);
process.stdout.write('x'.repeat(n));
process.stdout.write('\\n');
process.stdout.write('LOPPRIDA\\n');
`);
  const db = testDb();
  const r = startRun(db, 'sync', {}, { spawnFn: lapseks(PIKK, { MARKE: '400000' }) });
  const lopp = await ootaLopp(db, r.id);
  assert.equal(lopp.state, 'tehtud');
  assert.ok(String(lopp.log).length <= LOG_MAX, 'logi jaab lae alla: ' + String(lopp.log).length);
  assert.match(String(lopp.log), /kärbitud/, 'karbe peab olema NAHTAV, mitte vaikne: ' + String(lopp.log).slice(-200));
  const m = String(lopp.log).match(/kärbitud: (\d+)/);
  assert.ok(m && Number(m[1]) >= 400000 - RIDA_MAX, 'karbe suurus on kirjas: ' + (m && m[1]));
  assert.equal(viimaneRida(lopp.log), 'LOPPRIDA', 'pika rea JAREL tulev rida ei tohi kaduda');
  db.close();
  console.log('PASS runs: ülipikk rida kärbitakse nähtavalt');
}

// ---------------------------------------------------------------------------
// H (p5): pid-i ei usuta ilma omanikuta. Teise serveri-instantsi jooks on ALATI orb,
// olenemata pid-ist, ja teda EI TAPETA.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  // pid = meie enda protsess: alive(pid) utleks "elab" ka parast taaskaivitust.
  const r = startRun(db, 'sync', {}, { spawnFn: valeSpawn(process.pid) });
  let aliveKutsuti = 0; let tapetud = 0;
  const n = cleanupOrphans(db, {
    bootId: 'teine-server',
    alive: () => { aliveKutsuti++; return true; },
    kill: () => { tapetud++; },
  });
  assert.equal(n, 1, 'teise serveri jooks on orb ka elava pid-iga');
  assert.equal(aliveKutsuti, 0, 'voora jooksu pid-i EI KUSITA');
  assert.equal(tapetud, 0, 'orbu EI TAPETA pid-i jargi');
  assert.match(runsView(db)[0].error, /taaskäivitati/);

  // Sama serveri elav jooks jaab puutumata.
  const db2 = testDb();
  const r2 = startRun(db2, 'sync', {}, { spawnFn: valeSpawn(process.pid) });
  assert.equal(cleanupOrphans(db2, { alive: () => true }), 0, 'oma elav jooks ei ole orb');
  assert.equal(db2.prepare('SELECT state FROM hanke_runs WHERE id = ?').get(r2.id).state, 'käib');

  // stopRun ei tohi tappa voorast pid-i.
  const db3 = testDb();
  const r3 = startRun(db3, 'sync', {}, { spawnFn: valeSpawn(process.pid) });
  let tapeti = 0;
  const v = stopRun(db3, r3.id, { bootId: 'teine-server', kill: () => { tapeti++; } });
  assert.equal(tapeti, 0, 'teise serveri jooksu pid-i EI TAPETA');
  assert.equal(v.tapetud, false);
  assert.equal(db3.prepare('SELECT state FROM hanke_runs WHERE id = ?').get(r3.id).state, 'katkestatud');

  // Oma jooksu TAPAB.
  const db4 = testDb();
  const r4 = startRun(db4, 'sync', {}, { spawnFn: valeSpawn(4242) });
  let pid = null;
  const v4 = stopRun(db4, r4.id, { kill: (p) => { pid = p; } });
  assert.equal(pid, 4242, 'oma jooks tapetakse');
  assert.equal(v4.tapetud, true);
  assert.equal(stopRun(db4, r4.id, { kill: () => {} }).ok, false, 'lopetatud jooksu ei saa uuesti peatada');
  assert.ok(r.id && r3.id);
  db.close(); db2.close(); db3.close(); db4.close();
  console.log('PASS runs: pid usaldatakse ainult koos boot_id-ga');
}

// ---------------------------------------------------------------------------
// I (p6): lapse enda veateade voidab uldise "Protsess loppes koodiga 1" ule.
// ---------------------------------------------------------------------------
{
  const VIGA = skript('viga.mjs', `
process.stdout.write(JSON.stringify({ progress: 'laen RSS-i' }) + '\\n');
process.stdout.write(JSON.stringify({ error: 'RSS-i ei saanud: RHR vastas 502' }) + '\\n');
process.exitCode = 1;
`);
  const db = testDb();
  const r = startRun(db, 'sync', {}, { spawnFn: lapseks(VIGA) });
  const lopp = await ootaLopp(db, r.id);
  assert.equal(lopp.state, 'viga');
  assert.equal(lopp.error, 'RSS-i ei saanud: RHR vastas 502',
    'lapse sisuline viga EI TOHI uldise teate alla kaduda: ' + lopp.error);
  db.close();

  // Kui laps ei utle midagi, jaab uldine teade - muidu oleks punane jooks ilma pohjuseta.
  const VAIKNE = skript('vaikne.mjs', 'process.exitCode = 3;\n');
  const db2 = testDb();
  const r2 = startRun(db2, 'sync', {}, { spawnFn: lapseks(VAIKNE) });
  const lopp2 = await ootaLopp(db2, r2.id);
  assert.equal(lopp2.state, 'viga');
  assert.match(lopp2.error, /koodiga 3/, 'vaikiv laps saab uldise teate: ' + lopp2.error);
  db2.close();
  console.log('PASS runs: lapse enda veateade jääb alles');
}

// ---------------------------------------------------------------------------
// J (p7): kask on valge nimekirja taga ja argumendid valideeritakse.
// Shelli ei ole (spawn ilma shell:true), seega see ei ole shell-injection, vaid
// argv-hugiene: reavahetus voi '=' teeks --k=v kuju mitmemotteliseks ja objekt
// annaks argv-sse '[object Object]'.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const fake = valeSpawn();
  assert.throws(() => startRun(db, 'kustuta-koik', {}, { spawnFn: fake }), /Tundmatu käsk/);
  // Prototuubi votmed EI TOHI valgest nimekirjast labi minna.
  for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.throws(() => startRun(db, k, {}, { spawnFn: fake }), /Tundmatu käsk/, 'prototuubi voti: ' + k);
  }
  const halvad = [
    [{ alates: 'a\nb' }, /juhtmärki/],
    [{ alates: 'a=b' }, /võrdusmärki/],
    [{ alates: 'x'.repeat(500) }, /liiga pikk/],
    [{ alates: { kuu: 1 } }, /väärtus/],
    [{ alates: [1, 2] }, /väärtus/],
    [{ 'kuri arg': 'x' }, /argumendi nimi/],
    [{ alates: NaN }, /väärtus/],
  ];
  for (const [args, muster] of halvad) {
    assert.throws(() => startRun(db, 'sync', args, { spawnFn: fake }), muster,
      'peab keelduma: ' + JSON.stringify(args));
  }
  assert.equal(fake.kutseid, 0, 'vigane paring ei tohi protsessi tekitada');
  assert.throws(() => startRun(db, 'sync', 'alates=2025', { spawnFn: fake }), /argumendid/);

  // Lubatud argument jouab argv-sse --votme=vaartus kujul.
  const r = startRun(db, 'sync', { alates: '2025-01', kirjuta: true }, { spawnFn: fake });
  const argv = fake.argv[0][1];
  assert.ok(argv[0].endsWith('agent/hanked-sync.mjs') || argv[0].endsWith('agent\\hanked-sync.mjs'), argv[0]);
  assert.deepEqual(argv.slice(1), ['--alates=2025-01', '--kirjuta=true']);
  assert.equal(JSON.parse(db.prepare('SELECT args FROM hanke_runs WHERE id = ?').get(r.id).args).alates, '2025-01');
  db.close();
  console.log('PASS runs: käskude valge nimekiri ja argumentide valve');
}

// ---------------------------------------------------------------------------
// K (p8): agent/hanked-history.mjs ja agent/hanked-docs.mjs ei ole veel olemas
// (ulesanded 12 ja 14). Puuduv skript peab andma eestikeelse vea, mitte spawnima
// olematut faili ja loppema arusaamatu Node-i veaga.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const fake = valeSpawn();
  const vaade = cmdView();
  for (const cmd of ['history', 'docs']) {
    assert.equal(vaade[cmd].valmis, false, cmd + ' ei ole veel valmis');
    assert.throws(() => startRun(db, cmd, {}, { spawnFn: fake }), /ei ole veel valmis/,
      cmd + ' peab andma eestikeelse vea');
  }
  assert.equal(fake.kutseid, 0, 'puuduvat skripti ei spawnita');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanke_runs').get().c, 0,
    'keeldutud kask ei tohi jooksurida jatta');
  for (const cmd of ['sync', 'gate']) assert.equal(vaade[cmd].valmis, true, cmd + ' on valmis');
  // valmis tuleb KETTALT, mitte kasitsi hoitavast lipust.
  assert.equal(cmdView(join(TMP, 'puudub')).sync.valmis, false, 'valmis loetakse kettalt');
  db.close();
  console.log('PASS runs: veel valmimata käsk ütleb seda eesti keeles');
}

// ---------------------------------------------------------------------------
// L (p9): id tuup on labivalt sama. node:sqlite lastInsertRowid on siin Node-is
// number, aga tuup ei ole lubatud - BigInt-i korral ei klapiks === ja ulesande 10
// nupp ei leiaks oma jooksu. Normaliseerime ja LUKUSTAME selle testiga.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const r = startRun(db, 'sync', {}, { spawnFn: valeSpawn() });
  assert.equal(typeof r.id, 'number');
  assert.ok(Number.isSafeInteger(r.id));
  const v = runsView(db);
  assert.equal(typeof v[0].id, 'number');
  assert.ok(v.some((x) => x.id === r.id), '=== peab klappima ilma teisenduseta');
  // Marsruut annab id-d JSON-ist ehk numbrina, aga vanad kliendid saadavad stringi.
  assert.equal(stopRun(db, String(r.id), { kill: () => {} }).ok, true, 'stringist id peab toimima');
  assert.equal(stopRun(db, 'praht', { kill: () => {} }).ok, false);
  assert.doesNotThrow(() => JSON.stringify({ runs: runsView(db), tasks: cmdView() }), 'vaade peab JSON-i minema');
  assert.equal(runsView(db)[0].oma, true, 'oma jooks on margitud (ulesanne 10 nupp)');
  db.close();
  console.log('PASS runs: id on läbivalt number');
}

// ---------------------------------------------------------------------------
// M (p10): KAKS KIRJUTAJAT. Laps hoiab BEGIN IMMEDIATE-ga kirjutuslukku, vanem
// kirjutab samal ajal hanke_runs-i. Moodame, kas tuleb SQLITE_BUSY ja kas logi kaob.
// See on ulesande 11 otsuse sisend: kas laps tohib baasi avada.
// ---------------------------------------------------------------------------
{
  const dbTee = join(TMP, 'kaks-kirjutajat.sqlite');
  const db = open({ dbPath: dbTee });
  migrateHanked(db);
  const KIRJUTAJA = skript('kirjutaja.mjs', `
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.env.TEST_DB);
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA journal_mode = WAL');
db.exec('BEGIN IMMEDIATE');
for (let i = 0; i < 50; i++) db.prepare('INSERT INTO hanked (ref,title) VALUES (?,?)').run('L' + i, 'Laps ' + i);
for (let i = 1; i <= 400; i++) process.stdout.write(JSON.stringify({ progress: 'kirjutan ' + i, rows: i }) + '\\n');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
db.exec('COMMIT');
db.close();
process.stdout.write('LOPPRIDA\\n');
`);
  const { proxy, arv } = loendur(db);
  const r = startRun(proxy, 'sync', {}, { spawnFn: lapseks(KIRJUTAJA, { TEST_DB: dbTee }) });
  const lopp = await ootaLopp(db, r.id, 30000);
  assert.equal(lopp.state, 'tehtud', 'kahe kirjutaja jooks peab loppema: ' + lopp.error);
  // Siin EI SAA kusida viimast rida nagu plokis E: laps kasutab node:sqlite ja
  // Node kirjutab selle ExperimentalWarningu STDERR-i, mis jouab samasse logisse
  // stdout-i ridade JAREL (moodetud: 3 korda 5-st). Kusime sisu, mitte jarjekorda.
  assert.match(String(lopp.log), /LOPPRIDA/,
    'logi ei tohi kahe kirjutaja all kaduda: ' + JSON.stringify(String(lopp.log).slice(-160)));
  assert.match(String(lopp.log), /kirjutan 400/, 'viimased progressiread peavad kohal olema');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanked').get().c, 50, 'lapse tehing joudis baasi');
  console.log('   mõõdetud: SQLITE_BUSY ' + arv.busy + ' korda · vanema baasikirjutusi ' + arv.kirjutusi);
  assert.equal(arv.busy, 0, 'busy_timeout peab katma lapse tehingu kestuse');
  db.close();
  console.log('PASS runs: kaks kirjutajat ei anna SQLITE_BUSY-t ega kaota logi');
}

console.log('');
console.log('Värav gate-hanked-runs: kõik plokid rohelised.');
