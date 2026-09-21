// eForms (UBL) lepinguteadete lugeja: teatepiiri jargi tukeldav LUGEJA, mitte taisparser.
// Ilma baasita ja ilma vorguta - sama sisend annab alati sama valjundi.
//
// OENDFAIL: riigihanked/rhr_tools/rhr_parse.py (lxml + XPath). See on VORDLUSRAKENDUS,
// mis on paris RHR-i andmete peal juba jooksnud, ja tema valjade valikud on MOODETUD.
// Iga koht, kus see fail teeb midagi teisiti, kannab allpool kommentaari, MIKS.
// Kui rhr_parse.py-d muudetakse, vaadake ka siia (ja vastupidi) - sama joon mis
// hanked.mjs-i FIT-mustril ja rhr_watch.py-l.
//
// PARITEET ON NUUD VARAVAS, MITTE KASITSI ULEVAATUSES: test/gate-pariteet.mjs jooksutab
// parseAward-i kommititud PARIS RHR-i fikstuuri peal (test/fixtures/eforms-2026-08-naidis.xml,
// 11 teadet augustikuu avaandmetest) ja vordleb TAISVALJUNDIT ootusfailiga. Varav ei vaja
// vorku ega Pythonit. Vabatahtlik ristkontroll paris rhr_parse.py vastu koos teadlike
// lahknevuste nimekirjaga: npm run pariteet:python. Tahtlik muudatus: npm run pariteet:uuenda.
//
// Kuju on MOODETUD failist
// https://riigihanked.riik.ee/rhr/api/public/v1/opendata/notice_award/2026/month/8/xml
// (22 MB, 956 ContractAwardNotice'i). Moodetud faktid, mis siinseid otsuseid kannavad:
//   - efac:ReceivedSubmissionsStatistics EI SISALDA RHR-i ekspordis efbc:StatisticsCode'i
//     (3527 plokki koodita, 0 koodiga) - statistikaliiki ei saa sealt lugeda;
//   - cbc:Name kannab ALATI languageID-d (EST 6331, ENG 53) - eelistus on vajalik;
//   - cbc:IssueDate on ajavoondiga ('2026-07-12+03:00');
//   - kogu kuu valuuta oli EUR (1270 PayableAmount + 608 TotalAmount);
//   - CDATA-t ei olnud, olemeid oli (33 '&amp;' nimedes).
//
// Kasutaja: ulesanne 12 (kuine ajaloo import) -> hanke_lepingud -> konkurentide analuus.
// Sealt tuleb ka siinne pohireegel: OLETUS PEAB END NIMETAMA. Iga vali, mille vaartus
// tuleb heuristikast, kannab kaasa `*_allikas` marget, et import saaks kahtlased read
// eraldi naidata. Vale voitja ilma margeta on vaikne vale andmestik.
//
// SIIN ON AINULT parseAward. ContractNotice'i lugejat EI OLE: ulesanne 12 impordib
// ainult notice_award-voogu ja ulesanne 13 loeb hanke_lepingud-tabelit. Hanketeated
// tulevad CRM-i RSS-i kaudu (hanked.mjs parseRss). Kui kunagi tuleb vajadus lugeda
// ContractNotice'i XML-i, on splitNotices juba tagi-agnostiline ja puudu on ainult
// parseNotice - aga seda plaan praegu ei noua ja seda siin ei ole.

import { olemid } from './hanked.mjs';

// ---------------------------------------------------------------------------
// Tukeldaja.
// ---------------------------------------------------------------------------

// Tagi nimi laheb regexi sisse, seega ta on VALVATUD: '.*' ei tohi muutuda mustriks.
const TAG_OK = /^[A-Za-z_][\w.-]*$/;

/**
 * Tukeldab teadetevoo uksikteadeteks AVATAGI jargi: iga tukk algab avatagist ja
 * lopeb JARGMISE avatagi ees.
 *
 * MIKS MITTE LOPUTAGI JARGI: RHR-i teate tekstivaljas (cbc:Note, cbc:Description)
 * esineb string '&lt;/ContractAwardNotice&gt;'. Loputagi jargi tukeldaja loikaks
 * sellise teate pooleks ja teine pool laheks eraldi "teatena" edasi - vaikselt,
 * ilma erindita. Plaani fikstuur sisaldab seda loksu meelega.
 *
 * VIIMANE TUKK kannab kaasa juurelemendi loputagi ('</OPEN-DATA>'). See on TEADLIK:
 * tema maha loikamine nouaks jalle loputagi otsimist, ehk tooks sama vea tagasi.
 * Kahju ei ole, sest koik valjaeraldajad on skoobitud teate ENDA siltide sisse ja
 * '</OPEN-DATA>' ei sisalda uhtegi neist.
 *
 * Tundmatu tag, tuhi sisend ja mitte-string annavad TUHJA MASSIIVI, mitte erindit:
 * ulesande 12 kuine import ei tohi uhe tuhja kuu peale maha kukkuda.
 */
export function splitNotices(xml, tag) {
  if (typeof xml !== 'string' || !xml) return [];
  if (typeof tag !== 'string' || !TAG_OK.test(tag)) return [];
  // [\s>] noudmine hoiab prefiksinimed valjas: <ContractAwardNoticeX> ei ole vaste.
  const algus = new RegExp('<' + tag + '[\\s>]', 'g');
  const idx = [...xml.matchAll(algus)].map((m) => m.index);
  return idx.map((a, i) => xml.slice(a, i + 1 < idx.length ? idx[i + 1] : xml.length));
}

// ---------------------------------------------------------------------------
// Teksti eraldajad. `[^<]+` EI KOLBA: ta ei dekodeeri olemeid ('V&amp;V Digi OÜ'
// joudis nii baasi) ega tule toime CDATA-ga.
// ---------------------------------------------------------------------------

// Silt koos atribuutidega, ka ise sulguv (<cbc:Name/>). Vahemalus, sest neid
// mustreid ehitatakse teate kohta kumneid ja kuu jooks kaib neid labi tuhandeid kordi.
const MUSTRID = new Map();
function silt(nimi) {
  let re = MUSTRID.get(nimi);
  if (!re) {
    re = new RegExp('<' + nimi + '(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</' + nimi + '\\s*>)', 'g');
    MUSTRID.set(nimi, re);
  }
  re.lastIndex = 0;
  return re;
}

// Sama normaliseerimine mis hanked.mjs-i tagi(): CDATA maha, olemid lahti (UHE
// kaiguga), reavahetused uheks tuhikuks. Paris RHR-i XML on sissetaanetega ja
// StatisticsNumeric on omal real - ilma selleta jaaks vaartuse korvale tuhikuid.
// Tuhi tulemus on null ("ei tea"), MITTE tuhi string.
function tekst(sisu) {
  if (typeof sisu !== 'string') return null;
  const s = olemid(sisu.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/\s+/g, ' ').trim();
  return s || null;
}

/** Koik silditi esinemised plokis: [{ attrs, sisu }] (sisu voib olla null). */
function koik(plokk, nimi) {
  if (typeof plokk !== 'string') return [];
  const out = [];
  for (const m of plokk.matchAll(silt(nimi))) out.push({ attrs: m[1] || '', sisu: tekst(m[2]) });
  return out;
}

/** Esimene silt, valikuliselt atribuudifiltriga. */
function uks(plokk, nimi, filter = null) {
  for (const m of koik(plokk, nimi)) if (!filter || filter(m.attrs)) return m.sisu;
  return null;
}

const attr = (attrs, nimi) => (attrs.match(new RegExp('\\b' + nimi + '="([^"]*)"')) || [])[1] ?? null;
const onList = (nimi) => (attrs) => attr(attrs, 'listName') === nimi;

// Nimi EESTI KEELES. RHR kirjutab mone organisatsiooni nime kahes keeles ja ENG voib
// olla eespool - esimene vaste annaks siis ingliskeelse nime, mis laheks nii baasi
// ja sealt konkurentide nimekirja. rhr_parse.py votab esimese (tema valjund on
// vaheformaat, mitte vaade); meie oma laheb otse inimese ette, seega eelistame EST-i.
function nimiEst(plokk) {
  const nimed = koik(plokk, 'cbc:Name');
  if (!nimed.length) return null;
  return (nimed.find((n) => attr(n.attrs, 'languageID') === 'EST') || nimed[0]).sisu;
}

// Arv, mis EI OLE kunagi NaN. '', 'kokkuleppel' ja puuduv vali annavad koik null
// ("ei tea") - sama joon mis hanked.mjs-i arv() tombab, ainult et siin ei ole
// "katki" ja "puudub" eraldamisel kasutajat: molemad lahevad importi tuhjana.
function arv(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/\s/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Esimene plokk kahe sildi vahel, ILMA et prefiksinimeline silt kaasa haaraks:
// <cac:ProcurementProjectLot> ei tohi vastata mustrile <cac:ProcurementProject>.
function esimenePlokk(plokk, nimi) {
  const m = new RegExp('<' + nimi + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + nimi + '\\s*>').exec(plokk || '');
  return m ? m[1] : null;
}

/** Koik plokid antud sildi all. */
function plokid(plokk, nimi) {
  if (typeof plokk !== 'string') return [];
  const re = new RegExp('<' + nimi + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + nimi + '\\s*>', 'g');
  return [...plokk.matchAll(re)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// Organisatsioonid.
// ---------------------------------------------------------------------------

// efac:Organizations/efac:Organization/efac:Company - sama tee mis rhr_parse.py-l.
// PartyIdentification/cbc:ID ('ORG-0004') on VIIDE, mida kasutavad nii hankija
// (cac:ContractingParty) kui voitja (efac:Tenderer).
function loeOrgid(blk) {
  const list = [];
  const kaart = new Map();
  for (const c of plokid(blk, 'efac:Company')) {
    const o = {
      id: uks(esimenePlokk(c, 'cac:PartyIdentification') || '', 'cbc:ID'),
      name: nimiEst(esimenePlokk(c, 'cac:PartyName') || ''),
      // PartyLegalEntity/cbc:CompanyID on RHR-i registrikood; varutee on plokis
      // esimene CompanyID (nii teeb ka rhr_parse.py oma `or .//cbc:CompanyID`-ga).
      reg: uks(esimenePlokk(c, 'cac:PartyLegalEntity') || '', 'cbc:CompanyID') || uks(c, 'cbc:CompanyID'),
      size: uks(c, 'efbc:CompanySizeCode'),
    };
    list.push(o);
    if (o.id && !kaart.has(o.id)) kaart.set(o.id, o);
  }
  return { list, kaart };
}

// ---------------------------------------------------------------------------
// Voitja: LotResult -> LotTender -> TenderingParty -> Tenderer -> Organization.
//
// MIKS MITTE `orgs.find(o => o.size) || orgs[1]` (plaani naidiskood): see on
// heuristika ja ta on MOODETULT vale. Augustikuu 956 teate peal:
//   - 800 teatel andsid ahel ja heuristika molemad vastuse ja need LAHKUSID 116 korral;
//   - 156 teatel (tulemus 'clos-nw' - voitjat ei valitud) andis heuristika ikkagi nime,
//     ehk MOTLES voitja VALJA.
// Kokku vale voi valjamoeldud voitja 272 teatel 956-st (28 %). CompanySizeCode on
// ka HANKIJAL (paris failis 983 koodi 956 teate kohta) ja voitjal voib ta PUUDUDA.
//
// Heuristika jaab VARUTEEKS, aga KAHE valve taga. Kui NoticeResult ON ja ahel on
// tuhi, siis voitjat EI OLE - see on paris vastus, mitte puudujaak. Ja ka
// NoticeResult-ita ploki peal ei tohi voitjat valja motelda: plaani naidiskoodi
// `|| orgs[1]` andis paris failis KUUEL teatel (NoticeTypeCode 'can-standard',
// tulemuseta lepinguteade) voitjaks RIIGIHANGETE VAIDLUSTUSKOMISJONI - RHR paneb
// vaidlustuskomisjoni ja Riigihangete registri IGA teate organisatsioonide hulka.
// Seega nouab varutee POSITIIVSET jalge voitjast: efbc:CompanySizeCode mone
// organisatsiooni peal, kes ei ole hankija. Jalje puudumisel on vastus null.
// ---------------------------------------------------------------------------

// Pakkumused ja pakkujad on NoticeResult-i otsesed lapsed, aga SAMAD sildinimed
// esinevad ka VIIDETENA LotResult-i sees (<efac:LotTender><cbc:ID>TEN-0001</cbc:ID>).
// Viiteplokk on tuhi, seega eristame sisu jargi: paris LotTender kannab summat voi
// pakkujat, paris TenderingParty kannab efac:Tenderer'it.
function loeNoticeResult(nr) {
  const pakkumused = new Map();
  for (const t of plokid(nr, 'efac:LotTender')) {
    if (!/<efac:TenderingParty[\s>]|<cac:LegalMonetaryTotal[\s>]/.test(t)) continue;
    const id = uks(t, 'cbc:ID');
    if (id && !pakkumused.has(id)) {
      pakkumused.set(id, {
        amount: arv(uks(esimenePlokk(t, 'cac:LegalMonetaryTotal') || '', 'cbc:PayableAmount')),
        currency: attr((koik(esimenePlokk(t, 'cac:LegalMonetaryTotal') || '', 'cbc:PayableAmount')[0] || {}).attrs || '', 'currencyID'),
        tp: uks(esimenePlokk(t, 'efac:TenderingParty') || '', 'cbc:ID'),
      });
    }
  }
  const pooled = new Map();
  for (const p of plokid(nr, 'efac:TenderingParty')) {
    if (!/<efac:Tenderer[\s>]/.test(p)) continue;
    const id = uks(p, 'cbc:ID');
    if (id && !pooled.has(id)) {
      pooled.set(id, plokid(p, 'efac:Tenderer').map((x) => uks(x, 'cbc:ID')).filter(Boolean));
    }
  }
  return { pakkumused, pooled };
}

// ---------------------------------------------------------------------------
// Statistika: mitu pakkumust laekus.
//
// MIKS MITTE Math.max(...stats) (plaani naidiskood): efac:ReceivedSubmissionsStatistics
// esineb eForms-is MITMES liigis (laekunud pakkumused `tenders`, VKE-de omad `t-sme`,
// EL-i omad `t-oth-eea`, elektroonilised `ele-sub`, osalemistaotlused `part-req`).
// Maksimum on vale niipea, kui mone liigi arv on suurem kui laekunud pakkumuste arv -
// ja `part-req` ON suurem (piiratud menetluses laekub 29 osalemistaotlust ja 3 pakkumust).
//
// MOODETUD AUGUSTIS: RHR EI EKSPORDI efbc:StatisticsCode'i. 3527 statistikaplokist
// oli koodiga 0. 1290 LotResult-ist olid vaartused erinevad 126-l; neist 124-l oli
// ESIMENE vaartus uhtlasi maksimum, ja ulejaanud KAHEL ((3,3,3,29) ja (1,1,1,24))
// oli maksimum VALE - 29 ja 24 on osalemistaotlused. Seega:
//   - kui kood ON olemas (eForms standard), filtreerime LIIGI jargi;
//   - kui koodi EI OLE (RHR), votame ESIMESE - eForms-i elemendijarjekord algab
//     liigiga `tenders` ja moodetult oli esimene molemal erandjuhul oige.
// Kumb tee kaidi, utleb `tenders_allikas`.
//
// MITME OSAGA TEADE: statistika on OSA kohta, mitte teate kohta (paris naide 309730 -
// kolm osa, 10 / 7 / 7 pakkumust). Ulesanne 12 kirjutab UHE rea teate kohta, seega
// `tenders` on siin ESIMESE osa arv. Et see lihtsustus ei oleks vaikne, tagastame ka
// `osi` (tulemusega osade arv) - kui `osi > 1`, siis `tenders` ja `winner` kirjeldavad
// esimest osa, mitte kogu teadet, ja import saab sellised read eraldi naidata.
// rhr_parse.py tagastab KOIK vaartused massiivina ega vali - tema valjund on
// vaheformaat, siit laheb arv otse baasiveergu, seega siin tuleb valida.
const STAT_LIIK = 'tenders';

function loeStatistika(plokk) {
  const stat = plokid(plokk, 'efac:ReceivedSubmissionsStatistics');
  const read = [];
  for (const s of stat) {
    const n = arv(uks(s, 'efbc:StatisticsNumeric'));
    if (n === null) continue; // efac:FieldsPrivacy-plokk ilma arvuta
    read.push({ n, kood: uks(s, 'efbc:StatisticsCode') });
  }
  if (!read.length) return { tenders: null, allikas: null };
  const koodiga = read.find((r) => r.kood === STAT_LIIK);
  if (koodiga) return { tenders: koodiga.n, allikas: 'kood' };
  if (read.some((r) => r.kood)) return { tenders: read[0].n, allikas: 'kood-puudub' };
  return { tenders: read[0].n, allikas: 'koodita-esimene' };
}

// ---------------------------------------------------------------------------
// Summa.
//
// MIKS MITTE Math.round(esimene PayableAmount) (plaani naidiskood): kolm viga korraga.
//   1) Mitme osaga teatel on PayableAmount IGAL pakkumusel, ka KAOTAJATEL -
//      esimene voib olla kaotaja oma. Paris failis on 1270 PayableAmount'i 956 teate
//      kohta ja 112 teatel on mitu voitjat.
//   2) Math.round KAOTAB SENDID. 1234.56 -> 1235. Ulesande 12 baasiveerg on INTEGER,
//      aga umardamine on SELLE veeru otsus, mitte lugeja oma - lugeja ei tohi
//      andmeid vaikselt kaotada.
//   3) currencyID ei pruugi olla EUR. Vaikne eurodesse kirjutamine on KEELATUD.
//
// Reegel: "lepingu maksumus" = efac:NoticeResult/cbc:TotalAmount (teate kogusumma,
// mis katab koik osad). Kui teda ei ole, liidetakse VOITNUD pakkumuste summad -
// mitte koik PayableAmount'id. Moodetud: kogusumma ja voitnud pakkumuste summa
// langesid kokku 568 teatel, erinesid 40-l (raamlepingu maksimumid ja tuhistatud
// osad), ja 192 teatel oli ainult pakkumuse summa.
//
// Mitte-EUR: `amount` on NULL ja arv jaab nahtavaks valjas `amount_valuutas`,
// et ulesanne 12 ei kirjutaks 300 000 SEK-i euroveergu. Moodetud augustis: koik
// 1878 summat olid EUR, ehk see valve ei maksa praegu midagi ja hoiab ara kogu
// ajaloo vaikse rikkumise siis, kui uhel paeval tuleb mitte-EUR kirje.
function summaVorm(vaartus, valuuta, allikas) {
  if (vaartus === null) return { amount: null, currency: valuuta ?? null, amount_valuutas: null, amount_allikas: null };
  const eur = valuuta === null || valuuta === 'EUR';
  return {
    amount: eur ? vaartus : null,
    currency: valuuta ?? null,
    amount_valuutas: vaartus,
    amount_allikas: allikas,
  };
}

// ---------------------------------------------------------------------------

// Koik osade tulemusekoodid: uks kood -> see, mitu erinevat -> 'segu', ukski -> null.
function tulemusKood(nr) {
  if (nr === null) return null;
  const koodid = [...new Set(plokid(nr, 'efac:LotResult')
    .map((lr) => uks(lr, 'cbc:TenderResultCode')).filter(Boolean))];
  if (!koodid.length) return uks(nr, 'cbc:TenderResultCode');
  return koodid.length === 1 ? koodid[0] : 'segu';
}

const TUHI = {
  ref: null, notice_id: null, folder: null, date: null, title: null,
  nature: null, cpv: null, menetlus: null, buyer: null, buyer_reg: null,
  winner: null, winner_reg: null, winner_size: null, winner_allikas: null,
  winners: [], winner_arv: 0, tulemus: null, osi: null,
  amount: null, currency: null, amount_valuutas: null, amount_allikas: null,
  tenders: null, tenders_allikas: null,
};

/**
 * Loeb UHE lepinguteate ploki (splitNotices'i valjund) valjadeks.
 *
 * EI VISKA kunagi erindit: ulesande 12 kuine import kaib tuhandeid teateid labi ja
 * uks katkine plokk ei tohi kogu kuud maha votta (sama joon mis parseRss-il).
 * Iga puuduv vali on `null`, mitte tuhi string ega NaN.
 */
export function parseAward(blk) {
  if (typeof blk !== 'string' || !blk) return { ...TUHI, winners: [] };
  try {
    return loe(blk);
  } catch {
    return { ...TUHI, winners: [] };
  }
}

function loe(blk) {
  const { list: orgs, kaart } = loeOrgid(blk);

  // TEATE OMA valjad loetakse KEHAST, ehk plokist ILMA ext:UBLExtensions'ita.
  // rhr_parse.py kasutab XPathi OTSESEID lapsi ('cbc:ID', 'cbc:IssueDate') ja saab
  // selle tasuta; regexil tuleb skoop ise tommata. Moodetud paris failis: laiendus
  // on plokis EES ja kannab omaenda cbc:ID-d (efac:LotResult 'RES-0000',
  // efac:Organization 'ORG-0001') ning omaenda cbc:IssueDate-t (lepingu solmimise
  // kuupaev efac:SettledContract'is). Ilma skoobita oli notice_id vale 956 teatel
  // 956-st ja date vale 591 teatel - viimane oleks ulesande 12 24 kuu akna vaikselt
  // nihutanud, ilma et miski punaseks laheks.
  const keha = blk.replace(/<ext:UBLExtensions[\s\S]*?<\/ext:UBLExtensions\s*>/g, '');

  // Hankija tuleb VIITEST (cac:ContractingParty -> PartyIdentification/cbc:ID), nagu
  // rhr_parse.py-s. orgs[0] on ainult varutee: augustis langes ta 956/956 korral
  // viitega kokku, aga see on RHR-i jarjestuse ONN, mitte lubadus.
  const bref = uks(esimenePlokk(esimenePlokk(keha, 'cac:ContractingParty') || '', 'cac:PartyIdentification') || '', 'cbc:ID');
  const buyer = (bref && kaart.get(bref)) || orgs[0] || null;

  // Teate tasemel ProcurementProject on ESIMENE; osade omad on ProcurementProjectLot'i
  // sees ja nende CPV ei ole teate CPV.
  const pp = esimenePlokk(keha, 'cac:ProcurementProject') || '';
  // '312679-0000' -> '312679'. Sama loige mis plaanis; sidekriipsuta ID jaab terveks.
  const ppId = uks(pp, 'cbc:ID');
  const ref = ppId ? (ppId.split('-')[0] || null) : null;

  const nr = esimenePlokk(blk, 'efac:NoticeResult');

  // --- voitjad ---
  let winners = [];
  let winner_allikas = null;
  let voitnudSummad = [];
  if (nr !== null) {
    const { pakkumused, pooled } = loeNoticeResult(nr);
    const nahtud = new Set();
    for (const lr of plokid(nr, 'efac:LotResult')) {
      // LotResult-i sees on efac:LotTender AINULT viitena - just neid me siin tahamegi.
      for (const tp of plokid(lr, 'efac:LotTender')) {
        const tid = uks(tp, 'cbc:ID');
        const T = tid && pakkumused.get(tid);
        if (!T) continue;
        if (T.amount !== null) voitnudSummad.push(T);
        for (const oref of (pooled.get(T.tp) || [])) {
          const o = kaart.get(oref);
          if (!o || nahtud.has(oref)) continue;
          nahtud.add(oref);
          winners.push(o);
        }
      }
    }
    if (winners.length) winner_allikas = 'tendering-party';
  } else {
    // VARUTEE ainult struktuurita ploki jaoks (plaani fikstuur, kasitsi kupitud kirje).
    // NOUE: suuruskood mone organisatsiooni peal, kes EI OLE hankija. Ilma selleta
    // ei ole plokis uhtegi jalge voitjast ja `orgs[1]` oleks puhas arvamine.
    // Kannab marget 'suuruskood' - ulesanne 12 naeb, et tegu on OLETUSEGA.
    const o = orgs.find((x) => x.size && x !== buyer);
    if (o) { winners = [o]; winner_allikas = 'suuruskood'; }
  }

  // --- summa ---
  let summa = { amount: null, currency: null, amount_valuutas: null, amount_allikas: null };
  if (nr !== null) {
    const ta = koik(nr, 'cbc:TotalAmount')[0];
    if (ta && arv(ta.sisu) !== null) {
      summa = summaVorm(arv(ta.sisu), attr(ta.attrs, 'currencyID'), 'total-amount');
    } else if (voitnudSummad.length) {
      const valuutad = [...new Set(voitnudSummad.map((t) => t.currency))];
      const kokku = voitnudSummad.reduce((s, t) => s + t.amount, 0);
      // Mitu eri valuutat uhes teates: liitmine oleks vale arv. 'segu' ei ole EUR,
      // seega summaVorm jatab `amount` tuhjaks ja arv jaab ainult nahtavaks.
      summa = summaVorm(kokku, valuutad.length === 1 ? valuutad[0] : 'segu', 'voitnud-pakkumused');
    }
  } else {
    const pa = koik(keha, 'cbc:PayableAmount')[0];
    if (pa && arv(pa.sisu) !== null) {
      summa = summaVorm(arv(pa.sisu), attr(pa.attrs, 'currencyID'), 'payable-esimene');
    }
  }

  // --- statistika ---
  // Eelistame LotResult-i sisest statistikat (seal on ta paris failis); kui teatel
  // ei ole LotResult-i, vaatame kogu plokki (lihtsustatud kirje, plaani fikstuur).
  const lrid = nr === null ? [] : plokid(nr, 'efac:LotResult');
  const stat = lrid.length ? loeStatistika(lrid[0]) : loeStatistika(blk);

  const v = winners[0] || null;
  return {
    ref,
    notice_id: uks(keha, 'cbc:ID'),
    folder: uks(keha, 'cbc:ContractFolderID'),
    // IssueDate on ajavoondiga ('2026-07-12+03:00') - kuupaev on esimesed 10 marki.
    date: (uks(keha, 'cbc:IssueDate') || '').slice(0, 10) || null,
    title: nimiEst(pp),
    nature: uks(pp, 'cbc:ProcurementTypeCode', onList('contract-nature')),
    cpv: uks(pp, 'cbc:ItemClassificationCode', onList('cpv')),
    // eForms annab menetluse KOODINA ('open', 'restricted'), RSS-i tee annab
    // eestikeelse nime ('Avatud hankemenetlus'). Need EI OLE sama kuju ja seda
    // teadmata paneks ulesanne 12 baasi kaks eri sonavara.
    menetlus: uks(esimenePlokk(keha, 'cac:TenderingProcess') || '', 'cbc:ProcedureCode'),
    buyer: buyer?.name ?? null,
    buyer_reg: buyer?.reg ?? null,
    winner: v?.name ?? null,
    winner_reg: v?.reg ?? null,
    winner_size: v?.size ?? null,
    winner_allikas,
    winners: winners.map((o) => o.name).filter(Boolean),
    winner_arv: winners.length,
    osi: lrid.length || null,
    // Tulemusekood on eForms-is OSA kohta, mitte teate kohta. Mitme osaga teatel
    // voivad osad saada eri tulemuse (paris failis tuli ette teade, kus uks osa oli
    // 'clos-nw' ja teine sai voitja). Uhe (esimese) koodi tagastamine valetaks,
    // seega eri koodide korral on vastus 'segu' ja ulesanne 12 naeb, et teate
    // tasemel uhest vastust ei ole.
    tulemus: tulemusKood(nr),
    ...summa,
    tenders: stat.tenders,
    tenders_allikas: stat.allikas,
  };
}
