// Väravas: käsupõhine env-allowlist ei anna last saladusi ega tundmatuid
// muutujaid edasi; HANKED_RUN_ID läheb ainult sync/history/docs-ile, mitte
// gate'ile (audit PR2, ENV-1/ENV-2/ENV-5/ENV-6, 22.09.2026).
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateHanked } from '../lib/hanked.mjs';
import { lubatudEnv, startRun } from '../lib/hanked-runs.mjs';

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

  const history = lubatudEnv('history', fiktiivneAllikas());
  assert.equal(history.HANKED_AWARD_BASE, 'https://fake/award');
  assert.equal(history.HANKED_RSS_URL, undefined);

  const docs = lubatudEnv('docs', fiktiivneAllikas());
  assert.equal(docs.HANKED_DOCS_DIR, 'C:\\fake\\docs');
  assert.equal(docs.HANKED_RHR_BASE, 'https://fake/rhr');
  assert.equal(docs.PDFTOTEXT, 'C:\\fake\\pdftotext.exe');
  assert.equal(docs.HANKED_RSS_URL, undefined);

  const gate = lubatudEnv('gate', fiktiivneAllikas());
  assert.equal(gate.HANKED_RSS_URL, undefined);
  assert.equal(gate.HANKED_DOCS_DIR, undefined);
  assert.equal(gate.CRM_DB_PATH, 'C:\\fixture\\db.sqlite', 'CRM_DB_PATH on ühine baas-muutuja');
}
console.log('PASS hanked-env: käsupõhised muutujad ei sega üksteist (ENV-6)');

// Tundmatu käsk - tühi lisakonfiguratsioon, ei laiene, ei kuku.
{
  const out = lubatudEnv('tundmatu-kask-xyz', fiktiivneAllikas());
  assert.equal(out.HANKED_RSS_URL, undefined);
  assert.equal(out.SystemRoot, 'C:\\Windows', 'Windows-baas jääb ka tundmatul käsul');
}
console.log('PASS hanked-env: tundmatu käsk ei laienda lubaloendit');

// ENV-2: Windows võtmekuju on kanooniline ja konfliktireegel deterministlik.
// Object.keys({Path,PATH}) hoiab kirjutusjärjekorra - ESIMENE vaste võidab (dokumenteeritud
// lubatudEnv-is). Test tõestab tulemuse DETERMINISMI, mitte "õiget" OS-käitumist.
{
  const segane = { Path: 'esimene-vaste', PATH: 'teine-vaste', SystemRoot: 'C:\\Windows' };
  const out1 = lubatudEnv('sync', segane);
  const out2 = lubatudEnv('sync', segane);
  assert.equal(Object.keys(out1).filter((k) => k.toUpperCase() === 'PATH').length, 1,
    'täpselt üks PATH-kujuline väljundvõti, mitte mõlemad');
  assert.equal(out1.PATH, 'esimene-vaste', 'esimene Object.keys() vaste võidab (dokumenteeritud reegel)');
  assert.equal(out1.PATH, out2.PATH, 'sama sisend annab alati sama väljundi');
}
console.log('PASS hanked-env: Windows Path/PATH konflikt on deterministlik (ENV-2)');

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
  process.env.MAIL_PASS = 'salajane-test-ei-tohi-lekkida';
  try {
    const db = testDb();
    const f = valeSpawn();

    const sync = startRun(db, 'sync', {}, { spawnFn: f });
    const [, , syncOpts] = f.argv[0];
    assert.equal(syncOpts.env.MAIL_PASS, undefined,
      'startRun (sync) ei tohi anda lapsele TÄIT process.env-i - MAIL_PASS lekkis');
    assert.equal(syncOpts.env.HANKED_RUN_ID, String(sync.id),
      'sync peab saama HANKED_RUN_ID (runId: true)');

    const gate = startRun(db, 'gate', {}, { spawnFn: f });
    const [, , gateOpts] = f.argv[1];
    assert.equal(gateOpts.env.MAIL_PASS, undefined,
      'startRun (gate) ei tohi anda lapsele TÄIT process.env-i - MAIL_PASS lekkis');
    assert.equal(gateOpts.env.HANKED_RUN_ID, undefined,
      'gate ei tohi kunagi saada HANKED_RUN_ID-d (runId: false, ENV-5)');

    db.close();
  } finally {
    if (VANA_MAIL_PASS === undefined) delete process.env.MAIL_PASS;
    else process.env.MAIL_PASS = VANA_MAIL_PASS;
  }
}
console.log('PASS hanked-env: startRun ise (mitte ainult lubatudEnv) ei anna lapsele saladusi (ENV-1/ENV-5 integratsioon)');
