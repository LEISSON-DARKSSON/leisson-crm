// Äriregistri avaandmete LUGEMISKIHT (võrguta, ilma andmebaasita).
//
// Miks see olemas on: CRM-i ettevõtetel puudus stabiilne identiteet. Dedupe
// pidi seepärast toetuma nimedele ja haruldastele sõnadele, ja seda loogikat
// on juba KAKS korda parandatud (17.09 ja 20.09.2026, vt lib/seed-dedupe.mjs).
// Äriregistri kood on see puuduv võti. Lisaks annab register kaks numbrit,
// mida me seni ei teadnud ja mille peal seisab meie kõige riskantsem väide
// kirjades: töötajate arv ja käive (TTJA mikroettevõtja erand).
//
// Failid tekitavad agent/registry-sync.mjs, -enrich.mjs ja -financials.mjs.
// Kõik on data/ all ehk GITIST VÄLJAS — need on masina vahemälu, mitte kood.
//
// ⚠ Seda moodulit EI kasuta server.mjs. Täisregister on 378k kirjet; lugemine
// võtab sekundeid ja sadu MB mälu. Koht on partiiskriptides ja väravates.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.mjs';

export const REGISTRY_DIR = join(ROOT, 'data', 'registry');
export const REGISTRY_FILE = join(REGISTRY_DIR, 'registry.ndjson');
export const CONTACTS_FILE = join(REGISTRY_DIR, 'contacts.ndjson');
export const FINANCIALS_FILE = join(REGISTRY_DIR, 'financials.ndjson');
export const META_FILE = join(REGISTRY_DIR, 'meta.json');
// Kitsas projektsioon AINULT nendest ettevõtetest, kes on meie seed-korpuses.
// Väravad loevad seda, mitte 88 MB registrit — muidu maksaks iga `npm test`
// paar sekundit ja sadu MB mälu. Kirjutab agent/registry-backfill.mjs.
export const SEED_PROFILE_FILE = join(REGISTRY_DIR, 'seed-profiil.json');

// TTJA: toodete ja teenuste ligipääsetavuse nõuded kehtivad alates
// 28.06.2025. Mikroettevõtja erand on ALLA 10 töötaja JA KUNI 2 M€ käive —
// mõlemad korraga. Vt project_parnu_outreach mälu ja test/gate-registry.mjs.
export const MIKRO_TOOTAJAD_MAX = 10;
export const MIKRO_KAIVE_MAX = 2_000_000;

const LEGAL_FORMS = new Set([
  'ou', 'oy', 'as', 'sa', 'mtu', 'fie', 'uu', 'tu', 'tuh', 'ku', 'ky',
  'osauhing', 'aktsiaselts', 'sihtasutus', 'mittetulundusuhing',
  'usaldusuhing', 'taisuhing', 'tulundusuhistu', 'korteriuhistu',
  'filiaal', 'ltd', 'oue',
]);

const COMBINING_MARKS = /[̀-ͯ]/g;
const NON_ALNUM = /[^a-z0-9\s]/g;

// NB! See EI OLE sama normaliseerija mis lib/seed-dedupe.mjs-is. Seal
// eemaldatakse lisaks Pärnumaa turismiärides korduvad üldsõnad (hotell,
// villa, Pärnu ...), sest seal võrreldakse kahte inimese kirjutatud nime.
// Siin võrdleme ametliku registrinimega, kus "Pärnu Vesi" ongi kogu nimi —
// üldsõna eemaldamine teeks vastest mõttetu tüve. Ainus, mis maha läheb, on
// õiguslik vorm ja kirjavahemärgid.
export function normalizeRegName(name) {
  const ascii = String(name || '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/õ/g, 'o')
    .replace(NON_ALNUM, ' ');
  return ascii.split(/\s+/).filter(Boolean).filter((t) => !LEGAL_FORMS.has(t)).join(' ');
}

function readNdjson(path) {
  if (!existsSync(path)) return null;
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue;
    out.push(JSON.parse(line));
  }
  return out;
}

export function loadSeedProfile() {
  if (!existsSync(SEED_PROFILE_FILE)) return null;
  return JSON.parse(readFileSync(SEED_PROFILE_FILE, 'utf8'));
}

export function registryStatus() {
  const file = (p) => (existsSync(p) ? { olemas: true, baite: statSync(p).size, muudetud: statSync(p).mtime.toISOString() } : { olemas: false });
  return {
    registry: file(REGISTRY_FILE),
    contacts: file(CONTACTS_FILE),
    financials: file(FINANCIALS_FILE),
    meta: existsSync(META_FILE) ? JSON.parse(readFileSync(META_FILE, 'utf8')) : null,
  };
}

// Registri indeks. byName väärtus on MASSIIV — kui kaks ettevõtet
// normaliseeruvad sama nimeni, ei tohi kumbagi vaikides valida.
export function loadRegistry({ onlyActive = true } = {}) {
  const rows = readNdjson(REGISTRY_FILE);
  if (!rows) return null;
  const byCode = new Map();
  const byName = new Map();
  for (const r of rows) {
    if (onlyActive && r.staatus !== 'R') continue;
    byCode.set(String(r.kood), r);
    const list = byName.get(r.norm);
    if (list) list.push(r); else byName.set(r.norm, [r]);
  }
  return { rows, byCode, byName };
}

export function loadContacts() {
  const rows = readNdjson(CONTACTS_FILE);
  if (!rows) return null;
  return new Map(rows.map((r) => [String(r.kood), r]));
}

// Mitu aastat ühe ettevõtte kohta -> jätame viimase esitatud aruande.
export function loadFinancials() {
  const rows = readNdjson(FINANCIALS_FILE);
  if (!rows) return null;
  const byCode = new Map();
  for (const r of rows) {
    const k = String(r.kood);
    const prev = byCode.get(k);
    if (!prev || r.aasta > prev.aasta) byCode.set(k, r);
  }
  return byCode;
}

// Leiab ettevõtte registrist. Tagastab alati kindluse ja põhjuse — vaikivat
// "parimat oletust" siin ei ole, sest vale kood on halvem kui puuduv kood.
export function resolveCompany({ name, regcode }, index) {
  if (!index) return { kood: null, kindlus: null, pohjus: 'register puudub (npm run registry:sync)' };
  if (regcode) {
    const hit = index.byCode.get(String(regcode));
    if (hit) return { kood: String(regcode), kirje: hit, kindlus: 'kood', pohjus: 'olemasolev registrikood leiti registrist' };
    return { kood: String(regcode), kirje: null, kindlus: 'kood-tundmatu', pohjus: 'olemasolevat registrikoodi EI OLE aktiivsete seas' };
  }
  const norm = normalizeRegName(name);
  if (!norm) return { kood: null, kindlus: null, pohjus: 'nimi normaliseerus tühjaks' };
  const hits = index.byName.get(norm);
  if (!hits || hits.length === 0) return { kood: null, kindlus: null, pohjus: 'nime järgi ei leitud' };
  if (hits.length > 1) {
    return { kood: null, kirje: null, kindlus: 'mitmene', pohjus: `sama nimi ${hits.length} korda: ` + hits.map((h) => h.kood).join(', '), kandidaadid: hits };
  }
  return { kood: String(hits[0].kood), kirje: hits[0], kindlus: 'nimi', pohjus: 'täpne normaliseeritud nimevaste' };
}

// TTJA mikroettevõtja erandi kontroll. teada=false tähendab, et me EI TEA —
// ja see ei ole sama mis "ei ole mikroettevõtja". Värav käsitleb teadmatust
// eraldi juhuna, mitte rohelisena.
export function mikroettevotja(kood, { contacts, financials } = {}) {
  const k = String(kood || '');
  const fin = financials && financials.get(k);
  const con = contacts && contacts.get(k);
  const tootajad = fin && fin.tootajad != null ? fin.tootajad : (con && con.tootajad != null ? con.tootajad : null);
  const kaive = fin && fin.kaive != null ? fin.kaive : null;
  const allikas = fin ? `majandusaasta aruanne ${fin.aasta}` : (con && con.tootajad != null ? `registri aruandeinfo ${con.tootajad_aasta || ''}`.trim() : null);

  // Erand nõuab MÕLEMAT tingimust korraga. Seega üksainus ületatud lävi
  // otsustab juba ära, et tegu EI OLE mikroettevõtjaga — teist numbrit pole
  // siis vajagi. Näide: Sihtasutus Endla Teater, 90 töötajat, käive
  // avaandmetes puudu (sihtasutused esitavad teise vormi) — vastus on
  // ikkagi kindel "ei ole mikroettevõtja".
  if (tootajad != null && tootajad >= MIKRO_TOOTAJAD_MAX) {
    return { teada: true, mikro: false, tootajad, kaive, allikas, pohjus: `${tootajad} töötajat (lävi ${MIKRO_TOOTAJAD_MAX})` };
  }
  if (kaive != null && kaive > MIKRO_KAIVE_MAX) {
    return { teada: true, mikro: false, tootajad, kaive, allikas, pohjus: `käive ${Math.round(kaive)} € (lävi ${MIKRO_KAIVE_MAX})` };
  }
  if (tootajad == null || kaive == null) {
    return { teada: false, mikro: null, tootajad, kaive, allikas, pohjus: 'töötajate arv või käive puudub ja kumbki lävi ei ole ületatud' };
  }
  return { teada: true, mikro: true, tootajad, kaive, allikas, pohjus: `${tootajad} töötajat, käive ${Math.round(kaive)} € — mõlemad läve all` };
}

// Semikooloniga eraldatud rida, mis austab jutumärke. Äriregistri lihtandmete
// CSV-s on 378 163 reast neli sellist, kus aadressiväli sisaldab ise
// semikoolonit ("postiaadress: Sõle 51-69; asukoht:") — naiivne split lõhuks
// need read vaikselt valedeks veergudeks.
export function splitCsvLine(line, sep = ';') {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i += 1; }
      else inQuotes = !inQuotes;
      continue;
    }
    if (ch === sep && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// --- Domeenivaste ----------------------------------------------------------
// 35 meie 128-st sihtmärgist on kirjas KAUBAMÄRGINIMEGA ("Hedon Spa & Hotel",
// "Karjamõisa Lihatööstus"), mitte ärinimega — nimevaste ei leia neid kunagi.
// Aga registri e-posti kate on 97,8 % ja e-posti domeen on peaaegu alati sama
// mis ettevõtte veebileht. Seega: domeen on teine, sõltumatu identiteedivõti.
// Mõõdetud tulemus: nimevaste leidis 31, domeen lisas veel 17 — ja tabas ühe
// vaikiva vea, mille nimevaste oleks teinud (Ranna Villa: nimevaste osutas
// Saaremaa firmale, domeen Pärnu omale).
//
// Tasuta postkastid tuleb VÄLJA jätta — nende taga on tuhanded eri ettevõtted
// ja üksainus vaste oleks juhuslik.
export const YLDISED_POSTIDOMEENID = new Set([
  'gmail.com', 'hot.ee', 'mail.ee', 'hotmail.com', 'outlook.com', 'yahoo.com',
  'live.com', 'icloud.com', 'me.com', 'msn.com', 'online.ee', 'neti.ee',
  'inbox.lv', 'mail.ru', 'yandex.ru', 'protonmail.com', 'proton.me', 'gmx.com',
]);

export function domeenist(vaartus) {
  if (!vaartus) return null;
  let s = String(vaartus).trim().toLowerCase();
  const at = s.lastIndexOf('@');
  if (at >= 0) s = s.slice(at + 1);
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split(/[/:?#]/)[0];
  s = s.replace(/\.$/, '');
  if (!s || !s.includes('.') || YLDISED_POSTIDOMEENID.has(s)) return null;
  return s;
}

// domeen -> [kood, ...]. Mitme koodiga domeen (nt ühe grupi mitu firmat) ei
// ole identiteedivõti ja jääb resolve'is kasutamata.
export function loadDomainIndex(contacts) {
  const src = contacts || loadContacts();
  if (!src) return null;
  const idx = new Map();
  for (const rec of src.values()) {
    const domeenid = new Set();
    for (const e of rec.email || []) { const d = domeenist(e); if (d) domeenid.add(d); }
    for (const w of rec.www || []) { const d = domeenist(w); if (d) domeenid.add(d); }
    for (const d of domeenid) {
      const list = idx.get(d);
      if (list) { if (!list.includes(rec.kood)) list.push(rec.kood); }
      else idx.set(d, [rec.kood]);
    }
  }
  return idx;
}

// Kaks sõltumatut võtit korraga: nimi ja domeen. Kui mõlemad annavad vastuse
// ja need EI KATTU, ei vali kumbagi — see on andmeviga, mitte valikukoht.
export function resolveWithDomain(company, index, domainIndex) {
  const nimiVaste = resolveCompany(company, index);
  if (nimiVaste.kindlus === 'kood' || nimiVaste.kindlus === 'kood-tundmatu') return nimiVaste;

  let domeeniKood = null; let domeeniAllikas = null;
  if (domainIndex) {
    for (const kandidaat of [company.url, company.email]) {
      const d = domeenist(kandidaat);
      if (!d) continue;
      const hits = domainIndex.get(d);
      if (hits && hits.length === 1) { domeeniKood = String(hits[0]); domeeniAllikas = d; break; }
      if (hits && hits.length > 1 && !domeeniKood) { domeeniAllikas = `${d} (${hits.length} ettevõtet — ei kasuta)`; }
    }
  }

  if (nimiVaste.kindlus === 'nimi') {
    if (domeeniKood && domeeniKood !== nimiVaste.kood) {
      return { kood: null, kindlus: 'vastuolu', pohjus: `nimi annab ${nimiVaste.kood}, domeen ${domeeniAllikas} annab ${domeeniKood}` };
    }
    return nimiVaste;
  }
  if (domeeniKood) {
    return { kood: domeeniKood, kirje: index.byCode.get(domeeniKood) || null, kindlus: 'domeen', pohjus: `domeenivaste ${domeeniAllikas}` };
  }
  return nimiVaste;
}
