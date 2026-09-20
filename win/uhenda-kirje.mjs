// Uhendab kaks sama ettevotte kirjet UHEKS. Kasutus:
//   node win/uhenda-kirje.mjs <jaab> <kaob>          kuivjooks
//   node win/uhenda-kirje.mjs <jaab> <kaob> --tee    teeb ara
//
// REEGEL: TOESIMUSED voidavad. Kui uhel kirjel on tegelik saatmisajalugu ja
// teisel ainult ette valmistatud kiri, siis jaab kehtima SAADETUD seis -
// muidu naitab CRM kirja, mida kunagi ei saadetud, ja saatja voib saata teist korda.
import { open } from '../lib/db.mjs';

const [jaab, kaob] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const TEE = process.argv.includes('--tee');
if (!jaab || !kaob) { console.error('Kasutus: node win/uhenda-kirje.mjs <jaab> <kaob> [--tee]'); process.exit(1); }

const db = open();
const A = db.prepare('SELECT * FROM companies WHERE id=?').get(jaab);
const B = db.prepare('SELECT * FROM companies WHERE id=?').get(kaob);
if (!A || !B) { console.error('Kirjet ei leidnud:', !A ? jaab : kaob); process.exit(1); }

const saadetud = (id) => db.prepare("SELECT COUNT(*) n FROM activity WHERE company_id=? AND kind='sent'").get(id).n;
const aSent = saadetud(jaab), bSent = saadetud(kaob);

// Kumb kirje kannab TOELIST saatmisajalugu?
const allikas = bSent > aSent ? B : A;
const SEIS = ['ootel', 'kiri', 'kohtumine', 'pakkumine', 'voidetud'];
const parem = (x, y) => (SEIS.indexOf(y) > SEIS.indexOf(x) ? y : x);

const uus = {
  status: parem(A.status, B.status),
  listid: allikas.listid || A.listid,
  priority: allikas.priority || A.priority,
  url: A.url || B.url,
  finding: allikas.finding || A.finding || B.finding,
  offer: allikas.offer || A.offer || B.offer,
  price: allikas.price || A.price || B.price,
  // Kiri: VOTA SEE, MIS TEGELIKULT SAADETI.
  subject: aSent >= bSent && A.subject ? A.subject : (B.subject || A.subject),
  body: aSent >= bSent && A.body ? A.body : (B.body || A.body),
  turnover: A.turnover || B.turnover,
  seg: A.seg || B.seg,
  loc: A.loc || B.loc,
  regcode: A.regcode || B.regcode,
  meet_day: allikas.meet_day || A.meet_day || B.meet_day,
};

console.log(`\nJÄÄB   ${jaab}  (saadetud kirju ${aSent})`);
console.log(`KAOB   ${kaob}  (saadetud kirju ${bSent})`);
console.log(`\nTõesuse allikas: ${allikas.id} — sellel on tegelik saatmisajalugu\n`);
for (const [k, v] of Object.entries(uus)) {
  const enne = A[k];
  const mark = String(enne) === String(v) ? '   ' : ' → ';
  console.log(`  ${k.padEnd(10)}${mark}${String(v ?? '—').slice(0, 68)}`);
}
const liigub = {
  activity: db.prepare('SELECT COUNT(*) n FROM activity WHERE company_id=?').get(kaob).n,
  messages: db.prepare('SELECT COUNT(*) n FROM messages WHERE company_id=?').get(kaob).n,
  offers: db.prepare('SELECT COUNT(*) n FROM offers WHERE company_id=?').get(kaob).n,
  invoices: db.prepare('SELECT COUNT(*) n FROM invoices WHERE company_id=?').get(kaob).n,
  drafts: db.prepare('SELECT COUNT(*) n FROM drafts WHERE company_id=?').get(kaob).n,
  stages: db.prepare('SELECT COUNT(*) n FROM stages WHERE company_id=?').get(kaob).n,
};
console.log(`\n  Ümber tõstetavaid ridu: ${JSON.stringify(liigub)}`);

if (!TEE) { console.log('\n  Kuivjooks. Tegemiseks lisa --tee\n'); db.close(); process.exit(0); }

db.exec('BEGIN');
try {
  db.prepare(`UPDATE companies SET status=?, listid=?, priority=?, url=?, finding=?, offer=?, price=?,
              subject=?, body=?, turnover=?, seg=?, loc=?, regcode=?, meet_day=?, updated=? WHERE id=?`)
    .run(uus.status, uus.listid, uus.priority, uus.url, uus.finding, uus.offer, uus.price,
         uus.subject, uus.body, uus.turnover, uus.seg, uus.loc, uus.regcode, uus.meet_day,
         new Date().toISOString(), jaab);
  for (const t of ['activity', 'messages', 'offers', 'invoices', 'drafts', 'stages']) {
    db.prepare(`UPDATE ${t} SET company_id=? WHERE company_id=?`).run(jaab, kaob);
  }
  db.prepare('DELETE FROM companies WHERE id=?').run(kaob);
  db.exec('COMMIT');
  console.log(`\n  Ühendatud. ${kaob} on kustutatud, kõik read on ${jaab} all.\n`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('  TÕRGE, midagi ei muudetud:', e.message);
  process.exit(1);
}
db.close();
