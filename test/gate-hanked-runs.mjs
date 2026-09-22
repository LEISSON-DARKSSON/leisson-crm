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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { open } from '../lib/db.mjs';
import { migrateHanked } from '../lib/hanked.mjs';
import { CMD, BOOT_ID, LOG_MAX, RIDA_MAX, cmdView, startRun, finishRun, stopRun,
  cleanupOrphans, runsView, elab, OTSE_BOOT } from '../lib/hanked-runs.mjs';
import { alustaOtseJooks } from '../agent/hanked-sync.mjs';

const JUUR = dirname(dirname(fileURLToPath(import.meta.url)));
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
// Absoluutne file:// URL agent/hanked-sync.mjs-ile - ajutises kaustas olev laps
// ei leia teda suhtelise teega.
const SYNC_TEE = pathToFileURL(join(JUUR, 'agent', 'hanked-sync.mjs')).href;

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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
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
// N (audit P1, 22.09.2026): OTSE_BOOT-prefiksiga rida on SÕLTUMATU jooks (Task
// Scheduler / käsurida), mitte serveri laps. cleanupOrphans margib täna IGA
// boot_id !== bootId rea orbuks pid-i kusimata (vt blokk H) - aga otsejooksu
// boot_id ei saagi KUNAGI serveri BOOT_ID-ga klappida, seega tabas see reegel
// elavaid otsejookse ALATI. alustaOtseJooks (agent/hanked-sync.mjs) juba
// eristab OTSE_BOOT-prefiksit ja kontrollib pid-i - cleanupOrphans peab tegema
// sama.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const jooks = alustaOtseJooks(db, { pid: process.pid, elab: () => true });
  assert.equal(
    jooks.pohjus,
    null,
    'esimene otsejooks peab algama takistuseta: ' + jooks.pohjus,
  );

  // Serveri taaskaivitus UUE boot_id-ga ei tohi elavat otsejooksu puutuda.
  const n = cleanupOrphans(db, {
    bootId: 'server-uus-boot-id',
    alive: () => true,
  });
  assert.equal(n, 0, 'elav otsejooks ei ole orb');
  assert.equal(
    db.prepare('SELECT state FROM hanke_runs WHERE id = ?').get(jooks.id).state,
    'käib',
    'elav otsejooks peab jääma käib-olekusse üle serveri taaskäivituse',
  );

  // Kaitse ei tohi olla kadunud: teine sama käsu katse peab endiselt lukku austama.
  const teine = alustaOtseJooks(db, { pid: process.pid, elab: () => true });
  assert.equal(
    teine.id,
    null,
    'teine otsejooks sama käsu peale ei tohi alata, kui esimene on elus',
  );
  assert.match(
    teine.pohjus,
    /käib juba/,
    'lukk peab olema nähtav: ' + teine.pohjus,
  );
  db.close();
  console.log(
    'PASS runs: elav otsejooks ei kaota kaitset serveri taaskäivitusel',
  );
}

// ---------------------------------------------------------------------------
// O (audit P1, 22.09.2026): surnud otsejooks EI TOHI jääda igaveseks 'käib'-
// olekusse kinni - ilma serverita ei koristaks teda kunagi keegi teine.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const jooks = alustaOtseJooks(db, { pid: 999999, elab: () => true });
  assert.equal(jooks.pohjus, null);
  const n = cleanupOrphans(db, {
    bootId: 'server-uus-boot-id',
    alive: () => false,
  });
  assert.equal(n, 1, 'surnud otsejooks peab minema orbuks');
  const rida = db
    .prepare('SELECT state, error FROM hanke_runs WHERE id = ?')
    .get(jooks.id);
  assert.equal(rida.state, 'katkestatud');
  assert.match(
    rida.error,
    /suri|ei ela/i,
    'põhjus peab olema nähtav: ' + rida.error,
  );
  db.close();
  console.log('PASS runs: surnud otsejooks märgitakse katkestatuks');
}

// ---------------------------------------------------------------------------
// Q (audit PR1b, F3, 22.09.2026): EPERM parast paris process.kill kutset peab
// tahendama ELAV ("protsess on olemas, aga ei ole meie oma"), mitte surnud. Vana
// `elab` puudis IGA erindi (sh EPERM) surmana - see voinuks vabastada otsejooksu
// luku vale ajal (kui pid kuulub teisele kasutajale/protsessile). Sustime vea
// OS-KUTSE PIIRIL (process.kill ise), mitte cleanupOrphans/alustaOtseJooks-i
// "alive"/"elab" parameetri kaudu - nii testime paris veakasitlust, mitte ainult
// harude valikut. Uhtegi paris signaali voorale protsessile EI saadeta -
// process.kill on selle bloki jooksul terves ulatuses mockitud.
// ---------------------------------------------------------------------------
{
  const algne = process.kill;
  try {
    process.kill = () => { const e = new Error('mock eperm'); e.code = 'EPERM'; throw e; };
    assert.equal(elab(4242), true, 'EPERM ei tõenda surma - protsess on olemas, ei ole meie oma');

    process.kill = () => { const e = new Error('mock esrch'); e.code = 'ESRCH'; throw e; };
    assert.equal(elab(4242), false, 'ESRCH (protsessi pole) on ainus KINDEL surma tunnus');

    process.kill = () => { throw new Error('tundmatu viga ilma koodita'); };
    assert.equal(elab(4242), true, 'tundmatu kontrolliviga ei tohi vaikselt tähendada "surnud"');

    process.kill = () => true; // päris "elab" juht - signaal 0 õnnestub
    assert.equal(elab(4242), true);
  } finally {
    process.kill = algne;
  }
  assert.equal(elab(0), false, 'pid puudub - ei ole midagi kontrollida');
  assert.equal(elab(null), false);

  // A2 regressioonimaatriksi juhtum: alustaOtseJooks-i VAIKEPARAMEETER (pidElab,
  // nüüd jagatud lib/hanked-runs.mjs `elab`-iga) peab käituma sama moodi PÄRIS
  // EPERM-i korral, mitte ainult otse kutsutud elab() funktsiooniga.
  const db2 = testDb();
  const esimene = alustaOtseJooks(db2, { pid: 424242 }); // vaikimisi elab = pidElab
  assert.equal(esimene.pohjus, null);
  const algne2 = process.kill;
  try {
    process.kill = () => { const e = new Error('mock eperm'); e.code = 'EPERM'; throw e; };
    const teine = alustaOtseJooks(db2, { pid: 424242 });
    assert.equal(teine.id, null, 'A2: EPERM ei tohi vabastada lukku (pid tundub elus)');
    assert.match(teine.pohjus, /käib juba/);
  } finally {
    process.kill = algne2;
  }
  db2.close();
  console.log('PASS runs: elab() eristab ESRCH-i (surnud) EPERM-ist ja tundmatust veast (Q/F3)');
}

// ---------------------------------------------------------------------------
// PID-1 (audit PR2, 22.09.2026): cleanupOrphans ILMA süstitud `alive`-argumendita
// (vaikimisi `elab`) peab käituma õigesti EPERM/tundmatu vea/ESRCH korral, kui
// process.kill on OS-KUTSE PIIRIL mockitud - mitte ainult siis, kui test ise
// annab valmis `alive`-vastuse (nagu kõik muud cleanupOrphans testid failis).
{
  const stsenaariumid = [
    { kood: 'EPERM', ootus: 'käib' },
    { kood: 'UNKNOWN', ootus: 'käib' },
    { kood: 'ESRCH', ootus: 'katkestatud' },
  ];
  for (const { kood, ootus } of stsenaariumid) {
    const db = testDb();
    db.prepare(`INSERT INTO hanke_runs (cmd, args, state, started, boot_id, pid)
        VALUES ('history', '{}', 'käib', datetime('now'), ?, 4242)`).run(OTSE_BOOT + 'fixture');
    const algne = process.kill;
    try {
      process.kill = () => {
        if (kood === 'UNKNOWN') throw new Error('tundmatu viga ilma koodita');
        const e = new Error('mock ' + kood); e.code = kood; throw e;
      };
      cleanupOrphans(db); // VAIKIMISI alive = elab, EI anta üle
    } finally {
      process.kill = algne;
    }
    const rida = db.prepare("SELECT state FROM hanke_runs WHERE cmd='history'").get();
    assert.equal(rida.state, ootus, kood + ': rida peaks jääma ' + ootus);
    if (ootus === 'käib') {
      assert.throws(() => startRun(db, 'history', {}, {
        spawnFn: () => { throw new Error('ei tohiks siia jõuda'); },
      }), /käib juba/);
    }
    db.close();
  }
  console.log('PASS runs: cleanupOrphans vaikeabifunktsioon EPERM/tundmatu/ESRCH OS-kutse piiril (PID-1)');
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
// P (audit P1, 22.09.2026): server-käivitatud jooks peab lugema lapse
// tyhjenes-teadet, mitte ainult väljumiskoodi. agent/hanked-sync.mjs main() EI
// SEA process.exitCode-i tühja-feedi harul (ainult catch-plokk seab 1), seega
// laps lõpeb koodiga 0 ka siis, kui hanke_sync.ok=0 samal sündmusel. Enne seda
// parandust näitas nupu kaudu käivitatud sünk 'tehtud', kui otsejooks samal
// sündmusel oleks andnud 'viga' (vt agent/hanked-sync.mjs lopetaOtseJooks).
// ---------------------------------------------------------------------------
{
  const TYHJENEB = skript('tyhjeneb.mjs', `
process.stdout.write(JSON.stringify({ progress: 'laen RSS-i' }) + '\\n');
process.stdout.write(JSON.stringify({ done: true, rows: 0, tyhjenes: true }) + '\\n');
`);
  const db = testDb();
  const r = startRun(db, 'sync', {}, { spawnFn: lapseks(TYHJENEB) });
  const lopp = await ootaLopp(db, r.id);
  assert.equal(lopp.state, 'viga', 'tühjenenud feed ei tohi näidata tehtud, kuigi laps lõpeb koodiga 0');
  assert.match(lopp.error, /tühjenes/i, 'põhjus peab ütlema, et feed tühjenes: ' + lopp.error);
  db.close();

  // Kontrolljuht: sama kuju, aga tyhjenes:false - PEAB jääma tehtud (mitte-regressioon).
  const EI_TYHJENE = skript('ei-tyhjene.mjs', `
process.stdout.write(JSON.stringify({ done: true, rows: 7, tyhjenes: false }) + '\\n');
`);
  const db2 = testDb();
  const r2 = startRun(db2, 'sync', {}, { spawnFn: lapseks(EI_TYHJENE) });
  const lopp2 = await ootaLopp(db2, r2.id);
  assert.equal(lopp2.state, 'tehtud', 'tavaline edukas jooks ei tohi minna vigaseks');
  assert.equal(lopp2.rows, 7);
  db2.close();
  console.log('PASS runs: server-käivitatud jooks loeb tühjenes-e, mitte ainult väljumiskoodi');
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
// K (p8): puuduv skript peab andma EESTIKEELSE vea, mitte spawnima olematut faili
// ja loppema arusaamatu Node-i veaga. `valmis` tuleb KETTALT, mitte kasitsi
// hoitavast lipust - tapselt sellepärast lakkas see plokk ise kehtimast, kui
// ulesanne 12 tegi hanked-history.mjs ja ulesanne 14 hanked-docs.mjs valmis.
// Valve ise on endiselt vajalik, seega teda mootatakse nuud KAUSTA peal, kus
// skripti EI OLE - see vaide ei aegu uhegi jargmise ulesandega.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const fake = valeSpawn();
  const vaade = cmdView();
  for (const cmd of ['sync', 'gate', 'history', 'docs']) {
    assert.equal(vaade[cmd].valmis, true, cmd + ' skript on kettal olemas');
  }
  const puudub = join(TMP, 'puudub');
  assert.equal(cmdView(puudub).docs.valmis, false, 'valmis loetakse kettalt');
  assert.equal(cmdView(puudub).sync.valmis, false, 'valmis loetakse kettalt');
  for (const cmd of ['docs', 'history']) {
    assert.throws(() => startRun(db, cmd, {}, { spawnFn: fake, root: puudub }),
      /ei ole veel valmis/, cmd + ' peab andma eestikeelse vea');
  }
  assert.equal(fake.kutseid, 0, 'puuduvat skripti ei spawnita');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanke_runs').get().c, 0,
    'keeldutud kask ei tohi jooksurida jatta');
  db.close();
  console.log('PASS runs: puuduv skript ütleb seda eesti keeles');
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

// ---------------------------------------------------------------------------
// R (regressioon, leitud ulesandes 12): NUPUVAJUTUS EI TEINUD MITTE MIDAGI.
//
// Ulesanne 11 pani agendid otsekaivitusel ISE hanke_runs rida kirjutama, et
// Task Scheduleri jooks jataks jalje. Aga nupust kaivitatuna on rida juba
// startRun-i tehtud JA ta hoiab osalist unikaalindeksit idx_runs_kaib - lapse
// oma INSERT kukkus tapselt sellesse lukku ja laps teatas "kaib juba - jai
// vahele". Vaade naitas rohelist jooksu, mis ei teinud mitte midagi.
//
// Valve: startRun annab lapsele HANKED_RUN_ID ja laps ei tee siis oma rida.
// Kaks vaidet: (1) muutuja LAHEB kaasa; (2) paris lapsprotsessiga jaab TAPSELT
// uks rida ja laps EI raporteeri vahelejattu.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const f = valeSpawn();
  const r = startRun(db, 'sync', {}, { spawnFn: f });
  const [, , opts] = f.argv[0];
  assert.ok(opts && opts.env, 'startRun peab lapsele keskkonna kaasa andma');
  assert.equal(opts.env.HANKED_RUN_ID, String(r.id),
    'HANKED_RUN_ID peab olema vanema jooksu id - ilma selleta kukub laps vanema luku peale '
    + 'ja nupuvajutus ei tee mitte midagi');
  db.close();
  console.log('  ok startRun annab lapsele HANKED_RUN_ID');
}

{
  // Paris laps, kes kaitub nagu agent: kutsub alustaOtseJooks-i ja lopetab.
  const AGENT = skript('vale-agent.mjs', [
    "import { DatabaseSync } from 'node:sqlite';",
    "import { alustaOtseJooks, lopetaOtseJooks } from " + JSON.stringify(SYNC_TEE) + ";",
    "const db = new DatabaseSync(process.env.BAAS);",
    "const j = alustaOtseJooks(db);",
    "if (j.pohjus) console.log(JSON.stringify({ vahele: true, pohjus: j.pohjus }));",
    "else console.log(JSON.stringify({ progress: 'tootan', rows: 7 }));",
    "lopetaOtseJooks(db, j.id, { ok: true, rows: 7 });",
    "db.close();",
  ].join('\n'));
  const baas = join(TMP, 'regress.sqlite');
  const db = new DatabaseSync(baas);
  migrateHanked(db);
  // Spawn, mis AUSTAB startRun-i antud keskkonda (lapseks() viskab selle ara).
  const spawnAus = (exe, argv, opts) => spawn(exe, [AGENT],
    { ...opts, env: { ...opts.env, BAAS: baas } });
  const r = startRun(db, 'sync', {}, { spawnFn: spawnAus });

  await new Promise((r2) => setTimeout(r2, 1500));
  const read = db.prepare("SELECT * FROM hanke_runs WHERE cmd = 'sync'").all();
  assert.equal(read.length, 1,
    'nupust kaivitatud jooks peab jatma TAPSELT uhe rea, sai ' + read.length);
  assert.equal(nrId(read[0].id), r.id, 'see rida peab olema vanema oma');
  assert.ok(!/vahele/i.test(String(read[0].log || '')),
    'laps EI TOHI raporteerida vahelejattu oma vanema luku parast: ' + read[0].log);
  assert.ok(/tootan/.test(String(read[0].log || '')), 'lapse paris too peab logisse jouma');
  db.close();
  console.log('  ok nupust kaivitatud laps ei kuku vanema luku peale');
}

// ---------------------------------------------------------------------------
// ENV-3/ENV-4 (audit PR2, 22.09.2026): startRun peab andma HANKED_RUN_ID õigesti
// ka 'history' ja 'docs' käsule, mitte ainult 'sync'-ile (vt plokk R ülalpool).
//
// RISK, MIS SEE PLOKK LUKUSTAB: agent/hanked-history.mjs main() ja
// agent/hanked-docs.mjs main() kutsuvad mõlemad alustaOtseJooks(db, { cmd: CMD_NIMI }),
// mille vaikeparameeter loeb vanemaJooks = process.env.HANKED_RUN_ID. Kui see
// muutuja on nupust käivitatud lapsele PUUDU (vale KASU_ENV konfiguratsioon vms),
// üritab alustaOtseJooks kirjutada OMA hanke_runs rea, põrkab startRun-i juba
// tehtud rea peale kehtivale osalisele unikaalindeksile (idx_runs_kaib) ja
// tagastab { id: null, vanem: null, pohjus: '... käib juba' } - MÕLEMAD main()
// funktsioonid loevad seda vahelejätuna ja lõpevad VAIKSELT koodiga 0 (nupp näeb
// rohelisena välja, aga ei tee mitte midagi - täpselt sama klass viga, mis plokis
// R juba ühe korra tabati sync-i puhul). Task 1 fikseeris süstimise üldiselt
// (KASU_ENV per-cmd), see plokk lukustab TÄPSELT history/docs juhtumi, et
// regressioon ei jääks vaikseks.
//
// SABOTAAŽIKONTROLL (CLAUDE.md "iga värav peab sabotaaži all punaseks minema"):
// KASU_ENV.history.runId ja KASU_ENV.docs.runId lib/hanked-runs.mjs-is käsitsi
// false peale keeratuna läks see plokk PUNASEKS (HANKED_RUN_ID oli undefined),
// tagasi true-le taastatuna roheliseks - kinnitatud käsitsi enne commiti.
{
  const db = testDb();
  const f = valeSpawn();

  const history = startRun(db, 'history', {}, { spawnFn: f });
  const [, , historyOpts] = f.argv[f.argv.length - 1];
  assert.ok(historyOpts && historyOpts.env, 'startRun (history) peab lapsele keskkonna kaasa andma');
  assert.equal(historyOpts.env.HANKED_RUN_ID, String(history.id),
    'history peab saama HANKED_RUN_ID - muidu kukub alustaOtseJooks() vanema luku peale ja '
    + 'main() lõpeb vaikselt vahelejätuna (koodiga 0, ENV-3)');

  const docs = startRun(db, 'docs', {}, { spawnFn: f });
  const [, , docsOpts] = f.argv[f.argv.length - 1];
  assert.ok(docsOpts && docsOpts.env, 'startRun (docs) peab lapsele keskkonna kaasa andma');
  assert.equal(docsOpts.env.HANKED_RUN_ID, String(docs.id),
    'docs peab saama HANKED_RUN_ID - sama vahelejätu-risk mis history puhul (ENV-4)');

  // Sümmeetriline kinnitus (odav lisakontroll - Task 1 testid katavad seda juba
  // test/gate-hanked-env.mjs ENV-5-s ja plokk A/K katab siin 'gate' jooksu):
  // 'gate' EI TOHI kunagi HANKED_RUN_ID-d saada, sest test/gate-hanked.mjs kutsub
  // alustaOtseJooks-i ISE oma fikstuuribaaside peal - pärandatud run-id ajaks selle
  // segi.
  const gate = startRun(db, 'gate', {}, { spawnFn: f });
  const [, , gateOpts] = f.argv[f.argv.length - 1];
  assert.equal(gateOpts.env.HANKED_RUN_ID, undefined,
    'gate ei tohi kunagi saada HANKED_RUN_ID-d (runId: false)');

  db.close();
  console.log('PASS runs: startRun süstib HANKED_RUN_ID õigesti history/docs käsule (ENV-3/ENV-4)');
}

function nrId(v) { return typeof v === 'bigint' ? Number(v) : v; }

console.log('');
console.log('Värav gate-hanked-runs: kõik plokid rohelised.');
