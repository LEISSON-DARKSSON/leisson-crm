#!/usr/bin/env node
// ULESANNE 13: sarnased lepingud ja skoori ajalootegur.
//
// SIIN HAKKAB AJALOO TABEL ESIMEST KORDA OTSUST MOJUTAMA. score() annab
// medianTenders >= AJALUGU_MIINUS10_ALATES eest -10 ja <= AJALUGU_PLUSS5_KUNI
// eest +5 (kalibreeritud 21.09.2026: 4 ja 1); verdikti piirid on 35 ja 60,
// seega KUMBKI tegur uksi liigutab hanke uhest otsusest teise. Vale mediaan ei
// ole siin kosmeetika - ta on vale ariotsus.
//
// MIDA SEE VARAV VALVAB (iga vaide on paris andmete peal moodetud):
//
//   1. UKS LEPING = UKS ARV. Rida on OSA kohta ja MITMEVOITJALISEL osal on
//      mitu rida (ulesanne 12, otsus 21.09.2026). Moodetud juuni-august 2026
//      (6671 rida): nisi pealkirjatabamusi oli 67 rida, aga ainult 24 LEPINGUT -
//      uks raamleping (303897 / LOT-0019, 30 voitjat, igauhel amount 8000 ja
//      tenders 35) andis uksi 26 rida. Reapohine mediaan oli medianTenders 35
//      ja medianAmount 8000; osapohine on 3.5 ja 48 460. Ehk reapohine mediaan
//      oleks andnud IGALE nisihankele -10 punkti uheainsa raamlepingu parast.
//      Seega grupeeritakse (ref, lot) ja uks osa annab UHE arvu.
//
//   2. TUHJA SUMMAT EI LOETA NULLIKS EGA VAIKITA. 3 kuu peal on 1268 rida 6671-st
//      summata (19 %) ja 867 voitjata (13 %). Nad jaavad mediaani alt valja, AGA
//      vastus kannab nii `n` (mediaani alus) kui `koguArv` - kadu on NAHTAV.
//
//   3. KONSORTSIUM EI TOHI SAMA RAHA KAKS KORDA LUGEDA. Partneri rida kannab
//      amount = NULL (amount_allikas = 'konsortsiumi-partner'), juhi rida kogu
//      summat. Osapohine grupeerimine + summafilter teevad temast uhe arvu.
//
//   4. PEALKIRJATABAMUS ON TUGEVAM (kasutaja siduv otsus 21.09.2026). Moodetud:
//      128 nisireast 47 tuli AINULT kirjeldusest ja seal on registri boilerplate -
//      "Kunda alajaama 110kV joutrafode C1T ja C2T ost" sattus nisi, sest
//      kirjelduses seisab "leitavad Elektrilevi VEEBILEHELT". Selle rea summa on
//      4 389 920 eurot. Ilma eelistuseta laheb hinnavordlusse trafo.
//
//   5. MIINIMUMLAVI. CPV-ga leitud lepinguid on tuupiliselt 0-6 (72413000
//      "veebilehekulgede kujundamine": 3 kuu peal NULL rida). Kahel lepingul
//      pohinev mediaan on mura ja -10 viiks hanke alusetult "JATA" hulka.
//
// PARIS ANDMED, VORKU EI KASUTA. Molemad fikstuurid on RHR-i avaandmetest
// kommititud eForms-XML ja nad lahevad labi PARIS importMonthXml-i:
//   eforms-2026-08-naidis.xml   - ulesande 12 fikstuur (mitmevoitjaline osa,
//                                 konsortsium sentidega, summata ja voitjata osad);
//   eforms-sarnased-naidis.xml  - 9 augusti 2026 lepinguteadet: 8 nisi
//                                 PEALKIRJA-tabamust ja Kunda trafo, mis tuli
//                                 nisi AINULT kirjelduse kaudu.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { migrateHanked, upsertHange, hangeDetail, score, sarnasedLepingud, mediaan,
  SARNASED_MIN, SARNASEID_RIDU } from '../lib/hanked.mjs';
import { importMonthXml } from '../agent/hanked-history.mjs';

const JUUR = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const XML_BAAS = readFileSync(join(JUUR, 'test/fixtures/eforms-2026-08-naidis.xml'), 'utf8');
const XML_NISS = readFileSync(join(JUUR, 'test/fixtures/eforms-sarnased-naidis.xml'), 'utf8');

// Sama fikstuur teiste viitenumbritega (sama vote mis gate-hanked-ajalugu.mjs-is):
// unikaalindeks on LEPINGU identiteet, seega kaks koopiat sama ref-iga oleks uks
// leping. Nihutatud ref annab paris parsitud read, mille CPV kordub - ainus viis
// toestada CPV-teed ilma vorguta, sest uhes kuus ei ole meie nisi CPV-l 5 lepingut.
const nihutatud = (n) => XML_NISS.replace(/<cbc:ID>(\d{6})-(\d{4})<\/cbc:ID>/g,
  (m, r, o) => '<cbc:ID>' + (Number(r) + n) + '-' + o + '</cbc:ID>');

function testDb(...kuud) {
  const dir = mkdtempSync(join(tmpdir(), 'sarnased-'));
  const db = new DatabaseSync(join(dir, 'test.sqlite'));
  migrateHanked(db);
  for (const [kuu, xml] of kuud) importMonthXml(db, kuu, xml);
  return db;
}

const baasDb = () => testDb(['2026-08', XML_BAAS]);
const nissDb = () => testDb(['2026-08', XML_NISS]);
const kolmDb = () => testDb(['2026-08', XML_NISS], ['2026-07', nihutatud(100000)],
  ['2026-06', nihutatud(200000)]);

// ---------------------------------------------------------------------------
// A. MEDIAANI DEFINITSIOON. Paarisarvu korral kahe keskmise KESKMINE.
// ---------------------------------------------------------------------------
{
  assert.equal(mediaan([7]), 7, 'uks element on ise mediaan');
  assert.equal(mediaan([10, 20]), 15, 'kaks elementi - keskmine');
  assert.equal(mediaan([30, 10, 20]), 20, 'kolm elementi - keskmine liige, jarjestus ei loe');
  assert.equal(mediaan([40, 10, 30, 20]), 25, 'neli elementi - kahe keskmise keskmine');
  assert.equal(mediaan([]), null, 'tuhi hulk ei anna nulli, vaid "ei tea"');
  // SENDID JAAVAD ALLES. `amount` veerg on INTEGER-afiinsusega, aga hoiab
  // eurosid sentidega (56515.72 jaab REAL-iks) - mediaan EI TOHI teda
  // taisarvuks umardada, sest see arv laheb kasutaja silme ette.
  assert.equal(mediaan([56515.72]), 56515.72, 'sendid ei kao');
  assert.equal(mediaan([1, 2]), 1.5, 'poolik vastus on lubatud');
  console.log('PASS sarnased: mediaani definitsioon (1, 2, 3 ja 4 elementi)');
}

// ---------------------------------------------------------------------------
// B. UKS LEPING = UKS ARV (mitmevoitjaline osa).
//
// Fikstuuris on 305201 / LOT-0001 ("Poolkorge saarega saapad"): KAKS voitjat,
// molemal amount 300 000 ja tenders 7. Reapohine mediaan loeks selle lepingu
// kaks korda; osapohine uks kord. Sama osa teine lot (LOT-0002) on voitjata.
// ---------------------------------------------------------------------------
{
  const db = baasDb();
  const r = sarnasedLepingud(db, '18800000');
  assert.equal(r.alus, 'cpv');
  assert.equal(r.koguRidu, 3, 'toorridu on kolm (kaks voitjat + voitjata osa)');
  assert.equal(r.koguArv, 2, 'lepinguid (osi) on kaks');
  assert.equal(r.n, 1, 'mediaani alus on UKS leping, mitte kaks rida');
  assert.equal(r.valjaJai, 1, 'voitjata osa jai valja ja see on valja oeldud');
  assert.equal(r.medianAmount, 300000);
  assert.equal(r.medianTenders, 7);
  assert.equal(r.read.length, 1, 'nimekirjas on uks leping, mitte kaks rida');
  assert.equal(r.read[0].voitjaid, 2, 'rida utleb, et voitjaid oli kaks');
  console.log('PASS sarnased: mitmevõitjaline osa annab ÜHE arvu, mitte kaks');
}

// ---------------------------------------------------------------------------
// C. KONSORTSIUM + SENDID. 306343 / LOT-0001 ("Vaikebuss"): juht OU KEIL M.A.
// summaga 56515.72 ja partner SIA Citadele Leasing summata. Sama CPV teine osa
// (LOT-0002 "Kaubik") on voitjata.
// ---------------------------------------------------------------------------
{
  const db = baasDb();
  const r = sarnasedLepingud(db, '34100000');
  assert.equal(r.koguRidu, 3);
  assert.equal(r.koguArv, 2);
  assert.equal(r.n, 1, 'konsortsium on UKS leping');
  assert.equal(r.valjaJai, 1);
  assert.equal(r.medianAmount, 56515.72, 'sendid jaavad mediaani alles');
  assert.equal(r.read[0].konsortsium, 1, 'rida margib konsortsiumi');
  assert.equal(r.read[0].winner, 'OÜ KEIL M.A.', 'nimekirjas on summat kandev juht');
  console.log('PASS sarnased: konsortsiumi lepingut ei loeta kaks korda, sendid jäävad');
}

// ---------------------------------------------------------------------------
// D. CPV ON TAPNE KOOD, MITTE GRUPP.
//
// Moodetud 3 kuu peal: CPV-grupp (esimesed 5 numbrit) ei anna meie nisi koodidel
// praktiliselt midagi juurde (72413000: tapne 0, grupp 0; 72212224: 0 -> 2), aga
// ehituse koodidel plahvatab (45233262: tapne 2, grupp 175). Seega vordleme
// TAPSET koodi ja puuduva vastuse korral kukume segmendile, mitte laiemale CPV-le.
// ---------------------------------------------------------------------------
{
  const db = baasDb();
  assert.ok(sarnasedLepingud(db, '18800000').n > 0, 'tapne kood leiab');
  assert.equal(sarnasedLepingud(db, '18800001').n, 0,
    'sama CPV-grupi naaberkood EI TOHI tabada - vordlus on tapne kood');
  assert.equal(sarnasedLepingud(db, '18800001').koguArv, 0);
  console.log('PASS sarnased: CPV-võrdlus on täpne kood, mitte grupp');
}

// ---------------------------------------------------------------------------
// E. CPV PUUDUB -> SEGMENT. RSS ei anna CPV-d uldse (moodetud ulesandes 9), seega
// see on TAVALINE juhtum. Segmendi pool vordleb AINULT pealkirjatabamusi.
//
// Fikstuuris on 8 nisi PEALKIRJA-lepingut ja uks nisi KIRJELDUSE-leping: Kunda
// trafo summaga 4 389 920 eurot. Ta EI TOHI vordlusse jouda.
// ---------------------------------------------------------------------------
{
  const db = nissDb();
  const r = sarnasedLepingud(db, null, { segment: 'nišš' });
  assert.equal(r.alus, 'segment', 'CPV-ta hange vordleb segmendi jargi');
  assert.equal(r.segment, 'nišš');
  assert.equal(r.n, 8, 'kaheksa pealkirjatabamusega lepingut');
  assert.equal(r.medianAmount, 44527, '(39054 + 50000) / 2');
  assert.equal(r.medianTenders, 2);
  assert.ok(r.piisav, 'kaheksa lepingut on ule miinimumlave');

  const nimed = r.read.map((x) => x.title).join(' | ');
  assert.doesNotMatch(nimed, /trafo/i, 'trafo EI TOHI sarnaste hulka sattuda: ' + nimed);
  for (const x of r.read) assert.equal(x.segment_allikas, 'pealkiri');
  assert.ok(r.read.length <= SARNASEID_RIDU, 'nimekiri on piiratud');
  // Kogu fikstuuri niss on 9 lepingut - trafo on neist uks ja ta jaab VALJA
  // POHJUSEGA, mitte vaikselt. Seda ei loeta "valja jaanud" mediaani aluseks,
  // sest ta ei kuulunud kunagi vordlushulka: `koguArv` on pealkirjatabamused.
  assert.equal(r.koguArv, 8, 'koguArv loeb vordlushulka, mitte kogu segmenti');
  console.log('PASS sarnased: CPV-ta hange kukub segmendile ja trafo jääb välja');
}

// ---------------------------------------------------------------------------
// F. PEALKIRJAEELISTUS ON MOODETAV. Kui kirjeldusest tulnud read lubada sisse,
// nihkub mediaan. See plokk fikseerib VAHE, mitte ainult reegli.
// ---------------------------------------------------------------------------
{
  const db = nissDb();
  const q = (millised) => db.prepare(`SELECT MAX(amount) a FROM hanke_lepingud
      WHERE segment = 'nišš' AND winner IS NOT NULL AND amount IS NOT NULL
        ${millised} GROUP BY ref, COALESCE(lot, '')`).all().map((x) => Number(x.a));
  const ainultPealkiri = mediaan(q("AND segment_allikas = 'pealkiri'"));
  const koikTabamused = mediaan(q(''));
  assert.equal(ainultPealkiri, 44527);
  assert.equal(koikTabamused, 50000, 'kirjelduse read nihutavad mediaani');
  assert.notEqual(ainultPealkiri, koikTabamused,
    'kui see vaide langeb, ei ole pealkirjaeelistusel enam moodetavat moju');
  assert.equal(sarnasedLepingud(db, null, { segment: 'nišš' }).medianAmount, ainultPealkiri);
  console.log('PASS sarnased: pealkirjaeelistus muudab mediaani mõõdetavalt (44 527 vs 50 000)');
}

// ---------------------------------------------------------------------------
// G. CPV VOIDAB, KUI TA ULETAB MIINIMUMLAVE; muidu kukub segmendile.
// Kolme kuu baasis on CPV 72200000 peal 6 lepingut (2 lepingut x 3 koopiat).
// ---------------------------------------------------------------------------
{
  const db = kolmDb();
  const cpv = sarnasedLepingud(db, '72200000', { segment: 'nišš' });
  assert.equal(cpv.alus, 'cpv', 'kuus lepingut on ule lave - CPV voidab');
  assert.equal(cpv.n, 6);
  assert.equal(cpv.medianTenders, 8.5, '(1 + 16) / 2');
  assert.equal(cpv.medianAmount, 32070, '(14140 + 50000) / 2');

  // 72262000 all on ainult 3 lepingut - alla lave, seega segment (24 lepingut).
  const vahe = sarnasedLepingud(db, '72262000', { segment: 'nišš' });
  assert.equal(vahe.alus, 'segment', 'alla lave CPV kukub segmendile');
  assert.equal(vahe.n, 24, 'kolm koopiat x kaheksa pealkirjatabamust');
  assert.equal(vahe.cpv, null, 'vastus utleb, et CPV-d ei kasutatud');

  // Kumbagi ei ole: aus tuhi vastus, mitte vale mediaan.
  const eimidagi = sarnasedLepingud(db, null, { segment: null });
  assert.equal(eimidagi.alus, null);
  assert.equal(eimidagi.n, 0);
  assert.equal(eimidagi.medianTenders, null);
  assert.equal(eimidagi.read.length, 0);
  console.log('PASS sarnased: CPV võidab üle läve, muidu segment, muidu aus tühi vastus');
}

// ---------------------------------------------------------------------------
// H. MIINIMUMLAVI MUUDAB VERDIKTI. score() tohib ajalooteguri rakendada AINULT
// siis, kui mediaan pohineb vahemalt SARNASED_MIN lepingul - ja ta utleb
// score_why-s, mitmel lepingul mediaan pohineb.
// ---------------------------------------------------------------------------
{
  assert.equal(SARNASED_MIN, 5);
  const baas = { segment: 'nišš' };  // 40 punkti
  const tana = { today: '2026-10-01' };

  const kindel = score(baas, { ...tana, ajalugu: { medianTenders: 8.5, n: 6, alus: 'cpv' } });
  assert.equal(kindel.points, 30, '40 - 10');
  assert.equal(kindel.verdict, 'JÄTA');
  assert.ok(kindel.why.some((x) => /-10/.test(x) && /6 lepingul/.test(x)),
    'pohjendus peab utlema, mitmel lepingul mediaan pohineb: ' + kindel.why.join(' / '));

  const nork = score(baas, { ...tana, ajalugu: { medianTenders: 8.5, n: 2, alus: 'cpv' } });
  assert.equal(nork.points, 40, 'kahe lepingu mediaan ei tohi verdikti liigutada');
  assert.equal(nork.verdict, 'KAALU', 'lavi hoiab hanke KAALU hulgas');
  assert.ok(nork.why.some((x) => x.startsWith('0 · ') && /2 lepingu/.test(x)),
    'rakendamata tegur peab olema NAHTAV nullrida: ' + nork.why.join(' / '));

  // Alus teadmata (vana kutsuja, kes `n`-i ei anna) EI TOHI vaikselt punkte anda.
  const teadmata = score(baas, { ...tana, ajalugu: { medianTenders: 12 } });
  assert.equal(teadmata.points, 40, 'aluseta mediaan ei liiguta skoori');
  assert.ok(teadmata.why.some((x) => x.startsWith('0 · ')), 'ka see on nahtav nullrida');

  // KAHE LAVE VAHE ON TEADLIK AUK, aga ta EI TOHI olla vaikne. Parast
  // 21.09.2026 kalibreeringut (laved 1 / 4, 24 kuu andmed) on ta LAI: 88 nisi
  // CPV-koodist jaab sinna 49. Paris jooksul on segmenditee mediaan 2 pakkujat
  // 132 lepingul ehk TAPSELT augus - ilma selle reata ei utleks score_why
  // uldse, et ajalugu vaadati. Vt test/gate-hanked-ajalugu-kalibreering.mjs.
  const vahepeal = score(baas, { ...tana, ajalugu: { medianTenders: 2, n: 24, alus: 'segment' } });
  assert.equal(vahepeal.points, 40, 'lavede vahele jaav mediaan ei anna ega vota punkte');
  assert.ok(vahepeal.why.some((x) => x.startsWith('0 · ') && /24 lepingul/.test(x)),
    'kahe reegli vahele jaav mediaan peab olema NAHTAV: ' + vahepeal.why.join(' / '));

  // Vaike mediaan sama lavi all.
  assert.equal(score(baas, { ...tana, ajalugu: { medianTenders: 1, n: 8 } }).points, 45, '40 + 5');
  assert.equal(score(baas, { ...tana, ajalugu: { medianTenders: 1, n: 4 } }).points, 40,
    'lavi kehtib ka boonuse poole peal');

  // Pohjendus peab utlema, MIDA vorreldi - segmendi tee ei ole "sama CPV ajalugu".
  const seg = score(baas, { ...tana, ajalugu: { medianTenders: 1, n: 8, alus: 'segment' } });
  assert.ok(seg.why.some((x) => /segmendi ajalugu/.test(x) && !/sama CPV/.test(x)),
    'segmendi-varutee peab pohjenduses nahtav olema: ' + seg.why.join(' / '));
  console.log('PASS sarnased: miinimumlävi hoiab müra verdiktist eemal ja on põhjenduses näha');
}

// ---------------------------------------------------------------------------
// I. hangeDetail annab `sarnased` ja EI LOHU ulesande 10 kuju.
// ---------------------------------------------------------------------------
{
  const db = nissDb();
  upsertHange(db, { ref: '999001', title: 'Veebilehe uuendus', segment: 'nišš', cpv: null });
  const d = hangeDetail(db, '999001');
  assert.ok(d.hange && Array.isArray(d.why), 'ulesande 10 kuju peab alles jaama');
  assert.ok(d.sarnased, 'detail peab kandma sarnaseid lepinguid');
  assert.equal(d.sarnased.alus, 'segment', 'CPV-ta hange vordleb segmendi jargi');
  assert.equal(d.sarnased.n, 8);

  // CPV-ga hange, mille kood baasis puudub: aus tuhi vordlus segmendi kaudu.
  upsertHange(db, { ref: '999002', title: 'Veebilehe uuendus', segment: 'nišš', cpv: '72413000' });
  const d2 = hangeDetail(db, '999002');
  assert.equal(d2.sarnased.alus, 'segment', '72413000 ei anna 3 kuu peal uhtegi rida');
  console.log('PASS sarnased: hangeDetail kannab sarnaseid lepinguid, vana kuju jääb alles');
}

// ---------------------------------------------------------------------------
// J. VAHEMALU. sarnasedLepingud kutsutakse sunkis IGA REA KOHTA KAKS KORDA (kaks
// skooritsuklit). RSS-i ridadel on cpv NULL ja segment sama, seega kutsed on
// identsed - jooksu sees peab vastus tulema vahemalust.
// ---------------------------------------------------------------------------
{
  const db = kolmDb();
  const cache = new Map();
  const a = sarnasedLepingud(db, null, { segment: 'nišš', cache });
  const b = sarnasedLepingud(db, null, { segment: 'nišš', cache });
  assert.equal(a, b, 'sama kusimus jooksu sees peab tulema vahemalust (sama objekt)');
  assert.equal(cache.size, 1, 'uks kirje uhe kusimuse kohta');
  sarnasedLepingud(db, '72200000', { segment: 'nišš', cache });
  assert.equal(cache.size, 2, 'eri kusimus on eri kirje');
  // Ilma vahemaluta on iga vastus oma objekt - vahemalu ei tohi olla vaikne globaal.
  assert.notEqual(sarnasedLepingud(db, null, { segment: 'nišš' }),
    sarnasedLepingud(db, null, { segment: 'nišš' }), 'vahemalu on kutsuja oma, mitte moodulis');
  console.log('PASS sarnased: jooksusisene vahemälu on kutsuja oma ja tabab');
}

// ---------------------------------------------------------------------------
// K. INDEKS. Segmendi paring ilma indeksita on TAISSKANN. Moodetud 6671 rea peal:
// 0.912 ms/kutse ilma, 0.063 ms indeksiga; 53 368 rea peal 0.612 ms indeksiga.
// Migratsioon on LISAV - vana baas saab indeksi ilma uuesti laadimiseta.
// ---------------------------------------------------------------------------
{
  const db = baasDb();
  const on = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_lep_segment'").get();
  assert.ok(on, 'segmendi paringul peab olema indeks');
  const plaan = db.prepare(`EXPLAIN QUERY PLAN SELECT ref FROM hanke_lepingud
      WHERE segment = ? AND segment_allikas = 'pealkiri' ORDER BY date DESC`).all()
    .map((r) => r.detail).join(' ');
  assert.match(plaan, /idx_lep_segment/, 'segmendi paring peab indeksit kasutama: ' + plaan);
  assert.doesNotMatch(plaan, /SCAN hanke_lepingud(?! USING)/, 'taisskann ei ole lubatud: ' + plaan);
  console.log('PASS sarnased: segmendi päring käib indeksi pealt, mitte täisskannina');
}

// ---------------------------------------------------------------------------
// L. TAHTLIK VIGANE SISEND. sarnasedLepingud on eksporditud ja teda kutsub ka
// marsruut (hangeDetail) - vigane sisend ei tohi anda vale mediaani ega erindit.
// ---------------------------------------------------------------------------
{
  const db = nissDb();
  for (const paha of [undefined, '', '   ', 0, false, {}, []]) {
    const r = sarnasedLepingud(db, paha, { segment: null });
    assert.equal(r.n, 0, 'vigane CPV annab tuhja vastuse: ' + JSON.stringify(paha));
    assert.equal(r.alus, null);
  }
  assert.equal(sarnasedLepingud(db, null, { segment: 'olematu segment' }).n, 0);
  console.log('PASS sarnased: vigane sisend annab ausa tühja vastuse, mitte vale mediaani');
}
