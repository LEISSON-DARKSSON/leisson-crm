// MOODETUD TOHUSUS. Koik numbrid tulevad andmebaasist, mitte hinnangust.
//   node win/tohusus.mjs
import { open } from '../lib/db.mjs';
import { limits } from '../lib/sendgate.mjs';

const db = open();
const nyyd = new Date();
const pv = (d) => d.toISOString().slice(0, 10);
const num = (n) => new Intl.NumberFormat('et-EE').format(n);
const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');

console.log('\n' + '='.repeat(74));
console.log('  LEISSON CRM — MÕÕDETUD TÕHUSUS  ' + nyyd.toISOString().slice(0, 16).replace('T', ' '));
console.log('='.repeat(74));

// --- 1. TORU ---
const firmasid = db.prepare('SELECT COUNT(*) n FROM companies').get().n;
const seisud = db.prepare('SELECT status, COUNT(*) n FROM companies GROUP BY status').all();
const saadetud = db.prepare("SELECT COUNT(*) n FROM activity WHERE kind='sent'").get().n;
const jarel = db.prepare("SELECT COUNT(*) n FROM activity WHERE kind='jarelkiri'").get().n;
const vastanud = db.prepare(
  "SELECT COUNT(DISTINCT company_id) n FROM messages WHERE direction='in' AND company_id IS NOT NULL").get().n;
const inimvastus = db.prepare(`SELECT COUNT(DISTINCT m.company_id) n FROM messages m
  WHERE m.direction='in' AND m.company_id IS NOT NULL
    AND m.subject NOT LIKE 'Auto%' AND m.subject NOT LIKE '%utomaatvastus%'`).get().n;

console.log('\n1. TORU');
console.log(`   ettevõtteid ${firmasid} · ${seisud.map((s) => `${s.status} ${s.n}`).join(' · ')}`);
console.log(`   külmkirju saadetud ${saadetud} · järelkirju ${jarel}`);
console.log(`   vastanud ettevõtteid ${vastanud} (${pct(vastanud, saadetud)}) · neist inimvastuseid ${inimvastus}`);

// --- 2. RAHA ---
let off = [], inv = [];
try { off = db.prepare('SELECT number, state, company_id FROM offers').all(); } catch {}
try { inv = db.prepare('SELECT number, state, total, sent FROM invoices').all(); } catch {}
const makstud = inv.filter((x) => x.state === 'makstud');
const raha = makstud.reduce((s, x) => s + (x.total || 0), 0);
console.log('\n2. RAHA');
console.log(`   pakkumisi ${off.length} · arveid ${inv.length} · makstud ${makstud.length}`);
console.log(`   LAEKUNUD ${num(raha)} €`);
for (const i of inv) console.log(`     ${i.number} · ${i.state} · ${num(i.total || 0)} €`);

// --- 3. AGENDIKULU ---
// NB veerg on total_cost_usd, mitte cost_usd. Vale nimi andis vaikselt 0.00 $
// ehk "agendid ei maksa midagi" - koige ohtlikum liiki viga aruandes.
let runs = [];
try { runs = db.prepare('SELECT type, model, total_cost_usd, ts FROM agent_runs').all(); } catch {}
const kulu = runs.reduce((s, r) => s + Number(r.total_cost_usd || 0), 0);
const tyypide = {};
for (const r of runs) {
  const t = `${r.type || '?'}${r.model ? ' (' + r.model + ')' : ''}`;
  tyypide[t] = tyypide[t] || { n: 0, usd: 0 };
  tyypide[t].n++; tyypide[t].usd += Number(r.total_cost_usd || 0);
}
console.log('\n3. AGENDIKULU (mudelikutsed)');
console.log(`   jookse ${runs.length} · kokku ${kulu.toFixed(2)} $`);
for (const [t, v] of Object.entries(tyypide).sort((a, b) => b[1].usd - a[1].usd)) {
  console.log(`     ${t.padEnd(24)} ${String(v.n).padStart(4)} × · ${v.usd.toFixed(3)} $`);
}
console.log(`   kulu ühe saadetud kirja kohta: ${saadetud ? (kulu / saadetud).toFixed(4) : '—'} $`);
console.log(`   kulu ühe vastuse kohta:        ${vastanud ? (kulu / vastanud).toFixed(3) : '—'} $`);

// --- 4. AUTOMAADID ---
console.log('\n4. AUTOMAATIDE PÄRIS JOOKS (viimased 7 päeva)');
// KOHALIK aeg, mitte UTC: varav toootab kohaliku kella jargi (tooaeg 9-17),
// seega UTC-jargi tukeldamine naitaks vale tunni ja peidaks puhangu ara.
const kohalikPaev = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const kohalikTund = (iso) => `${kohalikPaev(iso)} ${String(new Date(iso).getHours()).padStart(2, '0')}`;

const paevad = {};
for (const r of db.prepare("SELECT ts, kind FROM activity WHERE kind IN ('sent','jarelkiri') ORDER BY ts").all()) {
  const d = kohalikPaev(r.ts);
  paevad[d] = paevad[d] || { sent: 0, jarelkiri: 0 };
  paevad[d][r.kind]++;
}
const L = limits();
for (const [d, v] of Object.entries(paevad).sort()) {
  const yle = v.sent > L.perDay ? '  ← ÜLE PÄEVALIMIIDI' : '';
  console.log(`   ${d}  külmkirju ${String(v.sent).padStart(3)}/${L.perDay}  järelkirju ${String(v.jarelkiri).padStart(2)}${yle}`);
}

// --- 5. PUHANGUD ---
console.log('\n5. PUHANGUD (kirju tunnis)');
const tunnid = {};
for (const r of db.prepare("SELECT ts FROM activity WHERE kind IN ('sent','jarelkiri')").all()) {
  const t = kohalikTund(r.ts);
  tunnid[t] = (tunnid[t] || 0) + 1;
}
const halvad = Object.entries(tunnid).filter(([, n]) => n > L.perHour).sort();
if (!halvad.length) console.log(`   ükski tund ei ületa ${L.perHour} kirja`);
for (const [t, n] of halvad) console.log(`   ${t}:00  ${n} kirja  ← üle tunnilimiidi (${L.perHour})`);
  const tanaTunnid = Object.entries(tunnid).filter(([t]) => t.startsWith(kohalikPaev(nyyd.toISOString())));
  if (tanaTunnid.length) {
    console.log(`   täna: ${tanaTunnid.map(([t, n]) => `${t.slice(-2)}:00→${n}`).join('  ')}  (lagi ${L.perHour}/h)`);
  }

// --- 6. VARAVA POHJUSED ---
console.log('\n6. MIKS KIRI EI LÄHE (praegu torus)');
const ootel = db.prepare("SELECT email, body, subject FROM companies WHERE status='ootel'").all();
const p = { 'valmis, ootab järjekorda': 0, 'kirja ei ole': 0, 'e-posti ei ole': 0, 'kumbagi ei ole': 0 };
for (const c of ootel) {
  if (c.body && c.email) p['valmis, ootab järjekorda']++;
  else if (!c.body && !c.email) p['kumbagi ei ole']++;
  else if (!c.body) p['kirja ei ole']++;
  else p['e-posti ei ole']++;
}
for (const [k, v] of Object.entries(p)) console.log(`   ${String(v).padStart(3)} × ${k}`);

// --- 7. INIMESE TOO ---
console.log('\n7. INIMESE KLIKKI OOTAB');
let mustandeid = [];
try { mustandeid = db.prepare("SELECT subject, status FROM drafts WHERE status='ootab_kinnitust'").all(); } catch {}
console.log(`   ${mustandeid.length} mustandit`);
for (const m of mustandeid) console.log(`     ${String(m.subject).slice(0, 64)}`);
console.log('\n' + '='.repeat(74) + '\n');
db.close();
