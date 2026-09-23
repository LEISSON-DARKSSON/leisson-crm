#!/usr/bin/env node
// node win/mustand.mjs <mustandid/fail.json ...> [--kirjuta] [--ilma-vorguta]
// Vaikimisi kuivkäik: värav + eelvaade (.eml mustandid/.eelvaade/). --kirjuta paneb
// gert@leisson.eu Drafts-kausta. MITTE KUNAGI ei saada – "Saada" vajutab inimene.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { checkDraft, checkLinksLive } from '../lib/draft-gate.mjs';
import { buildDraftRaw } from '../lib/draft.mjs';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const write = args.includes('--kirjuta');
const offline = args.includes('--ilma-vorguta');
if (!files.length) {
  console.error('Kasutus: node win/mustand.mjs <mustandid/fail.json ...> [--kirjuta] [--ilma-vorguta]');
  process.exit(2);
}

let failed = 0;
for (const f of files) {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const g = checkDraft(d);
  const live = offline ? [] : await checkLinksLive(d.body);
  const errors = [...g.errors, ...live];
  console.log(`\n== ${basename(f)}  ->  ${d.to}\n   Teema: ${d.subject}\n   ${g.words} sõna, lingid: ${g.links.join(', ') || '–'}`);
  if (errors.length) {
    failed++;
    for (const e of errors) console.log(`   ✗ ${e}`);
    continue;
  }
  const { raw, messageId } = await buildDraftRaw(d);
  const outDir = join(dirname(f), '.eelvaade');
  mkdirSync(outDir, { recursive: true });
  const eml = join(outDir, `${d.id}.eml`);
  writeFileSync(eml, raw);
  console.log(`   ✓ värav roheline · eelvaade ${eml}`);
  if (write) {
    const { appendToDrafts } = await import('../lib/mail.mjs');
    const r = await appendToDrafts(d.konto || 'gert', raw, messageId);
    if (!r.ok) { failed++; console.log(`   ✗ Drafts: ${r.reason}`); continue; }
    console.log(r.skipped ? `   = juba mustandites (${r.box}), ei lisatud uuesti` : `   ✓ mustand kaustas "${r.box}" – ava ja vajuta ise "Saada"`);
  }
}
if (!write && !failed) console.log('\nKuivkäik. Drafts-kausta panekuks lisa --kirjuta.');
process.exitCode = failed ? 1 : 0; // mitte process.exit(): Node 25 + Windows + avatud fetch-soklid -> libuv assert
