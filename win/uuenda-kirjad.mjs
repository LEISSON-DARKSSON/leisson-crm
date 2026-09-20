// Uuendab seed-failist kohtumispaeva, pealkirja ja kirja SAATMATA ridadel.
//
// Miks eraldi skript: lib/db.mjs seed() kirjutab subject/body ainult siis, kui
// body on NULL - see on teadlik kaitse, et juba toimetatud kirja ei kaotataks.
// Kui kirjas endas on viga (nt vale nadalapaev), on vaja seda kaitset teadlikult
// ule astuda - aga AINULT ridadel, mis on veel 'ootel' ja millele ei ole vastatud.
//
// Kasutus: node win\uuenda-kirjad.mjs parnu2.json [--dry]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { open } from '../lib/db.mjs';
import { ROOT } from '../lib/env.mjs';

const fail = process.argv[2] || 'parnu2.json';
const DRY = process.argv.includes('--dry');
const data = JSON.parse(readFileSync(join(ROOT, 'seed', fail), 'utf8'));
const db = open();

const loe = db.prepare('SELECT id, status, meet_day, subject, body FROM companies WHERE id=?');
const kirjuta = db.prepare(`UPDATE companies SET meet_day=?, subject=?, body=?, updated=?
                            WHERE id=? AND status='ootel'`);
const now = new Date().toISOString();
let muudetud = 0, vahele = 0, puudu = 0;

for (const c of data.companies) {
  const r = loe.get(c.id);
  if (!r) { puudu++; continue; }
  if (r.status !== 'ootel') {
    console.log(`  vahele  ${c.id} — seis on "${r.status}", ei puutu`);
    vahele++; continue;
  }
  const sama = r.meet_day === c.day && r.subject === c.subject && r.body === c.body;
  if (sama) continue;
  if (!DRY) kirjuta.run(c.day ?? null, c.subject ?? null, c.body ?? null, now, c.id);
  if (r.meet_day !== c.day) console.log(`  paev    ${c.id}: ${r.meet_day} -> ${c.day}`);
  muudetud++;
}
console.log(`\n${DRY ? '[kuivjooks] ' : ''}muudetud ${muudetud} rida, vahele ${vahele}, baasist puudu ${puudu}`);
db.close();
