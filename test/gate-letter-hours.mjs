import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SERVICES } from '../../packages/service-catalog/index.mjs';
import { loadAllSeedCompanies } from '../lib/seed-dedupe.mjs';
import { open } from '../lib/db.mjs';
import { ROOT } from '../lib/env.mjs';

// See varav kaitseb 20.09.2026 leitud vea kordumise eest: kirja kehas vabalt
// tekstina kirjutatud "kuni N tundi" laknes teenuse tegelikust
// packages/service-catalog tunnimaarast lahku (nt AS SA.MET kirjas seisis
// "1450 € (kuni 10 tundi)", kuigi ux-audit-evidence/1450€ teenuse tegelik
// maht on 30 tundi -- lugejale naib pakkumine seetottu ~145 EUR/h, kuigi
// tegelik tunnihind on kataloogi 50 EUR/h). Auditist selgus 14 vigast kirja
// seed-korpuses ja elavas andmebaasis, kolm neist minu enda samal paeval
// kirjutatud uute kirjade seas -- st see EI OLE uhekordne libastus, vaid
// klass viga, mis kordub, kui tunnid kirjutatakse kirja kasitsi, mitte ei
// tuletata kataloogist. Vt ka crm/win/tmp/fix-hours.mjs ja
// crm/win/tmp/fix-seed-hours.mjs (parandused 20.09.2026).
//
// Kataloogi hind -> tunnid, ainult teenustele, kus tunnid on maaratud
// (nt ux-audit-pro on fikseeritud toode ilma tunnimaarata -- see jaetakse
// vordlusest valja, sest sealt ei saa "kuni N tundi" fraasi eeldada).
const HOURS_BY_PRICE = new Map(
  SERVICES.filter((s) => typeof s.hours === 'number').map((s) => [s.price, s.hours]),
);

function findMismatches(rows) {
  const bad = [];
  for (const r of rows) {
    if (!r.body) continue;
    const m = r.body.match(/kuni (\d+)\s*tund/i);
    if (!m) continue;
    const statedHours = Number(m[1]);
    const canonHours = HOURS_BY_PRICE.get(r.price);
    if (canonHours != null && statedHours !== canonHours) {
      bad.push({ id: r.id, name: r.name, file: r._file, price: r.price, statedHours, canonHours });
    }
  }
  return bad;
}

// seed/*.json on .gitignore'is (privaatne muugiandmestik) -- CI-s ja varskes
// kloonis neid ei ole, korpusekontroll jaab siis vahele (nagu gate-seed-dedupe.mjs
// puhul). Elava andmebaasi (data/crm.sqlite) kontroll on samal pohjusel valikuline.
const seedCompanies = loadAllSeedCompanies();
if (seedCompanies.length === 0) {
  console.log('INFO letter-hours: seed/*.json puuduvad (CI voi varske kloon) -- seed-korpuse kontroll jai vahele.');
} else {
  const bad = findMismatches(seedCompanies);
  assert.equal(bad.length, 0,
    `Seed-korpuses on ${bad.length} kirja, kus "kuni N tundi" ei vasta kataloogi tunnimaarale: ` +
    bad.map((b) => `${b.id} (${b.file}): kirjas ${b.statedHours}h, hind ${b.price}€ -> peaks olema ${b.canonHours}h`).join('; '));
  console.log(`PASS letter-hours (seed): ${seedCompanies.length} kirjet kontrollitud, 0 mittevastavust.`);
}

const dbPath = join(ROOT, 'data', 'crm.sqlite');
if (!existsSync(dbPath)) {
  console.log('INFO letter-hours: data/crm.sqlite puudub (CI voi varske kloon) -- elava andmebaasi kontroll jai vahele.');
} else {
  const db = open({ dbPath });
  const rows = db.prepare("SELECT id, name, offer, price, body FROM companies WHERE body IS NOT NULL AND body != ''").all();
  db.close();
  const bad = findMismatches(rows);
  assert.equal(bad.length, 0,
    `Elavas andmebaasis on ${bad.length} kirja, kus "kuni N tundi" ei vasta kataloogi tunnimaarale: ` +
    bad.map((b) => `${b.id}: kirjas ${b.statedHours}h, hind ${b.price}€ -> peaks olema ${b.canonHours}h`).join('; '));
  console.log(`PASS letter-hours (db): ${rows.length} kirjet kontrollitud, 0 mittevastavust.`);
}

// REGRESSIOONITEST, jookseb ALATI (ka CI-s ilma seed/db-ta), sest tema
// kaitseb tuvastusloogikat ennast, mitte konkreetset andmeseisu.
{
  const ok = { id: 'gate-oige', name: 'Oige OU', price: 1450, body: 'Pakun: UX + ligipaasetavus -- 1450 EUR (kuni 30 tundi).' };
  const bad1450 = { id: 'gate-vale-1450', name: 'Vale OU', price: 1450, body: 'Pakun: UX + ligipaasetavus -- 1450 EUR (kuni 10 tundi).' };
  const bad1900 = { id: 'gate-vale-1900', name: 'Vale2 OU', price: 1900, body: 'Pakun: Next.js kiirussprint -- 1900 EUR (kuni 30 tundi).' };
  const noHoursText = { id: 'gate-ilma-tunnita', name: 'Ilma Tunnita OU', price: 1450, body: 'Pakun UX auditit.' };
  const noCatalogMatch = { id: 'gate-tundmatu-hind', name: 'Tundmatu OU', price: 12345, body: 'kuni 5 tundi' };

  const res = findMismatches([ok, bad1450, bad1900, noHoursText, noCatalogMatch]);
  const ids = res.map((r) => r.id);
  assert.deepEqual(ids, ['gate-vale-1450', 'gate-vale-1900'],
    'Tuvastusloogika peab leidma tapselt kaks mittevastavust (1450€/10h ja 1900€/30h) ega tohi loomata valehaireid oige kirja, tunnideta kirja ega tundmatu hinna puhul.');
  assert.equal(HOURS_BY_PRICE.get(1450), 30, 'ux-audit-evidence kataloogi tunnimaar peab olema 30');
  assert.equal(HOURS_BY_PRICE.get(1900), 40, 'perf-sprint kataloogi tunnimaar peab olema 40');
  assert.equal(HOURS_BY_PRICE.get(990), 20, 'ai-visibility kataloogi tunnimaar peab olema 20');
  console.log('PASS letter-hours reg-test: tuvastusloogika leiab tapselt oodatud mittevastavused.');
}
