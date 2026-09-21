#!/usr/bin/env node
// PARITEEDIVÄRAV — lukustab Node'i väljundi PÄRIS RHR-i andmete peal.
//
// MIKS SEE FAIL OLEMAS ON
// Kaks Node-funktsiooni peavad jääma sünkroonis Pythoni õendfailidega, mis on päris
// RHR-i andmete peal juba jooksnud:
//   lib/hanked.mjs  segmentOf(title, kirjeldus)  <-> riigihanked/rhr_tools/rhr_watch.py
//   lib/eforms.mjs  parseAward(blk)              <-> riigihanked/rhr_tools/rhr_parse.py
// Mõlemal korral leiti triiv ALLES SIIS, kui keegi võrdles käsitsi: ülesandes 3 andis
// Node 3 leidu seal, kus Python andis 6 (segmentOf vaatas ainult pealkirja), ja
// ülesandes 6 oleks plaani võitjaheuristika andnud 29 % vale võitjaga ridu.
// Kolmandat korda käsitsi ei võrrelda — see värav teeb selle võimatuks.
//
// SEE VÄRAV EI VAJA VÕRKU EGA PYTHONIT. Fikstuur on kommititud päris XML
// (test/fixtures/eforms-2026-08-naidis.xml, lõige RHR-i 2026-08 lepinguteadete
// avaandmetest) ja ootused on kommititud JSON. Vabatahtlik ristkontroll päris
// Pythoni vastu on eraldi: tools/pariteet-python.mjs (npm run pariteet:python).
//
// Kui väljund muutub TAHTLIKULT: npm run pariteet:uuenda.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { splitNotices, parseAward } from '../lib/eforms.mjs';
import { segmentOf, FIT, EXCL, SMALLWEB } from '../lib/hanked.mjs';
import {
  JUUR, REPO, FIKSTUUR, OOTUS_EFORMS, OOTUS_SEGMENT, OENDFAILID,
  harud, laienda,
} from '../tools/pariteet-uuenda.mjs';

const JUHEND_EFORMS = '`parseAward` väljund lahkneb kommititud fikstuurist.'
  + ' Kui muudatus on tahtlik, uuenda ootusfaili käsuga `npm run pariteet:uuenda`'
  + ' ja kirjuta commiti sõnumisse, MIKS väljund muutus.';
const JUHEND_SEGMENT = '`segmentOf` väljund lahkneb kommititud fikstuurist.'
  + ' Kui muudatus on tahtlik, uuenda ootusfaili käsuga `npm run pariteet:uuenda`'
  + ' ja kirjuta commiti sõnumisse, MIKS väljund muutus.';

// ---------------------------------------------------------------------------
// 0. ÕENDFAILIDE VALVE.
//
// Kui rhr_watch.py või rhr_parse.py on kadunud või ümber nimetatud, kaob pariteedi
// mõte vaikselt. Aga: riigihanked/ ON .gitignore'is (vt repo juure .gitignore), seega
// CI-s ja igas värskes worktree's seda kausta LIHTSALT EI OLE. Puudumine ei tohi
// seetõttu olla punane — see oleks igapäevane müra, mis õpetab väravat eirama.
// Kaks eri seisu:
//   - kaust puudub JA on .gitignore'is   -> HOIATUS, värav jookseb edasi;
//   - kaust on olemas, aga FAIL puudub   -> PUNANE (keegi nimetas ümber või kustutas).
// ---------------------------------------------------------------------------
{
  // Worktree ei kanna .gitignore'itud kausta kaasa, aga peakoopias ta on. Vaatame
  // mõlemasse — ja ütleme välja, kust leiti, et vaikset valet ei tekiks.
  const juured = [process.env.RHR_JUUR, REPO, join(REPO, '..', '..')].filter(Boolean);
  const gitignore = existsSync(join(REPO, '.gitignore'))
    ? readFileSync(join(REPO, '.gitignore'), 'utf8').split(/\r?\n/).map((r) => r.trim())
    : [];
  const ignoreeritud = gitignore.includes('riigihanked/') || gitignore.includes('riigihanked');

  const kaustJuur = juured.find((j) => existsSync(join(j, 'riigihanked', 'rhr_tools')));
  if (kaustJuur) {
    const puudu = OENDFAILID.filter((f) => !existsSync(join(kaustJuur, f)));
    assert.equal(puudu.length, 0,
      `Õendfail(id) on kadunud või ümber nimetatud: ${puudu.join(', ')}\n`
      + `  Kaust ${join(kaustJuur, 'riigihanked/rhr_tools')} on olemas, aga fail(e) ei ole.\n`
      + '  Pariteedi mõte kaob vaikselt, kui Pythoni pool ümber nimetatakse ja Node\'i pool\n'
      + '  ei tea sellest. Uuenda viited failides lib/eforms.mjs, lib/hanked.mjs,\n'
      + '  tools/pariteet-uuenda.mjs ja tools/pariteet-python.mjs.');
    console.log(`PASS pariteet: õendfailid olemas (${kaustJuur})`);
  } else if (ignoreeritud) {
    console.log('HOIATUS pariteet: riigihanked/rhr_tools/ puudub siit masinalt.');
    console.log('  riigihanked/ on repo .gitignore\'is, seega CI-s ja värskes worktree\'s');
    console.log('  seda kausta ei ole. See EI OLE viga ja värav jookseb edasi.');
    console.log('  Vaadatud juured: ' + juured.join(', '));
    console.log('  Ristkontroll Pythoni vastu: npm run pariteet:python (vajab õendfaile).');
  } else {
    assert.fail('riigihanked/rhr_tools/ puudub JA riigihanked/ EI OLE .gitignore\'is.\n'
      + '  Kas kaust kustutati või .gitignore muutus? Õendfailideta ei ole pariteeti,\n'
      + '  mida hoida. Vaadatud juured: ' + juured.join(', '));
  }
}

// ---------------------------------------------------------------------------
// 1. FIKSTUURI TERVIKLIKKUS.
// ---------------------------------------------------------------------------
const xml = readFileSync(join(JUUR, FIKSTUUR), 'utf8');
const ootus = JSON.parse(readFileSync(join(JUUR, OOTUS_EFORMS), 'utf8'));
const tykid = splitNotices(xml, 'ContractAwardNotice');

{
  assert.ok(xml.startsWith('<?xml '), 'fikstuur peab olema kehtiv XML (XML-deklaratsioon)');
  assert.ok(/<OPEN-DATA>/.test(xml) && /<\/OPEN-DATA>/.test(xml),
    'fikstuuril peab olema juurelement <OPEN-DATA>, muidu ei ole ta kehtiv XML');
  // Baite loetakse LF-kujult. .gitattributes pinnib *.xml eol=lf, aga kui fail jouab
  // masinale muud teed (zip, kopeeri-kleebi, redaktori automaatne lopusalvestus), ei tohi
  // varav punaseks minna CRLF-i, vaid ainult SISU parast — muidu opib keegi seda rida eirama.
  const baite = Buffer.byteLength(xml.replace(/\r\n/g, '\n'), 'utf8');
  assert.equal(baite, ootus.baidid,
    `Fikstuur ise on muutunud (${baite} baiti LF-kujul, ootus ${ootus.baidid}).\n  ${JUHEND_EFORMS}`);
  assert.equal(tykid.length, ootus.teateid,
    `Fikstuurist tuleb ${tykid.length} teadet, ootus ${ootus.teateid}.\n  ${JUHEND_EFORMS}`);
  console.log(`PASS pariteet: fikstuur ${(ootus.baidid / 1024).toFixed(1)} KB, ${tykid.length} päris teadet`);
}

// ---------------------------------------------------------------------------
// 2. FIKSTUURI MITMEKESISUS.
//
// See on värava süda. Ilma selleta saab rohelise ka nii, et fikstuur kärbitakse
// sellisteks teadeteks, mille peal iga viga on nähtamatu. Iga rida siin vastab
// ühele mõõdetud päris juhtumile — ja kaks viimast on need, mis panevad ülesande 6
// pöördtestid kukkuma. Kui mõni loendur kukub nulli, ON VÄRAV VÄÄRTUSETU.
// ---------------------------------------------------------------------------
{
  const T = ootus.teated;
  const noue = (silt, f) => {
    const n = T.filter(f).length;
    assert.ok(n >= 1, `Fikstuur ei kata enam juhtumit "${silt}" (0 teadet).\n`
      + '  Fikstuuri nõrgendamine teeb värava väärtusetuks: vea, mida ükski teade ei\n'
      + '  vallanda, laseb värav läbi. Lisa sobiv päris teade tagasi.');
    return n;
  };
  const loendurid = {
    'üheosaline ühe võitjaga': noue('üheosaline ühe võitjaga', (a) => a.osi === 1 && a.winner_arv === 1),
    'mitmeosaline mitme võitjaga': noue('mitmeosaline mitme võitjaga', (a) => a.osi > 1 && a.winner_arv > 1),
    'osade tulemused erinevad (segu)': noue('segu', (a) => a.tulemus === 'segu'),
    'võitjata (clos-nw)': noue('clos-nw', (a) => a.tulemus === 'clos-nw' && a.winner === null),
    'summata': noue('summata', (a) => a.amount === null && a.amount_valuutas === null),
    'summa võitnud pakkumuste liitmisest': noue('voitnud-pakkumused', (a) => a.amount_allikas === 'voitnud-pakkumused'),
    'summa teate kogusummast': noue('total-amount', (a) => a.amount_allikas === 'total-amount'),
    'statistika koodita (RHR-i kuju)': noue('koodita-esimene', (a) => a.tenders_allikas === 'koodita-esimene'),
  };

  // languageID != EST — nimiEst-i eelistus peab olema päris andmete peal kaetud.
  const keeled = [...new Set([...xml.matchAll(/languageID="([^"]*)"/g)].map((m) => m[1]))];
  assert.ok(keeled.some((k) => k && k !== 'EST'),
    `Fikstuuris ei ole ühtegi mitte-EST languageID-d (leitud: ${keeled.join(', ')}).\n`
    + '  nimiEst-i EST-eelistus jääks katmata ja ingliskeelne nimi võiks vaikselt baasi jõuda.');
  loendurid['mitte-EST languageID'] = keeled.filter((k) => k && k !== 'EST').join(', ');

  // LÕKS ülesande 6 veale "date esimesest IssueDate-st": laienduses on lepingu
  // sõlmimise kuupäev ja see EI OLE teate kuupäev. Ilma sellise teateta ei kuku
  // pöördtest (c) ja 24 kuu akna vaikne nihe pääseks läbi.
  const dateLoks = tykid.filter((b, i) => {
    const esimene = (/<cbc:IssueDate(?:\s[^>]*)?>([^<]*)</.exec(b) || [])[1];
    return esimene && esimene.slice(0, 10) !== T[i].date;
  }).length;
  assert.ok(dateLoks >= 1,
    'Fikstuuris ei ole ühtegi teadet, kus ext:UBLExtensions\'i IssueDate erineb teate omast.\n'
    + '  Ilma selleta ei kuku pöördtest "date esimesest IssueDate-st" ja 24 kuu akna nihe\n'
    + '  pääseks vaikselt läbi.');
  loendurid['laienduse IssueDate erineb teate omast'] = dateLoks;

  // LÕKS ülesande 6 veale "orgs.find(o => o.size)": suuruskood on ka hankijal ja
  // KAOTAJAL, ja võitjal võib ta puududa. Fikstuuris peab olema teateid, kus
  // heuristika annab ahelast ERINEVA vastuse.
  const heurLoks = tykid.filter((b, i) => {
    const orgs = [...b.matchAll(/<efac:Company(?:\s[^>]*)?>([\s\S]*?)<\/efac:Company\s*>/g)].map((m) => {
      const c = m[1];
      const nm = /<cac:PartyName>[\s\S]*?<cbc:Name[^>]*>([\s\S]*?)<\/cbc:Name\s*>/.exec(c);
      return { name: nm ? nm[1].trim() : null, size: /<efbc:CompanySizeCode[\s>]/.test(c) };
    });
    const h = orgs.find((o) => o.size);
    return (h ? h.name : null) !== (T[i].winner === null ? null : T[i].winner)
      && !(h && T[i].winner && h.name.replace(/&amp;/g, '&') === T[i].winner);
  }).length;
  assert.ok(heurLoks >= 1,
    'Fikstuuris ei ole ühtegi teadet, kus suuruskoodi-heuristika annab võitjaahelast\n'
    + '  erineva vastuse. Ilma selleta ei kuku pöördtest "orgs.find(o => o.size)" ja\n'
    + '  ülesande 6 mõõdetud 29 % vale võitjat pääseks vaikselt läbi.');
  loendurid['suuruskoodi-heuristika lahkneb ahelast'] = heurLoks;

  for (const [k, v] of Object.entries(loendurid)) console.log(`     ${k}: ${v}`);
  console.log('PASS pariteet: fikstuur katab kõik mõõdetud juhtumid');
}

// ---------------------------------------------------------------------------
// 3. parseAward TÄISVÄLJUND vs kommititud ootus.
// ---------------------------------------------------------------------------
{
  const vead = [];
  for (let i = 0; i < tykid.length; i++) {
    const saadud = parseAward(tykid[i]);
    const oodatud = ootus.teated[i];
    const valjad = [...new Set([...Object.keys(oodatud), ...Object.keys(saadud)])];
    for (const v of valjad) {
      const a = JSON.stringify(saadud[v]);
      const b = JSON.stringify(oodatud[v]);
      if (a !== b) vead.push({ i, ref: oodatud.ref, vali: v, saadud: a, oodatud: b });
    }
  }
  if (vead.length) {
    console.error(`\n${JUHEND_EFORMS}\n`);
    console.error(`Lahknevusi: ${vead.length}`);
    for (const v of vead.slice(0, 60)) {
      console.error(`  teade #${v.i} (ref ${v.ref}) väli "${v.vali}": saadi ${v.saadud}, ootus ${v.oodatud}`);
    }
    if (vead.length > 60) console.error(`  ... ja veel ${vead.length - 60}`);
    console.error('');
    assert.fail(JUHEND_EFORMS);
  }
  const valju = Object.keys(ootus.teated[0]).length;
  console.log(`PASS pariteet: parseAward ${tykid.length} teadet x ${valju} välja lukus`);
}

// ---------------------------------------------------------------------------
// 4. segmentOf vs kommititud ootus.
// ---------------------------------------------------------------------------
const seg = JSON.parse(readFileSync(join(JUUR, OOTUS_SEGMENT), 'utf8'));
{
  assert.equal(seg.paarid.length, seg.paare, 'segment-ootus.json loendur ja nimekiri lahku');
  const vead = [];
  for (const p of seg.paarid) {
    const saadud = p.uheArgumendiga ? segmentOf(p.title) : segmentOf(p.title, p.kirjeldus);
    if (saadud !== p.ootus) vead.push({ ...p, saadud });
  }
  if (vead.length) {
    console.error(`\n${JUHEND_SEGMENT}\n`);
    console.error(`Lahknevusi: ${vead.length} / ${seg.paare}`);
    for (const v of vead.slice(0, 40)) {
      console.error(`  [${v.allikas} · haru "${v.haru}"]`);
      console.error(`    pealkiri : ${JSON.stringify(v.title)}`);
      console.error(`    kirjeldus: ${JSON.stringify(v.kirjeldus)}`);
      console.error(`    saadi ${JSON.stringify(v.saadud)}, ootus ${JSON.stringify(v.ootus)}`);
    }
    if (vead.length > 40) console.error(`  ... ja veel ${vead.length - 40}`);
    console.error('');
    assert.fail(JUHEND_SEGMENT);
  }
  console.log(`PASS pariteet: segmentOf ${seg.paare} paari lukus`);
}

// ---------------------------------------------------------------------------
// 5. HARUKATVUS.
//
// Ootusfail on genereeritud mustrite lähtekoodist. Kui keegi lisab FIT-i uue haru
// ja ootusfaili ei uuenda, jääks see haru katmata — täpselt see vaikne katvuse
// kadu, mille pärast see värav olemas on. Siin nõuame, et IGA praegune ülemise
// taseme haru on vähemalt ühe paariga kaetud.
// ---------------------------------------------------------------------------
{
  const tekstid = seg.paarid.flatMap((p) => [p.title || '', p.kirjeldus || '']);
  const katmata = [];
  for (const [nimi, re] of [['FIT', FIT], ['EXCL', EXCL], ['SMALLWEB', SMALLWEB]]) {
    for (const haru of harud(re.source)) {
      const h = new RegExp(haru, 'i');
      if (!tekstid.some((t) => h.test(t))) katmata.push(`${nimi}: /${haru}/`);
    }
  }
  assert.equal(katmata.length, 0,
    `Mustriharud ilma ühegi katva paarita (${katmata.length}):\n    ${katmata.join('\n    ')}\n`
    + `  ${JUHEND_SEGMENT}`);
  const harusid = harud(FIT.source).length + harud(EXCL.source).length + harud(SMALLWEB.source).length;
  console.log(`PASS pariteet: kõik ${harusid} mustriharu on kaetud`);
}

// ---------------------------------------------------------------------------
// 6. ÜLESANDE 3 PÄRIS KAOTATUD JUHTUM (310983).
//
// Eraldi ja nimeliselt, mitte ainult genereeritud paaride hulgas: pealkirjas EI OLE
// FIT-sõna, kirjelduses ON. Ainult-pealkiri-versioon jätaks selle hanke vahele —
// see JUHTUS ja maksis päris hanke.
// ---------------------------------------------------------------------------
{
  const p = seg.paarid.find((x) => x.allikas === 'päris-310983');
  assert.ok(p, 'päris juhtum 310983 peab ootusfailis olemas olema');
  assert.equal(FIT.test(p.title), false, '310983 pealkirjas EI TOHI olla FIT-sõna');
  assert.ok(FIT.test(p.kirjeldus), '310983 kirjelduses PEAB olema FIT-sõna');
  assert.equal(segmentOf(p.title, p.kirjeldus), 'nišš',
    'segmentOf peab FIT-sõna kirjeldusest leidma — ülesandes 3 jäi 310983 muidu vahele');
  assert.equal(segmentOf(p.title), null,
    'ainult pealkirjaga kutse annab null — see ongi ülesande 3 viga, mida kirjeldus parandab');
  console.log('PASS pariteet: 310983 (FIT ainult kirjelduses) ei jää enam vahele');
}

// Laienduse enesekontroll: kui `laienda` katki läheks, jääksid paarid vaikselt tühjaks.
{
  assert.deepEqual(laienda('a(b|c)d'), ['abd', 'acd']);
  assert.deepEqual(laienda('\\bui\\b'), ['ui']);
  assert.deepEqual(laienda('protot[üu][üu]p'), ['prototüüp', 'prototüup', 'prototuüp', 'prototuup']);
  assert.deepEqual(harud('a|b(c|d)|e'), ['a', 'b(c|d)', 'e']);
  console.log('PASS pariteet: mustriharude laiendaja on terve');
}

console.log('KÕIK PARITEEDIVÄRAVAD LÄBITUD');
