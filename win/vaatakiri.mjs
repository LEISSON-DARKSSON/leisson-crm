// Ajutine: nayta uks kiri taielikult. Kasutus: node win\vaatakiri.mjs 1484
import { DatabaseSync } from 'node:sqlite';
const uid = Number(process.argv[2] || 0);
const db = new DatabaseSync('data/crm.sqlite', { readOnly: true });
const rows = db.prepare('SELECT * FROM messages WHERE uid = ?').all(uid);
for (const r of rows) {
  for (const [k, v] of Object.entries(r)) {
    const s = String(v == null ? '' : v);
    console.log(k.padEnd(14), s.length > 2000 ? s.slice(0, 2000) + ' ...' : s);
  }
  console.log('======');
}
