// Väravas: käsupõhine env-allowlist ei anna last saladusi ega tundmatuid
// muutujaid edasi; HANKED_RUN_ID läheb ainult sync/history/docs-ile, mitte
// gate'ile (audit PR2, ENV-1/ENV-2/ENV-5/ENV-6, 22.09.2026).
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateHanked } from '../lib/hanked.mjs';
import { lubatudEnv, startRun, CMD, KASU_ENV } from '../lib/hanked-runs.mjs';

const SALADUSED = ['MAIL_PASS', 'ACC_GERT_PASS', 'IMAP_HOST', 'SMTP_HOST',
  'PARTNER_API_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY',
  'HTTPS_PROXY', 'HTTP_PROXY', 'NODE_OPTIONS', 'NODE_PATH'];

function fiktiivneAllikas() {
  const out = { SystemRoot: 'C:\\Windows', PATH: 'C:\\real\\path', TEMP: 'C:\\tmp',
    CRM_DB_PATH: 'C:\\fixture\\db.sqlite', HANKED_RSS_URL: 'https://fake/rss',
    HANKED_AWARD_BASE: 'https://fake/award', HANKED_DOCS_DIR: 'C:\\fake\\docs',
    HANKED_RHR_BASE: 'https://fake/rhr', PDFTOTEXT: 'C:\\fake\\pdftotext.exe',
    HANKED_RUN_ID: '999999' /* võlts pärandväärtus - ei tohi kunagi väljundisse jõuda */ };
  for (const k of SALADUSED) out[k] = 'salajane-' + k;
  return out;
}

// ENV-1: saladused ja ambient-konfiguratsioon ei jõua ÜHESSEGI käsku.
for (const cmd of ['sync', 'history', 'docs', 'gate']) {
  const out = lubatudEnv(cmd, fiktiivneAllikas());
  for (const salajane of SALADUSED) {
    assert.equal(out[salajane], undefined, cmd + ': ' + salajane + ' ei tohi lekkida');
  }
  assert.equal(out.HANKED_RUN_ID, undefined,
    cmd + ': HANKED_RUN_ID ei tule kunagi lähteallikast (ainult startRun süstib värske väärtuse)');
}
console.log('PASS hanked-env: ükski käsk ei saa saladusi ega võlts HANKED_RUN_ID-d (ENV-1)');

// ENV-6: käsupõhised muutujad AINULT õigel käsul.
{
  const sync = lubatudEnv('sync', fiktiivneAllikas());
  assert.equal(sync.HANKED_RSS_URL, 'https://fake/rss');
  assert.equal(sync.HANKED_AWARD_BASE, undefined);
  assert.equal(sync.PDFTOTEXT, undefined);
  assert.equal(sync.CRM_DB_PATH, 'C:\\fixture\\db.sqlite',
    'sync avab baasi ise (avaBaas -> open) - CRM_DB_PATH peab õigesse baasi suunama');

  const history = lubatudEnv('history', fiktiivneAllikas());
  assert.equal(history.HANKED_AWARD_BASE, 'https://fake/award');
  assert.equal(history.HANKED_RSS_URL, undefined);
  assert.equal(history.CRM_DB_PATH, 'C:\\fixture\\db.sqlite',
    'history avab baasi ise (avaBaas -> open) - CRM_DB_PATH peab õigesse baasi suunama');

  const docs = lubatudEnv('docs', fiktiivneAllikas());
  assert.equal(docs.HANKED_DOCS_DIR, 'C:\\fake\\docs');
  assert.equal(docs.HANKED_RHR_BASE, 'https://fake/rhr');
  assert.equal(docs.PDFTOTEXT, 'C:\\fake\\pdftotext.exe');
  assert.equal(docs.HANKED_RSS_URL, undefined);
  assert.equal(docs.CRM_DB_PATH, 'C:\\fixture\\db.sqlite',
    'docs avab baasi ise (avaBaas -> open) - CRM_DB_PATH peab õigesse baasi suunama');

  // gate (test/gate-hanked.mjs) ei loe process.env.CRM_DB_PATH-i KUNAGI ise - iga
  // avaBaas()/open() kutse selles failis saab oma fikstuuritee otse argumendina
  // (kontrollitud: grep avaBaas(/open( test/gate-hanked.mjs, kõik kutsed annavad
  // dbPath). CRM_DB_PATH oli seega SURNUD pärand gate'i keskkonnas, mitte "ühine
  // baasmuutuja" - eemaldatud (audit PR2 järelparandus, 22.09.2026).
  const gate = lubatudEnv('gate', fiktiivneAllikas());
  assert.equal(gate.HANKED_RSS_URL, undefined);
  assert.equal(gate.HANKED_DOCS_DIR, undefined);
  assert.equal(gate.CRM_DB_PATH, undefined,
    'gate ei tohi saada CRM_DB_PATH-i - ta ei loe seda muutujat kunagi ise (vt KASU_ENV kommentaar)');
}
console.log('PASS hanked-env: käsupõhised muutujad ei sega üksteist, CRM_DB_PATH ainult sync/history/docs-il (ENV-6)');

// Tundmatu käsk - tühi lisakonfiguratsioon, ei laiene, ei kuku.
{
  const out = lubatudEnv('tundmatu-kask-xyz', fiktiivneAllikas());
  assert.equal(out.HANKED_RSS_URL, undefined);
  assert.equal(out.SystemRoot, 'C:\\Windows', 'Windows-baas jääb ka tundmatul käsul');
  assert.equal(out.CRM_DB_PATH, undefined,
    'tundmatu käsk ei tohi vaikimisi CRM_DB_PATH-i saada - turvalisem minimaalne vaikeväärtus');
}
console.log('PASS hanked-env: tundmatu käsk ei laienda lubaloendit');

// ENV-2: Windows'i muutujanimed on tõstutundetud, aga JS-objektis on 'PATH' ja
// 'Path' kaks eri võtit. KINNITATUD LÄHTENÕUE: täpne kanooniline kirjatüüp ('PATH')
// VÕIDAB ALATI, sõltumata sellest, kummas järjekorras lähteallikas need kirjutas -
// mitte "esimene Object.keys() vaste" (see oli sisestusjärjekorra-sõltuv viga,
// parandatud audit PR2 järelparanduses, 22.09.2026). Kolm juhtu:
//   1. Path enne PATH-i lähteallikas -> PATH-i väärtus võidab ikkagi;
//   2. PATH enne Path-i lähteallikas -> PATH-i väärtus võidab (sama tulemus, tõestab
//      et võit ei sõltu järjekorrast);
//   3. lähteallikas pakub AINULT 'Path'-i (PATH puudub täiesti) -> tõstutundetu
//      tagavaraotsing peab ikkagi leidma väärtuse, väljundvõti jääb kanooniliseks 'PATH'-iks.
{
  const pathVoidab = 'PATH-väärtus';
  const pathEnneVoitu = { Path: 'Path-väärtus', PATH: pathVoidab, SystemRoot: 'C:\\Windows' };
  const out1 = lubatudEnv('sync', pathEnneVoitu);
  assert.equal(Object.keys(out1).filter((k) => k.toUpperCase() === 'PATH').length, 1,
    'täpselt üks PATH-kujuline väljundvõti, mitte mõlemad');
  assert.equal(out1.PATH, pathVoidab, 'Path enne PATH-i sisestusjärjekorras - kanooniline PATH peab siiski võitma');

  const pathParastVoitu = { PATH: pathVoidab, Path: 'Path-väärtus', SystemRoot: 'C:\\Windows' };
  const out2 = lubatudEnv('sync', pathParastVoitu);
  assert.equal(out2.PATH, pathVoidab, 'PATH enne Path-i sisestusjärjekorras - sama väärtus, sõltumatuse tõestus');
  assert.equal(out1.PATH, out2.PATH, 'PATH-i võit ei tohi sõltuda Object.keys() kirjutusjärjekorrast');

  const ainultPath = { Path: 'ainus-vaste', SystemRoot: 'C:\\Windows' };
  const out3 = lubatudEnv('sync', ainultPath);
  assert.equal(out3.PATH, 'ainus-vaste',
    'kui kanoonilist PATH-i lähteallikas ei paku, peab tõstutundetu tagavaraotsing väärtuse siiski leidma');
  assert.equal(Object.hasOwn(out3, 'Path'), false, 'väljundvõti peab olema kanooniline PATH, mitte Path');
}
console.log('PASS hanked-env: kanooniline PATH võidab alati Path-i ees, sõltumata sisestusjärjekorrast (ENV-2)');

// Staatiline regressioonivärav: sync/history/docs/gate ei tohi ISE kutsuda
// loadEnv/rawEnv-i (lib/env.mjs). See EI TÕENDA failisüsteemi-isolatsiooni -
// see on regressioonivärav teadaoleva konfiguratsioonilugeja tagasitoomise
// vastu (audit PR2, p.3). Sabotaaž: lisa üks selline kutse - värav läheb punaseks.
{
  const KEELATUD = /\b(loadEnv|rawEnv)\s*\(/;
  for (const tee of ['agent/hanked-sync.mjs', 'agent/hanked-history.mjs',
    'agent/hanked-docs.mjs', 'test/gate-hanked.mjs']) {
    const sisu = readFileSync(tee, 'utf8');
    assert.equal(KEELATUD.test(sisu), false,
      tee + ' ei tohi kutsuda loadEnv()/rawEnv() - need loeksid päris .env-i otse');
  }
}
console.log('PASS hanked-env: sync/history/docs/gate ei loe .env-i loadEnv/rawEnv kaudu (staatiline piir, p.3)');

// ENV-INTEGRATSIOON: startRun EI TOHI kunagi kogu process.env-i lapsele anda -
// see on TAPSELT sama viga, mida see fail parandab (vt CLAUDE.md "Every gate
// must fail under sabotage"). lubatudEnv() enda unit-testid seda üksi EI TÕENDA,
// sest startRun võiks teoreetiliselt lubatudEnv() tulemuse peale ikkagi
// process.env-i juurde segada - seepärast siin PÄRIS startRun koos valelapsega,
// mis loeb tegelikult saadetud env-objekti (audit PR2, sabotaaž kinnitatud
// 22.09.2026: {...process.env, ...lubatudEnv(cmd)} jättis kõik 44 väravat
// roheliseks, kuni see plokk lisati).
{
  const TMP = mkdtempSync(join(tmpdir(), 'hanked-env-'));
  function testDb() {
    const db = new DatabaseSync(join(TMP, 'r.sqlite'));
    migrateHanked(db);
    return db;
  }
  function valeSpawn(pid = 4242) {
    const f = (...a) => { f.kutseid++; f.argv.push(a); return { pid, stdout: { on() {} }, stderr: { on() {} }, on() {} }; };
    f.kutseid = 0; f.argv = [];
    return f;
  }

  const VANA_MAIL_PASS = process.env.MAIL_PASS;
  const VANA_CRM_DB_PATH = process.env.CRM_DB_PATH;
  process.env.MAIL_PASS = 'salajane-test-ei-tohi-lekkida';
  process.env.CRM_DB_PATH = join(TMP, 'ambient-crm-db-path.sqlite');
  try {
    const db = testDb();
    const f = valeSpawn();

    const sync = startRun(db, 'sync', {}, { spawnFn: f });
    const [, , syncOpts] = f.argv[0];
    assert.equal(syncOpts.env.MAIL_PASS, undefined,
      'startRun (sync) ei tohi anda lapsele TÄIT process.env-i - MAIL_PASS lekkis');
    assert.equal(syncOpts.env.HANKED_RUN_ID, String(sync.id),
      'sync peab saama HANKED_RUN_ID (runId: true)');
    assert.equal(syncOpts.env.CRM_DB_PATH, process.env.CRM_DB_PATH,
      'sync peab saama CRM_DB_PATH - muidu avab avaBaas() vaikimisi data/crm.sqlite');

    const gate = startRun(db, 'gate', {}, { spawnFn: f });
    const [, , gateOpts] = f.argv[1];
    assert.equal(gateOpts.env.MAIL_PASS, undefined,
      'startRun (gate) ei tohi anda lapsele TÄIT process.env-i - MAIL_PASS lekkis');
    assert.equal(gateOpts.env.HANKED_RUN_ID, undefined,
      'gate ei tohi kunagi saada HANKED_RUN_ID-d (runId: false, ENV-5)');
    assert.equal(gateOpts.env.CRM_DB_PATH, undefined,
      'gate ei tohi kunagi saada CRM_DB_PATH-i (startRun-integratsioon, mitte ainult lubatudEnv üksiktest)');

    db.close();
  } finally {
    if (VANA_MAIL_PASS === undefined) delete process.env.MAIL_PASS;
    else process.env.MAIL_PASS = VANA_MAIL_PASS;
    if (VANA_CRM_DB_PATH === undefined) delete process.env.CRM_DB_PATH;
    else process.env.CRM_DB_PATH = VANA_CRM_DB_PATH;
  }
}
console.log('PASS hanked-env: startRun ise (mitte ainult lubatudEnv) ei anna lapsele saladusi ega vale baasi (ENV-1/ENV-5/ENV-6 integratsioon)');

// Minor (koodikvaliteedi ülevaade, audit PR2, 22.09.2026): kui CMD-le lisatakse
// tulevikus uus käsk ilma vastava KASU_ENV kirjeta, langeks lubatudEnv() vaikimisi
// minimaalsele env-ile (turvaline, aga VAIKIV - uus käsk ei saaks kunagi oma
// HANKED_RUN_ID/lisamuutujaid ilma ühegi punase testita). See värav teeb selle
// lahknevuse kohe nähtavaks.
assert.deepEqual(Object.keys(CMD).sort(), Object.keys(KASU_ENV).sort(),
  'iga CMD käsk peab omama vastavat KASU_ENV kirjet (muidu jääks uus käsk vaikimisi minimaalse env-i peale ilma ühegi hoiatuseta)');
console.log('PASS hanked-env: CMD ja KASU_ENV käsuloendid on kooskõlas');

