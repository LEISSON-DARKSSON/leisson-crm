#!/usr/bin/env node
// ULESANNE 12: kuine ajaloo import. eForms notice_award (kuu kaupa XML) -> hanke_lepingud.
// Kasutus: node agent/hanked-history.mjs [--kuud=N] [--alates=AAAA-KK] [--uuesti] [--tana=AAAA-KK-PP]
//          npm run hanked:ajalugu
//
// MIS SIIN ON TEISITI KUI PLAANI NAIDISKOODIS - ja miks.
//
// O1. RIDA ON OSA KOHTA, MITTE TEATE KOHTA (otsus 21.09.2026).
//   Mitmeosalisel hankel on osadel eri voitjad, eri summad ja eri tulemused. Moodetud
//   august 2026 (956 lepinguteadet): 54 teatel on nii mitu osa kui mitu voitjat, 17-l
//   on osade tulemused erinevad. Uks rida teate kohta annaks konkurentide pingereas
//   sustemaatiliselt vale vastuse tapselt seal, kus raha on. Skeem (lib/hanked.mjs) ja
//   unikaalindeks (idx_lep_uniq_osa) kannavad seetottu osa tunnust; vana teatepohine
//   idx_lep_uniq on KUSTUTATUD, mitte korvu jaetud - ta oleks lasknud raamlepingu
//   teise osa rea (sama voitja, sama summa) vaikselt INSERT OR IGNORE taha kaduda.
//   KONSORTSIUM: iga liige saab oma rea (alltoovotupartner on tapselt see, keda
//   pingerida otsib), aga SUMMA on ainult juhi real - muidu loeks ulesande 13 mediaan
//   sama lepingu raha kaks korda. Partneri rida utleb amount_allikas = 'konsortsiumi-partner'.
//
// O2. TEHING ON KUU KAUPA, MITTE KOGU JOOKSU PEALE.
//   node:sqlite on sunkroonne: uks BEGIN IMMEDIATE 24 kuu peale hoiaks kirjutuslukku
//   kumneid minuteid ja CRM (server, sunk, nupud) jookseks selle taga kinni. Kuupohine
//   tehing teeb impordi ka JATKATAVAKS: hanke_sync rida kirjutatakse SAMAS tehingus,
//   seega "laetud kuu" ja "kuu read" ei saa lahku minna, ja katkenud jooks jatkab
//   sealt, kus ta pooleli jai (vt tehtudKuud).
//
// O3. UKS SONAVARA, NORMALISEERIMINE ON SIIN.
//   eForms annab koodid ('services', 'open'), RSS-i tee (lib/hanked.mjs parseRss) annab
//   eestikeelsed sonad ('Teenused', 'Avatud hankemenetlus'). Valitud on EESTIKEELNE
//   kuju, sest sama sonavara on juba `hanked`-tabelis ja lahebki otse inimese ette.
//   Tolge on SIIN (importijas), mitte lugejas: lib/eforms.mjs EI TOHI vaikselt tolkida,
//   tema too on lugeda see, mis failis on. Tundmatu kood laheb baasi TOORELT ja on
//   loendatud - vaikne NULL tahendaks, et RHR-i uus kood kaob ilma punase reata.
//
// VAIKSET FILTRIT EI OLE. Plaani naidiskoodi rida
//   if (a.nature !== 'services' || !a.winner) continue;
// oleks visanud ara 137 voitjata teadet JA kogu ehituse ja asjad - ilma uheainsa
// loendurita. Ajalootabel on TURUAJALUGU: kirjutamise hetkel filtreerimine on
// poordumatu (uus filter nouab 24 kuu uuesti laadimist), lugemise hetkel on ta tasuta
// WHERE. Seega laheb sisse KOIK, iga rida kannab `nature`, `segment` ja `tulemus`
// veergu, ja iga vahelejaanud asi (kuupaevata teade, loetamatu plokk) on LOENDATUD
// ning nahtav hanke_sync.note-s.
import { statfsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../lib/env.mjs';
import { migrateHanked, segmentOf, kuupaevaValve } from '../lib/hanked.mjs';
import { splitNotices, parseAward } from '../lib/eforms.mjs';
import { avaBaas, logiSync, logiSyncKindel, baasiViga, alustaOtseJooks,
  lopetaOtseJooks } from './hanked-sync.mjs';
import { LOG_MAX } from '../lib/hanked-runs.mjs';

// --- konstandid ------------------------------------------------------------

// 24 kuu aken on ARIOTSUS (plaan): vanem leping ei utle konkurendi tanase hinna
// kohta enam midagi. Sama arv piirab ka argumente - vt parseArgs.
export const MAX_KUUD = 24;
const VAIKE_BASE = 'https://riigihanked.riik.ee';
// Uks kuu on ~21 MB. Aegumine on kuu kohta, mitte jooksu kohta.
const AEGUMINE = 300000;
// Vaba ketas enne algust. 24 kuud x 21 MB laheb labi malu, aga baas, WAL ja
// ajutised failid tahavad ruumi - ja tais ketas annab keset jooksu SQLITE_FULL-i,
// mis naeb valja nagu andmeviga.
const VAJA_BAITE = 2 * 1024 * 1024 * 1024;
const CMD_NIMI = 'history';

// eForms-i kuu-XML. Kuu EI OLE nulliga polsterdatud (moodetud RHR-i URL-ist).
export function awardUrl(kuu, base = process.env.HANKED_AWARD_BASE || VAIKE_BASE) {
  const [aasta, kk] = kuuOsad(kuu);
  return `${base}/rhr/api/public/v1/opendata/notice_award/${aasta}/month/${kk}/xml`;
}

// --- sonavara (O3) ---------------------------------------------------------

// eForms `contract-nature` -> lib/hanked.mjs LIIGID kanooniline kuju. Sama sonavara,
// mis on juba `hanked`-tabelis RSS-i teed pidi.
export const LIIK_KOOD = new Map([
  ['services', 'Teenused'],
  ['supplies', 'Asjad'],
  ['works', 'Ehitustööd'],
]);

// eForms `ProcedureCode` -> RHR-i eestikeelne menetluse nimi (sama kuju, mille RSS-i
// kirjeldusvali annab). Kaks koodi vajavad selgitust:
//   'oth-single' = uhe pakkujaga menetlus (RHR: "Väljakuulutamiseta läbirääkimistega
//                  hankemenetlus" perekond) - RHR-i enda eestikeelne silt;
//   'neg-w-call' / 'neg-wo-call' = valjakuulutamisega / -kuulutamiseta labiraakimised.
// Tundmatu kood EI tolgita ara ega kustutata - ta laheb toorelt baasi ja loendurisse.
export const MENETLUS_KOOD = new Map([
  ['open', 'Avatud hankemenetlus'],
  ['restricted', 'Piiratud hankemenetlus'],
  ['comp-dial', 'Võistlev dialoog'],
  ['comp-tend', 'Konkurentsipõhine läbirääkimistega hankemenetlus'],
  ['innovation', 'Innovatsioonipartnerlus'],
  ['neg-w-call', 'Väljakuulutamisega läbirääkimistega hankemenetlus'],
  ['neg-wo-call', 'Väljakuulutamiseta läbirääkimistega hankemenetlus'],
  ['oth-single', 'Muu ühe pakkujaga menetlus'],
  // 'oth-mult' tuli valja ALLES PARIS JOOKSUL (2026-06: 4 rida) - fikstuuris teda ei
  // olnud. Tundmatu kood laks toorelt baasi ja loendurisse, seega ta oli NAHTAV ja
  // selle rea lisamine oli uhe minuti too. Tapselt selleks see loendur on.
  ['oth-mult', 'Muu mitme pakkujaga menetlus'],
]);

const tolgi = (kaart, kood, loend, votmeNimi) => {
  if (kood === null || kood === undefined || kood === '') return null;
  const v = kaart.get(kood);
  if (v) return v;
  loend[votmeNimi]++;
  return kood; // tundmatu kood jaab NAHTAVAKS, mitte ei kao NULL-i
};

// --- abid ------------------------------------------------------------------

const teata = (o) => {
  const rida = JSON.stringify(o);
  LOGI = (LOGI + rida + '\n').slice(-LOG_MAX);
  if (typeof o.progress === 'string') VIIMANE = o.progress;
  process.stdout.write(rida + '\n');
};
let LOGI = '';
let VIIMANE = null;

const lyhike = (e) => String((e && e.message) || e).replace(/\s+/g, ' ').trim().slice(0, 500);
const vorm = (n, ainsus, mitmus) => n + ' ' + (n === 1 ? ainsus : mitmus);

function viga(sonum) {
  const e = new Error(sonum);
  e.code = 400;
  return e;
}

const KUU_KUJU = /^(\d{4})-(0[1-9]|1[0-2])$/;
const PAEV_KUJU = /^\d{4}-\d{2}-\d{2}$/;

function kuuOsad(kuu) {
  const m = KUU_KUJU.exec(String(kuu ?? ''));
  if (!m) throw viga('Vigane kuu (oodati AAAA-KK): ' + String(kuu).slice(0, 40));
  return [Number(m[1]), Number(m[2])];
}

// Kuupaev peab olema OLEMAS, mitte ainult oige kujuga: '2026-02-31' on kuju poolest
// laitmatu ja teda ei ole olemas. Sama rangus mis SQL-i pool (kuupaevaValve).
function kehtivPaev(s) {
  if (typeof s !== 'string' || !PAEV_KUJU.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const kuuks = (aasta, kk) => aasta + '-' + String(kk).padStart(2, '0');

// --- kuude nimekiri --------------------------------------------------------

/**
 * Laetavad kuud. JOOKSVAT KUUD EI LAETA: RHR-i kuufail taieneb kuu jooksul ja
 * poolik kuu laheks tehtud kuude hulka, mille jarel teda ei laetaks enam KUNAGI
 * (tehtudKuud on korduskaitse). Seega loppeb nimekiri EELMISE taieliku kuuga.
 */
export function kuudeNimekiri(tana = new Date().toISOString().slice(0, 10),
  { kuud = MAX_KUUD, alates = null } = {}) {
  if (!kehtivPaev(tana)) throw viga('Vigane kuupäev: ' + String(tana).slice(0, 40));
  const [a, k] = [Number(tana.slice(0, 4)), Number(tana.slice(5, 7))];
  // Eelmine taielik kuu, jarjekorranumbrina (aasta * 12 + kuu - 1).
  const lopp = a * 12 + (k - 1) - 1;
  let algus;
  if (alates !== null && alates !== undefined) {
    const [aa, ak] = kuuOsad(alates);
    algus = aa * 12 + (ak - 1);
  } else {
    const n = Number(kuud);
    if (!Number.isInteger(n) || n < 1) throw viga('Vigane kuude arv: ' + String(kuud).slice(0, 40));
    algus = lopp - (n - 1);
  }
  // AKNA LAGI. --alates=2010-01 ei tohi teha 190 paringut (u 4 GB): 24 kuud on
  // kogu tabeli aken, vanem rida kustutataks kohe kustutaVanemad-iga.
  if (lopp - algus + 1 > MAX_KUUD) algus = lopp - (MAX_KUUD - 1);
  const out = [];
  for (let i = algus; i <= lopp; i++) out.push(kuuks(Math.floor(i / 12), (i % 12) + 1));
  return out;
}

// --- argumendid ------------------------------------------------------------

/**
 * Argumendid tulevad kahest kohast: kasurealt (Task Scheduler: --kuud=1) ja CRM-i
 * nupust (lib/hanked-runs.mjs valideeriArgs -> --kuud=1). Molemad lahevad SIIT labi.
 * Rumal vaartus ei tohi teha pool gigabaiti paringuid - --kuud=9999 PIIRATAKSE ja
 * piiramine jatab nahtava hoiatuse (vaikne piiramine oleks sama vale kui vaikne filter).
 */
export function parseArgs(argv = []) {
  const out = { kuud: MAX_KUUD, alates: null, uuesti: false, tana: null, hoiatus: null };
  for (const a of argv) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(String(a));
    if (!m) throw viga('Tundmatu argument: ' + String(a).slice(0, 40));
    const [, voti, vaartus] = m;
    if (voti === 'kuud') {
      const n = Number(vaartus);
      if (!Number.isInteger(n) || n < 1) {
        throw viga('Vigane --kuud (oodati taisarvu 1..' + MAX_KUUD + '): ' + String(vaartus).slice(0, 40));
      }
      out.kuud = Math.min(n, MAX_KUUD);
      if (n > MAX_KUUD) {
        out.hoiatus = '--kuud=' + n + ' on suurem kui ' + MAX_KUUD + ' kuu aken — laen ' + MAX_KUUD + ' kuud';
      }
    } else if (voti === 'alates') {
      if (!KUU_KUJU.test(String(vaartus ?? ''))) {
        throw viga('Vigane --alates (oodati AAAA-KK): ' + String(vaartus).slice(0, 40));
      }
      out.alates = vaartus;
    } else if (voti === 'tana') {
      if (!kehtivPaev(String(vaartus ?? ''))) {
        throw viga('Vigane --tana (oodati AAAA-KK-PP): ' + String(vaartus).slice(0, 40));
      }
      out.tana = vaartus;
    } else if (voti === 'uuesti') {
      out.uuesti = vaartus === undefined || vaartus === '' || vaartus === '1' || vaartus === 'true';
    } else {
      throw viga('Tundmatu argument: ' + String(a).slice(0, 40));
    }
  }
  return out;
}

// --- tehtud kuud -----------------------------------------------------------

const VOTI = (kuu) => 'notice_award:' + kuu;

/**
 * Kuud, mis on JUBA ONNESTUNULT laetud. See on impordi KATKESTATAVUSE alus: kui
 * jooks katkeb 14. kuu peal (masin magab, vork kaob, inimene vajutab "Peata"),
 * jatkab jargmine jooks sealt, mitte otsast. ok = 1 on noutud - punane kuu peab
 * uuesti proovitud saama.
 */
export function tehtudKuud(db) {
  const on = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='hanke_sync'").get();
  if (!on) return [];
  return db.prepare("SELECT key FROM hanke_sync WHERE key LIKE 'notice_award:%' AND ok = 1 ORDER BY key")
    .all().map((r) => String(r.key).slice('notice_award:'.length));
}

// --- import ----------------------------------------------------------------

// Vastus peab olema eForms, mitte HTML-veateade ega tuhi keha. Ilma selle valveta
// annaks proxy 502-leht splitNotices-ilt tuhja massiivi ja kuu "onnestuks" nulliga -
// ja ta oleks sellega IGAVESEKS tehtud kuude hulgas.
const EFORMS_KUJU = /<(OPEN-DATA|ContractAwardNotice)[\s>]/i;

const kirjeldaKeha = (xml) => {
  if (typeof xml !== 'string') return 'keha tüüp on ' + (xml === null ? 'null' : typeof xml);
  const s = xml.replace(/\s+/g, ' ').trim();
  if (!s) return 'tühi keha';
  return s.length > 120 ? s.slice(0, 120) + '…' : s;
};

const VEERUD = ['ref', 'lot', 'kuu', 'notice_id', 'date', 'buyer', 'buyer_reg', 'title', 'cpv',
  'nature', 'menetlus', 'segment', 'segment_allikas', 'tulemus', 'osi',
  'winner', 'winner_reg', 'winner_size', 'winner_allikas', 'winner_arv', 'konsortsium',
  'amount', 'currency', 'amount_valuutas', 'amount_allikas', 'tenders', 'tenders_allikas'];

const LISA_SQL = `INSERT OR IGNORE INTO hanke_lepingud (${VEERUD.join(',')})
  VALUES (${VEERUD.map(() => '?').join(',')})`;

// Mitte-EUR EI LAHE euroveergu. Sama reegel mis lib/eforms.mjs summaVorm-is:
// vaartus jaab nahtavaks `amount_valuutas`-es ja `amount` on tuhi.
function summa(vaartus, valuuta, allikas) {
  if (vaartus === null || vaartus === undefined) {
    return { amount: null, currency: valuuta ?? null, amount_valuutas: null, amount_allikas: allikas ?? null };
  }
  const eur = valuuta === null || valuuta === undefined || valuuta === 'EUR';
  return {
    amount: eur ? vaartus : null,
    currency: valuuta ?? null,
    amount_valuutas: vaartus,
    amount_allikas: allikas ?? null,
  };
}

// Segment + tabamuse allikas. Pealkiri on TUGEVAM tunnus: ta on hanke enda nimi,
// kirjeldus kannab ka standardteksti.
function segmendiga(title, kirjeldus) {
  const p = segmentOf(title);
  if (p) return { segment: p, segment_allikas: 'pealkiri' };
  const k = segmentOf(title, kirjeldus || '');
  return { segment: k, segment_allikas: k ? 'kirjeldus' : null };
}

function uusLoend() {
  return {
    teateid: 0, osi: 0, read: 0, duplikaate: 0, voitjata: 0, nisis: 0, nisisPealkirjast: 0, konsortsiume: 0,
    loetamatuid: 0, kuupaevata: 0, tundmatuLiik: 0, tundmatuMenetlus: 0,
    liigid: Object.create(null),
  };
}

/** Sunkimislogi rida: iga mahavisatud asi on NAHTAV, mitte ainult "N rida". */
export function loendiTekst(l) {
  const liigid = Object.entries(l.liigid).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => k + ' ' + v).join(' / ');
  const osad = [
    vorm(l.teateid, 'teade', 'teadet'),
    vorm(l.osi, 'osa', 'osa'),
    vorm(l.read, 'rida', 'rida'),
    l.voitjata + ' võitjata osa',
    l.nisis + ' nišis (' + l.nisisPealkirjast + ' pealkirjast)',
  ];
  if (l.duplikaate) osad.push(vorm(l.duplikaate, 'dublikaat', 'dublikaati'));
  if (l.konsortsiume) osad.push(vorm(l.konsortsiume, 'konsortsiumi rida', 'konsortsiumi rida'));
  if (liigid) osad.push(liigid);
  if (l.loetamatuid) osad.push(vorm(l.loetamatuid, 'loetamatu teade', 'loetamatut teadet'));
  if (l.kuupaevata) osad.push(l.kuupaevata + ' kuupäevata teadet (vahele jäetud)');
  if (l.tundmatuLiik) osad.push('tundmatu liigikood: ' + l.tundmatuLiik);
  if (l.tundmatuMenetlus) osad.push('tundmatu menetluskood: ' + l.tundmatuMenetlus);
  return osad.join(' · ');
}

// Uhe teate read. Tagastab massiivi - MITTE KUNAGI tuhja, kui teate kuupaev on
// loetav: teade ilma NoticeResult-ita annab UHE teatetasemel rea. Vaikne kadu on
// selle projekti korduv viga ja siin on ta valistatud testiga
// ("iga teade annab vahemalt uhe rea").
function teateRead(a, kuu, loend) {
  const liik = tolgi(LIIK_KOOD, a.nature, loend, 'tundmatuLiik');
  const menetlus = tolgi(MENETLUS_KOOD, a.menetlus, loend, 'tundmatuMenetlus');
  if (liik) loend.liigid[liik] = (loend.liigid[liik] || 0) + 1;

  const osad = a.lots && a.lots.length
    ? a.lots
    // Teade ilma NoticeResult-ita: uks "osa" teate enda valjadest. `lot` jaab
    // NULL-iks ja unikaalindeks normaliseerib ta tuhjaks stringiks.
    : [{ lot: null, tulemus: a.tulemus, tenders: a.tenders, tenders_allikas: a.tenders_allikas,
      title: null, description: null, cpv: null,
      voitjad: a.winner ? [{ tender: null, name: a.winner, reg: a.winner_reg, size: a.winner_size,
        juht: true, amount: a.amount_valuutas, currency: a.currency }] : [] }];

  const read = [];
  for (const osa of osad) {
    loend.osi++;
    const title = osa.title || a.title;
    // Kirjeldus on OSA oma JA teate oma kokku. Moodetud: uheosaline teade kordab
    // projekti ka osa sees, aga mitmeosalisel teatel on osa kirjeldus KITSAM
    // (uks osa suurest hankest) - kumbki uksi jataks nisisona vahele. EXCL kaib
    // endiselt AINULT pealkirja peal (vt lib/hanked.mjs segmentOf).
    const kirjeldus = [...new Set([osa.description, a.description].filter(Boolean))].join(' ');
    const alus = {
      ref: a.ref, lot: osa.lot ?? null, kuu, notice_id: a.notice_id, date: a.date,
      buyer: a.buyer, buyer_reg: a.buyer_reg, title, cpv: osa.cpv || a.cpv,
      nature: liik, menetlus,
      // FIT vaatab pealkirja JA kirjeldust (lib/hanked.mjs segmentOf). Ainult
      // pealkiri kaotas ulesandes 3 paris hanke 310983.
      //
      // AGA: MOODETUD 3 kuu paris jooksul (juuni-august 2026) andis kirjeldus 32
      // tabamust 65-st ja osa neist on MURA - lepinguteate kirjelduses on
      // registri boilerplate ("vaata riigihangete registri veebilehelt") ja nii
      // sattus nisi ka "jõutrafode ost". Kirjeldust EI TOHI seetottu valja visata
      // (see kaotaks paris hankeid), aga rida UTLEB, kummalt poolt tabamus tuli:
      // ulesanne 13 ja vaade saavad pealkirjatabamust kaaluda tugevamalt.
      ...segmendiga(title, kirjeldus),
      tulemus: osa.tulemus ?? null,
      osi: a.lots && a.lots.length ? a.lots.length : (a.osi ?? null),
      tenders: osa.tenders ?? null,
      tenders_allikas: osa.tenders_allikas ?? null,
    };
    if (alus.segment) { loend.nisis++; if (alus.segment_allikas === 'pealkiri') loend.nisisPealkirjast++; }

    if (!osa.voitjad.length) {
      // VOITJATA OSA JAAB TABELISSE. 137 teadet 956-st on 'clos-nw' (voitjat ei
      // valitud) ja see on TURUINFO: kus ei tule pakkujaid, seal on jargmine kord
      // ruumi. Plaani naidiskood viskas nad vaikselt minema.
      loend.voitjata++;
      read.push({ ...alus, winner: null, winner_reg: null, winner_size: null,
        winner_allikas: a.winner_allikas ?? null, winner_arv: 0, konsortsium: 0,
        ...summa(null, null, null) });
      continue;
    }
    const konsortsium = osa.voitjad.length > 1 && new Set(osa.voitjad.map((v) => v.tender)).size === 1;
    for (const v of osa.voitjad) {
      if (konsortsium) loend.konsortsiume++;
      // Partneri real ei ole summat - vt O1. Pohjus on VALJAS (amount_allikas),
      // muidu naeks tuhi summa valja nagu puuduv andmestik.
      const s = v.amount !== null && v.amount !== undefined
        ? summa(v.amount, v.currency, 'lot-tender')
        : summa(null, null, konsortsium && !v.juht ? 'konsortsiumi-partner' : null);
      read.push({ ...alus,
        winner: v.name ?? null, winner_reg: v.reg ?? null, winner_size: v.size ?? null,
        winner_allikas: a.winner_allikas ?? null,
        winner_arv: osa.voitjad.length, konsortsium: konsortsium ? 1 : 0, ...s });
    }
  }
  return read;
}

/**
 * Uks kuu sisse. UKS TEHING = UKS KUU (O2), ja hanke_sync rida kirjutatakse SAMAS
 * tehingus, seega "kuu on laetud" ja "kuu read on olemas" ei saa lahku minna.
 */
export function importMonthXml(db, kuu, xml, { uuesti = false } = {}) {
  migrateHanked(db);
  kuuOsad(kuu); // valve: vigane kuu ei tohi kirjutada rida tundmatu votmega
  if (!uuesti && tehtudKuud(db).includes(kuu)) return { kuu, vahelejäetud: true, rows: 0, loend: null };

  if (typeof xml !== 'string' || !EFORMS_KUJU.test(xml)) {
    const e = viga('RHR ei andnud eForms XML-i (' + kuu + '): ' + kirjeldaKeha(xml));
    logiSyncKindel(db, { key: VOTI(kuu), rows: 0, ok: 0, note: e.message });
    throw e;
  }

  const loend = uusLoend();
  const lisa = db.prepare(LISA_SQL);
  let meieTehing = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    meieTehing = true;
    // Tahtlik uuestilaadimine kustutab kuu read ENNE - muidu jaaks vana kuju
    // (nt vana segmendireegel) ridade sisse ja tabelis oleks kaks eri totte.
    if (uuesti) db.prepare('DELETE FROM hanke_lepingud WHERE kuu = ?').run(kuu);

    for (const blk of splitNotices(xml, 'ContractAwardNotice')) {
      loend.teateid++;
      const a = parseAward(blk);
      if (a.ref === null && a.notice_id === null) { loend.loetamatuid++; continue; }
      // `date` on tabelis NOT NULL ja 24 kuu aken kaib tema jargi. Kuupaevata
      // teadet ei saa aknasse panna - ta jaab VALJA ja on LOENDATUD.
      if (!kehtivPaev(a.date)) { loend.kuupaevata++; continue; }
      for (const r of teateRead(a, kuu, loend)) {
        // `read` LOEB TABELISSE JOUDNUD RIDU, mitte katseid. INSERT OR IGNORE neelas
        // paris jooksus (2026-06) 68 rida - sama kirje tuleb kuufailis mitu korda -
        // ja katsete lugemine oleks pannud sunkimislogisse suurema arvu, kui tabelis
        // tegelikult on. Vahe on nuud OMA loendur, mitte vaikne kadu.
        if (lisa.run(...VEERUD.map((v) => r[v] ?? null)).changes) loend.read++;
        else loend.duplikaate++;
      }
    }

    // NULL TEADET KUUS ON KAHTLANE. RHR-i kuufailis on tuhandeid teateid; tuhi
    // vastus tahendab pigem muutunud API-d kui vaikset kuud. ok = 0 hoiab kuu
    // tehtud kuude hulgast valjas, seega jargmine jooks proovib uuesti.
    const ok = loend.teateid > 0 ? 1 : 0;
    const note = loend.teateid > 0 ? loendiTekst(loend)
      : 'eForms-vastuses ei olnud ühtegi lepinguteadet — kontrolli, kas RHR muutis kuju';
    db.prepare(`INSERT INTO hanke_sync (key, ts, rows, ok, note)
        VALUES (?, datetime('now'), ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET ts = excluded.ts, rows = excluded.rows,
          ok = excluded.ok, note = excluded.note`).run(VOTI(kuu), loend.read, ok, note);
    db.exec('COMMIT');
  } catch (e) {
    if (meieTehing) {
      try { db.exec('ROLLBACK'); } catch { /* tehing voib olla juba ise katkenud */ }
      logiSyncKindel(db, { key: VOTI(kuu), rows: 0, ok: 0, note: lyhike(e) });
    }
    throw e;
  }
  return { kuu, rows: loend.read, vahelejäetud: false, loend };
}

// --- 24 kuu aken -----------------------------------------------------------

/**
 * Kustutab 24 kuu aknast valja jaanud read.
 *
 * KUUPAEVAKONTROLL ON RANGE, MITTE STRINGIVORDLUS. `date < '2024-09-20'` on tosi ka
 * vaartuse 'eile' ja '2026' kohta (string), ehk vigase kuupaevaga rida kustuks
 * VAIKSELT - ja SQLite teeb olematust paevast ('2026-02-31') ise '2026-03-03'.
 * Seega kaib kustutamine sama valve alt labi, mida markExpired kasutab (kuupaevaValve),
 * ja vigase kuupaevaga read LOENDATAKSE eraldi, et nad ei kaoks vaikselt kumbagi pidi.
 */
export function kustutaVanemad(db, tana = new Date().toISOString().slice(0, 10), kuud = MAX_KUUD) {
  if (!kehtivPaev(tana)) throw viga('Vigane kuupäev: ' + String(tana).slice(0, 40));
  const n = Number(kuud);
  if (!Number.isInteger(n) || n < 1) throw viga('Vigane kuude arv: ' + String(kuud).slice(0, 40));
  migrateHanked(db);

  const [a, k, p] = [Number(tana.slice(0, 4)), Number(tana.slice(5, 7)), Number(tana.slice(8, 10))];
  const sihtKuu = a * 12 + (k - 1) - n;
  const sa = Math.floor(sihtKuu / 12);
  const sk = (sihtKuu % 12) + 1;
  // Kuu pikkus erineb: 31.03 miinus 1 kuu ei ole 03.03. Piirame paeva kuu pikkusega.
  const viimane = new Date(Date.UTC(sa, sk, 0)).getUTCDate();
  const piir = kuuks(sa, sk) + '-' + String(Math.min(p, viimane)).padStart(2, '0');

  const valve = kuupaevaValve('date');
  const vigaseid = db.prepare(`SELECT COUNT(*) AS c FROM hanke_lepingud WHERE NOT (${valve})`).get().c;
  const kustutatud = db.prepare(`DELETE FROM hanke_lepingud
      WHERE ${valve} AND date(date) < date(?)`).run(piir).changes;
  return { kustutatud: Number(kustutatud), vigaseid: Number(vigaseid), piir };
}

// --- main ------------------------------------------------------------------

function vabaKetas(tee = ROOT) {
  try {
    const s = statfsSync(tee);
    return Number(s.bavail) * Number(s.bsize);
  } catch { return null; } // tundmatu ketas ei tohi importi ara keelata
}

async function laeKuu(kuu) {
  const url = awardUrl(kuu);
  let res;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(AEGUMINE),
      headers: { accept: 'application/xml, text/xml;q=0.9, */*;q=0.1' },
    });
  } catch (e) {
    // Timeout, DNS, TLS - koik uhe nahtava eestikeelse sonumi alla.
    throw new Error('Kuu ' + kuu + ': vastust ei saadud — ' + lyhike(e));
  }
  if (!res.ok) {
    await res.body?.cancel(); // lugemata keha hoiaks uhenduse lahti
    throw new Error('Kuu ' + kuu + ': RHR vastas ' + res.status + ' ' + (res.statusText || ''));
  }
  return res.text();
}

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
  const tana = args.tana || new Date().toISOString().slice(0, 10);

  const vaba = vabaKetas();
  if (vaba !== null && vaba < VAJA_BAITE) {
    teata({ error: 'Vaba ketast alla 2 GB (' + (vaba / 1e9).toFixed(1) + ' GB) — import jääb ära' });
    process.exitCode = 1;
    return;
  }

  let rows = 0;
  let laetud = 0;
  let kukkus = 0;
  let vahele = 0;
  let malu = process.memoryUsage().rss;
  try {
    db = avaBaas();
    migrateHanked(db);
    jooks = alustaOtseJooks(db, { cmd: CMD_NIMI });
    if (jooks.id === null && jooks.vanem === null) {
      // VAHELEJATT EI OLE RIKE (vt agent/hanked-sync.mjs): valjumiskood jaab 0-ks.
      teata({ vahelejaetud: true, pohjus: jooks.pohjus, jooks: jooks.blokeerija });
      return;
    }
    if (args.hoiatus) teata({ hoiatus: args.hoiatus });

    const kuud = kuudeNimekiri(tana, args);
    const tehtud = new Set(args.uuesti ? [] : tehtudKuud(db));
    teata({ progress: 'laen ' + vorm(kuud.length, 'kuu', 'kuud') + ' (' + kuud[0] + '…' + kuud[kuud.length - 1] + ')',
      kuud: kuud.length });

    for (let i = 0; i < kuud.length; i++) {
      const kuu = kuud[i];
      const koht = (i + 1) + '/' + kuud.length;
      if (tehtud.has(kuu)) {
        vahele++;
        teata({ progress: kuu + ' · ' + koht + ' · juba laetud' });
        continue;
      }
      let xml = null;
      try {
        xml = await laeKuu(kuu);
        const r = importMonthXml(db, kuu, xml, { uuesti: args.uuesti });
        rows += r.rows;
        laetud++;
        teata({ progress: kuu + ' · ' + koht + ' · ' + vorm(r.rows, 'rida', 'rida'), rows });
      } catch (e) {
        // UKS KUKKUNUD KUU EI VOTA JOOKSU MAHA. Jalg on baasis (importMonthXml
        // kirjutab ok = 0 ise; vorguvea puhul kirjutame siin) ja jargmine jooks
        // proovib sama kuud uuesti, sest tehtudKuud noudis ok = 1.
        kukkus++;
        const sonum = lyhike(e);
        if (!/eForms XML-i/.test(sonum)) {
          logiSyncKindel(db, { key: VOTI(kuu), rows: 0, ok: 0, note: sonum });
        }
        teata({ error: sonum, kuu });
      } finally {
        // MALU: uks kuu on ~21 MB ja splitNotices teeb tukid juurde. 24 kuud korraga
        // malus oleks pool gigabaiti - seega viide vabastatakse KOHE ja jargmine kuu
        // laetakse alles siis.
        xml = null;
        malu = Math.max(malu, process.memoryUsage().rss);
      }
    }

    const vanad = kustutaVanemad(db, tana, MAX_KUUD);
    if (vanad.kustutatud || vanad.vigaseid) {
      teata({ progress: 'aken ' + vanad.piir + ': ' + vanad.kustutatud + ' vana rida kustutatud'
        + (vanad.vigaseid ? ', ' + vanad.vigaseid + ' vigase kuupäevaga rida alles' : '') });
    }

    teata({ done: true, kuud: laetud, vahele, kukkus, rows,
      kustutatud: vanad.kustutatud, vigaseidKuupaevi: vanad.vigaseid,
      malu_mb: Math.round(malu / 1048576) });
    // Koik kuud kukkusid = jooks on rike. Osaline onnestumine jaab Task Scheduleris
    // roheliseks (ja jalg on baasis), muidu laheks iga uksik vorgutork punaseks.
    if (kukkus > 0 && laetud === 0) process.exitCode = 1;
    lopetaOtseJooks(db, jooks.id, {
      ok: kukkus === 0, rows, progress: VIIMANE, log: LOGI,
      error: kukkus ? kukkus + ' kuud jäi laadimata — vaata hanke_sync ridu' : null,
    });
  } catch (e) {
    if (db === null) {
      teata({ error: 'Baasi ei saanud avada: ' + lyhike(e) });
    } else {
      teata({ error: baasiViga(e) });
      try { logiSync(db, { key: 'notice_award', rows: null, ok: 0, note: lyhike(e) }); } catch { /* jalg on juba stdout-is */ }
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
