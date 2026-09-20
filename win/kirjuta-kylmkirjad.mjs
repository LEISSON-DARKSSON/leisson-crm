// Kirjutab kulmkirjad neile, kellel on MOODETUD leid ja kiri veel puudu.
// Kirjutab ainult sinna, kus on vahemalt kaks leidu - ilma selleta ei ole ausalt
// midagi oelda ja leiutatud probleem on Leissoni brändi vastu.
//   node win/kirjuta-kylmkirjad.mjs          naitab, keda puudutab
//   node win/kirjuta-kylmkirjad.mjs --tee    kirjutab baasi
//
// KIRJUTAB AINULT TUHJA PEALE. --uuesti lippu EI OLE ja ei tohi olla: 14.09
// kirjutas see 20 kasitsi tehtud kirja generaatori omadega ule. Kasitsi tehtud
// kiri kannab asju, mida masinloetav moot ei nae (ligipaasetavuse rikkumised,
// konkreetsed failinimed ja -suurused) - see on alati parem kui generaator.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/env.mjs';
import { open } from '../lib/db.mjs';
import { kylmkiri, kolbab } from '../lib/kylmkiri.mjs';
import { leiud } from '../lib/kaart.mjs';

const TEE = process.argv.includes('--tee');
const M = JSON.parse(readFileSync(join(ROOT, 'data', 'mootmised-masinloetav.json'), 'utf8'));

// Valikuline teine moodetud fakt (nt ligipaasetavus). Kaib eraldi failist, et
// kiri ei valjaks midagi, mida ei ole moodetud.
const LISA_TEE = join(ROOT, 'data', 'lisafaktid.json');
const LISA = existsSync(LISA_TEE) ? JSON.parse(readFileSync(LISA_TEE, 'utf8')) : {};

const db = open();
const read = db.prepare(
  "SELECT id,name,email,url,listid FROM companies WHERE status='ootel' AND email IS NOT NULL AND (body IS NULL OR body='')",
).all();

let kirjutatud = 0, vahele = 0;
for (const c of read) {
  const m = M[c.id];
  if (!kolbab(m)) { vahele++; continue; }
  const domeen = String(c.url || m.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const k = kylmkiri({ nimi: c.name, domeen, m, lisa: LISA[c.id] || null });
  if (!k) { vahele++; continue; }
  console.log(`  ${leiud(m).length}/5  ${c.name.slice(0, 30).padEnd(30)} ${c.email.padEnd(28)} ${k.subject}`);
  if (TEE) {
    db.prepare('UPDATE companies SET subject=?, body=?, updated=? WHERE id=?')
      .run(k.subject, k.body, new Date().toISOString(), c.id);
    kirjutatud++;
  }
}
console.log(`\n  ${TEE ? `kirjutatud ${kirjutatud}` : 'kuivjooks'} · vahele jäi ${vahele} (alla kahe leiu — ausalt ei ole midagi öelda)`);
if (!TEE) console.log('  Kirjutamiseks: node win/kirjuta-kylmkirjad.mjs --tee\n');
db.close();
