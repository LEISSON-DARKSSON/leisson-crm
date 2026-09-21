import assert from 'node:assert/strict';
import { loadAllSeedCompanies, matchExisting, buildTokenFrequency } from '../lib/seed-dedupe.mjs';

// See varav kontrollib KOIKI seed/*.json faile korraga (mitte ainult uhte),
// et sinna ei satuks kunagi kaks kirjet, mis on tegelikult sama ettevote.
// Tekkis 17.09.2026, kui parnu3 partii puhul tuli 6 sellist dublit (CRM
// reservitasemel, url:null) kasitsi kinni puuda, kuna varasem domeenipohine
// dedupe ei nainud neid.
//
// Tapne vaste (sama id / url / registrikood / normaliseeritud nimi) PEATAB
// varava. Norgem ("voimalik") vaste -- jagatud HARULDANE sona nimes eri
// kirjete vahel -- ainult trukitakse, sest see vajab inimese silma (vt
// agent/add-prospects.mjs --include). Sonad, mis Parnumaa turismiarides
// niigi korduvad (hotell, villa, Parnu ise jne), on valistatud, et signaal
// ei upuks murasse.
const all = loadAllSeedCompanies();

// seed/*.json on .gitignore'is (privaatne muugiandmestik), seega CI-s ja
// varskes kloonis neid EI OLE. Korpusekontroll on siis sisutu ja jaetakse
// vahele -- sunteetiline regressioonitest faili lopus jookseb ALATI, sest
// just tema kaitseb loogikat, mida on kaks korda parandatud (17.09, 20.09).
// Enne 20.09.2026 peatas siin olnud assert kogu CI crm-offline too.
if (all.length === 0) {
  console.log('INFO seed-dedupe: seed/*.json puuduvad (CI voi varske kloon) -- korpusekontroll jai vahele.');
} else {

const freq = buildTokenFrequency(all);
const exactDupes = [];
const possibleDupes = [];
const seen = [];
for (const c of all) {
  const result = matchExisting(c, seen, freq);
  if (result.kind === 'exact') exactDupes.push({ id: c.id, name: c.name, file: c._file, ...result });
  if (result.kind === 'possible') possibleDupes.push({ id: c.id, name: c.name, file: c._file, ...result });
  seen.push(c);
}

if (possibleDupes.length) {
  console.log(`INFO: ${possibleDupes.length} voimalikku (norka) dubleerimist seed-korpuses:`);
  for (const d of possibleDupes) {
    console.log(`  - ${d.id} (${d.name}, ${d.file}) vs ${d.match.id} (${d.match.name}, ${d.match._file}) -- ${d.reason}`);
  }
}

assert.equal(exactDupes.length, 0,
  'Seed-korpuses on tapseid dublikaate (sama id/url/registrikood/nimi eri failides): ' +
  exactDupes.map(d => `${d.id} vs ${d.match.id} (${d.reason})`).join('; '));

console.log(`PASS seed-dedupe: ${all.length} kirjet ${new Set(all.map(c => c._file)).size} failis, 0 tapset dubli.`);
}

// REGRESSIOONITEST 20.09.2026: matchExisting EI TOHI lasta norgemal ('possible')
// vastel varasemas kirjes peita tugevamat ('exact') vastet hilisemas kirjes.
// Juhtus paris andmetega parnumaa4-7 impordil: "OÜ NURME TEEDEEHITUS" (url
// nurmeteedeehitus.ee) oli juba CRM-is teise id all, aga korpuses oli EES
// (loadimisjarjekorras) ka eraldi ettevote "AS Nurme Turvas", kellega jagati
// haruldast sona "nurme" -- ilma parandusteta oleks matchExisting tagastanud
// 'possible' vs Nurme Turvas ja jatnud KUNAGI kontrollimata tegeliku 'exact'
// vaste (sama url) hilisema kirje "OÜ NURME TEEDEEHITUS" vastu.
{
  const existing = [
    { id: 'as-nurme-turvas', name: 'AS Nurme Turvas', url: 'https://nurmeturvas.ee/' },
    { id: 'o-nurme-teedeehitus', name: 'OÜ NURME TEEDEEHITUS', url: 'https://nurmeteedeehitus.ee' },
  ];
  const candidate = { id: 'nurme-teedeehitus-ou', name: 'OÜ NURME TEEDEEHITUS', url: 'https://nurmeteedeehitus.ee/' };
  const freq = buildTokenFrequency(existing);
  const result = matchExisting(candidate, existing, freq);
  assert.equal(result.kind, 'exact',
    `Reg-test nurjus: oodati 'exact' (sama url), saadi '${result.kind}' (${result.reason}) vs ${result.match && result.match.id}`);
  assert.equal(result.match.id, 'o-nurme-teedeehitus',
    `Reg-test nurjus: exact vaste pidi olema o-nurme-teedeehitus, oli ${result.match.id}`);
  console.log('PASS seed-dedupe reg-test: exact-vaste hilisemas kirjes ei jaa enam possible-vaste taha peitu.');
}
