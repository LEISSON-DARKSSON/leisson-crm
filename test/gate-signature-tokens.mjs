import assert from 'node:assert/strict';
import { buildSignature, loadTokens } from '../lib/signature.mjs';

// See värav kaitseb 24.09.2026 leitud vaikse vea eest: @leisson/shared v2.0.0 viis orbit.tokens.json-i
// DTCG 2025.10 kujule (värv = {colorSpace, components, hex}, mõõt = {value, unit}). lib/signature.mjs luges
// toorest JSON-it otse -> e-posti allkirja HTML-i jõudis "[object Object]" ja ükski test ei kukkunud.
// Reegel: tokenid loetakse AINULT @leisson/shared/orbit-tokens/dtcg.mjs toLegacy() kaudu, ja allkiri peab
// koosnema lahendatud CSS-väärtustest (inline-stiilid, Outlook ei tunne muutujaid ega rgba't).

const tokens = loadTokens();
assert.equal(typeof tokens.space['2'].$value, 'string', 'space.2 peab lugejast tulema CSS-stringina (nt "8px")');
assert.match(tokens.space['2'].$value, /^\d+(\.\d+)?px$/);
assert.equal(typeof tokens.color.canvas.$extensions['eu.leisson.orbit'].modes.day, 'string', 'värvi režiimiväärtus peab olema string');
assert.ok(Array.isArray(tokens.font.display.$value), 'font.display peab olema fondipere massiiv');

const { html, text, tokens: T } = buildSignature();
for (const [k, v] of Object.entries(T)) {
  assert.ok(typeof v === 'string' || typeof v === 'number', `allkirja token ${k} peab olema string või arv, sain ${JSON.stringify(v)}`);
}
for (const k of ['canvas', 'ink', 'ink2', 'ink3', 'hairline', 'hairlineStrong', 'signal']) {
  assert.match(String(T[k]), /^#[0-9a-fA-F]{6}$/, `allkirja värv ${k} peab olema kindel hex (e-post), sain ${T[k]}`);
}
assert.doesNotMatch(html, /\[object Object\]/, 'allkirja HTML sisaldab "[object Object]" — token loeti toorelt, mitte toLegacy kaudu');
assert.doesNotMatch(html, /\{(primitive|font|color|space)\.[^}]*\}/, 'allkirja HTML sisaldab lahendamata tokeniviidet');
assert.doesNotMatch(html, /var\(--/, 'allkiri ei tohi kasutada CSS-muutujaid (e-post)');
assert.ok(text.startsWith('--\n'), 'tekstiallkiri algab "--" reaga');
console.log(`PASS signature-tokens: ${Object.keys(T).length} tokenit lahendatud, HTML ${html.length} B ilma lekketa.`);
