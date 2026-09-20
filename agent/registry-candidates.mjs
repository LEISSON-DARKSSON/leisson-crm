#!/usr/bin/env node
// Uue sihtmärgipartii KANDIDAADID Äriregistri avaandmetest.
//
// See EI OLE valmis nimekiri, kellele kirju saata. See on nimekiri, keda
// tasub mõõta. Meie müügiargument sünnib endiselt mõõdetud leiust nende
// veebilehel — registris on veebiaadress ainult 5,5 %-l ettevõtetest.
//
// Mida filter teeb:
//   1. maakond + staatus R (kustutatud ja likvideerimisel jäävad välja)
//   2. registris on kehtiv e-post (muidu ei ole isegi kontaktvõimalust)
//   3. EI OLE mikroettevõtja — st TTJA ligipääsetavuse seaduse erand EI kehti.
//      Just see tingimus tegi kogu registritöö mõttekaks: varem ei saanud
//      seda kontrollida (töötajate arvu regex oli ebausaldusväärne).
//   4. käive vähemalt --min-kaive (vaikimisi 200 000 €) — allpool seda ei ole
//      1 450 € audit realistlik ost, ja EIS-i arendustegevuste toetus nõuab
//      samuti käivet >= 200 000 € (vt mälu project_toetuste_vaited)
//   5. EI OLE juba meie seed-korpuses (võrdlus registrikoodi järgi — täpselt
//      see, mille agent/registry-backfill.mjs 20.09 võimalikuks tegi)
//   6. EI OLE data/registry/valistatud.json nimekirjas — käsitsi juba uuritud
//      ja teadlikult välja jäetud ettevõtted (rahvusvaheline kontsern, coop-kett,
//      surnud/parkitud domeen, distinktset kodulehte ei leitud, e-post puudub).
//      Ilma selleta tuli 20.09.2026 sama 386-kandidaadi väljundisse tagasi ~30
//      ettevõtet, mis 12.-20.09 välitöö käigus juba käsitsi läbi vaadatud olid —
//      peaaegu läks korduvmõõtmisele. Uus valistus lisatakse valistatud.json-i.
//
// ⚠ VEEBIOTSUSE KOHT. Meie metoodika filter on "veebiotsus tehakse Pärnus".
// Registri e-posti domeen paljastab selle: scanfil.com, ruukki.com,
// metsagroup.com on välismaise emaettevõtte grupidomeenid — leht tehakse
// Helsingis või Stockholmis ja kohalikul juhil ei ole selle üle otsust.
// Seepärast eraldatakse .ee-domeeniga ettevõtted eraldi ja neid näidatakse
// vaikimisi. --koik näitab ka grupidomeene.
//
// Kasutus:
//   npm run registry:kandidaadid
//   node agent/registry-candidates.mjs --maakond=Harju --min-kaive=500000 --top=40
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/env.mjs';
import { SEED_FILES } from '../lib/db.mjs';
import { loadRegistry, loadContacts, loadFinancials, mikroettevotja, REGISTRY_DIR, domeenist } from '../lib/registry.mjs';

const arg = (nimi, vaikimisi) => {
  const a = process.argv.find((x) => x.startsWith(`--${nimi}=`));
  return a ? a.slice(nimi.length + 3) : vaikimisi;
};

const maakond = arg('maakond', 'Pärnu');
const minKaive = Number(arg('min-kaive', '200000'));
const top = Number(arg('top', '30'));

const index = loadRegistry();
if (!index) { console.error('registry.ndjson puudub — npm run registry:sync'); process.exit(1); }
const contacts = loadContacts();
const financials = loadFinancials();
if (!contacts || !financials) { console.error('contacts.ndjson või financials.ndjson puudub — npm run registry:update'); process.exit(1); }

// Juba meie torus — registrikoodi järgi, mitte nime järgi.
const olemas = new Set();
for (const f of SEED_FILES) {
  const p = join(ROOT, 'seed', f);
  if (!existsSync(p)) continue;
  for (const c of JSON.parse(readFileSync(p, 'utf8')).companies || []) {
    if (c.regcode) olemas.add(String(c.regcode));
  }
}

// Käsitsi uuritud ja teadlikult välja jäetud (rahvusvaheline kontsern, coop-kett,
// surnud/parkitud domeen, distinktset kodulehte ei leitud, e-post puudub jms) —
// vt data/registry/valistatud.json. See fail teeb 12.-20.09.2026 välitöö käigus
// mälusse kogunenud otsused koodis püsivaks, et sama ettevõte ei tuleks iga
// järgmise registry:kandidaadid käivitusega uuesti kandidaadiks tagasi.
const valistatudPath = join(REGISTRY_DIR, 'valistatud.json');
const valistatud = new Map();
if (existsSync(valistatudPath)) {
  for (const v of JSON.parse(readFileSync(valistatudPath, 'utf8')).valistatud || []) {
    valistatud.set(String(v.kood), v.pohjus);
  }
}

const kandidaadid = [];
let maakonnas = 0; let emailiga = 0; let mitteMikro = 0; let valjaJaetud = 0;

for (const r of index.byCode.values()) {
  if (!r.ehak || !r.ehak.includes(`${maakond} maakond`)) continue;
  maakonnas += 1;
  const kood = String(r.kood);
  if (olemas.has(kood)) continue;
  if (valistatud.has(kood)) { valjaJaetud += 1; continue; }

  const con = contacts.get(kood);
  const email = con && con.email.length ? con.email[0] : null;
  if (!email) continue;
  emailiga += 1;

  const m = mikroettevotja(kood, { contacts, financials });
  if (!m.teada || m.mikro) continue;   // erand kehtib või me ei tea — mõlemal juhul välja
  mitteMikro += 1;

  const kaive = m.kaive;
  if (kaive == null || kaive < minKaive) continue;

  kandidaadid.push({
    kood: r.kood,
    nimi: r.nimi,
    ehak: r.ehak,
    kmkr: r.kmkr,
    emtak: con.emtak,
    emtak_nimi: con.emtak_nimi,
    tootajad: m.tootajad,
    kaive: Math.round(kaive),
    email,
    tel: con.tel[0] || null,
    www: con.www[0] || null,
    domeen: domeenist(con.www[0]) || domeenist(email),
    eesti_domeen: /\.ee$/.test(domeenist(con.www[0]) || domeenist(email) || ''),
    allikas: m.allikas,
  });
}

kandidaadid.sort((a, b) => b.kaive - a.kaive);
const kodused = kandidaadid.filter((k) => k.eesti_domeen);
const grupid = kandidaadid.filter((k) => !k.eesti_domeen);
const naita = process.argv.includes('--koik') ? kandidaadid : kodused;

const valja = join(REGISTRY_DIR, `kandidaadid-${maakond.toLowerCase()}.json`);
writeFileSync(valja, JSON.stringify({
  koostatud: new Date().toISOString(),
  maakond, min_kaive: minKaive,
  selgitus: 'Kandidaadid mõõtmiseks, MITTE valmis saatmisnimekiri. Veebileht tuleb leida ja mõõta enne kirja.',
  kokku: kandidaadid.length,
  eesti_domeeniga: kandidaadid.filter((k) => k.eesti_domeen).length,
  kandidaadid,
}, null, 2) + '\n', 'utf8');

const eur = (n) => new Intl.NumberFormat('et-EE').format(n) + ' €';
console.log(`${maakond} maakonnas aktiivseid: ${maakonnas}`);
console.log(`  neist käsitsi juba uuritud ja välja jäetud (valistatud.json): ${valjaJaetud}`);
console.log(`  neist registri e-postiga ja meil veel puudu: ${emailiga}`);
console.log(`  neist tõendatult MITTE mikroettevõtjad: ${mitteMikro}`);
console.log(`  neist käive >= ${eur(minKaive)}: ${kandidaadid.length}`);
console.log(`    ...sellest .ee-domeeniga (veebiotsus tõenäoliselt Eestis): ${kodused.length}`);
console.log(`    ...välismaise grupi domeeniga (otsus mujal): ${grupid.length}\n`);
console.log(`TOP ${Math.min(top, naita.length)} käibe järgi${process.argv.includes('--koik') ? '' : ' (.ee domeenid)'}:`);
for (const k of naita.slice(0, top)) {
  const d = k.domeen ? ` · ${k.domeen}` : ' · DOMEEN PUUDUB';
  console.log(`  ${String(k.kaive).padStart(9)} € · ${String(k.tootajad).padStart(4)} tt · ${k.nimi}${d}`);
  console.log(`      ${k.emtak_nimi || 'EMTAK puudub'} · ${k.ehak} · ${k.email}`);
}
console.log(`\nKirjutatud: data/registry/kandidaadid-${maakond.toLowerCase()}.json`);
console.log('Järgmine samm: leia ja MÕÕDA veebileht (leisson-prospect-audit), alles siis npm run seed:add.');
