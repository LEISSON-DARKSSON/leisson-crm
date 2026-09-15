// JARELKIRJADE SAATJA
//
//   node agent/jarelkiri.mjs           saada, mis on kaes
//   node agent/jarelkiri.mjs --seis    ainult numbrid, ei saada
//   node agent/jarelkiri.mjs --kuiv    naitab tapse teksti, ei saada
//
// Sama kaks votit, mis kulmkirjadel: agendil EI OLE saatmistooriista. See on
// serveripoolne skript, mis kutsub /api/send - sama teed, mida inimese klikk.
// Loobumisrea paneb peale server ise (lib/sendgate.mjs).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { open } from '../lib/db.mjs';
import { ROOT } from '../lib/env.mjs';
import { jarelGate, MAX_JARELKIRJU } from '../lib/jarelgate.mjs';
import { koosta, nimiAadressist } from '../lib/jarelkiri.mjs';
import { uusFakt } from '../lib/jarelgate.mjs';
import { tooajal, limits } from '../lib/sendgate.mjs';

const arg = (n) => process.argv.includes('--' + n);
const DRY = arg('kuiv');
const SEIS = arg('seis');

// Jarelkirjadel on OMA paevalimiit ja see on vaiksem: jarelkiri laheb inimesele,
// kes juba korra ei vastanud - seal on kaebuse risk suurem kui esmakontaktil.
const PAEVAS = Number(process.env.JAREL_PER_DAY || 6);
const VAHE_MIN = Number(process.env.JAREL_GAP_MIN || 9);

let port = 4310;
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  const m = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('CRM_PORT='));
  if (m) port = Number(m.split('=')[1]) || 4310;
}
const BASE = `http://127.0.0.1:${port}`;

const MOOT = join(ROOT, 'data', 'mootmised-masinloetav.json');
const mootmised = existsSync(MOOT) ? JSON.parse(readFileSync(MOOT, 'utf8')) : {};

const db = open();
const now = new Date();
const L = limits();
const { jarjekord, miks } = jarelGate(db, { now, mootmised });

// Tana juba saadetud jarelkirjad
const tana = now.toISOString().slice(0, 10);
const tehtudTana = db.prepare(
  `SELECT COUNT(*) n FROM activity WHERE kind = 'jarelkiri' AND substr(ts, 1, 10) = ?`,
).get(tana).n;

const aeg = tooajal(now, L);
const ruumi = Math.max(0, PAEVAS - tehtudTana);
const saadan = (!aeg || !ruumi) ? [] : jarjekord.slice(0, Math.min(ruumi, 3));

console.log('\nJÄRELKIRJAD');
console.log(`  järjekorras ${jarjekord.length} · täna saadetud ${tehtudTana}/${PAEVAS} · tööaeg: ${aeg ? 'jah' : 'ei'}`);
if (Object.keys(miks).length) {
  console.log('  välja jääb:');
  for (const [k, v] of Object.entries(miks).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(3)} × ${k}`);
  }
}
console.log(`  saadan nüüd: ${SEIS || DRY ? 0 : saadan.length}${DRY ? ' (kuivjooks)' : ''}`);

if (SEIS) { db.close(); process.exit(0); }

const post = async (tee, keha) => {
  const r = await fetch(BASE + tee, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(keha),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};

const uni = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;

for (const c of saadan) {
  const kiri = koosta(c.samm, { kontakt: nimiAadressist(c.email), nimi: c.name, m: c.m });
  if (!kiri) { console.log(`  VAHELE ${c.name} — uut öelda ei ole`); continue; }

  // RAUDNE REEGEL: jarelkiri kannab uut moodetud fakti. Kui ei kanna, jaab saatmata.
  // Varasem = eelmise kirja keha JA koik varem oeldud moodetud sildid
  // (need on activity.note sees kujul "jarelkiri N - <silt>").
  const sildid = db.prepare(
    "SELECT note FROM activity WHERE company_id = ? AND kind = 'jarelkiri'",
  ).all(c.id).map((r) => r.note || '');
  const varasemad = [c.body || '', ...sildid];
  if (!uusFakt(kiri, varasemad)) {
    console.log(`  VAHELE ${c.name} — kiri ei kanna uut fakti`);
    continue;
  }

  if (DRY) {
    console.log(`\n  --- ${c.name} · järelkiri ${c.tehtud + 1}/${MAX_JARELKIRJU} · vaikus ${c.vaikus} tööpäeva`);
    console.log(`  ${c.email}`);
    console.log(`  ${kiri.subject}\n`);
    console.log(kiri.body.split('\n').map((r) => '  | ' + r).join('\n'));
    continue;
  }

  try {
    await post('/api/send', { id: c.id, to: c.email, subject: kiri.subject, body: kiri.body });
    db.prepare('INSERT INTO activity (company_id, ts, kind, note) VALUES (?,?,?,?)')
      .run(c.id, new Date().toISOString(), 'jarelkiri', `järelkiri ${c.tehtud + 1} · ${kiri.fakt}`);
    n++;
    console.log(`  saadetud ${c.name} → ${c.email} (järelkiri ${c.tehtud + 1})`);
  } catch (e) {
    // Esimese torke peal SEISAME. Pool jarjekorda vigase SMTP-ga on hullem
    // kui null kirja - sama reegel, mis kulmkirjade saatjal.
    console.error(`  TÕRGE ${c.name}: ${e.message} — seisan.`);
    break;
  }
  if (n < saadan.length) await uni((VAHE_MIN + Math.random() * 3) * 60000);
}

if (!DRY) console.log(`\n${n} järelkirja saadetud.\n`);
db.close();
