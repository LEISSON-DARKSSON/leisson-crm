#!/usr/bin/env node
// Lisab uue partii sihtettevõtteid seed/*.json faili, kontrollides enne
// dubleerimist KOGU seed-korpuse vastu (kõik failid, sh reservitase
// url:null kirjetega) — mitte ainult sihtfaili enda vastu ja mitte ainult
// domeeni järgi. Tekkis 17.09.2026 pärast seda, kui parnu3 partii puhul tuli
// 6 dublit käsitsi kinni püüda, sest need olid CRM-is reservis ilma domeenita.
//
// Kasutus:
//   node agent/add-prospects.mjs <kandidaadid.json> [--target=seed/parnu2.json] [--include=id1,id2]
//
// Täpsed dublid (sama id / url / registrikood / normaliseeritud nimi) JÄETAKSE
// VÄLJA alati. Nõrgemad ("võimalikud") dublid — jagatud pikk sõna nimes,
// nt "Karjamõisa" vs "Karjamõisa Lihatööstus" — jäetakse samuti vaikimisi
// välja ja trükitakse eraldi nimekirjana; --include=<id> lisab konkreetse
// kandidaadi siiski, kui käsitsi kontroll kinnitab, et tegu ON erinev firma.
//
// See skript EI puuduta töötavat serverit ega SQLite andmebaasi — ainult
// kirjutab JSON-faili. Pärast käivitamist tuleb server käsitsi taaskäivitada
// (win/restart-server.ps1), et seed() need read sisse loeks.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadAllSeedCompanies, matchExisting, buildTokenFrequency } from '../lib/seed-dedupe.mjs';
import { loadRegistry, loadDomainIndex, resolveWithDomain } from '../lib/registry.mjs';

const args = process.argv.slice(2);
const candidatesPath = args.find(a => !a.startsWith('--'));
const targetArg = args.find(a => a.startsWith('--target='));
const includeArg = args.find(a => a.startsWith('--include='));

if (!candidatesPath) {
  console.error('Kasuta: node agent/add-prospects.mjs <kandidaadid.json> [--target=seed/parnu2.json] [--include=id1,id2]');
  process.exit(1);
}
const targetPath = targetArg ? targetArg.slice('--target='.length) : 'seed/parnu2.json';
const included = new Set(includeArg ? includeArg.slice('--include='.length).split(',').filter(Boolean) : []);

const absCandidates = resolve(process.cwd(), candidatesPath);
const absTarget = resolve(process.cwd(), targetPath);
if (!existsSync(absCandidates)) { console.error('Ei leia:', absCandidates); process.exit(1); }
if (!existsSync(absTarget)) { console.error('Ei leia sihtfaili:', absTarget); process.exit(1); }

const candidates = JSON.parse(readFileSync(absCandidates, 'utf8'));
const targetData = JSON.parse(readFileSync(absTarget, 'utf8'));
const existingAll = loadAllSeedCompanies(); // kõik seed-failid, sh sihtfail ise
const existingIds = new Set(existingAll.map(c => c.id));
const tokenFreq = buildTokenFrequency(existingAll);

// SAMM 0: anna igale kandidaadile registrikood ENNE dubleerimiskontrolli.
// Ilma koodita otsustab matchExisting nimede ja haruldaste sõnade järgi ning
// just seda loogikat on kaks korda parandatud (17.09 ja 20.09.2026). Koodiga
// tabab esimene reegel ("sama registrikood") dubli kohe ja eksimatult.
// Kui registrit ei ole laetud, käitub skript täpselt nagu varem.
const registryIndex = loadRegistry();
const domainIndex = registryIndex ? loadDomainIndex() : null;
if (!registryIndex) {
  console.log('MÄRKUS: data/registry puudub — jätkan ainult nimepõhise kontrolliga.');
  console.log('        Soovitus: npm run registry:update (18,5 MB, ~10 s).');
} else {
  let lahendatud = 0;
  const vastuolud = [];
  for (const c of candidates) {
    if (c.regcode) continue;
    const r = resolveWithDomain({ name: c.name, regcode: null, url: c.url, email: c.email }, registryIndex, domainIndex);
    if (r.kindlus === 'nimi' || r.kindlus === 'domeen') {
      c.regcode = r.kood;
      c.regcode_allikas = `ariregister-${r.kindlus}`;
      lahendatud += 1;
    } else if (r.kindlus === 'vastuolu') {
      vastuolud.push(`${c.id} (${c.name}) — ${r.pohjus}`);
    }
  }
  console.log(`Äriregistrist leitud registrikoodi: ${lahendatud}/${candidates.length}`);
  if (vastuolud.length) {
    console.log('⚠ Nimi ja domeen osutavad ERI ettevõttele — kood jäi täitmata, kontrolli käsitsi:');
    for (const v of vastuolud) console.log('  ! ' + v);
  }
}

const toAdd = [];
const skippedExact = [];
const skippedPossible = [];

for (const c of candidates) {
  if (existingIds.has(c.id) && !included.has(c.id)) {
    skippedExact.push({ id: c.id, name: c.name, reason: 'sama id juba olemas' });
    continue;
  }
  const result = matchExisting(c, existingAll, tokenFreq);
  if (result.kind === 'exact' && !included.has(c.id)) {
    skippedExact.push({ id: c.id, name: c.name, reason: result.reason, matchId: result.match.id, matchFile: result.match._file });
    continue;
  }
  if (result.kind === 'possible' && !included.has(c.id)) {
    skippedPossible.push({ id: c.id, name: c.name, reason: result.reason, matchId: result.match.id, matchName: result.match.name, matchFile: result.match._file });
    continue;
  }
  toAdd.push(c);
}

console.log(`Kandidaate kokku: ${candidates.length}`);
console.log(`Lisatakse: ${toAdd.length} — ${toAdd.map(c => c.id).join(', ') || '(pole)'}`);
if (skippedExact.length) {
  console.log(`\nTÄPSED DUBLID (jäeti välja):`);
  for (const s of skippedExact) console.log(`  - ${s.id} (${s.name}) — ${s.reason}${s.matchId ? ` [vaste: ${s.matchId} failis ${s.matchFile}]` : ''}`);
}
if (skippedPossible.length) {
  console.log(`\nVÕIMALIKUD DUBLID — vajavad käsitsi kontrolli (jäeti välja, kinnita --include=id abil):`);
  for (const s of skippedPossible) console.log(`  - ${s.id} (${s.name}) — ${s.reason} [vaste: ${s.matchId} "${s.matchName}" failis ${s.matchFile}]`);
}

if (toAdd.length === 0) {
  console.log('\nMidagi ei lisatud.');
  process.exit(0);
}

targetData.companies.push(...toAdd);
writeFileSync(absTarget, JSON.stringify(targetData, null, 2) + '\n', 'utf8');
console.log(`\nKirjutatud: ${targetPath} (uus kokku: ${targetData.companies.length})`);
console.log('Järgmine samm: taaskäivita server (win/restart-server.ps1), siis kontrolli /api/state.');
