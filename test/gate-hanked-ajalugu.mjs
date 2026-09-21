#!/usr/bin/env node
// ULESANNE 12: kuine ajaloo import (eForms notice_award -> hanke_lepingud).
//
// MIDA SEE VARAV VALVAB
//   1. SKEEM. Rida on OSA kohta, mitte teate kohta (otsus 21.09.2026). Unikaalindeks
//      PEAB sisaldama osa tunnust - vana indeks (ref, winner_reg, amount) laseks
//      raamlepingu teise osa rea vaikselt INSERT OR IGNORE taha kaduda.
//   2. VAIKSET FILTRIT EI OLE. Iga teade annab vahemalt uhe rea ja iga mahavisatud
//      asi on LOENDATUD (hanke_sync.note). Plaani naidiskoodi rida
//      `if (a.nature !== 'services' || !a.winner) continue;` viskas 137 voitjata
//      teadet ja kogu ehituse/asjad vaikselt minema.
//   3. UKS SONAVARA. eForms annab koodid ('services', 'open'), RSS eestikeelsed
//      sonad ('Teenused', 'Avatud hankemenetlus'). Normaliseerimine on IMPORTIJAS.
//   4. 24 KUU AKEN kaib RANGE kuupaevakontrolli alt - vigane `date` ei tohi rida
//      vaikselt kustutada.
//   5. KATKESTATAVUS. Kuu kaupa tehing + hanke_sync rida = poolik jooks jatkub.
//
// VORKU EI KASUTA: fikstuur on kommititud paris XML ja pariskuju jooks kaib
// KOHALIKU HTTP-serveri vastu (HANKED_AWARD_BASE).
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { migrateHanked } from '../lib/hanked.mjs';
import { splitNotices, parseAward } from '../lib/eforms.mjs';
import { cmdView, valideeriArgs } from '../lib/hanked-runs.mjs';
import {
  importMonthXml, tehtudKuud, kustutaVanemad, kuudeNimekiri, parseArgs,
  loendiTekst, awardUrl, LIIK_KOOD, MENETLUS_KOOD, MAX_KUUD,
} from '../agent/hanked-history.mjs';

const JUUR = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const XML = readFileSync(join(JUUR, 'test/fixtures/eforms-2026-08-naidis.xml'), 'utf8');
// Sama fikstuur TEISTE viitenumbritega: kahe kuu jaoks on vaja kaht ERI hanget,
// sest unikaalindeks on LEPINGU identiteet (ref + osa + voitja + summa) ja ta EI
// SISALDA kuud - sama leping kahes kuufailis ongi UKS leping, mitte kaks.
const XML_TEINE = XML.replace(/<cbc:ID>(\d{6})-(\d{4})<\/cbc:ID>/g,
  (m, r, o) => '<cbc:ID>' + (Number(r) + 400000) + '-' + o + '</cbc:ID>');

function testDb() {
  const dir = mkdtempSync(join(tmpdir(), 'ajalugu-'));
  const db = new DatabaseSync(join(dir, 'test.sqlite'));
  migrateHanked(db);
  return db;
}

const indeksid = (db) => db.prepare(
  "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'hanke_lepingud'").all();
const veerud = (db) => db.prepare('PRAGMA table_info(hanke_lepingud)').all().map((c) => c.name);

// ---------------------------------------------------------------------------
// A. SKEEM: rida osa kohta.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const v = veerud(db);
  for (const veerg of ['ref', 'lot', 'kuu', 'notice_id', 'date', 'buyer', 'buyer_reg', 'title',
    'cpv', 'nature', 'menetlus', 'segment', 'winner', 'winner_reg', 'winner_size',
    'winner_allikas', 'winner_arv', 'konsortsium', 'tulemus', 'osi',
    'amount', 'currency', 'amount_valuutas', 'amount_allikas', 'tenders', 'tenders_allikas']) {
    assert.ok(v.includes(veerg), 'hanke_lepingud vajab veergu ' + veerg);
  }

  const idx = indeksid(db);
  const uniq = idx.filter((i) => /UNIQUE/i.test(i.sql || ''));
  assert.equal(uniq.length, 1, 'tapselt uks unikaalindeks hanke_lepingud peal');
  assert.match(uniq[0].sql, /\blot\b/, 'unikaalindeks PEAB sisaldama osa tunnust');
  assert.ok(!idx.some((i) => i.name === 'idx_lep_uniq'),
    'vana teatepohine unikaalindeks peab olema kustutatud, mitte korvuti jaetud');
  assert.ok(idx.some((i) => /\(cpv/i.test(i.sql || '')), 'CPV jargi paritakse (ulesanne 13)');
  assert.ok(idx.some((i) => /winner_reg/i.test(i.sql || '') && !/UNIQUE/i.test(i.sql || '')),
    'voitja jargi paritakse (ulesanne 13 konkurentide pingerida)');
  db.close();
  console.log('PASS ajalugu: skeem on osapohine ja indekseeritud');
}

// A2: MIGRATSIOON ON KORDUV JA ODAV. Teine kutse ei tohi indekseid umber ehitada
// ega kukkuda (migrateHanked jookseb iga importMonthXml-i sees).
{
  const db = testDb();
  migrateHanked(db);
  migrateHanked(db);
  assert.equal(indeksid(db).filter((i) => /UNIQUE/i.test(i.sql || '')).length, 1);
  db.close();
  console.log('PASS ajalugu: migratsioon on korduvkutsutav');
}

// A3: VANA BAAS. Kui tabel on juba vana skeemiga (uks rida teate kohta, vana
// unikaalindeks), peab migratsioon selle UMBER ehitama, mitte vaikselt edasi elama.
{
  const dir = mkdtempSync(join(tmpdir(), 'ajalugu-vana-'));
  const db = new DatabaseSync(join(dir, 'vana.sqlite'));
  db.exec(`CREATE TABLE hanke_lepingud (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT, date TEXT NOT NULL, buyer TEXT, title TEXT, cpv TEXT,
      winner TEXT, winner_reg TEXT, winner_size TEXT,
      amount INTEGER, tenders INTEGER, menetlus TEXT, segment TEXT);
    CREATE UNIQUE INDEX idx_lep_uniq
      ON hanke_lepingud(COALESCE(ref,''), COALESCE(winner_reg,''), COALESCE(amount,-1));`);
  migrateHanked(db);
  assert.ok(veerud(db).includes('lot'), 'vanale tabelile lisatakse osa veerg');
  assert.ok(!indeksid(db).some((i) => i.name === 'idx_lep_uniq'), 'vana indeks kaob ka vanalt baasilt');
  db.close();
  console.log('PASS ajalugu: vana skeem migreerub');
}

// ---------------------------------------------------------------------------
// B. IMPORT PARIS FIKSTUURIST: iga teade annab rea, osad on eraldi read.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const r = importMonthXml(db, '2026-08', XML);
  assert.equal(r.vahelejäetud, false);
  assert.equal(r.loend.teateid, 11, 'fikstuuris on 11 lepinguteadet');
  assert.ok(r.rows >= 11, 'ridu on vahemalt teadete jagu, mitte vahem');
  assert.equal(r.rows, db.prepare('SELECT COUNT(*) AS c FROM hanke_lepingud').get().c);

  // VAIKSE FILTRI VALVE: iga teate ref peab olema tabelis esindatud.
  const olemas = new Set(db.prepare('SELECT DISTINCT ref FROM hanke_lepingud').all().map((x) => x.ref));
  for (const blk of splitNotices(XML, 'ContractAwardNotice')) {
    const a = parseAward(blk);
    assert.ok(olemas.has(a.ref), 'teade ' + a.ref + ' ei tohi vaikselt kaduda');
  }

  // 305201 "Saabaste ostmine": LOT-0001 sai KAKS voitnud pakkumust, LOT-0002 on
  // clos-nw (voitjata). Teatepohine rida naitaks uht voitjat ja kaotaks teise.
  const saapad = db.prepare('SELECT * FROM hanke_lepingud WHERE ref = ? ORDER BY lot, id').all('305201');
  assert.equal(saapad.length, 3, '305201: kaks voitjat esimeses osas + voitjata teine osa');
  assert.equal(new Set(saapad.map((x) => x.lot)).size, 2, 'kaks eri osa');
  const osa1 = saapad.filter((x) => x.lot === saapad[0].lot);
  assert.equal(osa1.length, 2, 'LOT-0001 kaks voitjat');
  assert.equal(new Set(osa1.map((x) => x.winner)).size, 2, 'kaks ERINEVAT voitjat, mitte sama rida kaks korda');
  assert.ok(osa1.every((x) => x.tulemus === 'selec-w'));
  const osa2 = saapad.find((x) => x.lot !== saapad[0].lot);
  assert.equal(osa2.winner, null, 'voitjata osa jaab tabelisse, aga ilma voitjata');
  assert.equal(osa2.tulemus, 'clos-nw');
  assert.equal(osa2.tenders, 0, 'voitjata osale laekus 0 pakkumust ja see arv on NAHTAV');

  // Osa statistika on OSA kohta: LOT-0001 sai 7 pakkumust, LOT-0002 mitte uhtegi.
  assert.equal(osa1[0].tenders, 7, 'esimese osa pakkumuste arv tuleb selle osa statistikast');
  db.close();
  console.log('PASS ajalugu: iga teade annab rea ja osad on eraldi read');
}

// B2: KONSORTSIUM. 306343 (Vaikebussi ja kaubiku kasutusrent): uks voitnud
// pakkumus, KAKS pakkujat (TPA-0001: ORG-0005 juht + ORG-0004). Molemad peavad
// pingereas nahtavad olema, aga SUMMA tohib olla ainult UHEL real - muidu
// topeltloeb ulesande 13 mediaan sama lepingu raha kaks korda.
{
  const db = testDb();
  importMonthXml(db, '2026-08', XML);
  const read = db.prepare('SELECT * FROM hanke_lepingud WHERE ref = ? ORDER BY lot, id').all('306343');
  assert.equal(read.length, 3, '306343: konsortsiumi kaks liiget + voitjata teine osa');
  const konsortsium = read.filter((x) => x.winner !== null);
  assert.equal(konsortsium.length, 2);
  assert.ok(konsortsium.every((x) => x.konsortsium === 1), 'konsortsiumi rida on margitud');
  assert.equal(konsortsium.filter((x) => x.amount !== null).length, 1,
    'summa on tapselt uhel konsortsiumi real');
  assert.equal(konsortsium.find((x) => x.amount !== null).amount, 56515.72);
  assert.equal(konsortsium.find((x) => x.amount === null).amount_allikas, 'konsortsiumi-partner',
    'tuhi summa peab utlema, MIKS ta tuhi on');
  assert.equal(konsortsium[0].winner_arv, 2, 'osa voitjate arv on real nahtav');
  db.close();
  console.log('PASS ajalugu: konsortsium annab kaks rida ja uhe summa');
}

// B3: SEGMENT TULEB PEALKIRJAST JA KIRJELDUSEST. Ulesandes 3 kaotas ainult
// pealkirja vaatav segmentOf paris hanke (310983). parseAward peab andma
// kirjelduse ja importija peab selle segmentOf-ile ette andma.
{
  const a = parseAward(splitNotices(XML, 'ContractAwardNotice')[0]);
  assert.ok(typeof a.description === 'string' && a.description.length > 10,
    'parseAward peab andma hanke kirjelduse (cbc:Description), muidu on segment kitsam kui elaval hankel');
  assert.ok(!/Ida-Viru maakond, Sillam/.test(a.description),
    'kirjeldus ei tohi tulla cac:RealizedLocation plokist');

  const db = testDb();
  const eriline = XML
    .replace('<cbc:Description languageID="EST">Survevalumasinate komplekti ost',
      '<cbc:Description languageID="EST">Hanke ese on veebilehe ja kasutajaliidese arendus')
    // Teine teade saab nisisona PEALKIRJA, et mold allikat saaks vorrelda.
    .replace(/Kaardimaksete vastuvõtmise teenus/g, 'Kaardimaksete veebilehe uuendamine');
  importMonthXml(db, '2026-08', eriline);
  const rida = db.prepare('SELECT segment, segment_allikas FROM hanke_lepingud WHERE ref = ?').get('313192');
  assert.equal(rida.segment, 'nišš', 'kirjelduses olev nisisona peab segmendi andma');
  // MOODETUD PARIS JOOKSUL (3 kuud, 65 nisi teadet): 32 tabamust 65-st tuli AINULT
  // kirjeldusest ja osa neist on MURA ("jõutrafode ost", kus kirjelduses on
  // riigihangete registri veebilehe boilerplate). Kirjeldust EI TOHI seetottu
  // valja visata (ulesandes 3 kaotas pealkiri-ainult paris hanke), aga rida peab
  // UTLEMA, kummalt poolt tabamus tuli - ulesanne 13 saab neid eri kaaluga votta.
  assert.equal(rida.segment_allikas, 'kirjeldus', 'tabamuse allikas peab olema nahtav');
  const pealkirjast = db.prepare('SELECT segment, segment_allikas FROM hanke_lepingud WHERE ref = ?').get('313139');
  assert.equal(pealkirjast.segment, 'väike veebileht');
  assert.equal(pealkirjast.segment_allikas, 'pealkiri', 'pealkirjast tulnud tabamus on TUGEVAM ja margitud');
  db.close();
  console.log('PASS ajalugu: segment vaatab pealkirja JA kirjeldust');
}

// ---------------------------------------------------------------------------
// C. UKS SONAVARA (O3): eForms-i koodid normaliseeritakse eestikeelseks,
// TAPSELT samaks, mida RSS-i tee (lib/hanked.mjs LIIGID) baasi kirjutab.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  importMonthXml(db, '2026-08', XML);
  const liigid = db.prepare('SELECT DISTINCT nature FROM hanke_lepingud').all().map((x) => x.nature);
  assert.ok(liigid.includes('Teenused'), 'services -> Teenused');
  assert.ok(liigid.includes('Asjad'), 'supplies -> Asjad');
  assert.ok(!liigid.includes('services'), 'toorkood ei tohi baasi jouda');
  assert.equal(LIIK_KOOD.get('works'), 'Ehitustööd');
  const menetlused = db.prepare('SELECT DISTINCT menetlus FROM hanke_lepingud').all().map((x) => x.menetlus);
  assert.ok(menetlused.includes('Avatud hankemenetlus'), 'open -> Avatud hankemenetlus');
  assert.ok(!menetlused.includes('open'), 'toormenetluskood ei tohi baasi jouda');
  assert.equal(MENETLUS_KOOD.get('restricted'), 'Piiratud hankemenetlus');

  // TUNDMATU KOOD EI KAO. Ta laheb baasi TOORELT (mitte NULL-iks) ja ta on loendatud -
  // vaikne NULL tahendaks, et RHR-i uus kood kaob ilma uhegi punase reata.
  const db2 = testDb();
  const muudetud = XML.replace(/listName="contract-nature">services</g, 'listName="contract-nature">tundmatu<');
  const r = importMonthXml(db2, '2026-08', muudetud);
  assert.ok(r.loend.tundmatuLiik > 0, 'tundmatu liigikood tuleb loendada');
  assert.ok(db2.prepare('SELECT COUNT(*) AS c FROM hanke_lepingud WHERE nature = ?').get('tundmatu').c > 0,
    'tundmatu kood jaab toorelt nahtavaks');
  assert.match(loendiTekst(r.loend), /tundmatu/i, 'tundmatu kood peab olema sunkimislogis nahtav');
  db.close(); db2.close();
  console.log('PASS ajalugu: uks sonavara, tundmatu kood on nahtav');
}

// ---------------------------------------------------------------------------
// D. KORDUSKAITSE ja TAHTLIK UUESTILAADIMINE.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const r1 = importMonthXml(db, '2026-08', XML);
  assert.deepEqual(tehtudKuud(db), ['2026-08']);
  const r2 = importMonthXml(db, '2026-08', XML);
  assert.equal(r2.vahelejäetud, true, 'tehtud kuud ei laeta uuesti');
  assert.equal(r2.rows, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanke_lepingud').get().c, r1.rows,
    'korduskutse ei tohi ridu juurde tekitada');

  // Tahtlik uuestilaadimine: sama kuu read kirjutatakse ULE, mitte juurde.
  const r3 = importMonthXml(db, '2026-08', XML, { uuesti: true });
  assert.equal(r3.vahelejäetud, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanke_lepingud').get().c, r1.rows,
    'uuestilaadimine annab sama arvu ridu, mitte topelt');
  db.close();
  console.log('PASS ajalugu: korduskaitse ja tahtlik uuestilaadimine');
}

// D2: UNIKAALINDEKS PEAB OSA ERISTAMA. Sama voitja, sama summa, KAKS eri osa -
// vana indeks (ref, winner_reg, amount) kaotaks teise rea vaikselt.
{
  const db = testDb();
  const kaks = `<OPEN-DATA><ContractAwardNotice>
    <cbc:ID>NOT-1</cbc:ID><cbc:IssueDate>2026-08-05+03:00</cbc:IssueDate>
    <cac:ContractingParty><cac:PartyIdentification><cbc:ID>ORG-0001</cbc:ID></cac:PartyIdentification></cac:ContractingParty>
    <cac:ProcurementProject><cbc:ID>999001-0000</cbc:ID>
      <cbc:Name languageID="EST">Raamleping kahe osaga</cbc:Name>
      <cbc:Description languageID="EST">Veebilehe hooldus kahes osas.</cbc:Description>
      <cbc:ProcurementTypeCode listName="contract-nature">services</cbc:ProcurementTypeCode>
      <cac:MainCommodityClassification><cbc:ItemClassificationCode listName="cpv">72413000</cbc:ItemClassificationCode></cac:MainCommodityClassification>
    </cac:ProcurementProject>
    <ext:UBLExtensions><ext:UBLExtension><efac:Organizations>
      <efac:Organization><efac:Company><cac:PartyIdentification><cbc:ID>ORG-0001</cbc:ID></cac:PartyIdentification>
        <cac:PartyName><cbc:Name languageID="EST">Hankija AS</cbc:Name></cac:PartyName>
        <cac:PartyLegalEntity><cbc:CompanyID>10000001</cbc:CompanyID></cac:PartyLegalEntity></efac:Company></efac:Organization>
      <efac:Organization><efac:Company><cac:PartyIdentification><cbc:ID>ORG-0002</cbc:ID></cac:PartyIdentification>
        <cac:PartyName><cbc:Name languageID="EST">VELVET OÜ</cbc:Name></cac:PartyName>
        <cac:PartyLegalEntity><cbc:CompanyID>10000002</cbc:CompanyID></cac:PartyLegalEntity>
        <efbc:CompanySizeCode>small</efbc:CompanySizeCode></efac:Company></efac:Organization>
      </efac:Organizations>
      <efac:NoticeResult>
        <efac:LotResult><cbc:ID>RES-0000</cbc:ID>
          <cbc:TenderResultCode>selec-w</cbc:TenderResultCode>
          <efac:LotTender><cbc:ID>TEN-0001</cbc:ID></efac:LotTender>
          <efac:ReceivedSubmissionsStatistics><efbc:StatisticsNumeric>2</efbc:StatisticsNumeric></efac:ReceivedSubmissionsStatistics>
          <efac:TenderLot><cbc:ID>LOT-0001</cbc:ID></efac:TenderLot></efac:LotResult>
        <efac:LotResult><cbc:ID>RES-0001</cbc:ID>
          <cbc:TenderResultCode>selec-w</cbc:TenderResultCode>
          <efac:LotTender><cbc:ID>TEN-0002</cbc:ID></efac:LotTender>
          <efac:ReceivedSubmissionsStatistics><efbc:StatisticsNumeric>2</efbc:StatisticsNumeric></efac:ReceivedSubmissionsStatistics>
          <efac:TenderLot><cbc:ID>LOT-0002</cbc:ID></efac:TenderLot></efac:LotResult>
        <efac:LotTender><cbc:ID>TEN-0001</cbc:ID>
          <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="EUR">50000</cbc:PayableAmount></cac:LegalMonetaryTotal>
          <efac:TenderingParty><cbc:ID>TPA-0001</cbc:ID></efac:TenderingParty></efac:LotTender>
        <efac:LotTender><cbc:ID>TEN-0002</cbc:ID>
          <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="EUR">50000</cbc:PayableAmount></cac:LegalMonetaryTotal>
          <efac:TenderingParty><cbc:ID>TPA-0001</cbc:ID></efac:TenderingParty></efac:LotTender>
        <efac:TenderingParty><cbc:ID>TPA-0001</cbc:ID>
          <efac:Tenderer><cbc:ID>ORG-0002</cbc:ID></efac:Tenderer></efac:TenderingParty>
      </efac:NoticeResult></ext:UBLExtension></ext:UBLExtensions>
    </ContractAwardNotice></OPEN-DATA>`;
  const r = importMonthXml(db, '2026-08', kaks);
  assert.equal(r.rows, 2, 'sama voitja sama summaga KAHES osas annab KAKS rida');
  const read = db.prepare('SELECT lot, winner, amount FROM hanke_lepingud ORDER BY lot').all();
  assert.deepEqual(read.map((x) => x.lot), ['LOT-0001', 'LOT-0002']);
  assert.ok(read.every((x) => x.winner === 'VELVET OÜ' && x.amount === 50000));
  db.close();
  console.log('PASS ajalugu: teise osa rida ei kao unikaalindeksi taha');
}

// D3: DUBLIKAAT KUU SEES ON LOENDATUD, MITTE VAIKSELT NEELATUD. Moodetud paris
// jooksul (2026-06, 1180 teadet): INSERT OR IGNORE neelas 68 rida ja loendur utles
// ikka "2296 rida" - ehk sunkimislogi naitas rohkem, kui tabelis oli.
{
  const db = testDb();
  const tykk = XML.slice(XML.indexOf('<ContractAwardNotice'));
  const topelt = XML + tykk; // sama teade veel korra
  const r = importMonthXml(db, '2026-08', topelt);
  assert.equal(r.loend.teateid, 22, 'topeltfailis on 22 teadet');
  assert.ok(r.loend.duplikaate > 0, 'dublikaadid tuleb loendada');
  assert.equal(r.rows, db.prepare('SELECT COUNT(*) AS c FROM hanke_lepingud').get().c,
    'loendur peab naitama TABELISSE JOUDNUD ridu, mitte katsete arvu');
  assert.equal(db.prepare("SELECT rows FROM hanke_sync WHERE key='notice_award:2026-08'").get().rows, r.rows);
  assert.match(loendiTekst(r.loend), /dublikaat/i, 'dublikaadid peavad logis nahtavad olema');
  db.close();
  console.log('PASS ajalugu: dublikaat on loendatud, mitte vaikselt neelatud');
}

// ---------------------------------------------------------------------------
// E. 24 KUU AKEN. RANGE kuupaevakontroll, mitte stringivordlus.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const lisa = db.prepare("INSERT INTO hanke_lepingud (ref, lot, kuu, date, title) VALUES (?,?,?,?,?)");
  lisa.run('vana', 'LOT-0001', '2023-01', '2023-01-01', 'Vana leping');
  lisa.run('uus', 'LOT-0001', '2026-08', '2026-08-01', 'Uus leping');
  lisa.run('serv', 'LOT-0001', '2024-09', '2024-09-21', 'Akna servas');
  lisa.run('katki', 'LOT-0001', null, 'eile', 'Vigane kuupaev');
  lisa.run('olematu', 'LOT-0001', null, '2026-02-31', 'Olematu paev');
  lisa.run('paljas', 'LOT-0001', null, '2026', 'Paljas aasta');

  const r = kustutaVanemad(db, '2026-09-20', 24);
  assert.equal(r.kustutatud, 1, '24 kuust vanem rida kustub');
  assert.equal(r.vigaseid, 3, 'vigase kuupaevaga read LOENDATAKSE, mitte ei kustutata vaikselt');
  const alles = db.prepare('SELECT ref FROM hanke_lepingud ORDER BY ref').all().map((x) => x.ref);
  assert.deepEqual(alles, ['katki', 'olematu', 'paljas', 'serv', 'uus'],
    'vigase kuupaevaga rida EI TOHI vaikselt kustuda');
  assert.match(r.piir, /^\d{4}-\d{2}-\d{2}$/);
  assert.throws(() => kustutaVanemad(db, '20.09.2026', 24), /Vigane kuupäev/);
  assert.throws(() => kustutaVanemad(db, '2026-09-20', 0), /kuude arv/i);
  db.close();
  console.log('PASS ajalugu: 24 kuu aken ja range kuupaevakontroll');
}

// ---------------------------------------------------------------------------
// F. LOENDURID JA SUNKIMISLOGI. Iga mahavisatud asi on nahtav.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const r = importMonthXml(db, '2026-08', XML);
  const l = r.loend;
  assert.equal(l.teateid, 11);
  assert.ok(l.osi >= 11, 'osade arv on vahemalt teadete arv');
  assert.equal(l.read, r.rows);
  assert.ok(l.voitjata > 0, 'voitjata osad tuleb loendada (fikstuuris on neid)');
  assert.equal(typeof l.nisis, 'number');
  const rida = db.prepare("SELECT * FROM hanke_sync WHERE key = 'notice_award:2026-08'").get();
  assert.equal(rida.ok, 1);
  assert.equal(rida.rows, r.rows);
  assert.match(rida.note, /teadet/, 'sunkimislogi ridas on teadete arv');
  assert.match(rida.note, /võitjata/, 'voitjata osad peavad logis nahtavad olema');
  assert.match(rida.note, /Teenused/, 'liigid peavad logis nahtavad olema');
  db.close();
  console.log('PASS ajalugu: loendurid jouavad sunkimislogisse');
}

// ---------------------------------------------------------------------------
// G. KATKESTATAVUS: poolik jooks jatkub sealt, kus ta katkes.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  importMonthXml(db, '2026-07', XML);
  assert.throws(() => importMonthXml(db, '2026-08', '<html>502 Bad Gateway</html>'),
    /eForms|XML|ei andnud/i, 'katkine vastus peab andma eestikeelse vea');
  // Katkine kuu EI TOHI jouda tehtud kuude hulka - muidu jaaks ta igaveseks laadimata.
  assert.deepEqual(tehtudKuud(db), ['2026-07'], 'ainult onnestunud kuu loeb tehtuks');
  const vale = db.prepare("SELECT * FROM hanke_sync WHERE key = 'notice_award:2026-08'").get();
  assert.equal(vale.ok, 0, 'kukkunud kuu jatab PUNASE jalje');
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM hanke_lepingud WHERE kuu = '2026-08'").get().c, 0,
    'kukkunud kuu ei tohi poolikuid ridu jatta (tehing keeratakse tagasi)');

  // Jargmine jooks jatkab: 2026-07 jaab vahele, 2026-08 laetakse.
  const uus = importMonthXml(db, '2026-08', XML_TEINE);
  assert.equal(uus.vahelejäetud, false);
  assert.ok(uus.rows > 0);
  assert.deepEqual(tehtudKuud(db), ['2026-07', '2026-08']);
  db.close();
  console.log('PASS ajalugu: katkenud import jatkub, mitte ei alga otsast');
}

// G3: SAMA LEPING KAHES KUUFAILIS ON UKS LEPING. RHR-i kuufailid kattuvad servades
// (muutmisteade, parandus) ja ilma selleta kasvaks konkurendi "voitude arv" iga
// korduse pealt. Unikaalindeks EI SISALDA kuud just selleks - ja kordus on
// LOENDATUD, mitte vaikselt neelatud.
{
  const db = testDb();
  const a = importMonthXml(db, '2026-07', XML);
  const b = importMonthXml(db, '2026-08', XML);
  assert.equal(b.rows, 0, 'sama leping ei tule teist korda sisse');
  assert.equal(b.loend.duplikaate, a.rows, 'koik read on loendatud dublikaatideks');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanke_lepingud').get().c, a.rows);
  db.close();
  console.log('PASS ajalugu: sama leping kahes kuus on uks rida');
}

// G2: VIGANE SISEND ANNAB SELGE EESTIKEELSE VEA, mitte vaikset "0 rida".
{
  const db = testDb();
  for (const [sisu, silt] of [['', 'tuhi keha'], ['<html>vabandust</html>', 'HTML-veateade'],
    [null, 'mitte-string']]) {
    assert.throws(() => importMonthXml(db, '2026-08', sisu), /eForms|XML|ei andnud/i, silt);
  }
  // Teadetevaba, aga korrektne eForms-vastus EI OLE viga (tuhi kuu on voimalik),
  // aga ta peab olema NAHTAV.
  const r = importMonthXml(db, '2026-08', '<OPEN-DATA></OPEN-DATA>');
  assert.equal(r.rows, 0);
  assert.equal(r.loend.teateid, 0);
  const rida = db.prepare("SELECT * FROM hanke_sync WHERE key = 'notice_award:2026-08'").get();
  assert.equal(rida.ok, 0, 'null teadet kuus on kahtlane ja jaab punaseks');
  assert.throws(() => importMonthXml(db, '2026-8', XML), /kuu/i, 'vigane kuu kuju annab vea');
  db.close();
  console.log('PASS ajalugu: vigane sisend annab vea, mitte vaikse nulli');
}

// ---------------------------------------------------------------------------
// H. ARGUMENDID JA KUUDE NIMEKIRI.
// ---------------------------------------------------------------------------
{
  assert.deepEqual(kuudeNimekiri('2026-09-21', { kuud: 3 }), ['2026-06', '2026-07', '2026-08'],
    'kuud loetakse EELMISEST taielikust kuust tagasi, jooksvat kuud ei laeta');
  assert.deepEqual(kuudeNimekiri('2026-01-15', { kuud: 2 }), ['2025-11', '2025-12'],
    'aastavahetus ei tohi kuud nihutada');
  assert.deepEqual(kuudeNimekiri('2026-09-21', { alates: '2026-07' }), ['2026-07', '2026-08']);
  assert.deepEqual(kuudeNimekiri('2026-09-21', { alates: '2026-09' }), [], 'jooksev kuu ei ole taielik');

  const a = parseArgs(['--kuud=3']);
  assert.equal(a.kuud, 3);
  const suur = parseArgs(['--kuud=9999']);
  assert.equal(suur.kuud, MAX_KUUD, '--kuud=9999 piiratakse 24 kuuga, mitte pool gigabaiti paringuid');
  assert.ok(suur.hoiatus, 'piiramine peab jatma nahtava hoiatuse');
  assert.throws(() => parseArgs(['--kuud=abc']), /kuud/i);
  assert.throws(() => parseArgs(['--kuud=0']), /kuud/i);
  assert.throws(() => parseArgs(['--alates=2026-13']), /alates/i);
  assert.equal(parseArgs([]).kuud, MAX_KUUD, 'vaikevaartus on 24 kuu aken');
  assert.equal(kuudeNimekiri('2026-09-21', { kuud: MAX_KUUD }).length, MAX_KUUD);

  // Serveri nupp (ulesanne 10) saadab argumendid valideeriArgs-i kaudu.
  assert.deepEqual(valideeriArgs({ kuud: 1 }), { kuud: '1' });
  assert.deepEqual(valideeriArgs({ alates: '2025-01' }), { alates: '2025-01' });
  assert.match(awardUrl('2026-08'), /notice_award\/2026\/month\/8\/xml$/, 'kuu ei ole URL-is nulliga polsterdatud');
  assert.match(awardUrl('2026-12', 'http://127.0.0.1:1'), /^http:\/\/127\.0\.0\.1:1\//);
  console.log('PASS ajalugu: argumendid, piirid ja kuude nimekiri');
}

// H2: CMD.history muutub valmiks KETTALT, mitte kasitsi hoitavast lipust.
{
  assert.ok(existsSync(join(JUUR, 'agent/hanked-history.mjs')), 'skript peab kettal olema');
  assert.equal(cmdView(JUUR).history.valmis, true, 'nupp "Lae ajalugu" peab nuud valmis olema');
  console.log('PASS ajalugu: CMD.history on valmis');
}

// ---------------------------------------------------------------------------
// I. PARIS JOOKS LAPSPROTSESSINA kohaliku serveri vastu: progress, kuu kaupa
// tehing, mitte-200 vastus ja jooksurida.
// ---------------------------------------------------------------------------
async function jooksuta(kaitleja, argv, env = {}) {
  const server = createServer(kaitleja);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const dir = mkdtempSync(join(tmpdir(), 'ajalugu-jooks-'));
  const baas = join(dir, 'crm.sqlite');
  const laps = spawn(process.execPath, [join(JUUR, 'agent/hanked-history.mjs'), ...argv], {
    cwd: JUUR,
    env: { ...process.env, CRM_DB_PATH: baas, HANKED_AWARD_BASE: `http://127.0.0.1:${port}` },
    ...env,
  });
  let valja = '';
  laps.stdout.on('data', (t) => { valja += t; });
  laps.stderr.on('data', () => {});
  const kood = await new Promise((r) => laps.on('close', r));
  server.close();
  const read = valja.split('\n').filter(Boolean).map((r) => { try { return JSON.parse(r); } catch { return { toor: r }; } });
  return { kood, read, baas };
}

{
  let paringuid = 0;
  const r = await jooksuta((req, res) => {
    paringuid++;
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end(XML);
  }, ['--kuud=2', '--tana=2026-09-21']);

  assert.equal(r.kood, 0, 'onnestunud jooks annab koodi 0');
  assert.equal(paringuid, 2, 'kaks kuud = kaks paringut');
  const progressid = r.read.filter((x) => typeof x.progress === 'string').map((x) => x.progress);
  assert.ok(progressid.some((p) => /2026-07 · 1\/2/.test(p)),
    'progress peab utlema, mitmes kuu 24-st parasjagu kaib: ' + JSON.stringify(progressid));
  assert.ok(progressid.some((p) => /rida/.test(p)), 'progress peab naitama ridade arvu');
  const done = r.read.find((x) => x.done);
  assert.ok(done, 'lopus tuleb done-rida');
  assert.equal(done.kuud, 2);
  assert.ok(done.rows > 0);
  assert.ok(Number.isFinite(done.malu_mb), 'tipp-malukasutus peab olema mooedetud ja nahtav');

  const db = new DatabaseSync(r.baas);
  assert.deepEqual(tehtudKuud(db), ['2026-07', '2026-08']);
  const jooks = db.prepare("SELECT * FROM hanke_runs WHERE cmd = 'history' ORDER BY id DESC").get();
  assert.ok(jooks, 'otsekaivitus peab jatma jooksurea (Task Scheduler)');
  assert.equal(jooks.state, 'tehtud');
  assert.ok(String(jooks.boot_id).startsWith('otse:'));
  db.close();
  console.log('PASS ajalugu: paris jooks, progress, jooksurida');
}

// I2: MITTE-200 ei tohi anda vaikset "0 rida" ja peab jatma punase jalje.
{
  const r = await jooksuta((req, res) => { res.writeHead(502); res.end('<html>Bad Gateway</html>'); },
    ['--kuud=1', '--tana=2026-09-21']);
  assert.equal(r.kood, 1, 'koik kuud kukkusid -> valjumiskood 1');
  const viga = r.read.find((x) => x.error);
  assert.ok(viga && /502/.test(viga.error), 'veateade peab utlema, mida RHR vastas: ' + JSON.stringify(r.read));
  const db = new DatabaseSync(r.baas);
  assert.deepEqual(tehtudKuud(db), [], 'kukkunud kuu ei ole tehtud');
  assert.equal(db.prepare("SELECT ok FROM hanke_sync WHERE key = 'notice_award:2026-08'").get().ok, 0);
  const jooks = db.prepare("SELECT * FROM hanke_runs WHERE cmd = 'history' ORDER BY id DESC").get();
  assert.equal(jooks.state, 'viga', 'jooks ei tohi jaada igaveseks "kaib" seisu');
  db.close();
  console.log('PASS ajalugu: mitte-200 annab punase jalje, mitte vaikse nulli');
}

// I3: UKS KUKKUNUD KUU EI TOHI TERVET JOOKSU MAHA VOTTA.
{
  let n = 0;
  const r = await jooksuta((req, res) => {
    n++;
    if (n === 1) { res.writeHead(500); res.end('vabandust'); return; }
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end(XML);
  }, ['--kuud=2', '--tana=2026-09-21']);
  assert.equal(n, 2, 'teine kuu peab ikkagi proovitud saama');
  const done = r.read.find((x) => x.done);
  assert.ok(done, 'jooks peab loppema done-reaga ka siis, kui uks kuu kukkus');
  assert.equal(done.kukkus, 1);
  const db = new DatabaseSync(r.baas);
  assert.deepEqual(tehtudKuud(db), ['2026-08']);
  db.close();
  console.log('PASS ajalugu: uks kukkunud kuu ei vota jooksu maha');
}

console.log('\nKOIK AJALOO VARAVAD LABITUD');
