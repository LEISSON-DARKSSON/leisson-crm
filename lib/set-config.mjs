// Muuda .env-is UHTE mittesaladuslikku seadet, ilma faili sisu kuvamata.
//   node lib/set-config.mjs AGENT_DAILY_USD 6
//
// Lubatud on AINULT alljargnevad votmed. Paroolivotmeid see skript ei puutu
// ega kuva - .env-i ei loeta kunagi valja, ainult kirjutatakse tagasi.
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';

const LUBATUD = new Set([
  'CRM_PORT', 'POLL_MINUTES', 'DEFAULT_ACCOUNT',
  'AGENT_DAILY_USD', 'AGENT_MAX_DRAFTS',
  'IMAP_HOST', 'IMAP_PORT', 'SMTP_HOST', 'SMTP_PORT',
]);

const [key, ...rest] = process.argv.slice(2);
const value = rest.join(' ');

if (!key || !value) {
  console.error('Kasutus: node lib/set-config.mjs <VOTI> <vaartus>');
  console.error('Lubatud votmed: ' + [...LUBATUD].join(', '));
  process.exit(1);
}
if (!LUBATUD.has(key)) {
  console.error(`Votit "${key}" see skript ei muuda. Lubatud: ${[...LUBATUD].join(', ')}`);
  console.error('Kontode ja paroolide jaoks kasuta: npm run setup');
  process.exit(1);
}
if (!existsSync('.env')) { console.error('.env puudub - jooksuta enne: npm run setup'); process.exit(1); }

const read = readFileSync('.env', 'utf8');
const eol = read.includes('\r\n') ? '\r\n' : '\n';
const lines = read.split(/\r?\n/);
let vana = null, leitud = false;

const out = lines.map((l) => {
  const i = l.indexOf('=');
  if (i > 0 && l.slice(0, i).trim() === key) {
    vana = l.slice(i + 1).trim();
    leitud = true;
    return `${key}=${value}`;
  }
  return l;
});

if (!leitud) {
  // lisame hostide ploki lopupoole, et fail jaaks loetavaks
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  out.push(`${key}=${value}`, '');
}

writeFileSync('.env', out.join(eol), { mode: 0o600 });
try { chmodSync('.env', 0o600); } catch { /* mode ei ole Windowsis oluline */ }

console.log(leitud ? `${key}: ${vana} -> ${value}` : `${key}=${value} lisatud`);
