// Mitu saatjat sai eri kirjade peal ERI kategooria? Puhas SQL, null kulu.
// Vaikimisi ainult aktiivne postkast (arhiveeritud kirjad kannavad vanu silte).
//   node win/saatjakontroll.mjs          aktiivne postkast
//   node win/saatjakontroll.mjs --koik   koos arhiveerituga
import { open } from '../lib/db.mjs';
const koik = process.argv.includes('--koik');
const kus = koik ? '1=1' : 'archived=0 AND deleted IS NULL';
const db = open();
const base = `FROM messages WHERE direction='in' AND classified=1 AND addr IS NOT NULL AND ${kus}`;
const r = db.prepare(`SELECT addr, COUNT(DISTINCT category) kat, COUNT(*) kirju,
                             GROUP_CONCAT(DISTINCT category) nimekiri ${base}
                       GROUP BY addr HAVING kat > 1 ORDER BY kirju DESC`).all();
const saatjaid = db.prepare(`SELECT COUNT(DISTINCT addr) n ${base}`).get().n;
const korduvaid = db.prepare(`SELECT COUNT(*) n FROM (SELECT addr ${base} GROUP BY addr HAVING COUNT(*)>1)`).get().n;
const kirju = db.prepare(`SELECT COUNT(*) n ${base}`).get().n;
const mojutatud = r.reduce((a, x) => a + x.kirju, 0);
console.log(`Ulatus: ${koik ? 'koik kirjad' : 'aktiivne postkast'} · ${kirju} kirja · ${saatjaid} saatjat (${korduvaid} korduvat)`);
console.log(`EBAJARJEKINDLAID saatjaid: ${r.length}${korduvaid ? ` (${(r.length / korduvaid * 100).toFixed(0)} % korduvatest)` : ''}`);
console.log(`Mojutatud kirju: ${mojutatud} / ${kirju}${kirju ? ` (${(mojutatud / kirju * 100).toFixed(0)} %)` : ''}\n`);
for (const x of r) console.log(`  ${String(x.kirju).padStart(3)} kirja  ${x.addr.padEnd(40)} ${x.nimekiri}`);
if (!r.length) console.log('  Uhtegi ebajarjekindlat saatjat ei ole.');
db.close();
