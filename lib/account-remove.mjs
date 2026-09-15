// Eemalda konto .env-ist ilma paroole kuvamata.
//   node lib/account-remove.mjs leisson
// Kirjutab .env uuesti (mode 600) ja prindib AINULT votmenimed, mitte vaartusi.
import { readFileSync, writeFileSync, existsSync, chmodSync, unlinkSync } from 'node:fs';

const id = (process.argv[2] || '').trim().toLowerCase();
if (!id) { console.error('Kasutus: node lib/account-remove.mjs <konto-id>'); process.exit(1); }
if (!existsSync('.env')) { console.error('.env puudub'); process.exit(1); }

const K = id.toUpperCase();
const lines = readFileSync('.env', 'utf8').split(/\r?\n/);
const keyOf = (l) => { const i = l.indexOf('='); return i > 0 ? l.slice(0, i).trim() : null; };

let ids = [];
for (const l of lines) if (keyOf(l) === 'ACCOUNTS') ids = l.slice(l.indexOf('=') + 1).split(',').map((s) => s.trim()).filter(Boolean);
if (!ids.includes(id)) { console.error(`Kontot "${id}" ei ole .env-is. Praegu: ${ids.join(', ')}`); process.exit(1); }
if (ids.length < 2) { console.error('See on ainus konto - ei eemalda.'); process.exit(1); }

const jaab = ids.filter((x) => x !== id);
const out = [];
const eemaldatud = [];
for (const l of lines) {
  const k = keyOf(l);
  if (k && k.startsWith(`ACC_${K}_`)) { eemaldatud.push(k); continue; }
  if (k === 'ACCOUNTS') { out.push(`ACCOUNTS=${jaab.join(',')}`); continue; }
  if (k === 'DEFAULT_ACCOUNT') {
    const cur = l.slice(l.indexOf('=') + 1).trim();
    out.push(`DEFAULT_ACCOUNT=${cur === id ? jaab[0] : cur}`);
    continue;
  }
  out.push(l);
}

writeFileSync('.env', out.join('\n').replace(/\n{3,}/g, '\n\n'), { mode: 0o600 });
try { chmodSync('.env', 0o600); } catch {}

// varukoopia sisaldaks paroole avatekstina - seda me ei tee
if (existsSync('.env.bak')) {
  try { unlinkSync('.env.bak'); console.log('Vana .env.bak (sisaldas parooli avatekstina) kustutatud.'); }
  catch { console.log('MARKUS: .env.bak on alles ja sisaldab parooli avatekstina - kustuta kaega.'); }
}

console.log(`Konto "${id}" eemaldatud. Eemaldatud votmed: ${eemaldatud.join(', ')}`);
console.log(`Alles: ${jaab.join(', ')}`);
console.log('Kontrolli:  npm run doctor');
