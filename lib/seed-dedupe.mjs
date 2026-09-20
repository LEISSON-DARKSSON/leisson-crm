// Nimepohine dubleerimiskontroll seed/*.json failide vahel.
//
// Tekkis 16.-17.09.2026 parast seda, kui uue Parnumaa partii (parnu3) otsinguagent
// jattis oma domeenipohise dedupe'iga kinni puudmata 6 ettevotet, mis olid CRM-is
// juba olemas reservitasemel (priority "R", url: null) -- domeeni jargi ei leia neid
// KUNAGI ules, sest neil pole domeeni. Kasitsi nimede ristkontroll leidis koik 6,
// see fail teeb sama kontrolli automaatselt: tapne vaste (sama id / url /
// registrikood / nimi peale legaalvormi eemaldamist) ja norgem vaste (jagatud
// haruldane sona, nt "Karjamoisa" vs "Karjamoisa Lihatoostus") kahe erineva
// nimekirjastiili vahel.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.mjs';
import { SEED_FILES } from './db.mjs';

const LEGAL_FORMS = new Set([
  'oy', 'ou', 'as', 'sa', 'mtu', 'fie', 'uu',
  'osauhing', 'aktsiaselts', 'sihtasutus',
  'taisuhing', 'usaldusuhing',
  'tulundusuhistu', 'tuh',
  'mittetulundusuhing',
]);

// Uldsonad, mis Parnumaa turismi-/majutusarides korduvad kummnetes eri
// ettevotete nimedes (hotell, villa, puhkekula, Parnu ise jne) -- need EI
// tohi kunagi UKSI dubleerimist tahistada, muidu upub tegelik signaal
// (nt "Karjamoisa") murasse. Legaalvormid ja need uldsonad eemaldatakse
// vordlusest taielikult, mollmal poolel vordselt -- see ei sega tapse vaste
// tuvastamist (nt "Parnu Vesi" vs "Parnu Vesi" jaab ikka vordseks parast
// eemaldamist), aga valdib "jagab sona 'hotell'" tuupi valehaireid.
const GENERIC_WORDS = new Set([
  'parnu', 'estonia', 'eesti', 'kihnu',
  'villa', 'hotell', 'hotel', 'hostel', 'motell', 'kamping', 'karavanikamping',
  'puhkekula', 'puhkekeskus', 'puhkemaja', 'kulalistemaja', 'kodumajutus',
  'majutus', 'resort', 'spa', 'spaa', 'boutique',
  'moisa', 'mois', 'sadam', 'rand', 'ranna', 'jarv', 'jarve',
  'keskus', 'grupp', 'group', 'teenused', 'ehitus', 'kaubandus',
]);

const MIN_SHARED_TOKEN_LEN = 5;
const MAX_RARE_TOKEN_FREQ = 2;

const COMBINING_MARKS = new RegExp('[̀-ͯ]', 'g');
const NON_ALNUM = new RegExp('[^a-z0-9\\s]', 'g');

export function normalizeName(name) {
  const ascii = String(name || '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NON_ALNUM, ' ');
  return ascii.split(/\s+/).filter(Boolean)
    .filter(t => !LEGAL_FORMS.has(t))
    .filter(t => !GENERIC_WORDS.has(t));
}

// Loendab, mitmes eri ettevotte nimes iga sona (peale legaalvormi/uldsona
// eemaldamist) esineb. Kasutatakse selleks, et "voimalik dubleerimine" ei
// pohineks lihtsalt pikal sonal, vaid HARULDASEL sonal -- sona, mis korpuses
// laiemalt ei kordu, on palju tugevam identiteedimark kui pelgalt >=5 tahte.
export function buildTokenFrequency(companies) {
  const freq = new Map();
  for (const c of companies) {
    for (const t of new Set(normalizeName(c.name))) {
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }
  return freq;
}

export function loadAllSeedCompanies(seedDir = join(ROOT, 'seed')) {
  const all = [];
  for (const f of SEED_FILES) {
    const p = join(seedDir, f);
    if (!existsSync(p)) continue;
    const data = JSON.parse(readFileSync(p, 'utf8'));
    for (const c of data.companies || []) all.push({ ...c, _file: f });
  }
  return all;
}

// Tagastab {kind:'exact'|'possible'|null, reason, match}. 'exact' peatab lisamise
// automaatselt; 'possible' peab jouma inimese silma alla (agent/add-prospects.mjs
// jatab need vaikimisi valja ja trukib nimekirjana; --include=<id> lubab uhe kirje
// siiski lisada, kui kasitsi kontroll kinnitab, et tegu ON erinev ettevote).
// tokenFreq on valikuline (buildTokenFrequency tulemus, arvutatuna KOGU
// korpuse pealt) -- kui puudub, arvutatakse see existingList pealt.
export function matchExisting(candidate, existingList, tokenFreq) {
  const freq = tokenFreq || buildTokenFrequency(existingList);
  const candTokens = normalizeName(candidate.name);
  const candJoined = candTokens.join(' ');
  const candUrl = (candidate.url || '').replace(/\/+$/, '').toLowerCase() || null;

  // KAKS LABIKAIKU, TAHTLIKULT. Kui labime nimekirja uhe korraga ja tagastame
  // koheselt esimese vaste peale (ukskoik, kas 'exact' voi 'possible'), siis
  // norgem ('possible') vaste MOnE VARASEMA kirje vastu peidab tugevama
  // ('exact') vaste, mis oleks leitud alles HILISEMA kirje vastu samas
  // nimekirjas -- naiteks kui parnu.json (varem SEED_FILES jarjekorras) sisaldab
  // sarnase nimega, aga TEIST ettevotet ("AS Nurme Turvas"), ja alles parnu2.json
  // (hiljem) sisaldab tegelikku dublikaati sama URL-iga ("OÜ NURME TEEDEEHITUS").
  // Avastati 20.09.2026 parnumaa4-7 partii impordil. Seepärast: labime KOGU
  // nimekirja labi tapsete vastete jaoks EEST, ja alles kui uhtegi tapset ei
  // leitud, labime uuesti norgema ('possible') vaste jaoks.
  for (const existing of existingList) {
    if (existing.id === candidate.id) {
      return { kind: 'exact', reason: 'sama id', match: existing };
    }
    if (candUrl && existing.url) {
      const exUrl = existing.url.replace(/\/+$/, '').toLowerCase();
      if (exUrl === candUrl) return { kind: 'exact', reason: 'sama url', match: existing };
    }
    if (candidate.regcode && existing.regcode && String(candidate.regcode) === String(existing.regcode)) {
      return { kind: 'exact', reason: 'sama registrikood', match: existing };
    }
    const exTokens = normalizeName(existing.name);
    const exJoined = exTokens.join(' ');
    if (candJoined && exJoined && candJoined === exJoined) {
      return { kind: 'exact', reason: 'sama normaliseeritud nimi', match: existing };
    }
  }

  for (const existing of existingList) {
    const exTokens = normalizeName(existing.name);
    const shared = candTokens.filter(t =>
      t.length >= MIN_SHARED_TOKEN_LEN &&
      (freq.get(t) || 0) <= MAX_RARE_TOKEN_FREQ &&
      exTokens.includes(t));
    if (shared.length > 0) {
      return { kind: 'possible', reason: 'jagatud haruldane sona: ' + shared.join(', '), match: existing };
    }
  }
  return { kind: null, reason: null, match: null };
}
