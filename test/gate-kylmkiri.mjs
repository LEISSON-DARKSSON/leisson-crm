// Synthetic evidence and catalog checks. No private customer records, network or sending.
import assert from 'node:assert/strict';
import {kylmkiri,kolbab,teemarida,onAvalik} from '../lib/kylmkiri.mjs';
import {leiud,renderKaart} from '../lib/kaart.mjs';
import {teenus,KAIBEMAKS,CATALOG_VERSION} from '../lib/hinnakiri.mjs';
const broken={ok:true,desc:0,og:0,org:false,hreflang:0,tLen:10};
const healthy={ok:true,desc:140,og:8,org:true,hreflang:2,tLen:55};
const one={...healthy,desc:0};
assert.equal(kolbab(null),false);assert.equal(kolbab({ok:false}),false);assert.equal(kolbab(healthy),false);assert.equal(kolbab(one),false);
assert.equal(kylmkiri({nimi:'Test',domeen:'example.test',m:null}),null);
assert.equal(kylmkiri({nimi:'Test',domeen:'example.test',m:healthy}),null);
const draft=kylmkiri({nimi:'Test',domeen:'example.test',m:broken,lisa:'Väljamõeldud müügikadu 50%'});
const service=teenus('inquiry-repair');
assert.equal(draft.serviceId,service.id);assert.equal(draft.catalogVersion,CATALOG_VERSION);
assert.ok(draft.body.includes(service.mark));assert.ok(draft.body.includes(service.hind+' €'));assert.ok(draft.body.includes(service.tarne));assert.ok(draft.body.includes(KAIBEMAKS.lause));
assert.equal((draft.body.match(/\?/g)||[]).length,1);assert.equal(draft.needsApproval,true);assert.equal(draft.readyToSend,false);assert.equal(draft.from,'gert@leisson.eu');
assert.equal(draft.additionalEvidenceRequiresReview,true);assert.ok(!draft.body.includes('50%'));
assert.equal(draft.fakt,leiud(broken)[0].moot);assert.ok(draft.subject.includes(leiud(broken)[0].leid));
assert.ok(!/Google.is on 10|LinkedInis ei näita midagi|ei saa.*andmeid kätte|klikk läheb konkurendile/.test(draft.subject+draft.body));
assert.ok(onAvalik('Kihnu vald'));assert.ok(!onAvalik('Test OÜ'));
assert.equal(leiud({ok:false,desc:0}).length,0);assert.equal(leiud(null).length,0);
assert.equal(leiud({ok:true}).length,0); // missing data is not a zero result
assert.equal(leiud({...healthy,tLen:14}).length,0); // short title does not prove ranking loss
const html=renderKaart({nimi:'Fixture',url:'https://example.test',m:broken,kuupaev:'2026-09-15'});
assert.ok(html.includes('Mõõtmisviis on dokumenteerimata'));assert.ok(!html.includes('Chromium 131'));assert.ok(!html.includes('Mõõtsin teie avalehe üle päris brauseriga'));
assert.ok(!html.includes('juhusliku lõigu'));assert.ok(!html.includes('Link näeb välja nagu rämpspost'));
assert.ok(html.includes('Tegelikku eelvaadet tuleb kontrollida'));assert.ok(html.includes('ei tõenda otsingust'));
assert.equal(renderKaart({nimi:'Fixture',url:'example.test',m:{ok:false},kuupaev:'2026-09-15'}),null);
console.log('PASS: synthetic cold draft evidence, catalog scope, no send approval, no invented measurement or business result.');
