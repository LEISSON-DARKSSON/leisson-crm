import assert from 'node:assert/strict';
import { CATALOG, CATALOG_VERSION, SERVICES, SELLER, serviceById, serviceSnapshot } from '../../packages/service-catalog/index.mjs';
import { TEENUSED, KAIBEMAKS, teenus, jargmineAste, masinloetavPuudu } from '../lib/hinnakiri.mjs';

const ids = SERVICES.flatMap(s => [s.id, ...s.aliases]);
assert.equal(new Set(ids).size, ids.length, 'Canonical IDs and aliases are unambiguous');
for (const [id, price, hours, deposit] of [
  ['inquiry-repair', 290, 3, 100], ['landing-page', 590, 8, 50], ['business-website', 1190, 16, 50],
]) {
  const service = teenus(id);
  assert.equal(service.hind, price); assert.equal(service.tunnid, hours);
  assert.equal(service.ettemaks_protsent, deposit); assert.equal(service.parandusringid, 1);
  assert.equal(service.kohtumine, false); assert.equal(service.catalog_version, CATALOG_VERSION);
}
assert.equal(teenus('ai-nahtavus').id, 'ai-visibility');
assert.equal(teenus('kiirussprint').id, 'perf-sprint');
assert.equal(teenus('does-not-exist'), null);
assert.equal(teenus('masinloetav').aktiivne, false, 'Retired offer remains readable but is not newly sold');
assert.equal(teenus('masinloetav').hind, 290, 'Legacy price is not silently remapped');
assert(!TEENUSED.some(s => s.id === 'masinloetav' || s.id === 'nahtavuskaart' || s.id === 'website-care'));
assert.equal(jargmineAste(0), null, 'Prior spend alone does not select another sale');
assert.equal(KAIBEMAKS.kohustuslane, SELLER.vatRegistered);
assert(SELLER.source.startsWith('https://ariregister.rik.ee/'));
assert.equal(CATALOG.seller.priceBasis, 'final');
const snapshot = serviceSnapshot('landing-page');
snapshot.service.price = 1; snapshot.service.name.et = 'Changed';
assert.equal(serviceById('landing-page').price, 590, 'Invoice copy cannot mutate canonical prices');
assert.equal(serviceSnapshot('landing-page').service.name.et, 'Ühe teenuse müügileht');
assert.deepEqual(masinloetavPuudu(undefined), []);
assert.deepEqual(masinloetavPuudu({}), []);
assert.deepEqual(masinloetavPuudu({ok:false,desc:0}), [], 'Failed measurement is not evidence of a defect');
assert.deepEqual(masinloetavPuudu({ok:true,desc:200,tLen:70}), [], 'Length alone is not a broken search result');
assert.deepEqual(masinloetavPuudu({ok:true,desc:0}), ['otsingukirjeldus puudub']);
assert.deepEqual(masinloetavPuudu({ok:true,hreflang:0}), [], 'Single-language site does not need language alternates');
assert.deepEqual(masinloetavPuudu({ok:true,multilingual:true,hreflang:0}), ['keeleviiteid ei tuvastatud']);
console.log('Catalog compatibility and evidence checks passed.');
