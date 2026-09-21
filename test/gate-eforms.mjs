// eForms-lugeja varav: teatepiir, voitjaahel, statistika, summa ja puuduvad valjad.
// Fikstuurid on INLINE ja vorku EI kasutata - varav peab jooksma ka ilma RHR-ita.
//
// Fikstuuride kuju on moodetud paris failist
// (riigihanked.riik.ee .../opendata/notice_award/2026/month/8/xml, 22 MB, 956 teadet),
// mitte valja moeldud: sissetaandused, schemeName-atribuudid, ajavoondiga IssueDate ja
// viiteplokid (efac:LotTender ILMA sisuta LotResult-i sees) on sealt kopeeritud.
import assert from 'node:assert/strict';
import { splitNotices, parseAward } from '../lib/eforms.mjs';

// ---------------------------------------------------------------------------
// 1. Plaani fikstuur: teatepiir ja pohivaljad.
// Lihtsustatud teade ILMA efac:NoticeResult-ita - nii kaib labi varutee
// (suuruskoodi heuristika ja plokis esimene PayableAmount).
// ---------------------------------------------------------------------------
const AWARD_FIXTURE = `<OPEN-DATA>
<ContractAwardNotice><cbc:IssueDate>2026-08-04</cbc:IssueDate>
<cac:ProcurementProject><cbc:ID>312679-0000</cbc:ID><cbc:Name languageID="EST">Disainisüsteemi edasiarendus</cbc:Name>
<cbc:ProcurementTypeCode listName="contract-nature">services</cbc:ProcurementTypeCode>
<cac:MainCommodityClassification><cbc:ItemClassificationCode listName="cpv">72413000</cbc:ItemClassificationCode></cac:MainCommodityClassification></cac:ProcurementProject>
<efac:Organization><efac:Company><cac:PartyName><cbc:Name languageID="EST">Tallinna Strateegiakeskus</cbc:Name></cac:PartyName><cbc:CompanyID>75014913</cbc:CompanyID></efac:Company></efac:Organization>
<efac:Organization><efac:Company><cac:PartyName><cbc:Name languageID="EST">VELVET OÜ</cbc:Name></cac:PartyName><cbc:CompanyID>11221221</cbc:CompanyID><efbc:CompanySizeCode>small</efbc:CompanySizeCode></efac:Company></efac:Organization>
<efac:ReceivedSubmissionsStatistics><efbc:StatisticsNumeric>16</efbc:StatisticsNumeric></efac:ReceivedSubmissionsStatistics>
<cbc:PayableAmount currencyID="EUR">50000.00</cbc:PayableAmount>
<cbc:Note languageID="EST">Tekstis esineb string &lt;/ContractAwardNotice&gt; nagu päris teadetes</cbc:Note>
</ContractAwardNotice>
<ContractAwardNotice><cbc:IssueDate>2026-08-05</cbc:IssueDate>
<cac:ProcurementProject><cbc:ID>300811-0000</cbc:ID><cbc:Name languageID="EST">Kontorimööbel</cbc:Name>
<cbc:ProcurementTypeCode listName="contract-nature">supplies</cbc:ProcurementTypeCode></cac:ProcurementProject>
</ContractAwardNotice></OPEN-DATA>`;

{
  const tykid = splitNotices(AWARD_FIXTURE, 'ContractAwardNotice');
  assert.equal(tykid.length, 2, 'tekstis olev lõputag ei tohi teadet pooleks lõigata');
  const a = parseAward(tykid[0]);
  assert.equal(a.ref, '312679');
  assert.equal(a.date, '2026-08-04');
  assert.equal(a.nature, 'services');
  assert.equal(a.cpv, '72413000');
  assert.equal(a.buyer, 'Tallinna Strateegiakeskus');
  assert.equal(a.winner, 'VELVET OÜ');
  assert.equal(a.winner_size, 'small');
  assert.equal(a.tenders, 16);
  assert.equal(a.amount, 50000);
  assert.equal(parseAward(tykid[1]).nature, 'supplies');
  console.log('PASS eforms: teadete piir ja väljad');
}

// P1: lihtsustatud teate voitja on OLETUS ja seda peab naha olema.
// Ulesanne 12 peab saama kahtlased read eraldi naidata.
{
  const a = parseAward(splitNotices(AWARD_FIXTURE, 'ContractAwardNotice')[0]);
  assert.equal(a.winner_allikas, 'suuruskood', 'suuruskoodi heuristika peab end nimetama');
  assert.equal(a.amount_allikas, 'payable-esimene', 'plokis esimene summa peab end nimetama');
  assert.equal(a.tenders_allikas, 'koodita-esimene', 'koodita statistika peab end nimetama');
  const b = parseAward(splitNotices(AWARD_FIXTURE, 'ContractAwardNotice')[1]);
  assert.equal(b.winner, null, 'ilma organisatsioonideta teatel ei ole võitjat');
  assert.equal(b.winner_allikas, null, 'olematu võitja ei kanna allikamärget');
  console.log('PASS eforms: oletuslik võitja kannab allikamärget');
}

// ---------------------------------------------------------------------------
// 2. splitNotices: valvatud sisend ja tagi tapsus.
// ---------------------------------------------------------------------------
{
  assert.deepEqual(splitNotices('', 'ContractAwardNotice'), [], 'tühi sisend annab tühja massiivi');
  assert.deepEqual(splitNotices(null, 'ContractAwardNotice'), [], 'null annab tühja massiivi');
  assert.deepEqual(splitNotices(undefined, 'ContractAwardNotice'), [], 'undefined annab tühja massiivi');
  assert.deepEqual(splitNotices(42, 'ContractAwardNotice'), [], 'mitte-string annab tühja massiivi');
  assert.deepEqual(splitNotices(AWARD_FIXTURE, 'ContractNotice'), [],
    'vasteta tag annab tühja massiivi, mitte erindit');
  assert.deepEqual(splitNotices(AWARD_FIXTURE, ''), [], 'tühi tag annab tühja massiivi');
  assert.deepEqual(splitNotices(AWARD_FIXTURE, '.*'), [],
    'regexi erimärk tagis ei tohi muutuda mustriks');
  // Prefiksitag ei tohi kaasa haarata: <ContractAwardNoticeX> ei ole ContractAwardNotice.
  assert.deepEqual(splitNotices('<ContractAwardNoticeX>a</ContractAwardNoticeX>', 'ContractAwardNotice'), [],
    'prefiksinimeline tag ei tohi vastata');
  // Atribuutidega avatag (paris RHR-is on seal xmlns-loend).
  const kaks = splitNotices('<A x="1">esimene</A>\n<A>teine</A></OPEN-DATA>', 'A');
  assert.equal(kaks.length, 2, 'atribuutidega avatag peab samuti piiri andma');
  assert.ok(kaks[1].includes('</OPEN-DATA>'),
    'viimane tükk kannab juurelemendi lõputagi - see on teadlik ja tohutu');
  console.log('PASS eforms: splitNotices valvab sisendit ja tagi täpsust');
}

// ---------------------------------------------------------------------------
// 3. Paris eForms-i kuju: voitja tuleb TenderingParty-ahelast, mitte suuruskoodist.
// Loks: HANKIJAL on CompanySizeCode ja esimene pakkuja on KAOTAJA.
// Naiivne orgs.find(o => o.size) annaks hankija, orgs[1] annaks kaotaja.
// ---------------------------------------------------------------------------
const ORGID = `<efac:Organizations>
  <efac:Organization><efac:Company>
    <cac:PartyIdentification><cbc:ID schemeName="organization">ORG-0001</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name languageID="EST">Tallinna Strateegiakeskus</cbc:Name></cac:PartyName>
    <cac:PartyLegalEntity><cbc:CompanyID>75014913</cbc:CompanyID></cac:PartyLegalEntity>
    <efbc:CompanySizeCode>large</efbc:CompanySizeCode>
  </efac:Company></efac:Organization>
  <efac:Organization><efac:Company>
    <cac:PartyIdentification><cbc:ID schemeName="organization">ORG-0002</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name languageID="ENG">Loser Ltd</cbc:Name><cbc:Name languageID="EST">KAOTAJA OÜ</cbc:Name></cac:PartyName>
    <cac:PartyLegalEntity><cbc:CompanyID>10000002</cbc:CompanyID></cac:PartyLegalEntity>
    <efbc:CompanySizeCode>micro</efbc:CompanySizeCode>
  </efac:Company></efac:Organization>
  <efac:Organization><efac:Company>
    <cac:PartyIdentification><cbc:ID schemeName="organization">ORG-0003</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name languageID="EST">V&amp;V Digi OÜ</cbc:Name></cac:PartyName>
    <cac:PartyLegalEntity><cbc:CompanyID>10000003</cbc:CompanyID></cac:PartyLegalEntity>
    <efbc:CompanySizeCode>small</efbc:CompanySizeCode>
  </efac:Company></efac:Organization>
</efac:Organizations>`;

const SABA = `<cac:ContractingParty><cac:Party><cac:PartyIdentification><cbc:ID schemeName="organization">ORG-0001</cbc:ID></cac:PartyIdentification></cac:Party></cac:ContractingParty>
<cac:TenderingProcess><cbc:ProcedureCode listName="procurement-procedure-type">open</cbc:ProcedureCode></cac:TenderingProcess>
<cac:ProcurementProject><cbc:ID>309481-0000</cbc:ID><cbc:Name languageID="ENG">Website development</cbc:Name><cbc:Name languageID="EST">Veebilehe arendus</cbc:Name>
<cbc:ProcurementTypeCode listName="contract-nature">services</cbc:ProcurementTypeCode>
<cac:MainCommodityClassification><cbc:ItemClassificationCode listName="cpv">72413000</cbc:ItemClassificationCode></cac:MainCommodityClassification></cac:ProcurementProject>
<cac:ProcurementProjectLot><cbc:ID schemeName="Lot">LOT-0000</cbc:ID>
<cac:ProcurementProject><cbc:ID>309481-0001</cbc:ID><cbc:Name languageID="EST">Osa 1</cbc:Name>
<cac:MainCommodityClassification><cbc:ItemClassificationCode listName="cpv">79822500</cbc:ItemClassificationCode></cac:MainCommodityClassification></cac:ProcurementProject></cac:ProcurementProjectLot>
</ContractAwardNotice>`;

const teade = (noticeResult) => `<OPEN-DATA><ContractAwardNotice xmlns="urn:oasis:names:specification:ubl:schema:xsd:ContractAwardNotice-2" xmlns:cac="urn:x">
<cbc:ID schemeName="notice-id">1f6a0b9e-0000-4000-8000-000000000001</cbc:ID>
<cbc:ContractFolderID>e2eae7d1-1c04-4352-a9d6-dea1c4f0d016</cbc:ContractFolderID>
<cbc:IssueDate>2026-07-12+03:00</cbc:IssueDate>
<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><efext:EformsExtension>
${noticeResult}
${ORGID}
</efext:EformsExtension></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
${SABA}</OPEN-DATA>`;

const VOITJA_TEADE = teade(`<efac:NoticeResult>
  <cbc:TotalAmount currencyID="EUR">26000.00</cbc:TotalAmount>
  <efac:LotResult>
    <cbc:ID schemeName="result">RES-0000</cbc:ID>
    <cbc:TenderResultCode listName="winner-selection-status">selec-w</cbc:TenderResultCode>
    <efac:LotTender>
<cbc:ID schemeName="tender">TEN-0001</cbc:ID>
    </efac:LotTender>
    <efac:ReceivedSubmissionsStatistics>

<efbc:StatisticsNumeric>7</efbc:StatisticsNumeric>
    </efac:ReceivedSubmissionsStatistics>
    <efac:ReceivedSubmissionsStatistics>

<efbc:StatisticsNumeric>5</efbc:StatisticsNumeric>
    </efac:ReceivedSubmissionsStatistics>
    <efac:ReceivedSubmissionsStatistics>

<efbc:StatisticsNumeric>7</efbc:StatisticsNumeric>
    </efac:ReceivedSubmissionsStatistics>
    <efac:TenderLot><cbc:ID schemeName="Lot">LOT-0000</cbc:ID></efac:TenderLot>
  </efac:LotResult>
  <efac:LotTender>
    <cbc:ID schemeName="tender">TEN-0001</cbc:ID>
    <cac:LegalMonetaryTotal>
<cbc:PayableAmount currencyID="EUR">26000.00</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
    <efac:TenderingParty>
<cbc:ID schemeName="tendering-party">TPA-0001</cbc:ID>
    </efac:TenderingParty>
    <efac:TenderLot><cbc:ID schemeName="Lot">LOT-0000</cbc:ID></efac:TenderLot>
  </efac:LotTender>
  <efac:LotTender>
    <cbc:ID schemeName="tender">TEN-0002</cbc:ID>
    <cac:LegalMonetaryTotal>
<cbc:PayableAmount currencyID="EUR">99000.00</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
    <efac:TenderingParty>
<cbc:ID schemeName="tendering-party">TPA-0002</cbc:ID>
    </efac:TenderingParty>
  </efac:LotTender>
  <efac:TenderingParty>
    <cbc:ID schemeName="tendering-party">TPA-0001</cbc:ID>
    <efac:Tenderer><cbc:ID schemeName="organization">ORG-0003</cbc:ID></efac:Tenderer>
  </efac:TenderingParty>
  <efac:TenderingParty>
    <cbc:ID schemeName="tendering-party">TPA-0002</cbc:ID>
    <efac:Tenderer><cbc:ID schemeName="organization">ORG-0002</cbc:ID></efac:Tenderer>
  </efac:TenderingParty>
</efac:NoticeResult>`);

{
  const tykid = splitNotices(VOITJA_TEADE, 'ContractAwardNotice');
  assert.equal(tykid.length, 1);
  const a = parseAward(tykid[0]);
  assert.equal(a.winner, 'V&V Digi OÜ', 'võitja tuleb LotResult -> LotTender -> TenderingParty ahelast');
  assert.equal(a.winner_reg, '10000003');
  assert.equal(a.winner_size, 'small');
  assert.equal(a.winner_allikas, 'tendering-party', 'mõõdetud ahel peab end nimetama');
  assert.equal(a.winner_arv, 1, 'üks võitja');
  assert.deepEqual(a.winners, ['V&V Digi OÜ']);
  assert.equal(a.buyer, 'Tallinna Strateegiakeskus', 'hankija tuleb ContractingParty viitest');
  assert.equal(a.buyer_reg, '75014913');
  assert.equal(a.tulemus, 'selec-w');
  assert.equal(a.menetlus, 'open');
  assert.equal(a.date, '2026-07-12', 'ajavööndiga IssueDate lõigatakse kuupäevaks');
  assert.equal(a.ref, '309481');
  assert.equal(a.cpv, '72413000', 'CPV tuleb teate tasemelt, mitte osast');
  assert.equal(a.title, 'Veebilehe arendus', 'EST-nimi võidab ENG-nime üle');
  assert.equal(a.folder, 'e2eae7d1-1c04-4352-a9d6-dea1c4f0d016');
  console.log('PASS eforms: võitja tuleb pakkujaahelast, mitte suuruskoodist');
}

// P2: & nimes tuleb olemina ja peab dekodeeruma (paris failis 33 sellist nime).
{
  const a = parseAward(splitNotices(VOITJA_TEADE, 'ContractAwardNotice')[0]);
  assert.ok(!a.winner.includes('&amp;'), 'HTML-olem ei tohi nimme jääda: ' + a.winner);
  assert.equal(a.winner, 'V&V Digi OÜ');
  console.log('PASS eforms: olemid dekodeeritakse nimedes');
}

// P3: CDATA ja numbriolem. Kumbki ei tohi valja tuhjaks teha.
{
  const x = `<ContractAwardNotice><cbc:IssueDate>2026-08-04</cbc:IssueDate>
<cac:ProcurementProject><cbc:ID>400111-0000</cbc:ID>
<cbc:Name languageID="EST"><![CDATA[Kodulehe "Uuendus" &amp; hooldus]]></cbc:Name></cac:ProcurementProject></ContractAwardNotice>`;
  const a = parseAward(x);
  assert.equal(a.title, 'Kodulehe "Uuendus" & hooldus', 'CDATA koorub ja olem dekodeeritakse');
  const y = x.replace('<![CDATA[Kodulehe "Uuendus" &amp; hooldus]]>', 'T&#228;nav &#x26; tee');
  assert.equal(parseAward(y).title, 'Tänav & tee', 'numbriolemid dekodeeritakse');
  console.log('PASS eforms: CDATA ja numbriolemid');
}

// ---------------------------------------------------------------------------
// 4. Tulemuseta teade (clos-nw): voitjat EI TOHI valja motelda.
// Paris augustikuu failis on selliseid 200 LotResult-i / 156 teadet.
// ---------------------------------------------------------------------------
{
  const x = teade(`<efac:NoticeResult>
  <efac:LotResult>
    <cbc:ID schemeName="result">RES-0000</cbc:ID>
    <cbc:TenderResultCode listName="winner-selection-status">clos-nw</cbc:TenderResultCode>
    <efac:TenderLot><cbc:ID schemeName="Lot">LOT-0000</cbc:ID></efac:TenderLot>
  </efac:LotResult>
</efac:NoticeResult>`);
  const a = parseAward(splitNotices(x, 'ContractAwardNotice')[0]);
  assert.equal(a.winner, null, 'tulemuseta teatel ei ole võitjat - suuruskoodi varutee EI tohi käivituda');
  assert.equal(a.winner_reg, null);
  assert.equal(a.winner_size, null);
  assert.equal(a.winner_allikas, null);
  assert.equal(a.winner_arv, 0);
  assert.equal(a.tulemus, 'clos-nw');
  assert.equal(a.amount, null, 'tulemuseta teatel ei ole summat');
  assert.equal(a.tenders, null, 'tulemuseta teatel ei ole pakkujate arvu');
  console.log('PASS eforms: tulemuseta teade ei saa väljamõeldud võitjat');
}

// P4: mitu voitjat (raamleping / mitu osa) - paris failis 112 teadet.
{
  const x = VOITJA_TEADE.replace(
    '<efac:LotTender>\n<cbc:ID schemeName="tender">TEN-0001</cbc:ID>\n    </efac:LotTender>',
    '<efac:LotTender>\n<cbc:ID schemeName="tender">TEN-0001</cbc:ID>\n    </efac:LotTender>\n    <efac:LotTender>\n<cbc:ID schemeName="tender">TEN-0002</cbc:ID>\n    </efac:LotTender>');
  const a = parseAward(splitNotices(x, 'ContractAwardNotice')[0]);
  assert.equal(a.winner_arv, 2, 'kaks võitjat peab olema loendatud');
  assert.deepEqual(a.winners, ['V&V Digi OÜ', 'KAOTAJA OÜ']);
  assert.equal(a.winner, 'V&V Digi OÜ', 'winner on esimene võitja, winners kannab kõiki');
  console.log('PASS eforms: mitme võitjaga teade loendatakse');
}

// P6: teate OMA valjad tulevad teate tasemelt, MITTE ext:UBLExtensions'i seest.
// Moodetud paris failis: efac:Organizations ja efac:SettledContract on plokis EES
// ja kannavad omaenda <cbc:ID>-d ja <cbc:IssueDate>-t. Ilma skoobita andis lugeja
// notice_id'ks 'RES-0000'/'ORG-0001' (956 teadet 956-st vale) ja kuupaevaks LEPINGU
// solmimise kuupaeva (591 teadet 956-st vale) - viimane oleks ulesande 12
// 24 kuu akna vaikselt nihutanud.
{
  const x = `<ContractAwardNotice>
<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><efext:EformsExtension>
<efac:NoticeResult>
  <efac:SettledContract><cbc:ID schemeName="contract">CON-0001</cbc:ID><cbc:IssueDate>2026-06-01+03:00</cbc:IssueDate></efac:SettledContract>
  <efac:LotResult><cbc:ID schemeName="result">RES-0000</cbc:ID><cbc:TenderResultCode listName="winner-selection-status">clos-nw</cbc:TenderResultCode></efac:LotResult>
</efac:NoticeResult>
<efac:Organizations><efac:Organization><efac:Company>
  <cac:PartyIdentification><cbc:ID schemeName="organization">ORG-0001</cbc:ID></cac:PartyIdentification>
  <cac:PartyName><cbc:Name languageID="EST">Tartu Rakenduslik Kolledž</cbc:Name></cac:PartyName>
  <cac:PartyLegalEntity><cbc:CompanyID>75024308</cbc:CompanyID></cac:PartyLegalEntity>
</efac:Company></efac:Organization></efac:Organizations>
</efext:EformsExtension></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
<cbc:ID schemeName="notice-id">a460885c-bb84-4baf-b8dc-28f0aee04b8b</cbc:ID>
<cbc:ContractFolderID>e125a172-22cb-489c-a2de-24d6d7445573</cbc:ContractFolderID>
<cbc:IssueDate>2026-08-12+03:00</cbc:IssueDate>
<cac:ContractingParty><cac:Party><cac:PartyIdentification><cbc:ID schemeName="organization">ORG-0001</cbc:ID></cac:PartyIdentification></cac:Party></cac:ContractingParty>
<cac:ProcurementProject><cbc:ID>306939-0000</cbc:ID><cbc:Name languageID="EST">Robootika simulaatorid</cbc:Name></cac:ProcurementProject>
</ContractAwardNotice>`;
  const a = parseAward(x);
  assert.equal(a.notice_id, 'a460885c-bb84-4baf-b8dc-28f0aee04b8b',
    'notice_id tuleb teate tasemelt, mitte laienduse sees olevast cbc:ID-st');
  assert.equal(a.date, '2026-08-12', 'date on TEATE kuupäev, mitte lepingu sõlmimise kuupäev');
  assert.equal(a.folder, 'e125a172-22cb-489c-a2de-24d6d7445573');
  assert.equal(a.ref, '306939');
  console.log('PASS eforms: teate väljad ei tule laienduse seest');
}

// P7: tulemuseta teade (can-standard, SubTypeCode 29) ILMA efac:NoticeResult-ita.
// Paris failis on selliseid 6. Organisatsioonide hulgas on ALATI ka Riigihangete
// vaidlustuskomisjon ja Riigihangete register - plaani naidiskoodi varutee
// `orgs.find(o => o.size) || orgs[1]` andis kuuel teatel voitjaks
// VAIDLUSTUSKOMISJONI. Varutee tohib kaivituda AINULT siis, kui plokis on paris
// jalg voitjast: suuruskood mone organisatsiooni peal, kes ei ole hankija.
{
  const x = `<ContractAwardNotice>
<ext:UBLExtensions><efext:EformsExtension>
<cbc:NoticeTypeCode listName="result">can-standard</cbc:NoticeTypeCode>
<efac:Organizations>
<efac:Organization><efac:Company><cac:PartyIdentification><cbc:ID schemeName="organization">ORG-0001</cbc:ID></cac:PartyIdentification>
<cac:PartyName><cbc:Name languageID="EST">Aktsiaselts Tallinna Arendused</cbc:Name></cac:PartyName>
<cac:PartyLegalEntity><cbc:CompanyID>11066456</cbc:CompanyID></cac:PartyLegalEntity></efac:Company></efac:Organization>
<efac:Organization><efac:Company><cac:PartyIdentification><cbc:ID schemeName="organization">ORG-0002</cbc:ID></cac:PartyIdentification>
<cac:PartyName><cbc:Name languageID="EST">Riigihangete vaidlustuskomisjon</cbc:Name></cac:PartyName>
<cac:PartyLegalEntity><cbc:CompanyID>1000123</cbc:CompanyID></cac:PartyLegalEntity></efac:Company></efac:Organization>
<efac:Organization><efac:Company><cac:PartyIdentification><cbc:ID schemeName="organization">ORG-0003</cbc:ID></cac:PartyIdentification>
<cac:PartyName><cbc:Name languageID="EST">Riigihangete register</cbc:Name></cac:PartyName>
<cac:PartyLegalEntity><cbc:CompanyID>TED64</cbc:CompanyID></cac:PartyLegalEntity></efac:Company></efac:Organization>
</efac:Organizations></efext:EformsExtension></ext:UBLExtensions>
<cbc:IssueDate>2026-08-12+03:00</cbc:IssueDate>
<cac:ContractingParty><cac:Party><cac:PartyIdentification><cbc:ID schemeName="organization">ORG-0001</cbc:ID></cac:PartyIdentification></cac:Party></cac:ContractingParty>
<cac:ProcurementProject><cbc:ID>291820-0000</cbc:ID><cbc:Name languageID="EST">Turu koristuse hange</cbc:Name></cac:ProcurementProject>
</ContractAwardNotice>`;
  const a = parseAward(x);
  assert.equal(a.buyer, 'Aktsiaselts Tallinna Arendused');
  assert.equal(a.winner, null, 'vaidlustuskomisjon EI OLE võitja - ilma suuruskoodita ei tohi varutee käivituda');
  assert.equal(a.winner_allikas, null);
  assert.equal(a.winner_arv, 0);
  console.log('PASS eforms: tulemuseta can-standard ei saa väljamõeldud võitjat');
}

// P8: mitme osaga teade, kus osad said ERI tulemuse. Uks kood teate kohta oleks vale
// (paris failis on 1 teade, kus esimese osa kood on clos-nw ja voitja siiski olemas).
{
  const x = VOITJA_TEADE.replace('<cbc:TenderResultCode listName="winner-selection-status">selec-w</cbc:TenderResultCode>',
    `<cbc:TenderResultCode listName="winner-selection-status">selec-w</cbc:TenderResultCode>
  </efac:LotResult>
  <efac:LotResult>
    <cbc:ID schemeName="result">RES-0001</cbc:ID>
    <cbc:TenderResultCode listName="winner-selection-status">clos-nw</cbc:TenderResultCode>`);
  const a = parseAward(splitNotices(x, 'ContractAwardNotice')[0]);
  assert.equal(a.tulemus, 'segu', 'eri tulemusega osad annavad "segu", mitte esimese osa koodi');
  assert.equal(a.winner, 'V&V Digi OÜ', 'võitnud osa võitja jääb alles');
  assert.equal(a.osi, 2, 'osade arv peab olema nähtav');
  console.log('PASS eforms: eri tulemusega osad märgitakse seguks');
}

// ---------------------------------------------------------------------------
// 5. Statistika: RHR EI anna efbc:StatisticsCode'i, seega maksimum on vale.
// Moodetud augustis: 1290 LotResult-ist 126-l on erinevad vaartused ja kahel
// neist on MAKSIMUM vale (mustrid (3,3,3,29) ja (1,1,1,24) - 29 ja 24 on
// osalemistaotlused, mitte pakkumused).
// ---------------------------------------------------------------------------
{
  const a = parseAward(splitNotices(VOITJA_TEADE, 'ContractAwardNotice')[0]);
  assert.equal(a.tenders, 7, 'koodita statistikast võetakse ESIMENE, mitte maksimum');
  assert.equal(a.tenders_allikas, 'koodita-esimene');
  assert.equal(a.osi, 1, 'ühe osaga teade');

  // Mitme osaga teatel kirjeldab `tenders` ESIMEST osa - `osi` teeb selle nähtavaks.
  // Paris naide: 309730, kolm osa, 10 / 7 / 7 pakkumust.
  const mitu = VOITJA_TEADE.replace('<efac:TenderLot><cbc:ID schemeName="Lot">LOT-0000</cbc:ID></efac:TenderLot>\n  </efac:LotResult>',
    `<efac:TenderLot><cbc:ID schemeName="Lot">LOT-0000</cbc:ID></efac:TenderLot>
  </efac:LotResult>
  <efac:LotResult>
    <cbc:ID schemeName="result">RES-0001</cbc:ID>
    <cbc:TenderResultCode listName="winner-selection-status">selec-w</cbc:TenderResultCode>
    <efac:LotTender><cbc:ID schemeName="tender">TEN-0002</cbc:ID></efac:LotTender>
    <efac:ReceivedSubmissionsStatistics><efbc:StatisticsNumeric>3</efbc:StatisticsNumeric></efac:ReceivedSubmissionsStatistics>
  </efac:LotResult>`);
  const m = parseAward(splitNotices(mitu, 'ContractAwardNotice')[0]);
  assert.equal(m.osi, 2, 'kaks tulemusega osa');
  assert.equal(m.tenders, 7, 'tenders kirjeldab esimest osa');
  assert.equal(m.winner_arv, 2, 'mõlema osa võitja on loendatud');

  const paha = VOITJA_TEADE.replace('<efbc:StatisticsNumeric>5</efbc:StatisticsNumeric>',
    '<efbc:StatisticsNumeric>29</efbc:StatisticsNumeric>');
  const b = parseAward(splitNotices(paha, 'ContractAwardNotice')[0]);
  assert.equal(b.tenders, 7, 'osalemistaotluste arv (29) ei tohi pakkumuste arvuks saada');

  // Kui kood ON olemas (eForms standard), siis filtreeritakse KOODI jargi.
  const koodiga = VOITJA_TEADE
    .replace('<efbc:StatisticsNumeric>7</efbc:StatisticsNumeric>',
      '<efbc:StatisticsCode listName="received-submission-type">t-sme</efbc:StatisticsCode><efbc:StatisticsNumeric>2</efbc:StatisticsNumeric>')
    .replace('<efbc:StatisticsNumeric>5</efbc:StatisticsNumeric>',
      '<efbc:StatisticsCode listName="received-submission-type">tenders</efbc:StatisticsCode><efbc:StatisticsNumeric>11</efbc:StatisticsNumeric>');
  const c = parseAward(splitNotices(koodiga, 'ContractAwardNotice')[0]);
  assert.equal(c.tenders, 11, 'koodiga statistikast võetakse liik "tenders", mitte esimene');
  assert.equal(c.tenders_allikas, 'kood');
  console.log('PASS eforms: statistika liik, mitte maksimum');
}

// ---------------------------------------------------------------------------
// 6. Summa: teate kogusumma, mitu osa ja mitte-EUR valuuta.
// ---------------------------------------------------------------------------
{
  const a = parseAward(splitNotices(VOITJA_TEADE, 'ContractAwardNotice')[0]);
  assert.equal(a.amount, 26000, 'NoticeResult/TotalAmount on teate lepingu maksumus');
  assert.equal(a.currency, 'EUR');
  assert.equal(a.amount_allikas, 'total-amount');

  // Ilma TotalAmount-ita liidetakse VOITNUD pakkumuste summad (mitte koik PayableAmount).
  // Kaotaja TEN-0002 summa 99000 ei tohi kaasa minna.
  const ilma = VOITJA_TEADE.replace('<cbc:TotalAmount currencyID="EUR">26000.00</cbc:TotalAmount>', '');
  const b = parseAward(splitNotices(ilma, 'ContractAwardNotice')[0]);
  assert.equal(b.amount, 26000, 'ilma kogusummata liidetakse ainult võitnud pakkumused');
  assert.equal(b.amount_allikas, 'voitnud-pakkumused');

  // Sendid ei tohi kaduda: 1234.56 EI ole 1235.
  const sent = VOITJA_TEADE.replace('<cbc:TotalAmount currencyID="EUR">26000.00</cbc:TotalAmount>',
    '<cbc:TotalAmount currencyID="EUR">1234.56</cbc:TotalAmount>');
  assert.equal(parseAward(splitNotices(sent, 'ContractAwardNotice')[0]).amount, 1234.56,
    'summa ei tohi ümardudes sente kaotada');

  // Mitte-EUR: vaikne eurodesse kirjutamine on keelatud.
  const sek = VOITJA_TEADE.replace('<cbc:TotalAmount currencyID="EUR">26000.00</cbc:TotalAmount>',
    '<cbc:TotalAmount currencyID="SEK">300000.00</cbc:TotalAmount>');
  const d = parseAward(splitNotices(sek, 'ContractAwardNotice')[0]);
  assert.equal(d.amount, null, 'mitte-EUR summa ei tohi euroveergu jõuda');
  assert.equal(d.currency, 'SEK');
  assert.equal(d.amount_valuutas, 300000, 'algne arv jääb nähtavaks');
  console.log('PASS eforms: summa allikas, sendid ja mitte-EUR valuuta');
}

// ---------------------------------------------------------------------------
// 7. Miinimumteade: iga puuduv vali on null, mitte '' ega NaN.
// ---------------------------------------------------------------------------
{
  const a = parseAward('<ContractAwardNotice><cbc:IssueDate>2026-08-04</cbc:IssueDate></ContractAwardNotice>');
  assert.equal(a.date, '2026-08-04', 'ainus olemasolev väli loetakse');
  for (const [k, v] of Object.entries(a)) {
    if (k === 'date') continue;
    if (k === 'winners') { assert.deepEqual(v, [], 'winners on tühi massiiv'); continue; }
    // ÜLESANNE 12: `lots` on osade massiiv. Tühi massiiv tähendab "sellel teatel ei
    // ole NoticeResult-i" — importija teeb siis teate tasemel ühe rea. NULL oleks
    // siin vale kuju: lugeja peab saama ilma tüübikontrollita üle käia.
    if (k === 'lots') { assert.deepEqual(v, [], 'lots on tühi massiiv'); continue; }
    if (k === 'winner_arv') { assert.equal(v, 0, 'winner_arv on 0'); continue; }
    assert.equal(v, null, `puuduv väli ${k} peab olema null, mitte ${JSON.stringify(v)}`);
    assert.ok(!Number.isNaN(v), `puuduv väli ${k} ei tohi olla NaN`);
  }
  // Tuhjad sildid on samuti "ei tea", mitte tuhi string.
  const b = parseAward(`<ContractAwardNotice><cbc:IssueDate></cbc:IssueDate>
<cac:ProcurementProject><cbc:ID>   </cbc:ID><cbc:Name languageID="EST"/></cac:ProcurementProject>
<cbc:PayableAmount currencyID="EUR">kokkuleppel</cbc:PayableAmount></ContractAwardNotice>`);
  assert.equal(b.date, null, 'tühi IssueDate on null');
  assert.equal(b.ref, null, 'tühikutest koosnev ID on null');
  assert.equal(b.title, null, 'ise sulguv Name on null');
  assert.equal(b.amount, null, 'loetamatu summa on null, mitte NaN');
  assert.ok(!Number.isNaN(b.amount), 'loetamatu summa ei tohi olla NaN');
  console.log('PASS eforms: puuduv väli on null, mitte tühi string ega NaN');
}

// P5: parseAward ei tohi valise sisendi peale erindit visata - ulesanne 12 kaib
// kuu jagu teateid labi ja uks katkine plokk ei tohi importi maha votta.
{
  for (const sisend of [null, undefined, '', 42, '<ContractAwardNotice>', 'lihtsalt teksti']) {
    const a = parseAward(sisend);
    assert.equal(typeof a, 'object', 'parseAward peab alati objekti tagastama');
    assert.equal(a.ref, null);
    assert.equal(a.winner, null);
  }
  console.log('PASS eforms: vigane sisend ei võta jooksu maha');
}

// ---------------------------------------------------------------------------
// 8. Jouduluse varav. Kuu jagu lepinguteateid on kumneid megabaite ja laisad
// [\s\S]*? mustrid suure ploki peal on tapselt see koht, kus ReDoS ja
// ruutkeerukus end naitavad. Piir on helde (CI masin voib olla aeglane), aga
// MITTE olematu: ruutkeerukus ei mahu siia ara.
// ---------------------------------------------------------------------------
{
  const yks = VOITJA_TEADE.replace('<OPEN-DATA>', '').replace('</OPEN-DATA>', '');
  const kordi = Math.ceil((5 * 1024 * 1024) / yks.length);
  const suur = '<OPEN-DATA>' + yks.repeat(kordi) + '</OPEN-DATA>';
  const mb = suur.length / 1048576;
  const t0 = process.hrtime.bigint();
  const tykid = splitNotices(suur, 'ContractAwardNotice');
  let n = 0;
  for (const b of tykid) if (parseAward(b).winner) n++;
  const sek = Number(process.hrtime.bigint() - t0) / 1e9;
  assert.equal(tykid.length, kordi, 'kõik teated peavad tükeldumisest läbi tulema');
  assert.equal(n, kordi, 'kõik teated peavad võitja saama');
  console.log(`     ${mb.toFixed(1)} MB / ${kordi} teadet: ${sek.toFixed(2)}s `
    + `(${(mb / sek).toFixed(1)} MB/s)`);
  assert.ok(sek < 20, `5 MB peab läbi saama alla 20 s, kulus ${sek.toFixed(2)}s`);
  console.log('PASS eforms: 5 MB läbib jõudluspiiri');
}
