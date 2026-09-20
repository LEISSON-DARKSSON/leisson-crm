// Nahtavuskaart failina. Kasutus:
//   node win/kaart.mjs as-nurme-turvas          -> data/kaardid/<id>.html
//   node win/kaart.mjs --koik                   -> koik, kellel on 3+ puudu
//   node win/kaart.mjs --nimekiri               -> kellele saab kaardi teha
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/env.mjs';
import { open } from '../lib/db.mjs';
import { renderKaart, leiud } from '../lib/kaart.mjs';
import { masinloetavPuudu, teenus } from '../lib/hinnakiri.mjs';

const MOOT = join(ROOT, 'data', 'mootmised-masinloetav.json');
if (!existsSync(MOOT)) { console.error('Mootmisfaili ei ole:', MOOT); process.exit(1); }
const M = JSON.parse(readFileSync(MOOT, 'utf8'));
const kuupaev = statSync(MOOT).mtime.toISOString();
const db = open();
const firmad = new Map(db.prepare('SELECT id, name, url, email, status FROM companies').all().map((c) => [c.id, c]));
const KAUST = join(ROOT, 'data', 'kaardid');

const arg = process.argv[2];
const sobivad = Object.entries(M)
  .filter(([id, m]) => m.ok && firmad.has(id) && leiud(m).length > 0)
  .map(([id, m]) => ({ id, m, c: firmad.get(id), n: masinloetavPuudu(m).length }))
  .sort((a, b) => b.n - a.n);

if (!arg || arg === '--nimekiri') {
  console.log(`\nNÄHTAVUSKAART — ${teenus('nahtavuskaart').hind} € · ${sobivad.length} ettevõttel on midagi öelda\n`);
  for (const s of sobivad.slice(0, 40)) {
    console.log(`  ${s.n}/5  ${s.c.name.slice(0, 34).padEnd(34)} ${(s.c.email || '—').padEnd(30)} ${s.c.status}`);
  }
  console.log('\n  node win/kaart.mjs <id>   või   node win/kaart.mjs --koik\n');
  db.close();
  process.exit(0);
}

mkdirSync(KAUST, { recursive: true });
const teha = arg === '--koik' ? sobivad.filter((s) => s.n >= 3) : sobivad.filter((s) => s.id === arg);
if (!teha.length) { console.error('Ei leidnud:', arg); db.close(); process.exit(1); }

for (const s of teha) {
  const html = renderKaart({ nimi: s.c.name, url: s.c.url || s.m.url, m: s.m, kuupaev });
  if (!html) { console.log('  vahele:', s.c.name, '(midagi oelda ei ole)'); continue; }
  const tee = join(KAUST, `${s.id}.html`);
  writeFileSync(tee, html, 'utf8');
  console.log(`  ${s.n}/5  ${s.c.name.padEnd(34)} -> data\\kaardid\\${s.id}.html`);
}
console.log(`\n  Ava brauseris ja vajuta "Prindi / PDF".`);
console.log(`  CRM-is: http://127.0.0.1:4310/doc?kind=kaart&id=<id>\n`);
db.close();
