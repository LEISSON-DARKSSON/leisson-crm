// Eemaldab kirje SEEMNEFAILIST. Ilma selleta tuleb kustutatud/uhendatud kirje
// jargmisel serveri kaivitusel tagasi: server.mjs kutsub seed(db) ja seemne
// upsert loob rea uuesti.
//   node win/kustuta-seemnest.mjs <id> [<id>...]          kuivjooks
//   node win/kustuta-seemnest.mjs <id> [<id>...] --tee    kirjutab failid umber
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/env.mjs';

const idd = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const TEE = process.argv.includes('--tee');
if (!idd.length) { console.error('Kasutus: node win/kustuta-seemnest.mjs <id> [...] [--tee]'); process.exit(1); }

let kokku = 0;
for (const f of readdirSync(join(ROOT, 'seed'))) {
  if (!f.endsWith('.json')) continue;
  const tee = join(ROOT, 'seed', f);
  const j = JSON.parse(readFileSync(tee, 'utf8'));
  const read = j.companies || j;
  const enne = read.length;
  const alles = read.filter((c) => !idd.includes(c.id));
  if (alles.length === enne) continue;
  for (const c of read) if (idd.includes(c.id)) console.log(`  ${f}: eemaldan ${c.id} (${c.name})`);
  kokku += enne - alles.length;
  if (TEE) {
    if (j.companies) j.companies = alles; 
    writeFileSync(tee, JSON.stringify(j.companies ? j : alles, null, 2) + '\n', 'utf8');
  }
}
console.log(`\n  ${TEE ? 'eemaldatud' : 'eemaldaks'} ${kokku} kirjet`);
if (!TEE) console.log('  Tegemiseks: --tee\n');
