#!/usr/bin/env node
// Pariteedi ootusfailide uuendaja — TAHTLIK ja NÄHTAV tee.
//
// MIKS SEE FAIL OLEMAS ON
// lib/eforms.mjs (parseAward) ja lib/hanked.mjs (segmentOf) peavad jääma sünkroonis
// Pythoni õendfailidega riigihanked/rhr_tools/. Kaks korda leiti triiv alles siis,
// kui keegi võrdles käsitsi: ülesandes 3 andis Node 3 leidu seal, kus Python andis 6
// (segmentOf vaatas ainult pealkirja), ja ülesandes 6 oleks plaani võitjaheuristika
// andnud 29 % vale või väljamõeldud võitjaga ridu. Kolmandat korda käsitsi ei võrrelda.
//
// test/gate-pariteet.mjs lukustab MÕÕDETUD väljundi päris RHR-i andmete peal.
// Kui väljund muutub TAHTLIKULT, uuendatakse ootusfailid SIIT — mitte väravajooksu
// ajal automaatselt. Automaatne uuendamine betoneeriks vea vaikselt; eraldi käsk
// jätab commiti diffi jälje ja nõuab commiti sõnumisse põhjendust.
//
// Kasutus:  node tools/pariteet-uuenda.mjs     (npm run pariteet:uuenda)
//           node tools/pariteet-uuenda.mjs --kuiv   ainult näita, ära kirjuta
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitNotices, parseAward } from '../lib/eforms.mjs';
import { segmentOf, FIT, EXCL, SMALLWEB } from '../lib/hanked.mjs';

export const JUUR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = JUUR;

export const FIKSTUUR = 'test/fixtures/eforms-2026-08-naidis.xml';
export const OOTUS_EFORMS = 'test/fixtures/eforms-2026-08-ootus.json';
export const OOTUS_SEGMENT = 'test/fixtures/segment-ootus.json';

// Õendfailid on repo JUURE suhtes, mitte crm/ suhtes.
export const OENDFAILID = [
  'riigihanked/rhr_tools/rhr_watch.py',
  'riigihanked/rhr_tools/rhr_parse.py',
];

// ---------------------------------------------------------------------------
// Mustriharude laiendaja.
//
// MIKS: segmendipaare EI TOHI käsitsi loetleda. Käsitsi nimekiri jääb uue FIT-haru
// lisamisel vaikselt maha — täpselt see viga, mida see värav peab välistama.
// Paarid TULETATAKSE mustri enda lähtekoodist, ja värav kontrollib eraldi, et iga
// praegune haru on kaetud.
// ---------------------------------------------------------------------------

/** Ülemise taseme alternatiivid ('a|b(c|d)|e' -> ['a','b(c|d)','e']). */
export function harud(src) {
  const out = [];
  let cur = '', sulg = 0, klass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { cur += c + (src[i + 1] ?? ''); i++; continue; }
    if (klass) { cur += c; if (c === ']') klass = false; continue; }
    if (c === '[') { klass = true; cur += c; continue; }
    if (c === '(') { sulg++; cur += c; continue; }
    if (c === ')') { sulg--; cur += c; continue; }
    if (c === '|' && sulg === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.filter((h) => h.length > 0);
}

function loeAlternatiivid(src, i, lopp) {
  const koik = [];
  let jooksvad = [''];
  const lisa = (valikud) => {
    const uus = [];
    for (const a of jooksvad) for (const v of valikud) uus.push(a + v);
    jooksvad = uus;
  };
  while (i < src.length) {
    const c = src[i];
    if (lopp && c === lopp) { i++; break; }
    if (c === '|') { koik.push(...jooksvad); jooksvad = ['']; i++; continue; }
    if (c === '\\') {
      const n = src[i + 1];
      i += 2;
      // Sõnapiir ei ole märk — ta ei tohi laiendusse jõuda.
      if (n === 'b' || n === 'B') continue;
      if (n === 's') { lisa([' ']); continue; }
      if (n === 'd') { lisa(['0']); continue; }
      if (n === 'w') { lisa(['a']); continue; }
      lisa([n]); continue;
    }
    if (c === '(') {
      let j = i + 1;
      if (src.slice(j, j + 2) === '?:') j += 2;
      const [sisu, uus] = loeAlternatiivid(src, j, ')');
      lisa(sisu); i = uus; continue;
    }
    if (c === '[') {
      let j = i + 1;
      const margid = [];
      while (j < src.length && src[j] !== ']') { margid.push(src[j]); j++; }
      lisa(margid); i = j + 1; continue;
    }
    // Kvantoreid nendes kolmes mustris ei ole; kui keegi lisab, jääb eelmine
    // aatom alles ja laiendus on ikkagi VASTE (mitte täielik, aga mitte vale).
    if (c === '?' || c === '*' || c === '+') { i++; continue; }
    lisa([c]); i++;
  }
  koik.push(...jooksvad);
  return [koik, i];
}

/** Kõik literaalsõned, mida see mustriharu katab (kuni `piir` tükki). */
export function laienda(haru, piir = 24) {
  const [tulemus] = loeAlternatiivid(haru, 0, null);
  return [...new Set(tulemus)].filter(Boolean).slice(0, piir);
}

/** Pythoni õendfaili mustrid lähtekoodist, või null kui faili ei ole. */
export function pythoniMustrid(repo = REPO) {
  const p = join(repo, 'riigihanked/rhr_tools/rhr_watch.py');
  if (!existsSync(p)) return null;
  const s = readFileSync(p, 'utf8');
  const v = (nimi) => {
    const m = new RegExp(nimi + "\\s*=\\s*re\\.compile\\(r'([^']*)'", 'm').exec(s);
    return m ? m[1] : null;
  };
  return { FIT: v('FIT'), EXCL: v('EXCL'), SMALLWEB: v('SMALLWEB') };
}

/** Näidissõned mustri kohta: Node'i muster + (kui on) Pythoni oma, ühendatuna. */
export function naidised(jsRe, pySrc) {
  const kogu = new Set();
  for (const src of [jsRe.source, pySrc].filter(Boolean)) {
    for (const h of harud(src)) for (const n of laienda(h)) kogu.add(n);
  }
  return [...kogu];
}

// ---------------------------------------------------------------------------
// Segmendipaarid.
// ---------------------------------------------------------------------------

// Pealkiri ILMA ühegi FIT-, EXCL- ja SMALLWEB-sõnata. Kuju on päris RHR-ist:
// asutuse sisenimi, millest töö sisu ei paista. Just selline pealkiri jättis
// ülesandes 3 hanke 310983 vahele.
export const NEUTRAALNE = 'OsKus ühtse infosüsteemi ja analüüsikeskkonna loomine';

export function koostaSegmendiPaarid(repo = REPO) {
  const py = pythoniMustrid(repo);
  const paarid = [];
  const lisa = (allikas, haru, title, kirjeldus, uheArgumendiga = false) => {
    paarid.push({
      allikas, haru, title, kirjeldus,
      ...(uheArgumendiga ? { uheArgumendiga: true } : {}),
      ootus: uheArgumendiga ? segmentOf(title) : segmentOf(title, kirjeldus),
    });
  };

  // FIT: sõna pealkirjas JA sõna ainult kirjelduses. Teine pool on ülesande 3
  // kaotatud hange — ilma selleta ei kuku pöördtest "ainult pealkiri".
  for (const n of naidised(FIT, py?.FIT)) {
    lisa('FIT', n, `Hange ${n} soetamine`, 'Hanke ese on kirjelduses lahti kirjutatud.');
    lisa('FIT-kirjeldusest', n, NEUTRAALNE, `Teenused; sisu: ${n} ja sellega seonduv.`);
  }
  // EXCL: sõna pealkirjas (peab välistama) JA sõna ainult kirjelduses (EI TOHI
  // välistada — mõõdetud otsus, vt lib/hanked.mjs kommentaari).
  for (const n of naidised(EXCL, py?.EXCL)) {
    lisa('EXCL', n, `${n} ja veebilehe uuendamine`, 'Teenused; veebileht.');
    lisa('EXCL-kirjeldusest', n, `${NEUTRAALNE} ja veebilehe uuendamine`,
      `Teenused; tööde hulgas on ka ${n}.`);
  }
  // SMALLWEB: sõna pealkirjas (väike veebileht) JA ainult kirjelduses (ei tohi
  // suurt infosüsteemi väikeseks veebileheks kirjutada).
  for (const n of naidised(SMALLWEB, py?.SMALLWEB)) {
    lisa('SMALLWEB', n, `${n} uuendamine`, 'Teenused.');
    lisa('SMALLWEB-kirjeldusest', n, `${NEUTRAALNE}, kasutajakogemus`,
      `Teenused; osana valmib ka ${n}.`);
  }

  // Päris juhtumid ja ääred.
  lisa('päris-310983', '310983', NEUTRAALNE,
    'Teenused; veebirakenduste loomiseks ja arendamiseks, sh prototüüpimine ja kasutajatestid.');
  lisa('äär', 'tühi pealkiri', '', 'veebileht');
  lisa('äär', 'null pealkiri', null, 'veebileht');
  lisa('äär', 'üks argument', 'Veebilehe uuendamine', '', true);
  lisa('äär', 'üks argument, FIT ainult kirjelduses', NEUTRAALNE, '', true);
  return paarid;
}

// ---------------------------------------------------------------------------
// eForms-i ootus.
// ---------------------------------------------------------------------------

export function loeFikstuur(juur = JUUR) {
  const tee = join(juur, FIKSTUUR);
  const xml = readFileSync(tee, 'utf8');
  // LF-kujult, sama mis varavas — vt seletust test/gate-pariteet.mjs-is.
  return { xml, baidid: Buffer.byteLength(xml.replace(/\r\n/g, '\n'), 'utf8') };
}

export function koostaEformsOotus(juur = JUUR) {
  const { xml, baidid } = loeFikstuur(juur);
  const tykid = splitNotices(xml, 'ContractAwardNotice');
  return {
    fikstuur: FIKSTUUR,
    baidid,
    teateid: tykid.length,
    teated: tykid.map((b) => parseAward(b)),
  };
}

// ---------------------------------------------------------------------------

function main(argv) {
  const kuiv = argv.includes('--kuiv');
  const ef = koostaEformsOotus();
  const seg = { paare: 0, paarid: koostaSegmendiPaarid() };
  seg.paare = seg.paarid.length;

  const failid = [
    [OOTUS_EFORMS, JSON.stringify(ef, null, 2) + '\n'],
    [OOTUS_SEGMENT, JSON.stringify(seg, null, 2) + '\n'],
  ];
  for (const [suhteline, sisu] of failid) {
    const tee = join(JUUR, suhteline);
    const vana = existsSync(tee) ? readFileSync(tee, 'utf8') : null;
    const muutus = vana !== sisu;
    if (!kuiv) writeFileSync(tee, sisu, 'utf8');
    console.log(`${muutus ? 'MUUTUS ' : 'sama   '} ${suhteline} (${(Buffer.byteLength(sisu, 'utf8') / 1024).toFixed(1)} KB)`);
  }
  console.log(`\neForms: ${ef.teateid} teadet fikstuurist ${ef.fikstuur} (${(ef.baidid / 1024).toFixed(1)} KB)`);
  console.log(`segmentOf: ${seg.paare} paari`);
  if (!pythoniMustrid()) {
    console.log('\nHOIATUS: riigihanked/rhr_tools/rhr_watch.py puudub (kaust on .gitignore\'is).');
    console.log('Segmendipaarid tulid AINULT Node\'i mustritest. Kui Pythoni pool on');
    console.log('vahepeal harusid juurde saanud, ei ole need praegu kaetud.');
  }
  if (kuiv) console.log('\n--kuiv: midagi ei kirjutatud.');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
