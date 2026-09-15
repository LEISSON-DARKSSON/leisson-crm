// Evidence renderer behavior on synthetic data; private customer reports stay local.
import assert from 'node:assert/strict';
import {renderKaart} from '../lib/kaart.mjs';
const evidence={ok:true,desc:0,og:0,org:false};
const report=renderKaart({nimi:'Example',url:'https://example.test',m:evidence,kuupaev:'2026-09-15'});
assert.ok(report.includes('HTML-i struktuuri'));
assert.ok(report.includes('Mõõtmisviis on dokumenteerimata'));
assert.ok(report.includes('brauserikontrolli ei kinnitata'));
assert.ok(!/Chromium 131|üle päris brauseriga|WCAG 2.2.{0,20}kontrollitud|klikk läheb konkurendile/.test(report));
assert.equal(renderKaart({nimi:'Example',url:'https://example.test',m:{ok:false},kuupaev:'2026-09-15'}),null);
const explicit=renderKaart({nimi:'<script>unsafe</script>',url:'https://example.test',m:evidence,kuupaev:'2026-09-15',mootja:'Fixture HTML parser; no browser run'});
assert.ok(explicit.includes('Fixture HTML parser; no browser run'));assert.ok(!explicit.includes('<script>unsafe</script>'));assert.ok(explicit.includes('&lt;script&gt;'));
console.log('PASS: evidence reports preserve missing measurement, failed checks, scope and escaped client data.');
