#!/usr/bin/env node
// Veebilehe e-posti fallback seed-ettevõtetele, kellel on url, aga e-post
// puudub Äriregistri kontaktivoos (agent/registry-enrich.mjs katab Pärnu
// maakonnas ~97,8% e-postiga, aga MITTE 100% — vt project_parnu_outreach.md
// 20.09.2026 kanne "E-posti puuduse tagasiuurimine": käsitsi kontrollitud
// näide oli 11/12 leitav ettevõtte enda veebilehelt).
//
// KIRJUTAB ainult siis, kui leid on KINDEL: täpselt üks e-post, ettevõtte
// ENDA saidi domeenilt (mitte jagatud majutus/haldusfirma domeenilt). Sama
// reegel, mis registry-backfill.mjs kasutab registrikoodi jaoks: "vale on
// halvem kui puuduv". Ebakindel leid (mitu domeeni, ainult võõras domeen,
// midagi ei leitud) läheb ainult aruandesse — seed jääb puutumata.
//
// Vaikimisi KUIVALT (ei kirjuta midagi). Kirjutamiseks: --kirjuta
// lib/db.mjs seed() täidab olemasoleva (juba DB-s oleva) rea e-posti ainult
// siis, kui see on seal tühi — täpselt sama reegel, mis regcode'il juba on.
//
// Kasutus:
//   node agent/registry-website-fallback.mjs                 # aruanne
//   node agent/registry-website-fallback.mjs --kirjuta
//   node agent/registry-website-fallback.mjs --limit=10 --kirjuta  # ettevaatlik esmajooks
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/env.mjs';
import { SEED_FILES } from '../lib/db.mjs';

const UA = 'Mozilla/5.0 (compatible; LeissonContactLookup/1.0; +https://leisson.eu/et/kontakt)';
const FETCH_TIMEOUT_MS = 8000;
const CONTACT_PATHS = ['/kontakt', '/contact', '/kontaktid', '/en/contact'];
const JUNK_LOCAL = /^(no-?reply|donotreply|unsubscribe|postmaster|abuse|mailer-daemon|webmaster)$/i;
const JUNK_DOMAIN = /(sentry\.io|wixpress\.com|godaddy\.com|example\.(com|org)|schema\.org|w3\.org|googleapis\.com|gstatic\.com|cloudflare\.com|github\.io|wordpress\.com|gravatar\.com)$/i;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const MAILTO_RE = /href\s*=\s*["']mailto:([^"'?>\s]+)/gi;

export function registrableDomain(hostOrUrl) {
  try {
    const host = hostOrUrl.includes('://') ? new URL(hostOrUrl).hostname : hostOrUrl;
    const parts = host.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
    return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
  } catch { return null; }
}

export function isJunkEmail(addr) {
  const m = /^([^@]+)@(.+)$/.exec(addr || '');
  if (!m) return true;
  const [, local, domain] = m;
  if (JUNK_LOCAL.test(local)) return true;
  if (JUNK_DOMAIN.test(domain)) return true;
  if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(domain)) return true;
  return false;
}

// Kogub e-posti kandidaadid ühelt HTML-lehelt: kõigepealt mailto: lingid
// (kindlam — need on autor ise nii märkinud), siis vabateksti e-posti
// mustrid (nt jaluses ilma mailto lingita kirjutatud aadress).
export function extractCandidates(html) {
  const found = new Set();
  let m;
  MAILTO_RE.lastIndex = 0;
  while ((m = MAILTO_RE.exec(html))) {
    const addr = decodeURIComponent(m[1]).trim().toLowerCase();
    if (addr && !isJunkEmail(addr)) found.add(addr);
  }
  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(html))) {
    const addr = m[0].toLowerCase();
    if (!isJunkEmail(addr)) found.add(addr);
  }
  return [...found];
}

// Otsustab kogutud kandidaatide pealt. KINDEL ainult siis, kui täpselt üks
// e-post on ettevõtte enda saidi domeenilt — muidu jääb kirjutamata.
export function decide(candidates, siteDomain) {
  if (!candidates.length) return { status: 'puudub', email: null, reason: 'ühtegi e-posti ei leitud' };
  const own = siteDomain ? candidates.filter((a) => registrableDomain(a.split('@')[1]) === siteDomain) : [];
  if (own.length === 1) return { status: 'kindel', email: own[0], reason: 'üks vaste ettevõtte enda domeenilt' };
  if (own.length > 1) {
    return { status: 'ebakindel', email: null, reason: `${own.length} erinevat vastet enda domeenilt: ${own.join(', ')}` };
  }
  return { status: 'ebakindel', email: null, reason: `ainult võõralt domeenilt: ${candidates.join(', ')}` };
}

async function fetchText(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' });
    clearTimeout(t);
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('html') && !ct.includes('text')) return null;
    return await r.text();
  } catch { clearTimeout(t); return null; }
}

async function lookup(url) {
  let base;
  try { base = new URL(url); } catch { return { status: 'puudub', email: null, reason: 'vigane url' }; }
  const siteDomain = registrableDomain(base.hostname);
  const candidates = [];
  const home = await fetchText(base.origin);
  if (home) candidates.push(...extractCandidates(home));
  let d = decide([...new Set(candidates)], siteDomain);
  if (d.status !== 'kindel') {
    for (const path of CONTACT_PATHS) {
      const html = await fetchText(base.origin + path);
      if (html) candidates.push(...extractCandidates(html));
      d = decide([...new Set(candidates)], siteDomain);
      if (d.status === 'kindel') break;
    }
  }
  return d;
}

async function main() {
  const kirjuta = process.argv.includes('--kirjuta');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity;

  const kokkuvote = { kindel: [], ebakindel: [], puudub: [], vahele_jaetud: 0 };
  let vaadatud = 0;

  for (const f of SEED_FILES) {
    const p = join(ROOT, 'seed', f);
    if (!existsSync(p)) continue;
    const data = JSON.parse(readFileSync(p, 'utf8'));
    let failiMuutusi = 0;

    for (const c of data.companies || []) {
      if (c.email || !c.url) { kokkuvote.vahele_jaetud += 1; continue; }
      if (vaadatud >= limit) continue;
      vaadatud += 1;
      const d = await lookup(c.url);
      if (d.status === 'kindel') {
        kokkuvote.kindel.push({ f, id: c.id, name: c.name, email: d.email });
        if (kirjuta) { c.email = d.email; c.email_note = null; c.email_allikas = 'veebileht-automaatne'; failiMuutusi += 1; }
      } else if (d.status === 'ebakindel') {
        kokkuvote.ebakindel.push({ f, id: c.id, name: c.name, reason: d.reason });
      } else {
        kokkuvote.puudub.push({ f, id: c.id, name: c.name });
      }
    }

    if (kirjuta && failiMuutusi) {
      writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
      console.log(`Kirjutatud ${f}: ${failiMuutusi} e-posti`);
    }
  }

  console.log(`\nKindel leid (${kirjuta ? 'kirjutatud' : 'kirjutamata, vaata --kirjuta'}): ${kokkuvote.kindel.length}`);
  for (const r of kokkuvote.kindel) console.log(`  + ${r.id} (${r.name}) -> ${r.email}`);
  if (kokkuvote.ebakindel.length) {
    console.log(`\n⚠ Ebakindel — EI KIRJUTATUD, vajab inimest: ${kokkuvote.ebakindel.length}`);
    for (const r of kokkuvote.ebakindel) console.log(`  ? ${r.id} (${r.name}) — ${r.reason}`);
  }
  console.log(`\nEi leitud midagi: ${kokkuvote.puudub.length}`);
  console.log(`Vahele jäetud (e-post juba olemas või url puudub): ${kokkuvote.vahele_jaetud}`);
  if (!kirjuta) console.log('\nKUIV JOOKS — seed-faile ei muudetud. Kirjutamiseks: node agent/registry-website-fallback.mjs --kirjuta');
}

if (process.argv[1]?.endsWith('registry-website-fallback.mjs')) {
  main().catch((e) => { console.error('registry-website-fallback nurjus:', e.message); process.exit(1); });
}
