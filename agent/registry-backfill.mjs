#!/usr/bin/env node
// Täidab seed/*.json ettevõtetele registrikoodi Äriregistri avaandmetest.
//
// MIKS: registrikood on ainus stabiilne identiteet, mis ettevõttel on.
// Ilma selleta pidi lib/seed-dedupe.mjs otsustama nimede ja haruldaste
// sõnade järgi — ja just seda loogikat on kaks korda parandatud (17.09 ja
// 20.09.2026). Kui mõlemal poolel on kood, langeb kogu see veaklass ära:
// matchExisting tagastab 'exact' juba esimese reegliga.
//
// Vaikimisi KUIVALT (ei kirjuta midagi). Kirjutamiseks: --kirjuta
// Mitmene vaste (sama normaliseeritud nimi mitmel ettevõttel) jäetakse ALATI
// täitmata ja trükitakse välja — vale kood on halvem kui puuduv kood.
//
// Kasutus:
//   node agent/registry-backfill.mjs            # aruanne
//   node agent/registry-backfill.mjs --kirjuta  # kirjutab seed-failidesse
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/env.mjs';
import { SEED_FILES } from '../lib/db.mjs';
import { writeFileSync as writeProfile } from 'node:fs';
import { loadRegistry, resolveWithDomain, loadContacts, loadFinancials, loadDomainIndex, mikroettevotja, SEED_PROFILE_FILE } from '../lib/registry.mjs';

const kirjuta = process.argv.includes('--kirjuta');
const index = loadRegistry();
if (!index) {
  console.error('data/registry/registry.ndjson puudub. Käivita esmalt: npm run registry:sync');
  process.exit(1);
}

const kontaktid = loadContacts();
const domeeniIndeks = loadDomainIndex(kontaktid);
if (!domeeniIndeks) console.error('MÄRKUS: contacts.ndjson puudub — domeenivaste jääb kasutamata (npm run registry:enrich).');

const kokkuvote = { kood_ok: 0, kood_tundmatu: [], leitud: [], mitmene: [], vastuolu: [], leidmata: [] };
let muudetud = 0;

for (const f of SEED_FILES) {
  const p = join(ROOT, 'seed', f);
  if (!existsSync(p)) continue;
  const data = JSON.parse(readFileSync(p, 'utf8'));
  let failiMuutusi = 0;

  for (const c of data.companies || []) {
    const r = resolveWithDomain({ name: c.name, regcode: c.regcode, url: c.url, email: c.email }, index, domeeniIndeks);
    if (c.regcode) {
      if (r.kindlus === 'kood') kokkuvote.kood_ok += 1;
      else kokkuvote.kood_tundmatu.push({ f, id: c.id, name: c.name, regcode: c.regcode });
      continue;
    }
    if (r.kindlus === 'nimi' || r.kindlus === 'domeen') {
      kokkuvote.leitud.push({ f, id: c.id, name: c.name, kood: r.kood, kindlus: r.kindlus, reg_nimi: r.kirje ? r.kirje.nimi : null, ehak: r.kirje ? r.kirje.ehak : null });
      if (kirjuta) { c.regcode = r.kood; c.regcode_allikas = `ariregister-${r.kindlus}`; failiMuutusi += 1; }
    } else if (r.kindlus === 'vastuolu') {
      kokkuvote.vastuolu.push({ f, id: c.id, name: c.name, pohjus: r.pohjus });
    } else if (r.kindlus === 'mitmene') {
      kokkuvote.mitmene.push({ f, id: c.id, name: c.name, pohjus: r.pohjus });
    } else {
      kokkuvote.leidmata.push({ f, id: c.id, name: c.name });
    }
  }

  if (kirjuta && failiMuutusi) {
    writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
    muudetud += failiMuutusi;
    console.log(`Kirjutatud ${f}: ${failiMuutusi} registrikoodi`);
  }
}

console.log(`\nOlemasolev kood ja register kinnitab: ${kokkuvote.kood_ok}`);
console.log(`Nime järgi leitud (üks täpne vaste): ${kokkuvote.leitud.length}`);
for (const r of kokkuvote.leitud) console.log(`  + [${r.kindlus}] ${r.id} -> ${r.kood}  (${r.reg_nimi} — ${r.ehak})`);
if (kokkuvote.kood_tundmatu.length) {
  console.log(`\n⚠ Olemasolev kood EI OLE aktiivsete registris (kontrolli käsitsi): ${kokkuvote.kood_tundmatu.length}`);
  for (const r of kokkuvote.kood_tundmatu) console.log(`  ? ${r.id} (${r.name}) kood ${r.regcode}`);
}
if (kokkuvote.vastuolu.length) {
  console.log(`\n⚠ VASTUOLU nime ja domeeni vahel — EI TÄIDETUD: ${kokkuvote.vastuolu.length}`);
  for (const r of kokkuvote.vastuolu) console.log(`  ! ${r.id} (${r.name}) — ${r.pohjus}`);
}
if (kokkuvote.mitmene.length) {
  console.log(`\n⚠ Mitmene nimevaste — EI TÄIDETUD, vajab inimest: ${kokkuvote.mitmene.length}`);
  for (const r of kokkuvote.mitmene) console.log(`  ? ${r.id} (${r.name}) — ${r.pohjus}`);
}
if (kokkuvote.leidmata.length) {
  console.log(`\nNime järgi ei leitud: ${kokkuvote.leidmata.length} (kaubamärgi- või lühinimi, mitte ärinimi)`);
  for (const r of kokkuvote.leidmata) console.log(`  - ${r.id} (${r.name})`);
}
// Kitsas projektsioon väravatele: ainult meie seed-korpuse ettevõtted.
// test/gate-registry.mjs loeb seda faili, mitte 88 MB registrit.
const index2 = index;
const contacts = kontaktid;
const financials = loadFinancials();
const profiil = { koostatud: new Date().toISOString(), ettevotted: {} };
for (const f of SEED_FILES) {
  const p = join(ROOT, 'seed', f);
  if (!existsSync(p)) continue;
  const data = JSON.parse(readFileSync(p, 'utf8'));
  for (const c of data.companies || []) {
    if (!c.regcode) continue;
    const kood = String(c.regcode);
    const reg = index2.byCode.get(kood) || null;
    const mikro = mikroettevotja(kood, { contacts, financials });
    const con = contacts && contacts.get(kood);
    profiil.ettevotted[kood] = {
      seed_id: c.id,
      seed_nimi: c.name,
      reg_nimi: reg ? reg.nimi : null,
      staatus: reg ? reg.staatus : null,
      ehak: reg ? reg.ehak : null,
      kmkr: reg ? reg.kmkr : null,
      reg_email: con && con.email.length ? con.email : null,
      emtak: con ? con.emtak : null,
      emtak_nimi: con ? con.emtak_nimi : null,
      tootajad: mikro.tootajad,
      kaive: mikro.kaive,
      mikro_teada: mikro.teada,
      mikro: mikro.mikro,
      mikro_allikas: mikro.allikas,
    };
  }
}
writeProfile(SEED_PROFILE_FILE, JSON.stringify(profiil, null, 2) + '\n', 'utf8');
console.log(`\nseed-profiil.json: ${Object.keys(profiil.ettevotted).length} ettevõtet (väravate jaoks)`);

if (!kirjuta) console.log('\nKUIV JOOKS — seed-faile ei muudetud. Kirjutamiseks: node agent/registry-backfill.mjs --kirjuta');
else console.log(`\nKokku kirjutatud: ${muudetud}. Järgmine samm: npm test, seejärel win/restart-server.ps1`);
