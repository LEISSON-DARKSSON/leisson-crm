#!/usr/bin/env node
// ULESANNE 14: hanke alusdokumentide allalaadimine, lahtipakkimine ja nõuete lugemine.
// Kasutus: node agent/hanked-docs.mjs --ref=314159 [--uuesti]
//          npm run hanked:dokumendid -- --ref=314159
//
// TEE (sama, mis riigihanked/rhr_tools/rhr_docs.py juba paris RHR-i vastu teeb):
//   GET /rhr/api/public/v1/procurement/<rhr_id>/documents-temp-url -> { value }
//   GET https://riigihanked.riik.ee<value>                          -> zip
//   lahti riigihanked/<viitenumber>/docs/ alla
//   UPDATE hanked SET docs_dir, docs_count, rollid, kaive_noue, quality_weight, docs_leiud
//
// SEE ON VOORAST ALLIKAST TULEV ZIP ja teda koheldakse vastavalt. Kaitsed:
//   1. ZIP-SLIP - turvalineSihtkoht (siin failis) lubab AINULT sihtkausta sisse.
//      Ta ei ole `path.resolve` üksi: Linuxis on '\' LUBATUD failinimemärk, seega
//      kirje 'alam\..\..\evil.mjs' läheks siin ühte faili ja Windowsis kaustast
//      VÄLJA. Windowsi kuju (draivitäht, UNC, '\') on seetõttu eraldi keelatud.
//   2. ZIP-POMM - pakkimata kogumaht, ühe faili maht, failide arv JA pakkimissuhe
//      kontrollitakse keskkataloogist ENNE kui ükski bait lahti pakitakse
//      (lib/zip.mjs); valetavat `usize`-t piirab zlib `maxOutputLength`.
//   3. SUMLINGID - zip-is olevat sümlinki EI LOODA kunagi; kirje läheb
//      vahelejäetute loendisse koos põhjusega.
//   4. KOLBMATUD NIMED - Windowsi reserveeritud nimed (CON, NUL, COM1), keelatud
//      märgid, lõpupunkt/-tühik, üle 255 märgi, mitte-UTF-8 (U+FFFD).
//   5. KETTARUUM - kontrollitakse ENNE lahtipakkimist (muster on hanked-history.mjs-is).
//   6. OLEMASOLEV KAUST - teine jooks EI KIRJUTA vaikselt peale: vaikimisi
//      keeldutakse ja --uuesti TOSTAB vana kausta kõrvale. Kustutamist siin EI OLE
//      ja see on teadlik: CRM-i töökoopia elab mounditud kaustas, kus rm annab
//      EPERM - „puhastame ära" oleks siin lubadus, mida kood ei saa täita.
//
// ARILINE OSA. Dokumentidest loetakse `rollid`, `kaive_noue` ja `quality_weight`,
// mille peale score() annab ALLTÖÖVÕTU. VALE ARV MUUDAB VERDIKTI, seega:
// iga leid kannab TOENDIT (lause + failinimi) ja EBAKINDEL leid EI LAHE veergu -
// ta jääb docs_leiud-i märkega 'kontrolli' ja on paneelil nähtav. Vt lib/hanked-leiud.mjs.
import { spawnSync } from 'node:child_process';
import { statfsSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../lib/env.mjs';
import { migrateHanked, score, sarnasedLepingud, docsReast } from '../lib/hanked.mjs';
import { loeKeskkataloog, paki, docxTekst } from '../lib/zip.mjs';
import { koguLeiud } from '../lib/hanked-leiud.mjs';
import { laeTekst, laeBaidid } from '../lib/hanked-net.mjs';
import { avaBaas, baasiViga, alustaOtseJooks, lopetaOtseJooks } from './hanked-sync.mjs';
import { LOG_MAX } from '../lib/hanked-runs.mjs';

const VAIKE_BASE = 'https://riigihanked.riik.ee';
const CMD_NIMI = 'docs';

export const PAKI_PIIRID = Object.freeze({
  // Vaba ketta miinimumvaru LISAKS lahtipakitavale mahule. Tais ketas annab
  // keset lahtipakkimist ENOSPC-i, mis naeb valja nagu rikutud zip.
  vajaBaite: 64 * 1024 * 1024,
  // Uhe nime ja uhe tee lagi (Windowsi MAX_PATH-i lahedal).
  maxNimi: 255,
  maxTee: 240,
  // Tekstiks teisendamise lagi UHE faili kohta.
  maxTekst: 4 * 1024 * 1024,
  // pdftotext-i aegumine uhe faili kohta.
  pdfAegumine: 60000,
});

// Allalaadimise aegumine. Zip on megabaitides, aga RHR-i ajutine URL voib
// vastata aeglaselt - vt lib/hanked-net.mjs, aegumine katab PAISE JA KEHA.
const AEGUMINE = 180000;

// --- teatamine (sama muster mis hanked-history.mjs) -------------------------
let LOGI = '';
let VIIMANE = null;
const teata = (o) => {
  const rida = JSON.stringify(o);
  LOGI = (LOGI + rida + '\n').slice(-LOG_MAX);
  if (typeof o.progress === 'string') VIIMANE = o.progress;
  process.stdout.write(rida + '\n');
};
const lyhike = (e) => String((e && e.message) || e).replace(/\s+/g, ' ').trim().slice(0, 500);

function viga(sonum) {
  const e = new Error(sonum);
  e.code = 400;
  return e;
}

// --- 1. ZIP-SLIP -----------------------------------------------------------

// Windowsi reserveeritud seadmenimed. 'CON.txt' on Windowsis SAMA MIS 'CON' -
// laiend ei paasta. Fail nende nimedega ei teki, vaid avab seadme.
const RESERVEERITUD = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
// Windowsis failinimes keelatud margid.
const KEELATUD_MARK = /[<>:"|?*]/;
// Juhtmargid ja U+FFFD (= mitte-UTF-8 nimi, mille dekodeerija asendas).
// eslint-disable-next-line no-control-regex
const KOLBMATU_MARK = /[\u0000-\u001f\u007f�]/;

/**
 * Turvaline sihtkoht zip-i kirje jaoks. Viskab, kui nimi ei ole puhtalt
 * sihtkausta sees või ei kõlba failisüsteemis (Windows kaasa arvatud).
 * @param {string} base sihtkaust
 * @param {string} nimi zip-i kirje nimi
 * @returns {string} absoluutne tee sihtkausta sees
 */
export function turvalineSihtkoht(base, nimi) {
  if (typeof nimi !== 'string' || nimi.trim() === '') {
    throw viga('Tühi failinimi zip-is — kirje jäetakse vahele');
  }
  if (nimi.length > PAKI_PIIRID.maxNimi) {
    throw viga('Failinimi on liiga pikk (' + nimi.length + ' märki, lubatud '
      + PAKI_PIIRID.maxNimi + '): ' + nimi.slice(0, 60) + '…');
  }
  if (KOLBMATU_MARK.test(nimi)) {
    throw viga('Failinimes on kõlbmatu märk (juhtmärk või mitte-UTF-8): ' + JSON.stringify(nimi.slice(0, 60)));
  }
  if (/^[A-Za-z]:[\\/]/.test(nimi)) {
    throw viga('Failinimes on Windowsi draivitäht — fail asuks väljaspool sihtkausta: ' + nimi.slice(0, 60));
  }
  if (/^(?:\\\\|\/\/)/.test(nimi)) {
    throw viga('Failinimi on UNC-tee (võrgujagatis) — fail asuks väljaspool sihtkausta: ' + nimi.slice(0, 60));
  }
  if (nimi.includes('\\')) {
    // Linuxis on '\' lubatud FAILINIMEMARK ja path.resolve ei nae siin midagi
    // halba - Windowsis on ta kataloogieraldaja. Sama zip laheks kahes masinas
    // kahte eri kohta, uhes neist kaustast VALJA.
    throw viga('Failinimes on tagurpidi kaldkriips (Windowsis kataloogieraldaja): ' + nimi.slice(0, 60));
  }
  if (nimi.startsWith('/')) {
    throw viga('Absoluutne tee ei ole lubatud — fail asuks väljaspool sihtkausta: ' + nimi.slice(0, 60));
  }

  for (const osa of nimi.split('/')) {
    if (osa === '' || osa === '.') continue;
    if (osa === '..') {
      throw viga('Tee sisaldab „..", mis viiks väljaspool sihtkausta: ' + nimi.slice(0, 60));
    }
    if (KEELATUD_MARK.test(osa)) {
      throw viga('Failinimes on Windowsis keelatud märk (<>:"|?*): ' + osa.slice(0, 60));
    }
    if (/\.$/.test(osa)) throw viga('Failinimi lõpeb punktiga, mida Windows ei luba: ' + osa.slice(0, 60));
    if (/[  ]$/.test(osa)) throw viga('Failinimi lõpeb tühikuga, mida Windows ei luba: ' + JSON.stringify(osa.slice(0, 60)));
    if (RESERVEERITUD.test(osa)) {
      throw viga('Failinimi on Windowsis reserveeritud seadmenimi: ' + osa.slice(0, 60));
    }
  }

  const juur = resolve(base);
  const tee = resolve(juur, nimi);
  if (tee !== juur && !tee.startsWith(juur + sep)) {
    throw viga('Fail asuks väljaspool sihtkausta: ' + nimi.slice(0, 60));
  }
  if (tee.length - juur.length > PAKI_PIIRID.maxTee) {
    throw viga('Tee on liiga pikk Windowsi jaoks: ' + nimi.slice(0, 60) + '…');
  }
  return tee;
}

// --- 5. kettaruum ----------------------------------------------------------

export function vabaKetas(tee = ROOT) {
  try {
    const s = statfsSync(tee);
    return Number(s.bavail) * Number(s.bsize);
  } catch { return null; } // tundmatu ketas ei tohi tood ara keelata
}

// --- lahtipakkimine --------------------------------------------------------

/**
 * Pakib zip-i lahti sihtkausta. Kirje, mida ei saa turvaliselt kirjutada, JAAB
 * VAHELE JA ON LOENDATUD - vaikne kadu oleks siin hullem kui puudulik kaust.
 * @returns {{failid: Array, vahelejaetud: Array, vanaKaust: string|null, kokku: number}}
 */
export function lahtiPaki(zip, siht, { uuesti = false, vaba = vabaKetas } = {}) {
  const { kirjed, kokku } = loeKeskkataloog(zip);

  const vabaBaite = vaba(dirname(resolve(siht)));
  if (vabaBaite !== null && vabaBaite < kokku * 2 + PAKI_PIIRID.vajaBaite) {
    throw viga('Kettaruumi ei jätku: vaja ' + Math.round((kokku * 2 + PAKI_PIIRID.vajaBaite) / 1048576)
      + ' MB, vaba ' + Math.round(vabaBaite / 1048576) + ' MB');
  }

  let vanaKaust = null;
  if (existsSync(siht) && readdirSync(siht).length) {
    if (!uuesti) {
      throw viga('Sihtkaust ei ole tühi: ' + siht
        + ' — vana jooksu failid jääksid uute sekka. Kasuta --uuesti, mis tõstab vana kausta kõrvale.');
    }
    // KUSTUTAMIST EI OLE. Mounditud kaustas annab rm EPERM-i, seega vana kaust
    // TOSTETAKSE korvale ja jaab alles - inimene otsustab, mis temaga edasi saab.
    vanaKaust = siht + '-vana-' + new Date().toISOString().replace(/[:.]/g, '-');
    renameSync(siht, vanaKaust);
  }
  mkdirSync(siht, { recursive: true });

  const failid = [];
  const vahelejaetud = [];
  for (const k of kirjed) {
    if (k.sumlink) {
      vahelejaetud.push({ nimi: k.nimi, pohjus: 'sümlink — zip-is olevat sümlinki ei looda kunagi' });
      continue;
    }
    let tee;
    try {
      tee = turvalineSihtkoht(siht, k.kataloog ? k.nimi.replace(/\/+$/, '') : k.nimi);
    } catch (e) {
      vahelejaetud.push({ nimi: k.nimi, pohjus: lyhike(e) });
      continue;
    }
    if (k.kataloog) { mkdirSync(tee, { recursive: true }); continue; }
    try {
      const sisu = paki(zip, k);
      mkdirSync(dirname(tee), { recursive: true });
      // 'wx' = ei kirjuta olemasolevale peale. Kaks kirjet sama nimega on
      // pahatahtliku zipi klassikaline vote.
      writeFileSync(tee, sisu, { flag: 'wx' });
      failid.push({ nimi: k.nimi, tee, suurus: sisu.length });
    } catch (e) {
      vahelejaetud.push({ nimi: k.nimi, pohjus: lyhike(e) });
    }
  }
  return { failid, vahelejaetud, vanaKaust, kokku };
}

// --- tekstiks --------------------------------------------------------------

// MOODETUD 21.09.2026, hange 315437: masinas OLI pdftotext (xpdf 4.00,
// C:\Program Files\Git\mingw64\bin all), aga `hanked:dokumendid --ref=315437` sai
// spawnSync-ist ENOENT-i ja kirjutas kõik 9 faili `tekstita`-nimekirja. Tagajärg:
// rollid / kaive_noue / quality_weight jäid NULL ja verdikt jäi KAALU, kuigi õige
// vastus oli JÄTA. Põhjus ei olnud puuduv binaar vaid PATH selles protsessis,
// kust CRM käivitati. Seepärast EI otsi me binaari ainult PATH-ist:
//   1. PDFTOTEXT keskkonnamuutuja (täistee) — kui masinal on ta mujal;
//   2. paljas 'pdftotext' PATH-ist;
//   3. teadaolevad kohad Windowsis/Linuxis/macOS-is.
// `pdftotext -v` lõpetab xpdf-is koodiga 99 — see EI OLE viga, vaid versioonitrükk.
const PDFTOTEXT_KANDIDAADID = [
  'C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe',
  'C:\\Program Files (x86)\\Git\\mingw64\\bin\\pdftotext.exe',
  'C:\\Program Files\\poppler\\Library\\bin\\pdftotext.exe',
  '/usr/bin/pdftotext',
  '/usr/local/bin/pdftotext',
  '/opt/homebrew/bin/pdftotext',
];

export function leiaPdftotext({ env = process.env } = {}) {
  const kandidaadid = [];
  if (env.PDFTOTEXT) kandidaadid.push(env.PDFTOTEXT);
  kandidaadid.push('pdftotext', ...PDFTOTEXT_KANDIDAADID);
  for (const tee of kandidaadid) {
    // Paljast nime ei saa existsSync-iga kontrollida — teda otsib OS PATH-ist.
    if (tee !== 'pdftotext' && !existsSync(tee)) continue;
    try {
      const r = spawnSync(tee, ['-v'], { timeout: 10000 });
      if (!r.error && (r.status === 0 || r.status === 99)) return tee;
    } catch { /* järgmine kandidaat */ }
  }
  return null;
}

export function onPdftotext() {
  return leiaPdftotext() !== null;
}

/**
 * Fail -> tekst. PDF NOUAB VALIST BINAARI (pdftotext, poppler). Kui teda ei ole,
 * EI TEESKLE me midagi: fail saab `pohjus: 'pdftotext puudub'` ja on nimekirjas
 * nähtav. Vaikne tühi tekst tähendaks, et rollid loetakse 0-ks ja verdikt oleks
 * vale ilma ühegi märgita.
 */
export function failiTekst(tee, { pdftotext = true } = {}) {
  const nimi = tee.toLowerCase();
  // `pdftotext` on kas true (otsi ise), false (teadaolevalt puudub) või täistee.
  const bin = pdftotext === true ? leiaPdftotext() : pdftotext;
  try {
    if (nimi.endsWith('.pdf')) {
      if (!bin) return { tekst: null, pohjus: 'pdftotext puudub masinas — PDF-i ei saanud tekstiks' };
      const r = spawnSync(bin, ['-layout', '-enc', 'UTF-8', tee, '-'],
        { timeout: PAKI_PIIRID.pdfAegumine, maxBuffer: PAKI_PIIRID.maxTekst, encoding: 'utf8' });
      if (r.error) return { tekst: null, pohjus: 'pdftotext kukkus: ' + lyhike(r.error) };
      if (r.status !== 0) return { tekst: null, pohjus: 'pdftotext lõpetas koodiga ' + r.status };
      return { tekst: String(r.stdout || ''), pohjus: null };
    }
    if (nimi.endsWith('.docx')) return { tekst: docxTekst(readFileSync(tee)), pohjus: null };
    if (/\.(?:txt|md|csv)$/.test(nimi)) {
      return { tekst: readFileSync(tee, 'utf8').slice(0, PAKI_PIIRID.maxTekst), pohjus: null };
    }
    return { tekst: null, pohjus: 'tekstiks ei saanud: toetamata failitüüp' };
  } catch (e) {
    return { tekst: null, pohjus: 'tekstiks ei saanud: ' + lyhike(e) };
  }
}

export function failidTekstiks(failid, { pdftotext = leiaPdftotext() } = {}) {
  // Binaar otsitakse ÜKS kord terve paki kohta, mitte iga faili kohta uuesti.
  const bin = pdftotext === true ? leiaPdftotext() : pdftotext;
  const tekstid = [];
  const tekstita = [];
  for (const f of failid) {
    const r = failiTekst(f.tee, { pdftotext: bin || false });
    if (r.tekst && r.tekst.trim()) tekstid.push({ nimi: f.nimi, tekst: r.tekst });
    else tekstita.push({ nimi: f.nimi, pohjus: r.pohjus || 'tekst oli tühi' });
  }
  // `pdftotext` jääb TÕEVÄÄRTUSEKS: seda välja loeb nii baas (docs_leiud) kui ka
  // vaade (`dok.pdftotext === false`). Täistee käib eraldi väljal.
  return { tekstid, tekstita, pdftotext: Boolean(bin), pdftotextTee: bin || null };
}

// --- argumendid ------------------------------------------------------------

export function parseArgs(argv = []) {
  const out = { ref: null, uuesti: false };
  for (const a of argv) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(String(a));
    if (!m) throw viga('Tundmatu argument: ' + String(a).slice(0, 40));
    const [, voti, vaartus] = m;
    if (voti === 'ref') {
      const v = String(vaartus ?? '').trim();
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(v)) throw viga('Vigane --ref: ' + String(vaartus).slice(0, 40));
      out.ref = v;
    } else if (voti === 'uuesti') out.uuesti = true;
    else throw viga('Tundmatu argument: ' + String(a).slice(0, 40));
  }
  if (!out.ref) throw viga('Puudub --ref=<viitenumber>');
  return out;
}

export const docsJuur = () => process.env.HANKED_DOCS_DIR || join(ROOT, '..', 'riigihanked');

// --- main ------------------------------------------------------------------

async function main() {
  let db = null;
  let jooks = { id: null, vanem: null };
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    teata({ error: lyhike(e) });
    process.exitCode = 1;
    return;
  }

  const base = process.env.HANKED_RHR_BASE || VAIKE_BASE;
  try {
    db = avaBaas();
    migrateHanked(db);
    jooks = alustaOtseJooks(db, { cmd: CMD_NIMI });
    if (jooks.id === null && jooks.vanem === null) {
      teata({ vahelejaetud: true, pohjus: jooks.pohjus, jooks: jooks.blokeerija });
      return;
    }

    const hange = db.prepare('SELECT * FROM hanked WHERE ref = ?').get(args.ref);
    if (!hange) throw viga('Hanget ei ole baasis: ' + args.ref + ' — jooksuta esmalt sünk');
    if (!hange.rhr_id) {
      throw viga('Hankel ' + args.ref + ' ei ole RHR-i id-d — dokumente ei saa küsida');
    }

    teata({ progress: 'küsin dokumentide viidet (RHR ' + hange.rhr_id + ')' });
    const url = base + '/rhr/api/public/v1/procurement/' + encodeURIComponent(hange.rhr_id) + '/documents-temp-url';
    let value = null;
    try {
      const vastus = await laeTekst(url, { aegumine: 60000, silt: 'Dokumentide viide',
        headers: { accept: 'application/json' } });
      let j;
      try { j = JSON.parse(vastus); } catch { throw viga('RHR ei andnud JSON-i: ' + String(vastus).slice(0, 120)); }
      value = j && typeof j.value === 'string' ? j.value.trim() : null;
      if (!value) throw viga('RHR-i vastuses ei olnud dokumentide viidet (value)');
    } catch (e) {
      // 500 TAHENDAB RHR-is "sellel hankel ei ole avalikke dokumente" - see EI OLE
      // meie rike, aga ta ei tohi ka vaikselt roheliseks jaada: paneel naitab RHR-i
      // linki ja inimene vaatab ise.
      const kood = e && e.kood;
      const sonum = kood === 500 ? 'RHR ei andnud dokumente' : lyhike(e);
      teata({ error: sonum, rhr_id: hange.rhr_id, kood: kood ?? null });
      lopetaOtseJooks(db, jooks.id, { ok: false, error: sonum, progress: VIIMANE, log: LOGI });
      process.exitCode = 1;
      return;
    }

    const zipUrl = /^https?:\/\//i.test(value) ? value : base + (value.startsWith('/') ? '' : '/') + value;
    teata({ progress: 'laen dokumentide zip-i' });
    const zip = await laeBaidid(zipUrl, { aegumine: AEGUMINE, silt: 'Dokumendid' });

    const kaust = join(docsJuur(), args.ref, 'docs');
    const r = lahtiPaki(zip, kaust, { uuesti: args.uuesti });
    teata({ progress: r.failid.length + ' faili lahti pakitud'
      + (r.vahelejaetud.length ? ', ' + r.vahelejaetud.length + ' vahele jäetud' : ''),
    rows: r.failid.length });
    for (const v of r.vahelejaetud) teata({ hoiatus: 'vahele jäetud: ' + v.nimi + ' — ' + v.pohjus });
    if (r.vanaKaust) teata({ hoiatus: 'vana kaust tõsteti kõrvale: ' + r.vanaKaust });

    const t = failidTekstiks(r.failid);
    if (!t.pdftotext) {
      teata({ hoiatus: 'pdftotext puudub masinas — ükski PDF ei jõua tekstini, seega '
        + 'rollid/käibenõue/kvaliteedikaal jäävad NULL ja verdikt on lugemata. '
        + 'Sea PDFTOTEXT=<täistee> või lisa binaar PATH-i (vt gate-hanked-docs-tekst.mjs).' });
    }
    for (const x of t.tekstita) teata({ hoiatus: 'tekstiks ei saanud: ' + x.nimi + ' — ' + x.pohjus });

    const leiud = koguLeiud(t.tekstid);
    const docs = {
      ...leiud,
      failid: r.failid.map((f) => ({ nimi: f.nimi, suurus: f.suurus })),
      vahelejaetud: r.vahelejaetud,
      tekstita: t.tekstita,
      pdftotext: t.pdftotext,
      // MILLINE BINAAR luges — see EI OLE kosmeetika. Mõõdetud 21.09.2026
      // hankel 315437: xpdf 4.00 `-layout` lõhub hindamiskriteeriumide
      // mitmeveerulise tabeli nii, et osakaal „60" satub labelist eraldi reale
      // ja kvaliteedikaal jääb lugemata; poppleri sama käsk hoiab rea koos.
      // Ilma selle väljata ei ole hiljem võimalik aru saada, KUMB masin luges.
      pdftotextTee: t.pdftotextTee || null,
      ts: new Date().toISOString(),
    };

    db.prepare(`UPDATE hanked SET docs_dir = ?, docs_count = ?, rollid = ?, kaive_noue = ?,
        quality_weight = ?, blokeeriv_noue = ?, docs_leiud = ?, updated = datetime('now')
        WHERE ref = ?`)
      .run(kaust, r.failid.length, leiud.rollid, leiud.kaiveNoue, leiud.qualityWeight,
        (leiud.blokeerivad || []).join(',') || null, JSON.stringify(docs), args.ref);

    // SKOOR ARVUTATAKSE KOHE UMBER. Ilma selleta jouaks `rollid` kull baasi, aga
    // verdikt jaaks vanaks kuni jargmise sungini - ja ALLTOOVOTT, mille parast
    // kogu see ulesanne olemas on, ei ilmuks ekraanile.
    const rida = db.prepare('SELECT * FROM hanked WHERE ref = ?').get(args.ref);
    const s = score(rida, {
      ajalugu: sarnasedLepingud(db, rida.cpv, { segment: rida.segment }),
      docs: docsReast(rida),
    });
    db.prepare('UPDATE hanked SET score = ?, score_why = ?, verdict = ? WHERE ref = ?')
      .run(s.points, JSON.stringify(s.why), s.verdict, args.ref);

    teata({ done: true, ref: args.ref, failid: r.failid.length,
      vahelejaetud: r.vahelejaetud.length, tekstiga: t.tekstid.length, tekstita: t.tekstita.length,
      rollid: leiud.rollid, kaiveNoue: leiud.kaiveNoue, qualityWeight: leiud.qualityWeight,
      blokeerivad: leiud.blokeerivad || [],
      kontrolli: leiud.leiud.filter((x) => x.kindlus === 'kontrolli').length,
      verdict: s.verdict, score: s.points, kaust });
    lopetaOtseJooks(db, jooks.id, { ok: true, rows: r.failid.length, progress: VIIMANE, log: LOGI });
  } catch (e) {
    if (db === null) teata({ error: 'Baasi ei saanud avada: ' + lyhike(e) });
    else {
      teata({ error: baasiViga(e) });
      lopetaOtseJooks(db, jooks.id, { ok: false, error: baasiViga(e), progress: VIIMANE, log: LOGI });
    }
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}

// Windowsi-kindel otsekaivituse valve (vt agent/hanked-sync.mjs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
