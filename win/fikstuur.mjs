// Ajutine: vaata regressioonifikstuuri. node win\fikstuur.mjs [otsingusona]
import { readFileSync } from 'node:fs';
const f = JSON.parse(readFileSync('agent/fixtures/triage-regression.json', 'utf8'));
console.log('ulemised valjad:', Object.keys(f).join(', '));
const list = f.messages || f.kirjad || [];
console.log('kirju:', list.length);
const q = process.argv[2];
if (!q) {
  for (const m of list) console.log((m.id || m.uid), '|', (m.expect && m.expect.category), '|', String(m.addr || m.sender || ''), '|', String(m.subject || '').slice(0, 60));
} else {
  for (const m of list) if (JSON.stringify(m).toLowerCase().includes(q.toLowerCase())) console.log(JSON.stringify(m, null, 1));
}
