// Kes torus vajab teenust "Masinloetav leht" (290 EUR) - ilma uue mootmiseta.
// Sisend: data/mootmised-masinloetav.json (viie signaali moot iga lehe kohta).
// Kasutus: node win/masinloetav-sihtmargid.mjs [--csv]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/env.mjs';
import { open } from '../lib/db.mjs';
import { masinloetavPuudu, teenus } from '../lib/hinnakiri.mjs';

const TEE = join(ROOT, 'data', 'mootmised-masinloetav.json');
if (!existsSync(TEE)) {
  console.error(`Mootmisfaili ei ole: ${TEE}\nJooksuta enne mootmine ja salvesta tulemus sinna.`);
  process.exit(1);
}
const M = JSON.parse(readFileSync(TEE, 'utf8'));
const T = teenus('masinloetav');
const db = open();
const firmad = new Map(db.prepare('SELECT id, name, email, status, listid FROM companies').all().map((c) => [c.id, c]));

const read = [];
for (const [id, m] of Object.entries(M)) {
  if (!m.ok) continue;
  const puudu = masinloetavPuudu(m);
  const c = firmad.get(id);
  if (!c) continue;
  read.push({ id, nimi: c.name, epost: c.email, seis: c.status, list: c.listid, n: puudu.length, puudu });
}
read.sort((a, b) => b.n - a.n || a.nimi.localeCompare(b.nimi));

const sobivad = read.filter((r) => r.n >= 3);
const epostiga = sobivad.filter((r) => r.epost);

if (process.argv.includes('--csv')) {
  console.log('nimi;epost;puudu_arv;puudu;seis');
  for (const r of sobivad) console.log([r.nimi, r.epost || '', r.n, r.puudu.join('|'), r.seis].join(';'));
} else {
  console.log(`\nMASINLOETAV LEHT — ${T.hind} €\n`);
  console.log(`  mõõdetud ${read.length} · kolm või enam puudu ${sobivad.length} · neist e-postiga ${epostiga.length}`);
  console.log(`  kohene turg: ${epostiga.length} × ${T.hind} € = ${(epostiga.length * T.hind).toLocaleString('et-EE')} €\n`);
  for (const r of sobivad.slice(0, 30)) {
    console.log(`  ${String(r.n)}/5  ${r.nimi.slice(0, 30).padEnd(30)} ${(r.epost || '— e-posti ei ole').padEnd(32)} ${r.puudu.join(', ')}`);
  }
  if (sobivad.length > 30) console.log(`  ... ja veel ${sobivad.length - 30}`);
  const korras = read.filter((r) => r.n === 0);
  console.log(`\n  ${korras.length} ettevõttel on kõik viis korras — neile seda ei pakuta.\n`);
}
db.close();
