// Mustanditoru värav (võrguta): automaatika koostab, inimene vajutab "Saada".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkDraft } from '../lib/draft-gate.mjs';
import { buildDraftRaw, draftMessageId } from '../lib/draft.mjs';

const body = Array.from({ length: 12 }, (_, i) => `Lause number ${i + 1} on siin.`).join(' ')
  + '\n\nVaata: https://www.leisson.eu/k/bQnaWRMqYjVCThXWquZc';
const ok = { id: 'test-mustand', to: 'rita@osmussaar.ee', subject: 'Osmussaare kodulehe kohta', body };

// 1. Positiivne
assert.equal(checkDraft(ok).ok, true, JSON.stringify(checkDraft(ok).errors));
assert.equal(checkDraft({ ...ok, to: 'Rita Koppel <rita@osmussaar.ee>' }).ok, true, 'nimega aadress lubatud');

// 2. Negatiivsed – igaüks peab kukkuma
const bad = {
  emdash: { ...ok, body: body + ' See — nii.' },
  straightQuotes: { ...ok, subject: 'Meede "Elukeskkond"' },
  gmail: { ...ok, body: body + ' Kirjuta Gmaili.' },
  placeholder: { ...ok, body: body + ' Tere [Nimi].' },
  todo: { ...ok, body: body + ' TODO lisa.' },
  http: { ...ok, body: body + ' http://leisson.eu' },
  claude: { ...ok, body: body + ' https://claude.ai/x' },
  tooShort: { ...ok, body: 'Tere. Lühike.' },
  badTo: { ...ok, to: 'rita@' },
  sigInBody: { ...ok, body: body + '\n--\nGert' },
  badId: { ...ok, id: 'Rita Kiri' },
};
for (const [k, d] of Object.entries(bad)) assert.equal(checkDraft(d).ok, false, `peab kukkuma: ${k}`);

// 3. Ümbrik: gert@leisson.eu, deterministlik Message-ID, kliendiallkiri ilma hinnakirja ja alareata
const { raw, messageId } = await buildDraftRaw(ok);
const s = raw.toString('utf8');
assert.equal(messageId, draftMessageId('test-mustand'));
assert.match(s, /^From: Gert Leisson <gert@leisson\.eu>/m);
assert.match(s, /^Message-ID: <mustand-test-mustand@leisson\.eu>/mi);
assert.doesNotMatch(s, /Hinnakiri|leisson\.eu\/et\/prices/);
assert.doesNotMatch(s, /AI-Augmented/);
assert.match(s, /LEISSON/);

// 4. Staatiline: mustanditoru ei tunne saatmist
for (const f of ['lib/draft.mjs', 'lib/draft-gate.mjs', 'win/mustand.mjs']) {
  const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /sendMail|createTransport|smtp/i, `${f} ei tohi saata`);
}

console.log('gate-mustand: OK (värav 1+11, ümbrik, saatmiskeeld)');
