// Taielik saatmislugu: kes, millal, mis tempos, kas oli vigu.
import { open } from '../lib/db.mjs';
const db = open();
const read = db.prepare(
  "SELECT ts, company_id, note FROM activity WHERE kind='sent' ORDER BY ts",
).all();
console.log('KOIK SAADETUD KIRJAD:', read.length, '\n');
let eelmine = null;
for (const r of read) {
  const t = new Date(r.ts);
  const vahe = eelmine ? Math.round((t - eelmine) / 1000) : null;
  const saaja = (String(r.note).split('→')[1] || '').split('—')[0].trim();
  console.log(`  ${r.ts.slice(0, 19).replace('T', ' ')}  ${vahe === null ? '   —' : String(vahe).padStart(4) + 's'}  ${saaja}`);
  eelmine = t;
}
console.log('\nVEAD tegevuslogis:');
for (const r of db.prepare("SELECT ts, company_id, note FROM activity WHERE kind='error' ORDER BY ts DESC LIMIT 10").all())
  console.log(`  ${r.ts.slice(0, 19)} ${r.company_id} ${String(r.note).slice(0, 80)}`);
console.log('\nVABAPOSTI (eraisiku) aadressid, kellele laks kiri:');
for (const r of read) {
  const saaja = (String(r.note).split('→')[1] || '').split('—')[0].trim();
  if (/@(gmail|hotmail|outlook|live|yahoo|mail\.ee|hot\.ee)\./i.test(saaja)) console.log('  ', r.ts.slice(0, 19), saaja);
}
db.close();
