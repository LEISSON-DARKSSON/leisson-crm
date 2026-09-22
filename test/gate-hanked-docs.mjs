// ULESANNE 14: alusdokumentide allalaadimine, lahtipakkimine ja nouete lugemine.
//
// MIKS SEE VARAV ON OMA FAIL. Siin on KOLM eri riski, mis kukuvad eri moodi:
//   1. ZIP TULEB VOORAST ALLIKAST. Zip-slip, zip-pomm, sumlink ja Windowsis
//      keelatud nimi kirjutavad faile sinna, kuhu meie ei tahtnud - ja vaikselt.
//   2. ZIP-LUGEJA ON MEIE OMA. npm-sõltuvust ei tooda sisse (CRM on sõltuvusteta),
//      seega keskkataloogi lugemine, inflateRaw ja CRC on siin kirjutatud ja peavad
//      olema testitud OMA test-zipi peal, mitte võrgust tulnud faili peal.
//   3. VALE ARV MUUDAB VERDIKTI. rollid >= 3 annab -25 ja verdikti ALLTÖÖVÕTT.
//      Seega on siin eraldi testid selle kohta, et EBAKINDEL leid EI JÕUA
//      veergu `rollid` ega `kaive_noue` - ta jääb `docs_leiud`-i märkega
//      'kontrolli' ja skoori ei liiguta.
//
// VORKU EI KASUTATA. Zip-id ehitatakse siin (zlib.deflateRawSync), allalaadimist
// testitakse kohaliku serveri vastu (127.0.0.1), ja lausete mustrid on tsiteeritud
// PARIS TAI hanke 314159 alusdokumentidest (riigihanked/TAI_314159/alusdokumendid/).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crc32, loeKeskkataloog, paki, docxTekst, ZIP_PIIRID } from '../lib/zip.mjs';
import { turvalineSihtkoht, lahtiPaki, PAKI_PIIRID, PDFTOTEXT_KANDIDAADID } from '../agent/hanked-docs.mjs';
import { leiaRollid, leiaKaive, leiaKvaliteet, koguLeiud, laused } from '../lib/hanked-leiud.mjs';
import { laeBaidid, VorguViga } from '../lib/hanked-net.mjs';
import { score } from '../lib/hanked.mjs';
import { ROOT } from '../lib/env.mjs';

let ok = 0;
const check = (nimi, f) => { f(); ok++; console.log('  ok ' + nimi); };
const checkA = async (nimi, f) => { await f(); ok++; console.log('  ok ' + nimi); };

// --- test-zipi ehitaja -----------------------------------------------------
// Meie oma zip, et me ei sõltuks ühestki võõrast failist. `mode` lubab teha
// sümlinki- ja kataloogikirje; `vale_crc` rikub CRC-d meelega.
function teeZip(kirjed) {
  const lokaalsed = [];
  const kesk = [];
  let offset = 0;
  for (const k of kirjed) {
    const nimi = Buffer.from(k.nimi, 'utf8');
    const toores = Buffer.from(k.sisu ?? '', 'utf8');
    const meetod = k.meetod ?? 8;
    const andmed = meetod === 8 ? deflateRawSync(toores) : toores;
    const crc = k.vale_crc ? 0x12345678 : crc32(toores);
    const usize = k.usize ?? toores.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(meetod, 8); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(andmed.length, 18); lh.writeUInt32LE(usize, 22);
    lh.writeUInt16LE(nimi.length, 26); lh.writeUInt16LE(0, 28);
    lokaalsed.push(lh, nimi, andmed);

    const ce = Buffer.alloc(46);
    ce.writeUInt32LE(0x02014b50, 0); ce.writeUInt16LE(0x031e, 4); ce.writeUInt16LE(20, 6);
    ce.writeUInt16LE(meetod, 10); ce.writeUInt32LE(crc, 16);
    ce.writeUInt32LE(andmed.length, 20); ce.writeUInt32LE(usize, 24);
    ce.writeUInt16LE(nimi.length, 28);
    ce.writeUInt32LE(((k.mode ?? 0o100644) << 16) >>> 0, 38);
    ce.writeUInt32LE(offset, 42);
    kesk.push(ce, nimi);
    offset += 30 + nimi.length + andmed.length;
  }
  const keskBuf = Buffer.concat(kesk);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(kirjed.length, 8); eocd.writeUInt16LE(kirjed.length, 10);
  eocd.writeUInt32LE(keskBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokaalsed, keskBuf, eocd]);
}

const tmp = (silt) => mkdtempSync(join(tmpdir(), 'hanked-docs-' + silt + '-'));

// ---------------------------------------------------------------------------
// 1. CRC32 — teadaolev vektor. Ilma selleta oleks meie zip-lugeja ja meie
//    test-zip sama vea suhtes pimedad (mõlemad kasutavad sama funktsiooni).
// ---------------------------------------------------------------------------
check('crc32 annab teadaoleva vektori', () => {
  assert.equal(crc32(Buffer.from('123456789')) >>> 0, 0xcbf43926);
});

// ---------------------------------------------------------------------------
// 2. ZIP-SLIP (plaani juhtum + Windowsi variandid).
// ---------------------------------------------------------------------------
{
  const base = join(tmpdir(), 'riigihanked', '314159');
  check('turvalineSihtkoht: tavaline nimi jääb kausta (plaani juhtum)', () => {
    assert.equal(turvalineSihtkoht(base, 'Lisa 1.pdf'), join(base, 'Lisa 1.pdf'));
    assert.equal(turvalineSihtkoht(base, 'alam/Lisa 2.pdf'), join(base, 'alam', 'Lisa 2.pdf'));
    assert.equal(turvalineSihtkoht(base, './Lisa 3.pdf'), join(base, 'Lisa 3.pdf'));
  });
  check('turvalineSihtkoht: ../../evil.mjs ja /etc/passwd viskavad (plaani juhtum)', () => {
    assert.throws(() => turvalineSihtkoht(base, '../../evil.mjs'), /väljaspool/);
    assert.throws(() => turvalineSihtkoht(base, '/etc/passwd'), /väljaspool/);
  });
  check('turvalineSihtkoht: Windowsi variandid — draivitäht, UNC, tagurpidi kaldkriips', () => {
    assert.throws(() => turvalineSihtkoht(base, 'C:\\Windows\\system32\\evil.dll'), /väljaspool|absoluut|draivi/i);
    assert.throws(() => turvalineSihtkoht(base, '\\\\server\\share\\evil.dll'), /väljaspool|absoluut|UNC/i);
    assert.throws(() => turvalineSihtkoht(base, 'alam\\..\\..\\evil.mjs'), /väljaspool|kaldkriips/i);
    // Tagurpidi kaldkriips on Linuxis LUBATUD failinimemärk, seega `path.resolve`
    // ei näe siin midagi halba — Windowsis on ta kataloogieraldaja. Ilma oma
    // valveta läheks sama zip Linuxis ühte faili ja Windowsis kaustast välja.
    assert.throws(() => turvalineSihtkoht(base, '..\\evil.mjs'), /väljaspool|kaldkriips/i);
  });
  check('turvalineSihtkoht: Windowsis kõlbmatud nimed', () => {
    for (const n of ['CON', 'con.txt', 'NUL', 'COM1.pdf', 'LPT9', 'a:b.pdf', 'lisa.', 'lisa ',
      'va<b>.pdf', 'tsi"teeri.pdf', 'tab\tnimi.pdf']) {
      assert.throws(() => turvalineSihtkoht(base, n), /nimi|märk|reserveeritud|punkt|tühik/i,
        'peab keelduma: ' + JSON.stringify(n));
    }
    assert.throws(() => turvalineSihtkoht(base, 'a'.repeat(300) + '.pdf'), /pikk/i);
    assert.throws(() => turvalineSihtkoht(base, ''), /tühi|nimi/i);
    assert.throws(() => turvalineSihtkoht(base, 'nul\u0000l.pdf'), /märk|nimi/i);
  });
  console.log('PASS dokumendid: zip-slip kaitse');
}

// ---------------------------------------------------------------------------
// 3. ZIP-LUGEJA meie oma test-zipi peal (stored + deflated + CRC).
// ---------------------------------------------------------------------------
{
  const zip = teeZip([
    { nimi: 'a.txt', sisu: 'Tere ÕÄÖÜ maailm' },
    { nimi: 'b.bin', sisu: 'pakkimata sisu', meetod: 0 },
    { nimi: 'kaust/', sisu: '', mode: 0o040755 },
  ]);
  check('zip-lugeja loeb keskkataloogi, deflate ja stored kirjed', () => {
    const { kirjed } = loeKeskkataloog(zip);
    assert.equal(kirjed.length, 3);
    const a = kirjed.find((k) => k.nimi === 'a.txt');
    assert.equal(paki(zip, a).toString('utf8'), 'Tere ÕÄÖÜ maailm');
    const b = kirjed.find((k) => k.nimi === 'b.bin');
    assert.equal(b.meetod, 0);
    assert.equal(paki(zip, b).toString('utf8'), 'pakkimata sisu');
    assert.equal(kirjed.find((k) => k.nimi === 'kaust/').kataloog, true);
  });
  check('zip-lugeja avastab rikutud CRC', () => {
    const vale = teeZip([{ nimi: 'a.txt', sisu: 'Tere', vale_crc: true }]);
    const { kirjed } = loeKeskkataloog(vale);
    assert.throws(() => paki(vale, kirjed[0]), /CRC|kontrollsumma/i);
  });
  check('zip-lugeja keeldub, kui EOCD puudub', () => {
    assert.throws(() => loeKeskkataloog(Buffer.from('see ei ole zip')), /ZIP|zip/);
  });
  console.log('PASS dokumendid: ZIP-lugeja (keskkataloog, inflateRaw, stored, CRC)');
}

// ---------------------------------------------------------------------------
// 4. ZIP-POMM: pakkimata maht JA pakkimissuhe kontrollitakse ENNE lahtipakkimist.
// ---------------------------------------------------------------------------
{
  check('zip-pomm: pakkimissuhte lagi', () => {
    // 8 MB nulle pakib kokku mõne kilobaidini — suhe on tuhandetes.
    const pomm = teeZip([{ nimi: 'pomm.bin', sisu: '\u0000'.repeat(8 * 1024 * 1024) }]);
    assert.throws(() => loeKeskkataloog(pomm), /suhe|pomm/i);
  });
  check('zip-pomm: pakkimata kogumahu lagi', () => {
    // Deklareeritud maht üle lae. `usize` on keskkataloogis ja teda usaldab
    // iga naiivne lugeja — meie kontrollime teda ENNE kui ühtegi baiti avame.
    const suur = teeZip([{ nimi: 'suur.bin', sisu: 'x', usize: ZIP_PIIRID.maxKokku + 1 }]);
    assert.throws(() => loeKeskkataloog(suur), /maht|suur/i);
  });
  check('zip-pomm: failide arvu lagi', () => {
    const palju = teeZip(Array.from({ length: ZIP_PIIRID.maxFaile + 1 },
      (_, i) => ({ nimi: 'f' + i + '.txt', sisu: 'x' })));
    assert.throws(() => loeKeskkataloog(palju), /faili|arv/i);
  });
  check('zip-pomm: valetav usize ei tee malu tais (inflate katkeb lae peal)', () => {
    // Kirje ütleb "1 bait", tegelik sisu on 2 MB. maxOutputLength peab katkestama.
    const valetav = teeZip([{ nimi: 'valetav.bin', sisu: 'A'.repeat(2 * 1024 * 1024), usize: 1 }]);
    const { kirjed } = loeKeskkataloog(valetav);
    assert.throws(() => paki(valetav, kirjed[0]), /maht|suur|lahtipakkimine/i);
  });
  console.log('PASS dokumendid: zip-pommi kaitse (suhe, kogumaht, failide arv, valetav usize)');
}

// ---------------------------------------------------------------------------
// 5. SUMLINGID JA KATALOOGIKIRJED — sümlinki ei looda kunagi.
// ---------------------------------------------------------------------------
{
  const siht = tmp('sumlink');
  const zip = teeZip([
    { nimi: 'aus.txt', sisu: 'aus sisu' },
    { nimi: 'kuri.lnk', sisu: '/etc/passwd', mode: 0o120777 },   // S_IFLNK
    { nimi: 'kaust/', sisu: '', mode: 0o040755 },
  ]);
  check('sümlinkikirje jäetakse vahele ja on LOENDATUD, mitte vaikne', () => {
    const r = lahtiPaki(zip, siht);
    assert.equal(r.failid.length, 1, 'ainult aus fail: ' + JSON.stringify(r.failid));
    assert.equal(r.failid[0].nimi, 'aus.txt');
    const s = r.vahelejaetud.find((v) => v.nimi === 'kuri.lnk');
    assert.ok(s, 'sümlink peab olema vahelejäetute loendis: ' + JSON.stringify(r.vahelejaetud));
    assert.match(s.pohjus, /sümlink/i);
    assert.ok(!existsSync(join(siht, 'kuri.lnk')), 'sümlinkifaili ei tohi tekkida');
    assert.ok(existsSync(join(siht, 'aus.txt')));
  });
  console.log('PASS dokumendid: sümlingid ja kataloogikirjed');
}

// ---------------------------------------------------------------------------
// 6. ZIP-SLIP LOPUNI: kuri nimi zipi SEES ei tohi kirjutada väljapoole.
// ---------------------------------------------------------------------------
{
  const juur = tmp('slip');
  const siht = join(juur, 'docs');
  mkdirSync(siht, { recursive: true });
  const zip = teeZip([
    { nimi: '../../evil.mjs', sisu: 'process.exit(1)' },
    { nimi: 'C:\\evil.dll', sisu: 'x' },
    { nimi: '..\\evil2.mjs', sisu: 'x' },
    { nimi: 'CON', sisu: 'x' },
    { nimi: 'aus.pdf', sisu: '%PDF-1.4' },
  ]);
  check('kurja nimega kirjed ei kirjuta kausta väljapoole', () => {
    const r = lahtiPaki(zip, siht);
    assert.equal(r.failid.length, 1);
    assert.equal(r.vahelejaetud.length, 4, JSON.stringify(r.vahelejaetud));
    assert.ok(!existsSync(join(juur, 'evil.mjs')), 'evil.mjs EI TOHI olla docs-kaustast väljas');
    assert.ok(!existsSync(join(juur, 'evil2.mjs')));
    assert.deepEqual(readdirSync(siht), ['aus.pdf']);
  });
  console.log('PASS dokumendid: zip-slip ei kirjuta sihtkaustast välja');
}

// ---------------------------------------------------------------------------
// 7. OLEMASOLEV KAUST — teine jooks ei aja vanu faile segamini.
// ---------------------------------------------------------------------------
{
  const juur = tmp('olemas');
  const siht = join(juur, 'docs');
  mkdirSync(siht, { recursive: true });
  writeFileSync(join(siht, 'vana.pdf'), 'vana');
  const zip = teeZip([{ nimi: 'uus.pdf', sisu: 'uus' }]);
  check('täis kausta ei kirjutata vaikselt peale', () => {
    assert.throws(() => lahtiPaki(zip, siht), /olemas|uuesti/i);
    assert.equal(readFileSync(join(siht, 'vana.pdf'), 'utf8'), 'vana');
  });
  check('--uuesti tõstab vana kausta kõrvale, ei kustuta (mount keelab kustutamise)', () => {
    const r = lahtiPaki(zip, siht, { uuesti: true });
    assert.equal(r.failid.length, 1);
    assert.ok(r.vanaKaust && existsSync(r.vanaKaust), 'vana kaust peab alles olema: ' + r.vanaKaust);
    assert.equal(readFileSync(join(r.vanaKaust, 'vana.pdf'), 'utf8'), 'vana');
    assert.equal(readFileSync(join(siht, 'uus.pdf'), 'utf8'), 'uus');
  });
  console.log('PASS dokumendid: olemasolev kaust versioonitakse, mitte ei segata');
}

// ---------------------------------------------------------------------------
// 8. DOCX -> TEKST. DOCX on zip + XML, seega meie oma zip-lugeja oskab teda juba.
//    KRIITILINE KOHT: Word lõhub sõna mitmeks `w:t` jooksuks („31" + „4159").
//    Kui neid liita TÜHIKUGA, tuleb tekstiks „31 4159" ja iga viitenumbri- või
//    arvumuster läheb katki. Paris fail: Lisa 4 vorm III - CV projektijuht.docx.
// ---------------------------------------------------------------------------
{
  const doc = '<?xml version="1.0"?><w:document xmlns:w="x"><w:body>'
    + '<w:p><w:r><w:t>Riigihanke viitenumber: </w:t></w:r><w:r><w:t>31</w:t></w:r>'
    + '<w:r><w:t>4159</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>Projektijuht peab omama v&#228;hemalt 2 aastast t&#246;&#246;kogemust</w:t></w:r>'
    + '<w:r><w:tab/></w:r><w:r><w:t>projektijuhina</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>Hind &lt; 5 &amp; kvaliteet</w:t></w:r></w:p>'
    + '</w:body></w:document>';
  const docx = teeZip([
    { nimi: '[Content_Types].xml', sisu: '<Types/>' },
    { nimi: 'word/document.xml', sisu: doc },
  ]);
  check('docxTekst liidab w:t jooksud ILMA tühikuta ja lõigud reavahetusega', () => {
    const t = docxTekst(docx);
    assert.match(t, /Riigihanke viitenumber: 314159/, 'sõna ei tohi jooksude vahel katki minna: ' + t);
    assert.match(t, /vähemalt 2 aastast töökogemust projektijuhina/, 'olemid ja w:tab: ' + t);
    assert.match(t, /Hind < 5 & kvaliteet/, 'XML-olemid tuleb lahti kodeerida: ' + t);
    assert.equal(t.split('\n').length, 3, 'kolm lõiku = kolm rida: ' + JSON.stringify(t));
  });
  check('docxTekst ütleb selgelt, kui document.xml puudub', () => {
    const katki = teeZip([{ nimi: 'word/muu.xml', sisu: '<x/>' }]);
    assert.throws(() => docxTekst(katki), /document\.xml/);
  });
  console.log('PASS dokumendid: DOCX → tekst');
}

// ---------------------------------------------------------------------------
// 9. MUSTRID PARIS LAUSETE PEAL.
//
// Koik laused siin on TSITEERITUD hanke 314159 (Tervise Arengu Instituut,
// „Aitab") alusdokumentidest, failist 314159_vastavustingimused.pdf. Mustreid
// EI OLE valja moeldud - nad on ehitatud nende lausete peale.
// ---------------------------------------------------------------------------
const TAI_VASTAVUS = [
  'PAKKUJA MEESKOND - PROJEKTIJUHT.',
  'Tööde elluviimiseks peab pakkuja meeskonnas olema täidetud projektijuhi roll.',
  'Projektijuht peab omama vähemalt 2 aastast töökogemust (5 aasta jooksul riigihanke avaldamisest tagasiulatuvalt), tarkvara-, veebi- või mobiilirakenduste arendusprojektide projektijuhina.',
  'Pakkujal tuleb esitada meeskonnas projektijuhi rolli täitva isiku enda poolt digitaalselt allkirjastatud CV Lisa 4 vormil III – CV projektijuht.',
  'PAKKUJA MEESKOND - JUHTIVARENDAJA.',
  'Pakkuja meeskonnas peab olema täidetud juhtivarendaja roll.',
  'Pakkujal tuleb esitada meeskonnas juhtivarendaja rolli täitva isiku enda poolt digitaalselt allkirjastatud CV Lisa 4 vormil IV – CV juhtivarendaja.',
  'PAKKUJA MEESKOND - UX-UI DISAINER.',
  // NB: selles lauses PUUDUB „peab" - see on pärisdokumendi kirjaviga. Kui meie
  // ainus tõend oleks „<roll> roll", kaoks disainer ära ja rollid oleks 2.
  'Pakkuja meeskonnas olema täidetud UX-UI disaineri roll.',
  'Pakkujal tuleb esitada meeskonnas UX-UI disaineri rolli täitva isiku enda poolt digitaalselt allkirjastatud CV Lisa 4 vormil V – CV UX-UI disainer.',
  'PAKKUJA MEESKOND - TÄIENDAV KOMPETENTS JA ROLLIDE ÜHENDAMINE.',
  'Pakkuja peab tagama, et projektimeeskonnas on projekti edukaks kavandamiseks, arendamiseks, testimiseks ja kasutuselevõtuks vajalik kompetents sh. tehnilise arhitektuuri kavandamiseks, mobiili- ja veebilahenduse arendamiseks, integratsioonide kavandamiseks, infoturbe-, jõudluse-, skaleeritavuse-, kasutajakogemuse- (UX), kasutajaliidestuse- (UI), ligipääsetavuse-, testimiste ning programmi halduslahenduse kavandamise kompetents.',
  'Pakkuja meeskond peab minimaalselt koosnema punktides 9-11 nõutud rollidest, sh. võib üks meeskonnaliige täita maksimaalselt kuni kahte rolli.',
  'Lepingu täitmiseks on pakkujal õigus kaasata täiendavaid spetsialiste (nt. kvaliteedi tagamise, infoturbe, DevOpsi, analüütika, ligipääsetavuse või muu valdkonna eksperte).',
].join(' ');

{
  check('laused: lauseks lõhkumine ei lõhu kuupäeva ega lühendit', () => {
    const l = laused('Koostatud 09.09.2026 10:26:11 asjus. Pakkuja peab, sh. võib üks. Lõpp.');
    assert.equal(l.length, 3, JSON.stringify(l));
    assert.match(l[0], /09\.09\.2026/);
    assert.match(l[1], /sh\. võib üks/);
  });

  check('rollid: TAI 314159 annab TÄPSELT 3 rolli ja iga leid kannab tõendit', () => {
    const r = leiaRollid(TAI_VASTAVUS, '314159_vastavustingimused.pdf');
    assert.equal(r.arv, 3, 'oodati 3 rolli, sai ' + r.arv + ': '
      + JSON.stringify(r.leiud.map((x) => x.roll)));
    assert.equal(r.kindel, true);
    assert.deepEqual(r.leiud.filter((x) => x.kindlus === 'kindel').map((x) => x.roll).sort(),
      ['disainer', 'juhtivarendaja', 'projektijuht']);
    for (const leid of r.leiud) {
      assert.ok(leid.lause && leid.lause.length > 20, 'iga leid kannab LAUSET: ' + JSON.stringify(leid));
      assert.equal(leid.fail, '314159_vastavustingimused.pdf');
    }
  });

  check('rollid: „õigus kaasata täiendavaid spetsialiste" EI lisa rolle', () => {
    const r = leiaRollid(TAI_VASTAVUS, 'f.pdf');
    const nimed = r.leiud.filter((x) => x.kindlus === 'kindel').map((x) => x.roll);
    for (const vale of ['devops', 'infoturve', 'analüütik', 'testija', 'arhitekt']) {
      assert.ok(!nimed.includes(vale), vale + ' EI TOHI kindlate rollide hulka sattuda');
    }
    // ... aga nad ei kao ka vaikselt: kahtlane leid on nähtav märkega 'kontrolli'.
    assert.ok(r.leiud.some((x) => x.kindlus === 'kontrolli'),
      'vabatahtlikud spetsialistid peavad jääma nähtavaks: ' + JSON.stringify(r.leiud));
  });

  // SEE TEST TULI PARIS JOOKSUST. Esimene versioon luges hankel 314159 NELI rolli
  // (õige on kolm): neljas tuli ANDMETOOTLUSLEPINGUST, kus „arendaja" on lepingu
  // pool, mitte nõutud meeskonnaliige. Lause on tsiteeritud failist
  // „Lisa 3 - Hankelepingu Lisa 2 - Andmetöötlusleping_AITAB.pdf".
  check('rollid: lepingupool EI ole nõutud meeskonnaliige (päris regressioon)', () => {
    const leping = 'Lepinguga ja lepingulisaga võetud kohustuste täitmiseks ning lepingu objekti '
      + 'andmete juhuslikku hävimise ja kahjustamise vastu peab volitatud töötleja kui vastutav '
      + 'arenduse teostaja ja volitatud koordineeriv arendaja rakendama tehnilisi ja '
      + 'korralduslikke meetmeid sh säilitama kõiki arendusega seotud andmeid turvatud serveris.';
    const r = leiaRollid(leping, 'Lisa 3 - Hankelepingu Lisa 2 - Andmetöötlusleping_AITAB.pdf');
    assert.equal(r.arv, 0, 'lepingupool ei ole roll: ' + JSON.stringify(r.leiud));
    assert.ok(r.leiud.every((x) => x.kindlus === 'kontrolli'),
      'leid jääb nähtavaks, aga ei loe: ' + JSON.stringify(r.leiud));
    // Ja kogu dokumendikomplekt annab endiselt TAPSELT kolm rolli.
    const k = koguLeiud([
      { nimi: '314159_vastavustingimused.pdf', tekst: TAI_VASTAVUS },
      { nimi: 'Lisa 3 - Hankelepingu Lisa 2 - Andmetöötlusleping_AITAB.pdf', tekst: leping },
    ]);
    assert.equal(k.rollid, 3, 'päris hankel 314159 on KOLM rolli: ' + JSON.stringify(k.rollinimed));
  });

  check('rollid: „arhitektuuri" ja „kasutajakogemuse" EI ole rollinimed', () => {
    const r = leiaRollid('Pakkuja meeskonnas peab olema tehnilise arhitektuuri kavandamise '
      + 'ja kasutajakogemuse kompetents.', 'f.pdf');
    assert.equal(r.arv, 0, JSON.stringify(r.leiud));
  });

  check('rollid: selge arvuline nõue loetakse ja peab kokku langema', () => {
    const a = leiaRollid('Pakkuja meeskonnas peab olema vähemalt 3 (kolm) erinevat spetsialisti: '
      + 'projektijuht, arendaja ja disainer.', 'f.pdf');
    assert.equal(a.arv, 3);
    assert.equal(a.kindel, true);
    // Vastuolu (sõnades 5, loendatud 2) EI tohi minna veergu - ta on 'kontrolli'.
    const b = leiaRollid('Meeskonnas peab olema vähemalt 5 erinevat spetsialisti, sh '
      + 'projektijuht ja arendaja.', 'f.pdf');
    assert.equal(b.kindel, false, 'vastuolu peab tegema leiu ebakindlaks');
    assert.ok(b.leiud.some((x) => /vastuolu|erinev/i.test(x.markus || '')),
      'vastuolu peab olema kirjas: ' + JSON.stringify(b.leiud));
  });

  check('käibenõue: TAI 314159 dokumendis EI OLE käibenõuet — ja me ei leiuta seda', () => {
    const k = leiaKaive(TAI_VASTAVUS, 'f.pdf');
    assert.equal(k.summa, null, 'leidis olematu käibenõude: ' + JSON.stringify(k.leiud));
    // Hankepassi vorm sisaldab paljast välja „Käive:" — ka see ei ole nõue.
    assert.equal(leiaKaive('Ettevõtte suurus: Töötajate arv: Käive: Valuuta:', 'h.pdf').summa, null);
    // Ja „ilma käibemaksuta" ei ole käive.
    assert.equal(leiaKaive('Esitada põhiarendustöö kogumaksumus ilma käibemaksuta 120 000 eurot.', 'h.pdf').summa, null);
  });

  check('käibenõue: selge nõue loetakse koos tõendiga', () => {
    const k = leiaKaive('Pakkuja viimase kolme majandusaasta keskmine netokäive peab olema '
      + 'vähemalt 150 000 eurot.', 'kvalifitseerimine.pdf');
    assert.equal(k.summa, 150000);
    assert.equal(k.kindel, true);
    assert.match(k.leiud[0].lause, /netokäive/);
    assert.equal(k.leiud[0].fail, 'kvalifitseerimine.pdf');
  });

  check('käibenõue: number ilma nõudesõnata jääb ebakindlaks', () => {
    const k = leiaKaive('Pakkuja netokäive 2025. aastal oli 90 000 eurot.', 'f.pdf');
    assert.equal(k.summa, null);
    assert.ok(k.leiud.some((x) => x.kindlus === 'kontrolli'), JSON.stringify(k.leiud));
  });

  check('kvaliteedikaal: TAI 314159 hindamiskriteeriumide rida annab 70', () => {
    // Tsitaat failist 314159_hindamiskriteeriumid.pdf (pdftotext -layout).
    const rida = ' 4    Tehnilise      lahenduse    kirjeldus, Hindamismetoodika vastavalt Lisale 5 - '
      + 'Kvaliteet - hankija          70\n      programmi                      UX/UI Hindamiskriteeriumid '
      + 'ja -metoodika            hinnatav\n                                    Kokku:                 100\n';
    const q = leiaKvaliteet(rida, '314159_hindamiskriteeriumid.pdf');
    assert.equal(q.kaal, 70, JSON.stringify(q.leiud));
    assert.equal(q.kindel, true);
  });

  // SEE TEST TULI PARIS JOOKSUST (hange 312645, Eesti Post „Reisiteenuste
  // platvorm"). Esimene versioon luges kvaliteedikaaluks „kindla" 100 pakkumuse
  // esitamise ettepanekust („100-väärtuspunkti süsteemis") ja EI LUGENUD
  // hindamistabelist tegelikku 15, sest tabelireal ei olnud ühtegi muud
  // hindamissõna. Tulemus oli täpselt vale moodi vaikne: number oli olemas,
  // aga vale.
  check('kvaliteedikaal: tabelirida võidab, „100-väärtuspunkti" ei ole kaal (päris regressioon)', () => {
    const tabel = '  3    Täiendavad funktsioonid                 Pakkuja kirjeldab Lisa 3 punkti 3.1 all '
      + 'Kvaliteet - hankija                           15\n'
      + '                                               olevas tabelis täiendavaid funktsioone,       hinnatav\n';
    assert.equal(leiaKvaliteet(tabel, '312645_hindamiskriteeriumid.pdf').kaal, 15);
    const ettepanek = 'Hankija soovib võistlevaid pakkumusi tehnilises kirjelduses kirjeldatud lepingu '
      + 'eseme maksumuse ja kvaliteedi kohta, et sõlmida raamleping mõlemas osas vastavalt '
      + 'hindamiskriteeriumitele (sh hindamismetoodikale) 100-väärtuspunkti süsteemis täpsusega '
      + 'kaks kohta pärast koma.';
    assert.deepEqual(leiaKvaliteet(ettepanek, 'ettepanek.docx').kandidaadid, [],
      '„100-väärtuspunkti" ei ole kvaliteedikriteeriumi kaal');
    // Ja komplektina tuleb TABELI arv, mitte ettepaneku oma.
    const k = koguLeiud([{ nimi: 'ettepanek.docx', tekst: ettepanek },
      { nimi: '312645_hindamiskriteeriumid.pdf', tekst: tabel }]);
    assert.equal(k.qualityWeight, 15);
  });

  check('kvaliteedikaal: ühe faili vastuolu ulatub kogu komplektini', () => {
    // Kui vastuolu jääks faili SISSE, kaoks ta vaikselt ja teise faili nõrk
    // väärtus võidaks. Komplekti tasemel peab tulemus jääma EBAKINDLAKS.
    const k = koguLeiud([{ nimi: 'a.pdf', tekst: 'kvaliteet 60%\nkvaliteedi osakaal on 30\n' },
      { nimi: 'b.pdf', tekst: 'kvaliteet 40%\n' }]);
    assert.equal(k.qualityWeight, null, 'vastuolu ei tohi anda „kindlat" arvu');
  });

  check('kvaliteedikaal: protsendikuju ja vastuolu', () => {
    assert.equal(leiaKvaliteet('Hindamiskriteeriumid: hind 40%, kvaliteet 60%.', 'f.pdf').kaal, 60);
    const vastuolu = leiaKvaliteet('kvaliteet 60%\nkvaliteedi osakaal on 30\n', 'f.pdf');
    assert.equal(vastuolu.kindel, false, 'kaks eri kaalu ei tohi minna veergu');
    assert.equal(vastuolu.kaal, null);
  });
  console.log('PASS dokumendid: mustrid päris TAI 314159 lausete peal');
}

// ---------------------------------------------------------------------------
// 10. EBAKINDEL LEID EI JOUA VEERGU. See on selle ülesande kõige kallim viga:
//     vale `rollid` muudab verdikti alusetult ALLTÖÖVÕTUKS.
// ---------------------------------------------------------------------------
{
  check('koguLeiud: kindel komplekt täidab veerud', () => {
    const k = koguLeiud([{ nimi: 'vastavustingimused.pdf', tekst: TAI_VASTAVUS }]);
    assert.equal(k.rollid, 3);
    assert.equal(k.kaiveNoue, null, 'käibenõuet ei ole — NULL, mitte 0');
    assert.ok(k.leiud.length >= 3);
  });
  check('koguLeiud: ebakindel leid jääb veerust VÄLJA, aga jääb nähtavaks', () => {
    const tekst = 'Meeskonnas peab olema vähemalt 5 erinevat spetsialisti, sh projektijuht ja arendaja. '
      + 'Pakkuja netokäive 2025. aastal oli 90 000 eurot.';
    const k = koguLeiud([{ nimi: 'f.pdf', tekst }]);
    assert.equal(k.rollid, null, 'ebakindel rollide arv EI TOHI veergu jõuda');
    assert.equal(k.kaiveNoue, null);
    assert.ok(k.leiud.some((x) => x.kindlus === 'kontrolli'), 'leid peab jääma nähtavaks');
  });
  check('verdikt: ebakindel leid EI tee hankest ALLTÖÖVÕTTU, kindel teeb', () => {
    const h = { segment: 'väike veebileht', est: 40000, menetlus: 'Avatud hankemenetlus',
      deadline: '2026-12-01' };
    const t = '2026-09-21';
    const ebakindel = koguLeiud([{ nimi: 'f.pdf',
      tekst: 'Meeskonnas peab olema vähemalt 5 erinevat spetsialisti, sh projektijuht ja arendaja.' }]);
    const a = score(h, { today: t, docs: { rollid: ebakindel.rollid, kaiveNoue: ebakindel.kaiveNoue } });
    assert.notEqual(a.verdict, 'ALLTÖÖVÕTT', 'ebakindel leid ei tohi verdikti muuta: ' + JSON.stringify(a));
    const kindel = koguLeiud([{ nimi: 'vastavustingimused.pdf', tekst: TAI_VASTAVUS }]);
    const b = score(h, { today: t, docs: { rollid: kindel.rollid, kaiveNoue: kindel.kaiveNoue } });
    assert.equal(b.verdict, 'ALLTÖÖVÕTT', 'kolm CV-rolli PEAB andma ALLTÖÖVÕTU: ' + JSON.stringify(b));
    assert.ok(b.why.some((r) => /3 rolli CV-nõuet/.test(r)), JSON.stringify(b.why));
  });
  console.log('PASS dokumendid: ebakindel leid ei liiguta verdikti');
}

// ---------------------------------------------------------------------------
// 11. laeBaidid — sama kolmekihiline kaitse mis laeTekst, aga binaarne keha.
// ---------------------------------------------------------------------------
{
  const server = (kaitumine) => new Promise((res) => {
    const s = createServer(kaitumine);
    s.listen(0, '127.0.0.1', () => res({
      url: 'http://127.0.0.1:' + s.address().port + '/',
      sulge: () => new Promise((r) => s.close(r)),
    }));
  });

  await checkA('laeBaidid toob baidid tervelt ja muutmata', async () => {
    const zip = teeZip([{ nimi: 'a.txt', sisu: 'Tere ÕÄÖÜ' }]);
    const { url, sulge } = await server((req, res) => {
      res.writeHead(200, { 'content-type': 'application/zip' });
      res.write(zip.subarray(0, 10)); res.end(zip.subarray(10));
    });
    const b = await laeBaidid(url, { aegumine: 5000 });
    assert.ok(Buffer.isBuffer(b) || b instanceof Uint8Array);
    assert.equal(Buffer.compare(Buffer.from(b), zip), 0, 'baidid peavad olema identsed');
    assert.equal(docxTekst.name, 'docxTekst'); // moodul on laetud
    await sulge();
  });

  await checkA('laeBaidid: 500 annab VorguViga koodiga, mitte tühja puhvri', async () => {
    const { url, sulge } = await server((req, res) => { res.writeHead(500); res.end('vabandust'); });
    await assert.rejects(() => laeBaidid(url, { aegumine: 3000, silt: 'Dokumendid' }), (e) => {
      assert.ok(e instanceof VorguViga, 'oodati VorguViga, sai ' + e.name);
      assert.equal(e.kood, 500);
      assert.match(e.message, /Dokumendid: RHR vastas 500/);
      return true;
    });
    await sulge();
  });

  await checkA('laeBaidid: mahulagi katkestab enne mälu täissöömist', async () => {
    const { url, sulge } = await server((req, res) => {
      res.writeHead(200);
      const tukk = Buffer.alloc(64 * 1024, 65);
      let n = 0;
      const saada = () => { if (n++ > 200) return res.end(); if (res.write(tukk)) setImmediate(saada); else res.once('drain', saada); };
      saada();
    });
    await assert.rejects(() => laeBaidid(url, { aegumine: 5000, maxBaite: 256 * 1024 }),
      (e) => { assert.match(e.message, /maht|suur/i); return true; });
    await sulge();
  });

  await checkA('laeBaidid: rippuv keha aegub (sama viga mis ülesandes 13)', async () => {
    const { url, sulge } = await server((req, res) => { res.writeHead(200); res.write('PK'); });
    await assert.rejects(() => laeBaidid(url, { aegumine: 600, seisuAeg: 300 }),
      (e) => { assert.ok(e instanceof VorguViga && e.aegus, JSON.stringify(e.message)); return true; });
    await sulge();
  });
  console.log('PASS dokumendid: laeBaidid (terviklikkus, 500, mahulagi, aegumine)');
}

// ---------------------------------------------------------------------------
// 12. PIIRID ON NÄHTAVAD ARVUD, mitte maagia koodi sees.
// ---------------------------------------------------------------------------
check('piirid on eksporditud ja mõistlikud', () => {
  assert.ok(ZIP_PIIRID.maxSuhe >= 50 && ZIP_PIIRID.maxSuhe <= 1000);
  assert.ok(ZIP_PIIRID.maxKokku >= 64 * 1024 * 1024);
  assert.ok(PAKI_PIIRID.vajaBaite > 0);
});

// ---------------------------------------------------------------------------
// 13. PDF-1 (audit PR2, 22.09.2026): leiaPdftotext({env}) parameeter ei jõua
// spawnSync-ile (see kutsub leiaPdftotext-i sees kasutatavat process.env-i
// otse, mitte parameetrit) - seega OS-tasandi PATH-otsingu tõestamiseks peab
// test käivitama PÄRIS lapse KONTROLLITUD env-iga ja kutsuma leiaPdftotext()
// SISEMISELT, mitte andma sellele fiktiivset env-parameetrit väljastpoolt.
//
// AVASTUS SELLE VÄRAVA KIRJUTAMISEL: Windowsil ei kustuta `spawnSync`
// `env`-valik käivitatava faili PATH-otsingut - laps saab paljast käsku
// (`pdftotext`) lahendades ikkagi TÄIELIKU päris PATH-i, olenemata sellest,
// mis `env`-objektis on (kontrollitud käesoleva testi kirjutamisel:
// `process.env` dump lapse sees näitas täit reaalset PATH-i, kuigi `env`-is
// oli ainult neli muutujat). Seega ei saa "minimaalne env ilma PATH-ita"
// tõestada, et PDFTOTEXT ülekirjutus VÕITIS - paljas nimi leiaks õige
// binaari niikuinii PATH-i kaudu. Ja kuna `PDFTOTEXT_KANDIDAADID` sisaldab
// täpselt neid teid, kust pdftotext tavaliselt leitakse (mingw64, poppler,
// /usr/bin, /usr/local/bin, /opt/homebrew/bin - k.a. täpselt see koht, kuhu
// CI apt poppler-utils paigaldab), leiaks ka kõvakodeeritud varukohtade
// nimekiri sama tee ülekirjutusest sõltumata. Seepärast EI SAA katsehobuseks
// võtta päris pdftotext'i teed - iga selline väärtus on saavutatav KOLME
// sõltumatu tee kaudu (PDFTOTEXT, paljas PATH, kõvakodeeritud nimekiri) ja
// assert.equal(tee, tee) ei tõesta MIDAGI ülekirjutuse enda kohta.
//
// LAHENDUS: ülekirjutuse sihtmärgiks on `process.execPath` (node.exe enda
// täistee). See vastab kõikidele leiaPdftotext-i nõuetele (fail on olemas,
// `node -v` väljub koodiga 0), AGA teda EI SAA leida paljast 'pdftotext'
// käsku otsides ega `PDFTOTEXT_KANDIDAADID` nimekirjast - ainuke tee, kuidas
// laps saab selle tagasi anda, on PDFTOTEXT env-muutuja lugemine. Seega on
// see katse päriselt sabotaaži suhtes tundlik (kontrollitud käsitsi: kui
// `env.PDFTOTEXT` lugemine leiaPdftotext-is katki teha, läheb see test
// PUNASEKS, sest laps leiab siis paljast PATH-i kaudu tavalise pdftotext'i,
// mitte node.exe teed).
// ---------------------------------------------------------------------------
{
  const skript = `
    import { leiaPdftotext } from ${JSON.stringify(pathToFileURL(join(ROOT, 'agent/hanked-docs.mjs')).href)};
    const tee = leiaPdftotext();
    console.log(JSON.stringify({ tee }));
  `;
  const dir = mkdtempSync(join(tmpdir(), 'pdf-env-'));
  const skriptifail = join(dir, 'test.mjs');
  writeFileSync(skriptifail, skript);

  // Minimaalne, KONTROLLITUD env + PDFTOTEXT osutab node.exe enda teele.
  // Kuna node.exe teed ei saa leida ei paljast 'pdftotext' PATH-ist ega
  // kõvakodeeritud varukohtade nimekirjast, tõestab võrdsus tõesti, et
  // env.PDFTOTEXT jõudis SISEMISELT käivitunud spawnSync'ini.
  const ulekirjutusega = spawnSync(process.execPath, [skriptifail], {
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP, TMP: process.env.TMP, PDFTOTEXT: process.execPath },
    encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.equal(ulekirjutusega.status, 0,
    'laps ei lõpetanud korralikult (status=' + ulekirjutusega.status + ', signal=' + ulekirjutusega.signal
    + '): ' + (ulekirjutusega.stderr || ''));
  const j = JSON.parse(ulekirjutusega.stdout);
  assert.equal(j.tee, process.execPath,
    'PDFTOTEXT ülekirjutus (node.exe tee) peab jõudma leiaPdftotext-i tagastuseni, '
    + 'mitte kaduma bare PATH-otsingu või kõvakodeeritud varukohtade taha');
  console.log('PASS hanked-docs: PDFTOTEXT env-ülekirjutus jõuab sisemiselt spawnSync-ini (PDF-1)');
}

// ---------------------------------------------------------------------------
// 14. PDF-2 (audit PR2, 22.09.2026, järg PDF-1-le): PDF-1 tõestab ainult, et
// PDFTOTEXT keskkonnamuutuja jõuab leiaPdftotext()-i sisemiselt spawnSync-ini.
// See EI TÕESTA MIDAGI PDFTOTEXT_KANDIDAADID kõvakodeeritud varukohtade
// nimekirja ITERATSIOONI kohta — täpselt selle koodi, mis lisati hange
// 315437 vea parandamiseks (vt kommentaari eespool). Ilma selle testita võib
// kandidaatide nimekirja läbimine olla katki (vale järjekord, katkine
// tsükkel, vale existsSync-kontroll) ilma, et ükski värav seda märkaks —
// täpselt see regressioonilõhe, mille koodikvaliteedi ülevaade leidis.
//
// EMPIIRILINE LEID (kontrollitud käesoleva paranduse käigus, laiendab PDF-1
// avastust): kui `env`-objektis PATH VÕTI PUUDUB TÄIESTI, ehitab Windows/Node
// lapse jaoks ikkagi kokku TÄIELIKU päris süsteemi PATH-i (nähtud dumpides
// process.env last lapse sees — see näitas päris PATH-i, kuigi env-objektis
// oli ainult 4 muutujat, nagu PDF-1-gi puhul). Kui PATH oli env-objektis
// EKSPLITSIITSELT TÜHI STRING (''), oli laps Windowsil päriselt PATH-ita
// (process.env.PATH == '') ja isegi paljaste käskude (`pdftotext`,
// `where.exe`, `cmd.exe`) spawnSync andis ENOENT.
//
// SEE TEST EI KASUTA SIISKI PATH: '' — POSIX-i `execvp` (Linuxi CI kasutab
// seda) võib tühja PATH-i korral rakendada vaikimisi otsinguteed (nt
// `/bin:/usr/bin`, kuhu apt paigaldab poppler-utils'i pdftotext'i), mis
// teeks katse Linuxil vaikselt mõttetuks samal põhjusel, miks PDF-1 päris
// pdftotext'i teed katsehobuseks ei võtnud. Selle asemel antakse PATH-iks
// PÄRISOLEV, aga TÜHI kataloog (dir2, kuhu on kirjutatud ainult see testi
// enda skript, mitte ükski käivitatav fail) — see blokeerib bare-nime
// otsingu usaldusväärselt nii Windowsil (kontrollitud käsitsi) kui ka
// POSIX-il, ilma platvormipõhise vaikeotsingutee riskita.
//
// SEEGA: laps saab tühja kataloogi PATH-iks (paljas otsing blokeeritud) ega
// saa PDFTOTEXT-i (ülekirjutus välja lülitatud) — ainuke viis, kuidas
// leiaPdftotext() saab binaari leida, on PDFTOTEXT_KANDIDAADID nimekirja
// läbimine. Vastus PEAB olema üks nimekirja kirjetest. (Sabotaaž
// kontrollitud käsitsi: kandidaatide nimekirja väljajätmine `leiaPdftotext`-
// ist läheb selle testiga punaseks — vt ka commit-sõnumit.)
// ---------------------------------------------------------------------------
{
  const skript2 = `
    import { leiaPdftotext } from ${JSON.stringify(pathToFileURL(join(ROOT, 'agent/hanked-docs.mjs')).href)};
    const tee = leiaPdftotext();
    console.log(JSON.stringify({ tee }));
  `;
  const dir2 = mkdtempSync(join(tmpdir(), 'pdf-kandidaat-'));
  const skriptifail2 = join(dir2, 'test.mjs');
  writeFileSync(skriptifail2, skript2);

  // Puudub PDFTOTEXT ülekirjutus JA PATH osutab olemasolevale, aga tühjale
  // kataloogile (dir2 sisaldab ainult test.mjs, mitte ühtegi käivitatavat
  // faili) — ainuke järelejäänud tee binaarini on kõvakodeeritud
  // varukohtade nimekiri.
  const ilmaPathita = spawnSync(process.execPath, [skriptifail2], {
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: dir2 },
    encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.equal(ilmaPathita.status, 0,
    'laps ei lõpetanud korralikult (status=' + ilmaPathita.status + ', signal=' + ilmaPathita.signal
    + '): ' + (ilmaPathita.stderr || ''));
  const j2 = JSON.parse(ilmaPathita.stdout);
  assert.ok(j2.tee, 'leiaPdftotext() ei leidnud MITTE ÜHTEGI binaari, kui bare PATH-otsing oli '
    + 'blokeeritud ja PDFTOTEXT polnud seatud — kõvakodeeritud varukohtade nimekiri ei andnud '
    + 'sellel masinal ühtegi töötavat kandidaati');
  assert.ok(PDFTOTEXT_KANDIDAADID.includes(j2.tee),
    'leiaPdftotext() leidis binaari (' + j2.tee + '), mis EI OLE PDFTOTEXT_KANDIDAADID nimekirjas — '
    + 'see ei saa juhtuda, kui bare PATH-otsing on tõesti blokeeritud, seega on midagi katki '
    + 'kandidaatide-iteratsiooni ja PATH-blokeeringu vahel');
  console.log('PASS hanked-docs: PDFTOTEXT_KANDIDAADID varukohtade iteratsioon leiab töötava binaari ilma PATH-ita (PDF-2)');
}

console.log('PASS hanked-docs: ' + ok + ' kontrolli');
