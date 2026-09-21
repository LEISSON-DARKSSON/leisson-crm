// ULESANNE 14: minimaalne ZIP-lugeja. Sõltuvust EI TOODA SISSE.
//
// MIKS OMA LUGEJA. CRM on sõltuvusteta (node:sqlite, oma HTTP-server) ja see on
// teadlik: iga npm-pakett on uus tarneahela pind serveri all, mis loeb posti ja
// hoiab kliendiandmeid. `node:zlib` annab `inflateRawSync`-i, ZIP-i keskkataloog
// on 46 baiti kirje kohta - kogu puuduv osa on see fail.
//
// MIKS TA ON NII VALVAS. See zip tuleb VOORAST ALLIKAST (RHR-i hankedokumendid).
// Naiivne lugeja usaldab kolme asja, mida ei tohi usaldada:
//   1. KIRJE NIME - '../../evil.mjs' kirjutab kaustast välja (zip-slip). Nime
//      valve ei ole siin, vaid agent/hanked-docs.mjs turvalineSihtkoht-is, sest
//      ainult sealt on teada, KUHU pakitakse. Siin on ta ainult loetud.
//   2. PAKKIMISSUHET - 8 MB nulle pakib mõne kilobaidini; 50 sellist kirjet teeb
//      kettast prügi. Suhe ja kogumaht kontrollitakse KESKKATALOOGIST, ENNE kui
//      ükski bait lahti pakitakse.
//   3. DEKLAREERITUD MAHTU - keskkataloog VOIB VALETADA ('usize = 1', tegelik
//      sisu 2 GB). Seepärast antakse `inflateRawSync`-ile `maxOutputLength`:
//      mälu lagi tuleb zlib-ist endast, mitte meie heausksusest.
// Neljas valve on CRC32: ilma selleta ei tea me, kas lugesime õiget kohta -
// vale nihe annaks vaikselt prügi, mitte veateate.
//
// ZIP64 EI OLE TOETATUD ja see on NÄHTAV: üle 65 535 kirje või üle 4 GB zip
// annab eestikeelse vea, mitte vaikselt poole faili. Hankedokumentide zip on
// megabaitides - kui see kunagi muutub, tuleb punane rida, mitte vaikne kadu.
import { inflateRawSync } from 'node:zlib';

export const ZIP_PIIRID = Object.freeze({
  // Hankedokumente on tüüpiliselt 5-30. 2000 on lagi, mille taga ei ole enam
  // hankedokumendid, vaid rünne.
  maxFaile: 2000,
  // Kogu pakkimata maht. 512 MB on suurusjärk, mida päris hanke alusdokumendid
  // ei ületa (mõõdetud TAI 314159: 3,1 MB), aga zip-pomm ületab hetkega.
  maxKokku: 512 * 1024 * 1024,
  // Uhe kirje pakkimissuhe. Tavaline PDF pakib 1,0-1,5x, DOCX (juba zip) ~1,0x,
  // XML 5-15x. 200 jätab ausale failile varu ja lõikab pommi (nullid: 1000x+).
  maxSuhe: 200,
  // Suhet mõõdetakse alles siit alates: 12-baidine kirje, mis pakib 1 baidiks,
  // annab suhte 12 ja see ei ole pomm.
  minSuhtePakitud: 1024,
  // Uhe kirje pakkimata lagi (ka siis, kui kogumaht mahub).
  maxFail: 128 * 1024 * 1024,
});

const SIG_EOCD = 0x06054b50;
const SIG_CD = 0x02014b50;
const SIG_LOKAAL = 0x04034b50;
// S_IFMT / S_IFLNK / S_IFDIR unix-režiimist (external attributes ülemine 16 bitti).
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;

function viga(sonum) {
  const e = new Error(sonum);
  e.code = 400;
  return e;
}

// --- CRC32 -----------------------------------------------------------------
// Tabel ehitatakse UKS KORD mooduli laadimisel (256 kirjet).
const CRC_TABEL = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABEL[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- keskkataloog ----------------------------------------------------------

function leiaEocd(buf) {
  // Kommentaar voib olla kuni 65 535 baiti, seega otsime lõpust tagasi.
  const algus = Math.max(0, buf.length - (22 + 65535));
  for (let i = buf.length - 22; i >= algus; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * Loeb keskkataloogi ja teeb KOIK mahukontrollid ENNE lahtipakkimist.
 * @returns {{kirjed: Array, kokku: number, pakitud: number}}
 */
export function loeKeskkataloog(baidid, piirid = ZIP_PIIRID) {
  const buf = Buffer.isBuffer(baidid) ? baidid : Buffer.from(baidid);
  if (buf.length < 22) throw viga('See ei ole ZIP-fail: liiga lühike (' + buf.length + ' baiti)');
  const e = leiaEocd(buf);
  if (e < 0) throw viga('See ei ole ZIP-fail: keskkataloogi lõpumärgist (EOCD) ei leitud');

  const arv = buf.readUInt16LE(e + 10);
  const keskSuurus = buf.readUInt32LE(e + 12);
  const keskAlgus = buf.readUInt32LE(e + 16);
  if (arv === 0xffff || keskSuurus === 0xffffffff || keskAlgus === 0xffffffff) {
    throw viga('ZIP64-vormingus arhiiv ei ole toetatud — RHR-i zip on muutunud, vaata üle');
  }
  if (arv > piirid.maxFaile) {
    throw viga('ZIP sisaldab ' + arv + ' faili (lubatud ' + piirid.maxFaile + ') — jätame lahti pakkimata');
  }
  if (keskAlgus + keskSuurus > buf.length) throw viga('ZIP on katkine: keskkataloog jääb faili piiridest välja');

  const kirjed = [];
  let kokku = 0;
  let pakitudKokku = 0;
  let p = keskAlgus;
  for (let i = 0; i < arv; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CD) {
      throw viga('ZIP on katkine: keskkataloogi kirje ' + (i + 1) + ' ei alga õige märgisega');
    }
    const meetod = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const pakitud = buf.readUInt32LE(p + 20);
    const suurus = buf.readUInt32LE(p + 24);
    const nimeP = buf.readUInt16LE(p + 28);
    const extraP = buf.readUInt16LE(p + 30);
    const kommP = buf.readUInt16LE(p + 32);
    const mode = buf.readUInt32LE(p + 38) >>> 16;
    const offset = buf.readUInt32LE(p + 42);
    // MITTE-UTF-8 NIMI. Buffer.toString('utf8') asendab vigase baidi U+FFFD-ga
    // ja tulemus on NÄHTAV (turvalineSihtkoht keeldub U+FFFD sisaldavast nimest),
    // mitte vaikne mõttetu failinimi.
    const nimi = buf.toString('utf8', p + 46, p + 46 + nimeP);
    const kataloog = nimi.endsWith('/') || (mode & S_IFMT) === S_IFDIR;
    const sumlink = (mode & S_IFMT) === S_IFLNK;

    if (!kataloog && !sumlink) {
      if (suurus > piirid.maxFail) {
        throw viga('ZIP-i fail on liiga suur: ' + nimi + ' — ' + Math.round(suurus / 1048576)
          + ' MB (lubatud ' + Math.round(piirid.maxFail / 1048576) + ' MB)');
      }
      kokku += suurus;
      pakitudKokku += pakitud;
      if (pakitud >= piirid.minSuhtePakitud && suurus / pakitud > piirid.maxSuhe) {
        throw viga('ZIP-pommi kahtlus: ' + nimi + ' pakkimissuhe on '
          + Math.round(suurus / pakitud) + ':1 (lubatud ' + piirid.maxSuhe + ':1)');
      }
    }
    if (kokku > piirid.maxKokku) {
      throw viga('ZIP-i pakkimata maht on liiga suur: üle '
        + Math.round(piirid.maxKokku / 1048576) + ' MB — jätame lahti pakkimata');
    }
    kirjed.push({ nimi, meetod, crc, pakitud, suurus, offset, kataloog, sumlink, mode });
    p += 46 + nimeP + extraP + kommP;
  }
  return { kirjed, kokku, pakitud: pakitudKokku };
}

/**
 * Pakib UHE kirje lahti MALUS. Ketta peale kirjutamine on kutsuja töö (ainult
 * tema teab, kas sihtkoht on turvaline - vt turvalineSihtkoht).
 */
export function paki(baidid, kirje, piirid = ZIP_PIIRID) {
  const buf = Buffer.isBuffer(baidid) ? baidid : Buffer.from(baidid);
  if (kirje.kataloog) throw viga('Kataloogikirjet ei pakita lahti: ' + kirje.nimi);
  if (kirje.sumlink) throw viga('Sümlinkikirjet ei pakita lahti: ' + kirje.nimi);
  const p = kirje.offset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== SIG_LOKAAL) {
    throw viga('ZIP on katkine: kirje „' + kirje.nimi + '" lokaalne päis puudub');
  }
  // NIMEPIKKUS TULEB LOKAALSEST PAISEST, mitte keskkataloogist: nad VOIVAD
  // erineda (pahatahtlik zip teeb seda meelega) ja siis satuks andmete algus
  // valesse kohta - vaikselt.
  const algus = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const lopp = algus + kirje.pakitud;
  if (lopp > buf.length) throw viga('ZIP on katkine: kirje „' + kirje.nimi + '" andmed jäävad faili lõpust välja');
  const toores = buf.subarray(algus, lopp);

  let valja;
  if (kirje.meetod === 0) {
    valja = Buffer.from(toores);
  } else if (kirje.meetod === 8) {
    try {
      // maxOutputLength on KOVA LAGI: keskkataloogi `usize` voib valetada ja
      // ilma selleta soob valetav kirje kogu malu ara.
      valja = inflateRawSync(toores, { maxOutputLength: Math.max(1, kirje.suurus) });
    } catch (err) {
      if (/maxOutputLength|ERR_BUFFER_TOO_LARGE|buffer/i.test(String(err && (err.code || err.message)))) {
        throw viga('ZIP-pommi kahtlus: kirje „' + kirje.nimi
          + '" lahtipakkimine ületas lubatud mahu ' + kirje.suurus + ' baiti');
      }
      throw viga('ZIP-i kirjet „' + kirje.nimi + '" ei saanud lahti pakkida: '
        + String((err && err.message) || err).slice(0, 200));
    }
  } else {
    throw viga('ZIP-i pakkimismeetod ' + kirje.meetod + ' ei ole toetatud (kirje „' + kirje.nimi + '")');
  }
  if (valja.length !== kirje.suurus) {
    throw viga('ZIP-i kirje „' + kirje.nimi + '" maht ei klapi: lubati '
      + kirje.suurus + ', tuli ' + valja.length);
  }
  if (crc32(valja) !== (kirje.crc >>> 0)) {
    throw viga('ZIP-i kirje „' + kirje.nimi + '" kontrollsumma (CRC32) ei klapi — fail on rikutud');
  }
  return valja;
}

// --- DOCX ------------------------------------------------------------------

const OLEMID = new Map([['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"]]);

function olemid(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (kogu, k) => {
    if (k[0] === '#') {
      const n = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : kogu;
    }
    return OLEMID.has(k) ? OLEMID.get(k) : kogu;
  });
}

/**
 * DOCX -> tekst. DOCX ON ZIP + XML, seega ta käib sama lugeja alt läbi ja saab
 * sama pommikaitse.
 *
 * KRIITILINE KOHT: Word lõhub ÜHE sõna mitmeks `w:t` jooksuks (õigekirjakontroll,
 * kirjaviis, muudatuste jälitamine). Päris failis (Lisa 4 vorm III - CV
 * projektijuht.docx) on viitenumber kirjas kui `<w:t>31</w:t><w:t>4159</w:t>`.
 * Kui jooksud liita TÜHIKUGA - nagu teeb iga „strip tags" ühe rea lahendus -
 * tuleb tekstiks „31 4159" ja iga arvumuster (käibenõue, aastate arv, osakaal)
 * läheb vaikselt katki. Seega: jooksud liidetakse ILMA eraldajata ja lõigu
 * lõpp (`</w:p>`) annab reavahetuse.
 */
export function docxTekst(baidid, { maxXml = 32 * 1024 * 1024 } = {}) {
  const { kirjed } = loeKeskkataloog(baidid);
  const k = kirjed.find((x) => x.nimi === 'word/document.xml');
  if (!k) throw viga('See ei ole DOCX: word/document.xml puudub');
  if (k.suurus > maxXml) throw viga('DOCX-i word/document.xml on liiga suur: ' + k.suurus + ' baiti');
  const xml = paki(baidid, k).toString('utf8');
  return xmlTekstiks(xml);
}

export function xmlTekstiks(xml) {
  const t = xml
    .replace(/<w:tab\b[^>]*\/?>/g, ' ')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<[^>]*>/g, '');
  return olemid(t)
    .split('\n')
    .map((r) => r.replace(/[ \t ]+/g, ' ').replace(/ \| $/, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+$/, '');
}
