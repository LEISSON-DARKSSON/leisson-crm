// Automaatne kulmkirjade saatja.
//
// See EI OLE agenditoo ja EI OLE mudel. Agendil ei ole saatmistooriista uheski
// reziimis ja see reegel jaab kehtima. Siin on deterministlik skript, mis
// saadab INIMESE poolt ette valmistatud ja ule vaadatud kirju kindlas tempos.
// Saatmine ise kaib serveri /api/send kaudu - sama tee, mis inimese klikk,
// et seis, allkiri ja tegevuslogi ei laheks lahku.
//
//   node agent/saatja.mjs --dry        naita, keda saadetaks ja miks mitte
//   node agent/saatja.mjs              saada uks jooks (vaikimisi kuni 4 kirja)
//   node agent/saatja.mjs --loobumised loe postkastist loobumised ja summuta
//   node agent/saatja.mjs --seis       ainult numbrid
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { open } from '../lib/db.mjs';
import { ROOT } from '../lib/env.mjs';
import { sendGate, limits, lisaLoobumisrida, onLoobumine } from '../lib/sendgate.mjs';

const arg = (n) => process.argv.includes('--' + n);
const DRY = arg('dry');

let port = 4310;
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  const m = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('CRM_PORT='));
  if (m) port = Number(m.split('=')[1]) || 4310;
}
const BASE = `http://127.0.0.1:${port}`;

const db = open();
const L = limits();

// --- loobumised -------------------------------------------------------------
if (arg('loobumised')) {
  const now = new Date().toISOString();
  const kirjad = db.prepare(
    `SELECT mailbox, uid, addr, subject, body_text FROM messages
      WHERE direction='in' AND deleted IS NULL AND addr IS NOT NULL`,
  ).all();
  const ins = db.prepare(
    `INSERT INTO suppressions (addr, domain, reason, ts, by) VALUES (?,?,?,?,'loobumine')
     ON CONFLICT(addr) DO UPDATE SET reason=excluded.reason, ts=excluded.ts`,
  );
  // Ainult need saatjad, kellele me ise oleme kirjutanud. Muidu summutab
  // iga uudiskiri ennast oma "unsubscribe"-jalusega ara.
  // Domeeni kaupa, mitte aadressi kaupa: vastus tuleb sageli kolleegilt.
  const saatnud = new Set(
    db.prepare(
      `SELECT DISTINCT lower(c.email) e FROM activity a JOIN companies c ON c.id = a.company_id
        WHERE a.kind = 'sent' AND c.email IS NOT NULL`,
    ).all().map((r) => String(r.e).split('@')[1]).filter(Boolean),
  );
  let n = 0;
  for (const m of kirjad) {
    if (!onLoobumine(m, saatnud)) continue;
    const addr = String(m.addr).toLowerCase();
    ins.run(addr, addr.split('@')[1] || null, `loobumine kirjas ${m.mailbox}:${m.uid}`, now);
    console.log('  summutatud:', addr, '—', (m.subject || '').slice(0, 60));
    n++;
  }
  console.log(`\n${n} loobumist summutusnimekirja.`);
  db.close();
  process.exit(0);
}

// --- seis -------------------------------------------------------------------
const g = sendGate(db, { L });
console.log('\nKÜLMKIRJADE SAATJA');
console.log(`  kandidaate ${g.kandidaate} · väravat läbib ${g.labib} · täna saadetud ${g.tanaSaadetud}/${g.paevaLimiit}`);
console.log(`  viimase tunni sees ${g.tunnisSaadetud}/${g.tunniLimiit} (puhanguvärav)`);
console.log(`  tööaeg: ${g.tooajal.ok ? 'jah' : 'EI — ' + g.tooajal.miks} · viimasest kirjast ${g.minutitViimasest ?? '—'} min (nõutud ${L.minGapMin})`);
if (Object.keys(g.miks).length) {
  console.log('  välja jääb:');
  for (const [k, v] of Object.entries(g.miks).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(3)} × ${k}`);
}
console.log(`  saadan nüüd: ${g.saadanNyyd} · ootel järjekorras ${g.ootel.length}`);

if (arg('seis')) { db.close(); process.exit(0); }

if (!g.saadanNyyd) {
  console.log('\nMidagi ei saadeta.');
  db.close();
  process.exit(0);
}

console.log('\nJärjekord:');
for (const c of g.jarjekord) console.log(`  ${c.priority} ${c.name.slice(0, 38).padEnd(40)} ${c.email}`);

if (DRY) {
  console.log('\n[kuivjooks] ühtegi kirja ei saadetud.');
  db.close();
  process.exit(0);
}

// --- saatmine ---------------------------------------------------------------
const post = async (p, body) => {
  const r = await fetch(BASE + p, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
};

const oota = (ms) => new Promise((r) => setTimeout(r, ms));
let saadetud = 0;
for (const [i, c] of g.jarjekord.entries()) {
  // Iga kiri kannab loobumisrida. See on seadusest tulenev, mitte valikuline.
  // Loobumisrida paneb peale /api/send ise (lib/sendgate.mjs) - siin on ta ainult
  // selleks, et kuivjooks naitaks tapselt sama teksti, mis valja laheb.
  const keha = lisaLoobumisrida(c.body);
  try {
    const r = await post('/api/send', { id: c.id, to: c.email, subject: c.subject, body: keha });
    console.log(`  ✓ ${c.name.slice(0, 38).padEnd(40)} ${c.email} (${r.from || ''})`);
    saadetud++;
  } catch (e) {
    console.error(`  ✗ ${c.name.slice(0, 38).padEnd(40)} ${c.email} — ${e.message}`);
    break;   // esimese tõrke peal seisame: vigane SMTP ei tohi 12 korda korduda
  }
  if (i < g.jarjekord.length - 1) {
    const paus = (L.minGapMin + Math.random() * 3) * 60000;   // juhuslik vahe, mitte masinatempo
    console.log(`    ootan ${Math.round(paus / 60000)} min`);
    await oota(paus);
  }
}
console.log(`\nSaadetud ${saadetud} kirja. Täna kokku ${g.tanaSaadetud + saadetud}/${L.perDay}.`);
db.close();
