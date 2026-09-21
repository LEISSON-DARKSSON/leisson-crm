#!/usr/bin/env node
// AJALOOTEGURI KALIBREERING. Lukustab 24 kuu peal MOODETUD tode.
//
// Allikas: lib/hanked.mjs score() plokk 6 ja sarnasedLepingud(). Moodetud
// 21.09.2026 toodangubaasi peal (ainult lugemine): 46 845 lepingurida,
// 21 398 hanget, aken 2024-09-21 ... 2026-08-31, 24 kuud.
//
// MIKS SEE VARAV OLEMAS ON. Ajalootegur annab -10 voi +5 ja verdikti piirid on
// 35 / 60, ehk ta liigutab hanke uhest otsusest teise UKSI. Vanad laved (+5 kui
// mediaan <= 3, -10 kui >= 8) olid kirjutatud KOLME KUU andmete pealt ja nad ei
// eraldanud sellel turul mitte midagi:
//
//   meie nisi CPV-koodid (72/79/48/92), millel on vahemalt SARNASED_MIN lepingut:
//     88 koodi; vanade lavede all sai +5 neist 73 (83 %) ja -10 tapselt 1 (1,1 %).
//   koik CPV-koodid: 825 piisavat koodi; +5 sai 592 (72 %), -10 sai 20 (2,4 %).
//
// Reegel, mis utleb 83 %-le "jah", ei ole reegel. Uued laved on TULETATUD
// mooedetud jaotusest, mitte valitud kaest: +5 kaib alumise kvartiili peale
// (p25) ja -10 ulemise detsiili peale (p90). Asummeetria on teadlik - -10 on
// kaks korda suurem liigutus kui +5, seega ta nouab tugevamat tondit.
//
// SEE VARAV EI KASUTA TOODANGUBAASI. Ta jookseb kommititud fikstuuri
// test/fixtures/hanked-ajalugu-24k.json peal, mis on toodangubaasist loigatud
// tukk ILMA isikuandmeteta: nimesid, registrikoode, ostjat ega pealkirju ei ole
// kaasas ja voitja on pseudonuum (V0001). Pohjus on mooedetud: winner_reg-is on
// 329 rida kujul [1-6] + 10 numbrit ehk Eesti isikukoodi kujuga - see ei lahe
// repositooriumi. Mediaan vajab voitjast AINULT kahte asja (kas ta on olemas ja
// kas kaks voitjat on erinevad) ja pseudonuum hoiab molemad alles.
//
// KUI SA MUUDAD LAVE, KUKUB SEE VARAV. Nii on moeldud: lavi on siin TULETATUD
// fikstuuri kvantiilidest, mitte kirjutatud kaest. Uus lavi nouab uut mootmist
// ja uut fikstuuri.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { migrateHanked, sarnasedLepingud, mediaan, score,
  SARNASED_MIN, AJALUGU_PLUSS5_KUNI, AJALUGU_MIINUS10_ALATES } from '../lib/hanked.mjs';

const JUUR = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const FIKSTUUR = JSON.parse(readFileSync(join(JUUR, 'test/fixtures/hanked-ajalugu-24k.json'), 'utf8'));

// ---------------------------------------------------------------------------
// A. FIKSTUUR ISE: kuju, maht ja ISIKUANDMETE PUUDUMINE.
// ---------------------------------------------------------------------------
{
  const { meta, veerud, read } = FIKSTUUR;
  assert.equal(read.length, 4553, 'fikstuuri maht on mooedetud, mitte umbkaudne');
  assert.equal(meta.ridu, read.length, 'meta ja sisu peavad klappima');
  assert.equal(meta.aken.kuid, 24, 'see on 24 kuu mootmine');
  assert.equal(meta.aken.algus, '2024-09-21');
  assert.equal(meta.aken.lopp, '2026-08-31');
  assert.equal(meta.baasRidu, 46845, 'toodangubaasi maht loike hetkel');

  // ISIKUANDMED. Veerg, mida ei ole, ei saa lekkida.
  for (const keelatud of ['winner_reg', 'buyer', 'buyer_reg', 'title', 'notice_id']) {
    assert.ok(!veerud.includes(keelatud),
      'fikstuur EI TOHI kanda veergu ' + keelatud + ' — vt faili paise');
  }
  // Ja mis kaasas on, peab ule elama mustrikontrolli: e-post, telefon, isikukood.
  const kahtlane = /[\w.+-]+@[\w-]+\.\w+|\+\d{6,}|\b[1-6]\d{10}\b/;
  let stringe = 0;
  for (const rida of read) {
    for (const v of rida) {
      if (typeof v !== 'string') continue;
      stringe += 1;
      assert.ok(!kahtlane.test(v), 'fikstuuris on kahtlane vali: ' + JSON.stringify(v));
    }
  }
  assert.ok(stringe > 10000, 'kontroll peab paris valjasid nagema, mitte tuhja hulka');
  // Voitja on pseudonuum, mitte arinimi.
  const vi = veerud.indexOf('winner');
  for (const rida of read) {
    const w = rida[vi];
    assert.ok(w === null || /^V\d{4}$/.test(w), 'voitja peab olema pseudonuum: ' + w);
  }
  console.log('PASS kalibreering: fikstuur on 24 kuu tukk ja isikuandmeid ei kanna');
}

// ---------------------------------------------------------------------------
// Fikstuur PARIS baasi. Sama tee, mida toodang kaib: migrateHanked + hanke_lepingud.
// ---------------------------------------------------------------------------
function fikstuuriBaas() {
  const dir = mkdtempSync(join(tmpdir(), 'ajalugu-kalib-'));
  const db = new DatabaseSync(join(dir, 'test.sqlite'));
  migrateHanked(db);
  const { veerud, read } = FIKSTUUR;
  const sisesta = db.prepare('INSERT INTO hanke_lepingud (' + veerud.join(', ')
    + ') VALUES (' + veerud.map(() => '?').join(', ') + ')');
  db.exec('BEGIN');
  for (const rida of read) sisesta.run(...rida);
  db.exec('COMMIT');
  return db;
}
const db = fikstuuriBaas();

// Kvantiil LINEAARSE interpolatsiooniga. Sama definitsioon, millega laved on
// tuletatud - teine definitsioon annaks teise lavi ja vaikse triivi.
function kvantiil(arvud, p) {
  const s = arvud.slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return Math.round((s[lo] + (s[hi] - s[lo]) * (i - lo)) * 100) / 100;
}

// Read lepinguteks: SAMA reegel mis lib/hanked.mjs-is - (ref, lot) + MAX.
// Siin on ta uuesti kirjas meelega: kui mootori grupeerimine muutub, peab see
// varav SEDA NAGEMA, mitte muutuma temaga kaasa.
function lepinguteks(read, sobib = () => true) {
  const veerg = Object.fromEntries(FIKSTUUR.veerud.map((n, i) => [n, i]));
  const m = new Map();
  for (const r of read) {
    if (!sobib(r, veerg)) continue;
    const k = r[veerg.ref] + '\u0000' + (r[veerg.lot] || '');
    let o = m.get(k);
    if (!o) { o = { winner: null, amount: null, tenders: null }; m.set(k, o); }
    const a = r[veerg.amount];
    if (a !== null && Number.isFinite(a) && (o.amount === null || a > o.amount)) {
      o.amount = a; o.winner = r[veerg.winner];
    }
    const t = r[veerg.tenders];
    if (t !== null && Number.isFinite(t) && (o.tenders === null || t > o.tenders)) o.tenders = t;
    if (o.winner === null && r[veerg.winner]) o.winner = r[veerg.winner];
  }
  return [...m.values()].filter((x) => x.winner !== null && x.amount !== null);
}

// Tegur nii, nagu score() teda arvutab - laved tulevad MOOTORIST.
function tegur(medianTenders, n) {
  if (!Number.isFinite(n) || n < SARNASED_MIN || !Number.isFinite(medianTenders)) return 0;
  if (medianTenders >= AJALUGU_MIINUS10_ALATES) return -10;
  if (medianTenders <= AJALUGU_PLUSS5_KUNI) return 5;
  return 0;
}

// ---------------------------------------------------------------------------
// B. SEGMENDITEE toodangu kujul. Need arvud on 24 kuu peal mooedetud.
// ---------------------------------------------------------------------------
{
  const v = sarnasedLepingud(db, null, { segment: 'nišš' });
  assert.equal(v.alus, 'segment');
  assert.equal(v.koguRidu, 226, 'nisi PEALKIRJA-tabamusi 24 kuu peal');
  assert.equal(v.koguArv, 164, 'ridadest saab 164 lepingut (osa) — (ref, lot)');
  assert.equal(v.n, 132, 'mediaani alus: voitja JA summa olemas');
  assert.equal(v.valjaJai, 32);
  assert.equal(v.medianTenders, 2, 'Eesti turul on tuupiline pakkujate arv VAIKE');
  assert.equal(v.medianAmount, 80914.55);
  assert.ok(v.piisav);
  console.log('PASS kalibreering: segmenditee 24 kuu peal — 132 lepingut, mediaan 2 pakkujat');
}

// ---------------------------------------------------------------------------
// C. JAOTUS, mitte ainult mediaan. Mediaan 2 EI TAHENDA, et koik on vaiksed.
// ---------------------------------------------------------------------------
{
  const veerg = Object.fromEntries(FIKSTUUR.veerud.map((n, i) => [n, i]));
  const niss = lepinguteks(FIKSTUUR.read,
    (r, c) => r[c.segment] === 'nišš' && r[c.segment_allikas] === 'pealkiri');
  const t = niss.filter((x) => x.tenders !== null).map((x) => x.tenders);
  assert.equal(niss.length, 132);
  assert.equal(t.length, 129, 'kolmel lepingul pakkujate arvu ei ole');
  assert.equal(kvantiil(t, 0.25), 1);
  assert.equal(kvantiil(t, 0.5), 2);
  assert.equal(kvantiil(t, 0.75), 5);
  assert.equal(kvantiil(t, 0.9), 8);
  assert.equal(Math.max(...t), 43, 'saba on olemas — 43 pakkujat');
  assert.equal(t.filter((x) => x <= 3).length, 80, '62 % lepingutest: kuni 3 pakkujat');
  assert.equal(t.filter((x) => x >= 4 && x <= 7).length, 32);
  assert.equal(t.filter((x) => x >= 8).length, 17, '13 % on rahvarohked');
  assert.ok(veerg.tenders === 9, 'veerujarjekord on fikstuuri leping');
  console.log('PASS kalibreering: nisi jaotus p25=1 p50=2 p75=5 p90=8, saba 43-ni');
}

// ---------------------------------------------------------------------------
// D. AKNASOLTUVUS. See on avatud otsa B1 pohikusimus: kas tegur moodab TURGU
// voi AKNA PIKKUST. Vanade lavede all andis 3 kuud vastuse "0" ja 6/12/24 kuud
// vastuse "+5" — sama hange, eri skoor, olenevalt sellest, kui palju ajalugu
// parasjagu laetud oli. Uute lavede all annavad KOIK NELI AKENT sama vastuse.
// ---------------------------------------------------------------------------
{
  const lopp = FIKSTUUR.meta.aken.lopp;
  const algusOn = (kuud) => {
    const d = new Date(lopp + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() - kuud);
    return d.toISOString().slice(0, 10);
  };
  const OOTUS = [
    { kuud: 3, n: 24, mediaan: 3.5 },
    { kuud: 6, n: 39, mediaan: 2 },
    { kuud: 12, n: 70, mediaan: 2 },
    { kuud: 24, n: 132, mediaan: 2 },
  ];
  const tegurid = new Set();
  for (const o of OOTUS) {
    const algus = algusOn(o.kuud);
    const lep = lepinguteks(FIKSTUUR.read, (r, c) => r[c.segment] === 'nišš'
      && r[c.segment_allikas] === 'pealkiri' && r[c.date] > algus);
    const med = mediaan(lep.filter((x) => x.tenders !== null).map((x) => x.tenders));
    assert.equal(lep.length, o.n, o.kuud + ' kuud: lepingute arv');
    assert.equal(med, o.mediaan, o.kuud + ' kuud: mediaan');
    tegurid.add(tegur(med, lep.length));
  }
  assert.equal(tegurid.size, 1,
    'AKEN EI TOHI TEGURIT LIIGUTADA. 3 / 6 / 12 / 24 kuud peavad andma sama teguri, '
    + 'andsid: ' + [...tegurid].join(', ') + '. Kui see rida punastab, moodab tegur '
    + 'akna pikkust, mitte turgu — tapselt see, mille parast lavesid liigutati.');
  assert.equal([...tegurid][0], 0,
    'moodetud 24 kuu peal jaab segmenditee mediaan 2 KAHE REEGLI VAHELE');
  console.log('PASS kalibreering: 3 / 6 / 12 / 24 kuud annavad sama teguri (0)');
}

// ---------------------------------------------------------------------------
// E. LAVI ON TULETATUD, MITTE VALITUD. See on selle varava sudames.
// ---------------------------------------------------------------------------
{
  const veerg = Object.fromEntries(FIKSTUUR.veerud.map((n, i) => [n, i]));
  // AINULT MEIE NISI EESLIITED. Fikstuur kannab ka nisi-segmendi ridu, mille CPV
  // vaib olla mistahes kood (nt 45*) - nende koodide teised read EI OLE fikstuuris
  // ja nende n oleks POOLIK. Poolik kood annaks vale mediaani ja vale kvantiili.
  const EESLIITED = ['72', '79', '48', '92'];
  const koodid = new Map();
  for (const r of FIKSTUUR.read) {
    const cpv = r[veerg.cpv];
    if (!cpv || !EESLIITED.includes(cpv.slice(0, 2))) continue;
    if (!koodid.has(cpv)) koodid.set(cpv, []);
    koodid.get(cpv).push(r);
  }
  const mediaanid = [];
  for (const [cpv, read] of koodid) {
    const alus = lepinguteks(read);
    if (alus.length < SARNASED_MIN) continue;
    const med = mediaan(alus.filter((x) => x.tenders !== null).map((x) => x.tenders));
    if (med === null) continue;
    mediaanid.push({ cpv, n: alus.length, med });
  }
  const m = mediaanid.map((x) => x.med);
  assert.equal(mediaanid.length, 88,
    'meie nisi CPV-koode (72/79/48/92), millel on vahemalt ' + SARNASED_MIN + ' lepingut');
  assert.equal(kvantiil(m, 0.25), 1);
  assert.equal(kvantiil(m, 0.5), 2);
  assert.equal(kvantiil(m, 0.75), 3);
  assert.equal(kvantiil(m, 0.9), 4);
  assert.equal(Math.max(...m), 19);

  // LUKK. Lave EI TOHI kaest kirjutada — nad on selle jaotuse kvantiilid.
  assert.equal(AJALUGU_PLUSS5_KUNI, kvantiil(m, 0.25),
    '+5 lavi PEAB olema mooedetud jaotuse alumine kvartiil (p25). Kui sa muutsid '
    + 'lavi, moodda jaotus uuesti ja uuenda fikstuuri — mitte vastupidi.');
  assert.equal(AJALUGU_MIINUS10_ALATES, kvantiil(m, 0.9),
    '-10 lavi PEAB olema mooedetud jaotuse ulemine detsiil (p90). -10 on kaks korda '
    + 'suurem liigutus kui +5 ja nouab seetottu tugevamat tondit.');

  // Ja lavi peab paris eraldama: uhtegi haru ei tohi sattuda ule poole koodidest.
  const pluss = mediaanid.filter((x) => x.med <= AJALUGU_PLUSS5_KUNI).length;
  const miinus = mediaanid.filter((x) => x.med >= AJALUGU_MIINUS10_ALATES).length;
  const auk = mediaanid.length - pluss - miinus;
  assert.deepEqual({ pluss, auk, miinus }, { pluss: 26, auk: 49, miinus: 13 },
    'mooedetud bandid 24 kuu peal');
  for (const [silt, n] of [['+5', pluss], ['-10', miinus]]) {
    assert.ok(n / mediaanid.length <= 0.5,
      'haru ' + silt + ' tabab ' + n + '/' + mediaanid.length + ' koodi — reegel, mis '
      + 'utleb ule poole koodidest "jah", ei eralda midagi. Vanad laved (+5 kui <= 3) '
      + 'tabasid 73/88 ehk 83 %.');
    assert.ok(n >= 5,
      'haru ' + silt + ' tabab ainult ' + n + ' koodi — surnud haru on sama halb kui '
      + 'liiga lai. Vana -10 (>= 8) tabas 1/88.');
  }
  console.log('PASS kalibreering: +5 = p25 = ' + AJALUGU_PLUSS5_KUNI
    + ', -10 = p90 = ' + AJALUGU_MIINUS10_ALATES + ', bandid 26 / 49 / 13');
}

// ---------------------------------------------------------------------------
// F. MOOTOR KAITUB LAVEDE JARGI ja mitterakendumine on NAHTAV nullrida.
// ---------------------------------------------------------------------------
{
  const baas = { segment: 'nišš' };  // 40 punkti
  const tana = { today: '2026-10-01' };
  const p = (medianTenders, n = 9, alus = 'cpv') =>
    score(baas, { ...tana, ajalugu: { medianTenders, n, alus } }).points;

  assert.equal(p(AJALUGU_PLUSS5_KUNI), 45, 'lavi ise kuulub +5 sisse');
  assert.equal(p(AJALUGU_PLUSS5_KUNI + 0.5), 40, 'lavist ules jaab auku');
  assert.equal(p(AJALUGU_MIINUS10_ALATES), 30, 'lavi ise kuulub -10 sisse');
  assert.equal(p(AJALUGU_MIINUS10_ALATES - 0.5), 40, 'lavist allpool on auk');
  assert.equal(p(AJALUGU_MIINUS10_ALATES, SARNASED_MIN - 1), 40,
    'alla ' + SARNASED_MIN + ' lepingu tegurit ei rakendata');

  // Toodangu paris juhtum: segmenditee mediaan 2 kaib augu kaudu ja see peab
  // olema NAHTAV nullrida, mitte vaikus.
  const paris = score(baas, { ...tana, ajalugu: sarnasedLepingud(db, null, { segment: 'nišš' }) });
  assert.equal(paris.points, 40, 'mooedetud segmenditee ei liiguta skoori');
  assert.equal(paris.verdict, 'KAALU');
  const rida = paris.why.find((x) => /ajalugu/.test(x));
  assert.ok(rida && rida.startsWith('0 · '), 'rakendamata tegur peab olema nahtav: ' + rida);
  assert.ok(/132 lepingul/.test(rida), 'pohjendus peab utlema aluse: ' + rida);
  assert.ok(/segmendi ajalugu/.test(rida), 'ja MIDA vorreldi: ' + rida);
  console.log('PASS kalibreering: mootor jargib lavesid ja mitterakendumine on nähtav');
}

db.close();
console.log('KOIK OK gate-hanked-ajalugu-kalibreering');
