#!/usr/bin/env node
// Väravajooksja — avastab offline-ahela kettalt, mitte käsitsi hoitavast stringist.
//
// MIKS SEE FAIL OLEMAS ON
// package.json skript test:offline oli 27-kirjeline käsitsi hoitav string. Uue
// värava lisamisel ununes ahela uuendamine: gate-hanked.mjs jäi ahelast välja ja
// avastati alles ülevaatusel. Väravafail kettal on ainus tõde — nimekiri tuletatakse.
//
// Teine kaotatud käsitsitöö: sama ahelat jooksutati kahel pool käsitsi, sest
// npm ei tööta Linux VM-is (crm/node_modules on Windowsi junction). See jooksja
// on puhas Node ilma väliste sõltuvusteta, nii et sama käsk töötab mõlemal pool;
// VM-is jäävad npm-pakette vajavad väravad ausalt VAHELE JÄETUKS, mitte rohelisena.
//
// Kasutus:
//   node tools/varav.mjs                 kogu ahel
//   node tools/varav.mjs --ainult=hanked ainult mustrile vastavad (arendus)
//   node tools/varav.mjs --range         vahelejätt on samuti viga (CI)
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const JUUR = join(dirname(fileURLToPath(import.meta.url)), '..');

// Väravad avastatakse mustriga test/gate-*.mjs. NB: test/gate.mjs EI vasta sellele
// mustrile ja jääb teadlikult välja — see kasutab fixture-SQLite-t ja täiesti
// väljamõeldud env-i (npm test jooksutab ta eraldi); ainus tegelik väljajätu
// põhjus on Playwright/Chromium sõltuvus, mida offline-ahel ei paku.
const MUSTER = /^gate-.+\.mjs$/;

// Väravad, mis on kettal, aga EI kuulu offline-ahelasse. Iga kirje kannab põhjust —
// ilma põhjuseta väljajätt on sama vaikne katvuse kadu, mida see fail parandab.
export const VALJAJATED = new Map([
  ['gate-campaign-ui.mjs',
    'Brauserivärav: nõuab playwrighti + Chromiumi, mida offline-ahelas ei ole. Jookseb CI töös browser (.github/workflows/ci.yml).'],
  ['gate-inquiry-ui.mjs',
    'Brauserivärav: nõuab playwrighti + Chromiumi, mida offline-ahelas ei ole. Jookseb CI töös browser (.github/workflows/ci.yml).'],
  ['gate-hanked-vaade.mjs',
    'Brauserivärav: nõuab playwrighti + Chromiumi, mida offline-ahelas ei ole. Puhas loogika on kaetud test/gate-hanked-ui.mjs-is, mis jookseb ahelas. Jookseb CI töös browser (.github/workflows/ci.yml).'],
  ['gate-css-ab.mjs',
    'Brauserivärav: @leisson/shared/tools/css-ab.mjs mõõdab Chromiumis computed style’i ja vajab git-ajalugu (#15 fikstuur, CI fetch-depth 0). Jookseb CI töös browser (.github/workflows/ci.yml).'],
]);

// Jooksud, mis kuuluvad ahelasse, aga ei vasta mustrile gate-*.
export const LISAJOOKSUD = [
  { silt: 'test/web-inquiry.mjs', argumendid: ['test/web-inquiry.mjs'] },
  {
    silt: 'node --test agent/*.test.mjs',
    argumendid: ['--test',
      'agent/runtime.test.mjs',
      'agent/auth-cache.test.mjs',
      'agent/scheduled-run.test.mjs',
      'agent/public-scope.test.mjs',
      'agent/claude-runner.test.mjs'],
  },
];

/** Puhas avastus: mis on kettal, mis läheb ahelasse, mis jääb välja ja miks. */
export function leiaVaravad(juur = JUUR) {
  const failid = readdirSync(join(juur, 'test')).filter((f) => MUSTER.test(f)).sort();
  return {
    failid,
    varavad: failid.filter((f) => !VALJAJATED.has(f)),
    valjajaetud: failid.filter((f) => VALJAJATED.has(f)),
  };
}

/**
 * Teadlikult valja jaetud varavad ehtses kujus {silt, argumendid}.
 * Need on brauserivaravad: nad EI kuulu offline-ahelasse, aga nad peavad kuskil
 * jooksma. Varem loetles CI neid kasitsi (.github/workflows/ci.yml,
 * too browser) ja uus brauserivarav (gate-hanked-vaade.mjs) jai sinna lisamata:
 * varav oli olemas, VALJAJATED lubas, et CI jooksutab teda, ja keegi ei jooksutanud.
 * Tapselt see bugiklass, mille parast see jooksja uldse tehti - nuud on ka teine
 * ots avastatud, mitte kasitsi hoitav.
 */
export function koostaBrauserijooksud(juur = JUUR) {
  const { valjajaetud } = leiaVaravad(juur);
  return valjajaetud.map((f) => ({ silt: 'test/' + f, argumendid: ['test/' + f] }));
}

/** Avastatud väravad + lisajooksud ühtses kujus {silt, argumendid}. */
export function koostaJooksud(juur = JUUR) {
  const { varavad } = leiaVaravad(juur);
  return [
    ...varavad.map((f) => ({ silt: 'test/' + f, argumendid: ['test/' + f] })),
    ...LISAJOOKSUD,
  ];
}

// Kohalik puuduv fail tuleb Node'ist absoluutteena (/x/y.mjs või C:\x\y.mjs) või
// suhtelisena — see on päris viga. Paljas paketinimi on npm-sõltuvus, mida sellel
// masinal lihtsalt ei ole paigaldatud.
function onValinePakett(nimi) {
  return !(nimi.startsWith('.') || nimi.startsWith('/') || nimi.startsWith('file:')
    || /^[A-Za-z]:[\\/]/.test(nimi));
}

/** Kolm tulemust ühest väljumiskoodist ja veavoost. Puhas funktsioon. */
export function klassifitseeri(kood, veavoog = '') {
  if (kood === 0) return { seis: 'ok' };
  if (veavoog.includes('ERR_MODULE_NOT_FOUND')) {
    const m = /Cannot find (?:package|module) '([^']+)'/.exec(veavoog);
    if (m && onValinePakett(m[1])) return { seis: 'vahele', pakett: m[1] };
  }
  return { seis: 'kukkus', kood };
}

function sobib(silt, muster) {
  if (!muster) return true;
  const re = new RegExp(muster.split('*').map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i');
  return re.test(silt);
}

function jooksuta(jooks, juur) {
  const algus = Date.now();
  // stdio: stdout päritakse (väravate väljund voogab reaalajas), stderr aga
  // püütakse kinni, sest ERR_MODULE_NOT_FOUND tuleb sealt — ilma selleta ei saa
  // npm-piirangut koodiveast eristada. Püütud veavoog kirjutatakse kohe välja.
  const r = spawnSync(process.execPath, jooks.argumendid, {
    cwd: juur, stdio: ['inherit', 'inherit', 'pipe'], encoding: 'utf8', windowsHide: true,
  });
  const veavoog = r.stderr || '';
  const tulemus = klassifitseeri(r.status === null ? 1 : r.status, veavoog);
  if (veavoog && tulemus.seis !== 'vahele') process.stderr.write(veavoog);
  return { ...tulemus, sekundid: ((Date.now() - algus) / 1000).toFixed(1) };
}

function main(argv) {
  const lipud = argv.slice(2);
  const juurLipp = lipud.find((a) => a.startsWith('--juur='));
  const juur = juurLipp ? juurLipp.slice('--juur='.length) : JUUR;
  const muster = (lipud.find((a) => a.startsWith('--ainult=')) || '').slice('--ainult='.length);
  const range = lipud.includes('--range') || lipud.includes('--strict');
  // --brauserid poorab valiku umber: jooksutab TAPSELT need varavad, mis
  // offline-ahelast valja jaeti. CI too browser kutsub seda, nii et uus
  // brauserivarav satub jooksu ilma, et keegi peaks YAML-i muutma.
  const brauserid = lipud.includes('--brauserid');

  if (!existsSync(join(juur, 'test'))) {
    console.error(`Juurt ei ole: ${juur}`);
    return 1;
  }

  const { valjajaetud } = leiaVaravad(juur);
  const koik = brauserid ? koostaBrauserijooksud(juur) : koostaJooksud(juur);
  const jooksud = koik.filter((j) => sobib(j.silt, muster));

  if (brauserid && koik.length === 0) {
    console.error('--brauserid: ühtegi välja jäetud väravat ei ole. Kas VALJAJATED tühjenes?');
    return 1;
  }

  if (muster && jooksud.length === 0) {
    console.error(`Muster "${muster}" ei anna ühtegi vastet — 0 väravat jooksis.`);
    console.error(`Valikus on ${koik.length}: ${koik.map((j) => j.silt).join(', ')}`);
    return 1;
  }

  console.log(brauserid
    ? `Väravajooksja (brauserid) — ${jooksud.length} jooksu${muster ? ` (muster "${muster}")` : ''}`
    : `Väravajooksja — ${jooksud.length} jooksu${muster ? ` (muster "${muster}")` : ''}`
      + `${valjajaetud.length ? `, ${valjajaetud.length} teadlikult väljas` : ''}`);
  if (!brauserid) for (const f of valjajaetud) console.log(`  välja jäetud: test/${f} — ${VALJAJATED.get(f)}`);
  console.log('');

  const okid = [], kukkusid = [], vahele = [];
  for (const jooks of jooksud) {
    console.log(`── ${jooks.silt}`);
    const t = jooksuta(jooks, juur);
    if (t.seis === 'ok') { okid.push(jooks.silt); console.log(`   OK ${jooks.silt} (${t.sekundid}s)`); }
    else if (t.seis === 'vahele') {
      vahele.push({ silt: jooks.silt, pakett: t.pakett });
      console.log(`   VAHELE JÄETUD ${jooks.silt} — puudub npm-pakett "${t.pakett}"`);
    } else {
      kukkusid.push({ silt: jooks.silt, kood: t.kood });
      console.log(`   KUKKUS ${jooks.silt} (väljumiskood ${t.kood}, ${t.sekundid}s)`);
    }
    console.log('');
  }

  console.log(`Kokkuvõte: ${okid.length} OK · ${kukkusid.length} kukkus · ${vahele.length} vahele jäetud`);
  for (const k of kukkusid) console.log(`  KUKKUS ${k.silt} (väljumiskood ${k.kood})`);
  for (const v of vahele) console.log(`  VAHELE JÄETUD ${v.silt} — puudub npm-pakett "${v.pakett}"`);

  if (kukkusid.length) return 1;
  if (vahele.length && brauserid) {
    console.error('\n--brauserid: vahelejätt loeb veaks. Brauserivärav ilma playwrightita'
      + ' ei kaitse midagi — paigalda sõltuvused või eemalda värav VALJAJATED-ist.');
    return 1;
  }
  if (vahele.length && range) {
    console.error('\n--range: vahelejätt loeb veaks. CI-s on kõik sõltuvused olemas,'
      + ' seega vahelejätt tähendaks seal vaikset katvuse kadu.');
    return 1;
  }
  if (vahele.length) {
    console.log('\nVahelejätt on siin lubatud (npm-pakette pole paigaldatud).'
      + ' CI ja täisjooks: node tools/varav.mjs --range');
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv));
}
