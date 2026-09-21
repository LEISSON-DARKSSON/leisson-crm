// Väravajooksja enda värav — lisatud 21.09.2026.
//
// Miks: test:offline oli 27-kirjeline käsitsi hoitav string package.json-is.
// Uue värava lisamisel ununes ahel (gate-hanked.mjs jäi välja ja avastati alles
// ülevaatusel). Nüüd avastab tools/varav.mjs väravad kettalt — aga siis peab
// AVASTAMINE ise olema väravaga kaetud, muidu kolib sama vaikne katvuse kadu
// lihtsalt ühe kihi võrra sügavamale.
//
// Kõik alamprotsessid jooksevad os.tmpdir() võltsjuures. Võrku ei kasutata,
// päris CRM-i SQLite-i ei avata.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { leiaVaravad, koostaJooksud, klassifitseeri, VALJAJATED, LISAJOOKSUD } from '../tools/varav.mjs';

const JUUR = join(dirname(fileURLToPath(import.meta.url)), '..');
const VARAV = join(JUUR, 'tools', 'varav.mjs');
let tehtud = 0;
function check(nimi, fn) { fn(); tehtud++; console.log('  ok ' + nimi); }

// --- Fikstuur: võltsjuur paari väravaga, igaüks teadaoleva lõpuga. -----------
const prugi = [];
function voltsjuur({ kukkuja = true, pakett = true, kohalik = false } = {}) {
  const juur = mkdtempSync(join(tmpdir(), 'varav-fikstuur-'));
  prugi.push(juur);
  mkdirSync(join(juur, 'test'));
  mkdirSync(join(juur, 'agent'));
  const kirjuta = (suht, sisu) => writeFileSync(join(juur, suht), sisu);

  kirjuta('test/gate-a-ok.mjs', "console.log('fikstuur a: OK');\n");
  if (kukkuja) kirjuta('test/gate-b-kukub.mjs', "console.error('fikstuur b: katki');\nprocess.exit(1);\n");
  // Puuduv VÄLINE npm-pakett = Linux VM-i node_modules piirang, mitte koodiviga.
  if (pakett) kirjuta('test/gate-c-pakett.mjs', "import 'imapflow';\nconsole.log('ei tohi siia jõuda');\n");
  // Puuduv KOHALIK fail on päris viga ja peab lugema kukkumiseks.
  if (kohalik) kirjuta('test/gate-d-kohalik.mjs', "import './pole-olemas.mjs';\n");
  // Väljajäetu: kui jooksja ta kogemata käivitab, kukub kogu jooks ja me näeme seda.
  kirjuta('test/gate-campaign-ui.mjs', "console.error('väljajäetud värav ei tohi joosta');\nprocess.exit(3);\n");
  // gate.mjs ei vasta mustrile gate-* — ta ei tohi ahelasse sattuda.
  kirjuta('test/gate.mjs', "console.error('gate.mjs ei kuulu offline-ahelasse');\nprocess.exit(3);\n");

  kirjuta('test/web-inquiry.mjs', "console.log('fikstuur: web-inquiry OK');\n");
  for (const f of ['runtime', 'auth-cache', 'scheduled-run', 'public-scope', 'claude-runner']) {
    kirjuta(`agent/${f}.test.mjs`, "import {test} from 'node:test';\ntest('fikstuur', () => {});\n");
  }
  return juur;
}

function jooksuta(juur, ...lipud) {
  const r = spawnSync(process.execPath, [VARAV, '--juur=' + juur, ...lipud], { encoding: 'utf8' });
  return { kood: r.status, valjund: (r.stdout || '') + (r.stderr || '') };
}
function kokkuvote(valjund) {
  const m = /Kokkuvõte:\s*(\d+)\s*OK\D+(\d+)\s*kukkus\D+(\d+)\s*vahele jäetud/.exec(valjund);
  assert.ok(m, 'väljundis peab olema loetav kokkuvõte, saadi:\n' + valjund);
  return { ok: +m[1], kukkus: +m[2], vahele: +m[3] };
}

// --- 1. Avastamine käib kettalt, mitte käsitsi hoitavast nimekirjast. --------
check('avastab kõik test/gate-*.mjs failid päris juurest', () => {
  const { varavad, valjajaetud, failid } = leiaVaravad(JUUR);
  assert.ok(varavad.includes('gate-hanked.mjs'), 'gate-hanked.mjs peab olema avastatud');
  assert.ok(varavad.includes('gate-agent.mjs'), 'gate-agent.mjs peab olema avastatud');
  assert.ok(varavad.includes('gate-varav.mjs'), 'väravajooksja enda värav peab olema ahelas');
  assert.ok(!failid.includes('gate.mjs'), 'gate.mjs ei vasta mustrile gate-* ja jääb välja');
  assert.deepEqual(varavad, [...varavad].sort(), 'väravad tulevad sorditult');
  assert.deepEqual(valjajaetud, [...VALJAJATED.keys()].filter((f) => failid.includes(f)).sort(),
    'väljajäetud loend peab vastama koodis olevale nimekirjale');
});

// --- 2. Väljajätete jõustamine. ---------------------------------------------
check('gate-hanked.mjs EI ole väljajätete nimekirjas', () => {
  assert.ok(!VALJAJATED.has('gate-hanked.mjs'),
    'kui keegi lisab gate-hanked.mjs väljajätete hulka, peab see värav kukkuma');
  assert.ok(leiaVaravad(JUUR).varavad.includes('gate-hanked.mjs'));
});

check('iga väljajätt kannab kirjalikku põhjust', () => {
  assert.ok(VALJAJATED.size > 0, 'praegu on vähemalt UI-väravad väljas');
  for (const [fail, pohjus] of VALJAJATED) {
    assert.match(fail, /^gate-.+\.mjs$/, fail + ' peab olema gate-faili nimi');
    assert.ok(typeof pohjus === 'string' && pohjus.trim().length > 20,
      fail + ' vajab sisulist põhjust, miks ta offline-ahelasse ei kuulu');
  }
});

check('brauseriväravad on väljas ja ei satu ahelasse', () => {
  const { varavad } = leiaVaravad(JUUR);
  for (const f of ['gate-campaign-ui.mjs', 'gate-inquiry-ui.mjs']) {
    assert.ok(VALJAJATED.has(f), f + ' peab olema väljajätete nimekirjas');
    assert.ok(!varavad.includes(f), f + ' ei tohi ahelasse sattuda');
  }
});

// --- 3. Lisajooksud, mis ei vasta mustrile gate-*. ---------------------------
check('lisajooksud on ahelas: web-inquiry ja node --test agent-testid', () => {
  const sildid = koostaJooksud(JUUR).map((j) => j.silt);
  assert.ok(sildid.some((s) => s.includes('web-inquiry.mjs')), 'web-inquiry.mjs peab ahelas olema');
  const testirida = LISAJOOKSUD.find((j) => j.argumendid[0] === '--test');
  assert.ok(testirida, 'node --test rida peab olema lisajooksudes');
  for (const f of ['runtime', 'auth-cache', 'scheduled-run', 'public-scope', 'claude-runner']) {
    assert.ok(testirida.argumendid.includes(`agent/${f}.test.mjs`), f + ' peab olema node --test real');
  }
});

// --- 4. Kolm tulemust: OK / KUKKUS / VAHELE JÄETUD. --------------------------
check('eristab OK, KUKKUS ja VAHELE JÄETUD', () => {
  const juur = voltsjuur();
  const { kood, valjund } = jooksuta(juur);
  const k = kokkuvote(valjund);
  assert.equal(k.kukkus, 1, 'üks võltsvärav kukub');
  assert.equal(k.vahele, 1, 'puuduv npm-pakett imapflow jääb vahele');
  assert.equal(k.ok, 3, 'gate-a + web-inquiry + node --test = 3 OK');
  assert.match(valjund, /imapflow/, 'vahelejätu põhjus peab nimetama puuduva paketi');
  assert.ok(!valjund.includes('väljajäetud värav ei tohi joosta'), 'väljajäetud väravat ei käivitata');
  assert.ok(!valjund.includes('gate.mjs ei kuulu'), 'gate.mjs ei tohi joosta');
  assert.equal(kood, 1, 'kukkumine annab väljumiskoodi 1');
});

check('puuduv KOHALIK fail on kukkumine, mitte vahelejätt', () => {
  const juur = voltsjuur({ kukkuja: false, pakett: false, kohalik: true });
  const { kood, valjund } = jooksuta(juur);
  const k = kokkuvote(valjund);
  assert.equal(k.vahele, 0, 'kohalik puuduv fail ei ole npm-piirang');
  assert.equal(k.kukkus, 1, 'kohalik puuduv fail on kukkumine');
  assert.equal(kood, 1);
});

// --- 5. Väljumiskoodid ja --range. ------------------------------------------
check('ainult vahelejätt annab koodi 0, --range annab 1', () => {
  const juur = voltsjuur({ kukkuja: false });
  const lahtine = jooksuta(juur);
  assert.equal(kokkuvote(lahtine.valjund).vahele, 1);
  assert.equal(lahtine.kood, 0, 'vahelejätt üksinda ei kukuta kohalikku jooksu');

  const range = jooksuta(juur, '--range');
  assert.equal(range.kood, 1, '--range: vahelejätt on CI-s vaikne katvuse kadu');
  assert.match(range.valjund, /range|CI/i, '--range peab põhjust selgitama');

  const strict = jooksuta(juur, '--strict');
  assert.equal(strict.kood, 1, '--strict on --range sünonüüm');
});

check('puhas jooks annab koodi 0', () => {
  const juur = voltsjuur({ kukkuja: false, pakett: false });
  const r = jooksuta(juur);
  assert.equal(kokkuvote(r.valjund).kukkus, 0);
  assert.equal(r.kood, 0);
  assert.equal(jooksuta(juur, '--range').kood, 0, 'ilma vahelejättudeta on --range samuti roheline');
});

// --- 6. --ainult=<muster>. ---------------------------------------------------
check('--ainult=<muster> jooksutab ainult sobivad', () => {
  const juur = voltsjuur();
  const { kood, valjund } = jooksuta(juur, '--ainult=gate-a');
  const k = kokkuvote(valjund);
  assert.equal(k.ok, 1, 'mustrile vastab üks värav');
  assert.equal(k.kukkus, 0);
  assert.equal(k.vahele, 0);
  assert.equal(kood, 0);
  assert.ok(!valjund.includes('web-inquiry'), 'muster peab ka lisajookse filtreerima');
});

check('--ainult ilma vasteta ütleb seda välja ja ei teeskle rohelist ahelat', () => {
  const juur = voltsjuur();
  const { kood, valjund } = jooksuta(juur, '--ainult=pole-sellist-varavat');
  assert.match(valjund, /ükski|vastet|0 värava/i, 'tühi valik peab olema nähtav');
  assert.equal(kood, 1, 'tühi valik on kasutajaviga, mitte roheline jooks');
});

// --- 7. Klassifitseerija on puhas funktsioon. -------------------------------
check('klassifitseeri eristab välise paketi kohalikust failist', () => {
  assert.equal(klassifitseeri(0, '').seis, 'ok');
  const valine = klassifitseeri(1, "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'imapflow' imported from /x/y.mjs");
  assert.equal(valine.seis, 'vahele');
  assert.equal(valine.pakett, 'imapflow');
  assert.equal(klassifitseeri(1, "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/x/pole.mjs' imported from /x/y.mjs").seis, 'kukkus');
  assert.equal(klassifitseeri(1, "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\\\\x\\\\pole.mjs' imported from C:\\\\x\\\\y.mjs").seis, 'kukkus');
  assert.equal(klassifitseeri(1, 'AssertionError: midagi on valesti').seis, 'kukkus');
});

for (const juur of prugi) rmSync(juur, { recursive: true, force: true });
console.log(`PASS varav: ${tehtud} kontrolli`);
