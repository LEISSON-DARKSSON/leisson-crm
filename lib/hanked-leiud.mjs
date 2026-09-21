// ULESANNE 14: hankedokumendi TEKSTIST nõuete lugemine (rollid, käibenõue,
// kvaliteedikriteeriumi kaal).
//
// MIKS SEE FAIL ON ERALDI JA PUHAS. score() (lib/hanked.mjs) ootab `docs.rollid`,
// `docs.kaiveNoue` ja `docs.qualityWeight`. `rollid >= 3` annab -25 punkti JA
// verdikti ALLTÖÖVÕTT, mis on score-is ÜLIMUSLIK - ka 80-punktine hange muutub
// sellega teiseks müügivestluseks. Ehk: VALE ARV MUUDAB VERDIKTI. Seetõttu on
// lugemine siin puhas funktsioon (sisse tekst, välja leiud + tõendid), mida saab
// testida päris lausete peal ilma võrgu ja kettata.
//
// KAKS REEGLIT, MIS SIIN KOIKE OTSUSTAVAD:
//
//   R1. IGA LEID KANNAB TOENDIT. Leid ei ole arv, vaid { roll/summa, lause, fail }.
//       Lause on see, millest arv tuli, ja failinimi see, kust lause tuli. Ilma
//       tõendita ei saa Gert arvu KUNAGI silmaga kontrollida - ja ta peab, sest
//       verdikt sõltub sellest.
//
//   R2. EBAKINDEL LEID EI LAHE VEERGU. `rollid` ja `kaive_noue` täidetakse AINULT
//       siis, kui muster on üheselt mõistetav. Kahtlane leid saab märke
//       'kontrolli', läheb `docs_leiud`-i ja on paneelil nähtav, AGA skoori ta ei
//       liiguta. Põhjus on asümmeetria: alusetu ALLTÖÖVÕTT tähendab, et me EI
//       PAKU hankele, mida oleksime võitnud - see viga ei anna endast kunagi
//       märku. Puuduv arv annab: paneel ütleb „kontrolli".
//
// MUSTRID ON EHITATUD PARIS DOKUMENTIDE PEALE, mitte kujutluse peale. Alus on
// riigihanke 314159 (Tervise Arengu Instituut, „Aitab") alusdokumendid, eeskätt
// 314159_vastavustingimused.pdf ja 314159_hindamiskriteeriumid.pdf. Kolm asja,
// mille need dokumendid välja õpetasid:
//   a) NOUE EI OLE ALATI SAMAS LAUSES SONAGA „peab". Päris tekstis on
//      „Pakkuja meeskonnas olema täidetud UX-UI disaineri roll." - „peab" on
//      kirjaviga tõttu puudu. Kohustus tuleb välja hoopis CV-lausest:
//      „Pakkujal TULEB ESITADA meeskonnas UX-UI disaineri rolli täitva isiku ...
//      CV Lisa 4 vormil V". Seega loeme MOLEMAT kuju.
//   b) SAMAS DOKUMENDIS ON ROLLE, MIS EI OLE NOUE: „Lepingu täitmiseks on
//      pakkujal ÕIGUS KAASATA TÄIENDAVAID spetsialiste (nt. kvaliteedi tagamise,
//      infoturbe, DevOpsi, analüütika ... eksperte)." Naiivne loendur teeks
//      siit 3 rolli asemel 7 ja verdikt oleks ikka ALLTÖÖVÕTT - aga VALEL alusel.
//   c) KOMPETENTS EI OLE ROLL: „tehnilise ARHITEKTUURI kavandamiseks",
//      „KASUTAJAKOGEMUSE- (UX)" on nõutud oskused, mitte nõutud inimesed.

const viga = (s) => { const e = new Error(s); e.code = 400; return e; };

// --- lauseks lõhkumine -----------------------------------------------------

// Lause lõpeb punktiga JA jargneb suurtaht. See uksainus tingimus hoiab koos
// „sh." ja „nt." (jargneb vaiketaht) ning kuupaeva „09.09.2026" (jargneb number).
const LAUSE_PIIR = /(?<=[.!?])\s+(?=[A-ZÕÄÖÜŠŽÜ„"(])/u;
// pdftotext -layout murrab lause mitmele reale, seega read liidetakse. ERAND on
// SUURTAHTEDEGA PEALKIRI ("PAKKUJA MEESKOND - JUHTIVARENDAJA"), mis ei ole lause
// osa: ilma punktita liituks ta jargmise lausega kokku ja tõendi lause muutuks
// loetamatuks pudruks.
const PEALKIRI = /^[^a-zõäöüšž]{4,}$/u;

export function laused(tekst) {
  if (typeof tekst !== 'string' || !tekst.trim()) return [];
  const read = tekst.split(/\r?\n/).map((r) => r.trim()).filter(Boolean)
    .map((r) => (PEALKIRI.test(r) && !/[.!?:]$/.test(r) ? r + '.' : r));
  return read.join(' ').replace(/[ \t ]+/g, ' ').split(LAUSE_PIIR)
    .map((l) => l.trim()).filter((l) => l.length > 2);
}

// Tõendi lause lähéb ekraanile - piirame pikkuse, aga NÄHTAVALT (kolm punkti),
// mitte vaikse lõikamisega.
export const LAUSE_MAX = 400;
const toend = (l) => (l.length > LAUSE_MAX ? l.slice(0, LAUSE_MAX - 1) + '…' : l);

// --- rollid ----------------------------------------------------------------

// Jarjekord LOEB: pikem ja tapsem muster votab oma koha enne ("juhtivarendaja"
// enne "arendaja"), muidu loeks sama sõna kaheks rolliks.
export const ROLLID = Object.freeze([
  ['juhtivarendaja', /juhtiv[-\s]?arendaja[a-zõäöü]*/giu, null],
  ['projektijuht', /projektijuh(?:t|i)[a-zõäöü]*/giu, /^projektijuhtimi/iu],
  ['arendaja', /(?:tarkvara|veebi|mobiili|full[-\s]?stack)?[-\s]?arendaja[a-zõäöü]*/giu, null],
  ['disainer', /(?:ux[-\/\s]?ui|ui[-\/\s]?ux|ux|ui|graafiline|teenuse)?[-\s]?disainer[a-zõäöü]*/giu, null],
  ['analüütik', /anal[üu][üu]tik(?!a)[a-zõäöü]*/giu, null],
  ['testija', /testij[a-zõäöü]*|testimisjuh[a-zõäöü]*/giu, null],
  ['arhitekt', /(?:lahendus|süsteemi|tarkvara)?[-\s]?arhitekt(?!uur)[a-zõäöü]*/giu, null],
  ['devops', /devops[a-zõäöü]*/giu, null],
  ['infoturve', /infoturbe[a-zõäöü-]*/giu, null],
  ['andmeteadlane', /andmeteadlas[a-zõäöü]*|andmeanal[üu][üu]tik[a-zõäöü]*/giu, null],
  ['koolitaja', /koolitaj[a-zõäöü]*/giu, null],
  ['sisuloome', /sisuloo[a-zõäöü]*|tekstiautor[a-zõäöü]*|copywriter[a-zõäöü]*/giu, null],
]);

// Kohustus. „tuleb esitada ... CV" on sama tugev nõue kui „peab olema".
const KOHUSTUS = /\b(?:peab|peavad|tuleb|nõutud|nõutakse|nõuab|nõue|kohustuslik\w*|esitada|esitama|minimaalselt)\b/iu;
// Vabatahtlikkus. UKSKI neist ei tohi anda kindlat rolli - vt kommentaari b).
const VABATAHTLIK = /\b(?:võib|võivad|õigus\s+kaasata|täiendava\w*|lisaks\s+punktides|soovi\s+korral|soovituslik\w*|vabatahtlik\w*|näiteks|nt\.?)\b/iu;
// Kontekst on KAHEOSALINE ja see tuli PARIS JOOKSUST, mitte peast.
//
// Esimene versioon nõudis ainult „kohustus + mingi koosseisusõna" ja luges hankel
// 314159 kokku NELI rolli, kuigi neid on KOLM. Neljas („arendaja") tuli failist
// „Lisa 3 - Hankelepingu Lisa 2 - Andmetöötlusleping_AITAB.pdf" lausest
// „... PEAB volitatud töötleja kui vastutav arenduse teostaja ja volitatud
// koordineeriv ARENDAJA rakendama tehnilisi ja korralduslikke meetmeid ...".
// See on ANDMETOOTLUSLEPINGU pool, mitte kvalifitseerimistingimus - seal ei
// nõuta pakkujalt kedagi meeskonda.
//
// Seega peab lause ütlema MOLEMAD asjad:
//   SUBJEKT - kellest jutt on (pakkuja / tema meeskond), ja
//   TUNNUS  - mis laadi nõue see on (roll, CV, vorm, spetsialist).
// Lepingu ja tehnilise kirjelduse laused langevad SUBJEKTI peal välja ja jäävad
// nähtavaks märkega 'kontrolli' - nad ei kao, aga nad ei loe ka.
const SUBJEKT = /\b(?:pakkuj\w*|meeskon\w*)/iu;
const TUNNUS = /\b(?:roll\w*|CV\b|vormil?\b|vormidel?\b|elulookirjeldu\w*|spetsialist\w*)/iu;

const ARVSONAD = new Map([['üks', 1], ['kaks', 2], ['kolm', 3], ['neli', 4], ['viis', 5],
  ['kuus', 6], ['seitse', 7], ['kaheksa', 8], ['üheksa', 9], ['kümme', 10]]);
// „vähemalt 3 (kolm) erinevat spetsialisti", „minimaalselt kolm rolli".
const ARVNOUE = new RegExp('(?:vähemalt|minimaalselt|kokku)\\s+(\\d{1,2}|'
  + [...ARVSONAD.keys()].join('|') + ')\\s*(?:\\([^)]{0,20}\\))?\\s*(?:erinev\\w*\\s+)?'
  + '(?:spetsialisti?\\w*|rolli\\w*|meeskonnaliige|meeskonnaliiget|eksperti?\\w*)', 'iu');

const arvuks = (s) => (ARVSONAD.has(String(s).toLowerCase())
  ? ARVSONAD.get(String(s).toLowerCase()) : Number(s));

/** Rollinimed UHES lauses, pikim muster võidab (kattuvaid vahemikke ei loeta kaks korda). */
function rollidLauses(lause) {
  const votetud = [];
  const leitud = [];
  for (const [nimi, muster, mitte] of ROLLID) {
    muster.lastIndex = 0;
    let m;
    while ((m = muster.exec(lause)) !== null) {
      if (m[0].trim() === '') { muster.lastIndex++; continue; }
      const a = m.index + m[0].length - m[0].trimStart().length;
      const b = m.index + m[0].length;
      if (mitte && mitte.test(m[0].trim())) continue;
      if (votetud.some(([x, y]) => a < y && b > x)) continue;
      votetud.push([a, b]);
      if (!leitud.includes(nimi)) leitud.push(nimi);
    }
  }
  return leitud;
}

/**
 * @returns {{arv: number, kindel: boolean, leiud: Array}} `arv` on loendatud
 * KINDLATE rollide arv (või dokumendi enda arvuline nõue); `kindel` ütleb, kas
 * teda tohib veergu `rollid` kirjutada.
 */
export function leiaRollid(tekst, fail = null) {
  const kindlad = new Map();   // roll -> lause
  const kahtlased = new Map(); // roll -> lause
  let arvNoue = null;
  let arvLause = null;

  for (const lause of laused(tekst)) {
    const rollid = rollidLauses(lause);
    const m = ARVNOUE.exec(lause);
    if (m && arvNoue === null) {
      const n = arvuks(m[1]);
      if (Number.isInteger(n) && n > 0 && n <= 30) { arvNoue = n; arvLause = lause; }
    }
    if (!rollid.length) continue;
    const vabatahtlik = VABATAHTLIK.test(lause);
    const kindel = !vabatahtlik && KOHUSTUS.test(lause)
      && SUBJEKT.test(lause) && TUNNUS.test(lause);
    for (const r of rollid) {
      if (kindel) { if (!kindlad.has(r)) kindlad.set(r, lause); } else if (!kindlad.has(r) && !kahtlased.has(r)) kahtlased.set(r, lause);
    }
  }
  // Roll, mis sai kusagil KINDLA lause, ei jää enam kahtlaseks.
  for (const r of kindlad.keys()) kahtlased.delete(r);

  const leiud = [];
  for (const [roll, lause] of kindlad) {
    leiud.push({ liik: 'roll', roll, kindlus: 'kindel', lause: toend(lause), fail });
  }
  for (const [roll, lause] of kahtlased) {
    leiud.push({ liik: 'roll', roll, kindlus: 'kontrolli', lause: toend(lause), fail,
      markus: 'mainitud ilma selge kohustuseta — ei loeta nõutud rollide hulka' });
  }

  let arv = kindlad.size;
  let kindel = kindlad.size > 0;
  if (arvNoue !== null) {
    leiud.unshift({ liik: 'rollide-arv', arv: arvNoue,
      kindlus: arvNoue === kindlad.size ? 'kindel' : 'kontrolli',
      lause: toend(arvLause), fail,
      markus: arvNoue === kindlad.size ? null
        : 'vastuolu: dokument nõuab ' + arvNoue + ', tekstist loendasime '
          + kindlad.size + ' erinevat rolli' });
    arv = arvNoue;
    kindel = arvNoue === kindlad.size;
  }
  return { arv, kindel, leiud };
}

// --- käibenõue -------------------------------------------------------------

// „käive" JAH, „käibemaks" EI. Ilma selle lookaheadita loeks „maksumus ilma
// KÄIBEMAKSUTA 120 000 eurot" käibenõudeks - ja see on hanke maksumus, mitte nõue.
const KAIVE = /\b(?:neto)?käi(?:ve\w*|be(?!maks)\w*)/iu;
const KAIVE_NOUE = /\b(?:vähemalt|peab\s+olema|peavad\s+olema|ei\s+tohi\s+olla\s+väiksem|miinimum\w*|nõutav\w*|nõutud|peab\s+ületama|suurem\s+kui)\b/iu;
// Summa koos valuutamargiga. Ilma valuutata loeks „viimase 3 majandusaasta" 3-e.
const SUMMA = /(\d[\d\s .,]{0,15}\d|\d)\s*(?:€|EUR\b|euro\w*)/giu;

function summaks(s) {
  const puhas = String(s).replace(/[\s ]/g, '');
  // 150.000 on eesti kirjapildis tuhandeeraldaja; 150,00 on koma-kümnendik.
  const ilmaTuhandeta = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(puhas)
    ? puhas.replace(/\./g, '').replace(',', '.')
    : puhas.replace(/,/g, '.');
  const n = Number(ilmaTuhandeta);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function leiaKaive(tekst, fail = null) {
  const leiud = [];
  const kindlad = new Set();
  for (const lause of laused(tekst)) {
    if (!KAIVE.test(lause)) continue;
    SUMMA.lastIndex = 0;
    let m;
    const summad = [];
    while ((m = SUMMA.exec(lause)) !== null) {
      const n = summaks(m[1]);
      if (n !== null) summad.push(n);
    }
    if (!summad.length) continue;
    const noue = KAIVE_NOUE.test(lause);
    const summa = Math.max(...summad);
    if (noue) kindlad.add(summa);
    leiud.push({ liik: 'käive', summa, kindlus: noue ? 'kindel' : 'kontrolli',
      lause: toend(lause), fail,
      markus: noue ? null : 'summa ilma selge nõudesõnata — ei loeta käibenõudeks' });
  }
  if (kindlad.size === 1) return { summa: [...kindlad][0], kindel: true, leiud, kandidaadid: [...kindlad] };
  if (kindlad.size > 1) {
    for (const l of leiud) if (l.kindlus === 'kindel') { l.kindlus = 'kontrolli'; l.markus = 'vastuolu: mitu erinevat käibenõuet (' + [...kindlad].join(', ') + ')'; }
  }
  return { summa: null, kindel: false, leiud, kandidaadid: [...kindlad] };
}

// --- kvaliteedikriteeriumi kaal --------------------------------------------

// SEE ON REAPOHINE, mitte lausepõhine, ja see on teadlik: hindamiskriteeriumid
// on TABEL ja pdftotext -layout hoiab tabelirea ühel real:
//   „ 4  Tehnilise lahenduse kirjeldus, ... Kvaliteet - hankija      70"
// Lauseks liidetuna jookseks number kokku järgmise lahtri tekstiga.
//
// KAKS KUJU JA MOLEMAD ON KITSAD - mõlemad õppetunnid tulid PARIS JOOKSUST:
//   a) protsendikuju („kvaliteet 60%") - number otse sõna järel, kuni LAHEDUS märki;
//   b) tabelikuju - number on REA LOPUS ja märksõna kuni LAHEDUS märki enne teda.
// Esimene versioon lubas „suvalise viimase arvu real, kui real on ka mõni
// hindamissõna". Hankel 312645 (Eesti Post, „Reisiteenuste platvorm") luges see
// failist „20260804 Pakkumuse esitamise ettepanek.docx" lausest
// „... hindamiskriteeriumitele (sh hindamismetoodikale) 100-VAARTUSPUNKTI
// süsteemis ..." kvaliteedikaaluks 100, kuigi tegelik kaal on hindamistabelis 15.
// Vahemaa ja rea lõpu nõue lõikab selle ära; sama nõue pääseb ligi ka sellele
// tabelireale, mille real ei ole ühtegi muud hindamissõna.
const KVAL = /kvaliteet|kvaliteedi/iu;
export const KVAL_LAHEDUS = 60;

export function leiaKvaliteet(tekst, fail = null) {
  const leiud = [];
  const kandidaadid = new Set();
  for (const rida of String(tekst ?? '').split(/\r?\n/)) {
    const m = KVAL.exec(rida);
    if (!m) continue;
    const lopp = m.index + m[0].length;
    const saba = rida.slice(lopp, lopp + KVAL_LAHEDUS);
    let kaal = null;
    const pr = /(\d{1,3})\s*%/.exec(saba);
    if (pr) kaal = Number(pr[1]);
    else {
      // Tabelikuju: number on REA LOPUS ja märksõna piisavalt lähedal.
      const lr = /(?<![\d,.])(\d{1,3})\s*$/.exec(rida);
      if (lr && lr.index >= lopp && lr.index - lopp < KVAL_LAHEDUS) kaal = Number(lr[1]);
    }
    if (kaal === null || kaal < 1 || kaal > 100) continue;
    kandidaadid.add(kaal);
    leiud.push({ liik: 'kvaliteedikaal', kaal, kindlus: 'kindel',
      lause: toend(rida.replace(/\s+/g, ' ').trim()), fail });
  }
  if (kandidaadid.size === 1) return { kaal: [...kandidaadid][0], kindel: true, leiud, kandidaadid: [...kandidaadid] };
  if (kandidaadid.size > 1) {
    for (const l of leiud) { l.kindlus = 'kontrolli'; l.markus = 'vastuolu: mitu erinevat kvaliteedikaalu (' + [...kandidaadid].join(', ') + ')'; }
  }
  return { kaal: null, kindel: false, leiud, kandidaadid: [...kandidaadid] };
}

// --- kokkuvõte -------------------------------------------------------------

export const LEIUDE_MAX = 80;

/**
 * Kõik failid kokku. Rollid LIIDETAKSE (sama roll kahes failis on üks roll),
 * käive ja kvaliteedikaal peavad olema ÜHESED - vastuolu tähendab 'kontrolli',
 * mitte "võtame suurema".
 * @param {Array<{nimi: string, tekst: string}>} failid
 */
export function koguLeiud(failid) {
  if (!Array.isArray(failid)) throw viga('koguLeiud ootab massiivi');
  const leiud = [];
  const rollid = new Set();
  let rolliVastuolu = false;
  let arvNoue = null;
  const kaiveKindlad = new Set();
  const kvalKindlad = new Set();

  for (const f of failid) {
    const nimi = (f && f.nimi) || null;
    const tekst = (f && f.tekst) || '';
    if (!tekst.trim()) continue;
    const r = leiaRollid(tekst, nimi);
    for (const l of r.leiud) {
      if (l.liik === 'roll' && l.kindlus === 'kindel') rollid.add(l.roll);
      if (l.liik === 'rollide-arv') arvNoue = l.arv;
      leiud.push(l);
    }
    // KANDIDAADID, MITTE FAILIPOHINE "KINDEL". Kui koondada ainult neid faile,
    // kus vastuolu EI OLNUD, siis uhe faili sisemine vastuolu KAOB vaikselt ja
    // teise faili nork vaartus voidab. Nii sai hange 312645 kvaliteedikaaluks
    // „kindla" 100, kuigi hindamistabelis on 15. Vastuolu peab ULATUMA kogu
    // komplektini ja tegema tulemuse EBAKINDLAKS.
    const k = leiaKaive(tekst, nimi);
    for (const v of k.kandidaadid) kaiveKindlad.add(v);
    leiud.push(...k.leiud);
    const q = leiaKvaliteet(tekst, nimi);
    for (const v of q.kandidaadid) kvalKindlad.add(v);
    leiud.push(...q.leiud);
  }
  if (arvNoue !== null && arvNoue !== rollid.size) rolliVastuolu = true;

  return {
    rollid: rollid.size > 0 && !rolliVastuolu ? rollid.size : null,
    rollinimed: [...rollid],
    kaiveNoue: kaiveKindlad.size === 1 ? [...kaiveKindlad][0] : null,
    qualityWeight: kvalKindlad.size === 1 ? [...kvalKindlad][0] : null,
    leiud: leiud.slice(0, LEIUDE_MAX),
    kärbitud: Math.max(0, leiud.length - LEIUDE_MAX),
  };
}
