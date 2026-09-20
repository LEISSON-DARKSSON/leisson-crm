// Mida triaaz leidis: otsustavad kirjad koos kokkuvottega.
import { open } from '../lib/db.mjs';
const db = open();
const r = db.prepare(`
  SELECT mailbox || ':' || uid AS id, substr(ts,1,10) AS pv, addr, subject, category, urgency,
         ROUND(confidence,2) AS k, summary, replied,
         CAST(julianday('now') - julianday(ts) AS INTEGER) AS vanus
    FROM messages
   WHERE archived=0 AND deleted IS NULL
     AND (category IN ('paring','vastus_pakkumisele','kohtumine','klienditoo') OR urgency='korge')
   ORDER BY CASE category WHEN 'paring' THEN 0 WHEN 'vastus_pakkumisele' THEN 1
                          WHEN 'kohtumine' THEN 2 WHEN 'klienditoo' THEN 3 ELSE 4 END, ts DESC`).all();
for (const x of r) {
  console.log(`${x.id} | ${x.pv} (${x.vanus} p) | ${x.category}/${x.urgency} | kindlus ${x.k} | ${x.addr}${x.replied ? ' | VASTATUD' : ''}`);
  console.log('    ' + String(x.subject || '').slice(0, 90));
  if (x.summary) console.log('    ' + String(x.summary).slice(0, 170));
}
console.log(`\n${r.length} otsustavat kirja.`);
db.close();
