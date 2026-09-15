// Küsib mandaadid SINU terminalis ja kirjutab .env. Parool ei liigu kuhugi mujale.
// Toetab mitut kontot: gert@leisson.eu ja leisson@leisson.eu.
import { writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

const HOSTS = {
  IMAP_HOST: 'imap.zone.eu',
  IMAP_PORT: '993',
  SMTP_HOST: 'smtp.zone.eu',
  SMTP_PORT: '465',
  CRM_PORT: '4310',
  POLL_MINUTES: '5',
};

const SUGGEST = [
  { id: 'gert', user: 'gert@leisson.eu', name: 'Gert Leisson' },
  { id: 'leisson', user: 'leisson@leisson.eu', name: 'Leisson Creative' },
];

const CTRL_C = String.fromCharCode(3);
const BACKSPACE = String.fromCharCode(127);

const rl = createInterface({ input: stdin, output: stdout });
const ask = (q, def) =>
  new Promise((res) => rl.question(def ? `${q} [${def}]: ` : `${q}: `, (a) => res((a || '').trim() || def || '')));
const yes = async (q, def = 'j') => /^j|^y/i.test(await ask(`${q} (j/e)`, def));

function askHidden(q) {
  return new Promise((res) => {
    stdout.write(q + ': ');
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    let buf = '';
    const onData = (chunk) => {
      const s = chunk.toString('utf8');
      if (s === '\r' || s === '\n') {
        stdin.removeListener('data', onData);
        if (stdin.setRawMode) stdin.setRawMode(!!wasRaw);
        stdout.write('\n');
        res(buf);
        return;
      }
      if (s === CTRL_C) { stdout.write('\n'); process.exit(1); }
      if (s === BACKSPACE || s === '\b') { buf = buf.slice(0, -1); return; }
      buf += s;
    };
    stdin.on('data', onData);
  });
}

function readExisting() {
  if (!existsSync('.env')) return {};
  const out = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !line.trimStart().startsWith('#')) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

console.log('\nLEISSON CRM - kontode seadistus');
console.log('Paroolid kirjutatakse ainult faili .env selles kaustas. Neid ei logita ega saadeta kuhugi.\n');

const old = readExisting();
const keep = {};
const haveIds = (old.ACCOUNTS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!haveIds.length && old.MAIL_USER && old.MAIL_PASS) haveIds.push('gert');

const ids = [];

for (const s of SUGGEST) {
  const K = s.id.toUpperCase();
  const existingUser = old[`ACC_${K}_USER`] || (s.id === 'gert' ? old.MAIL_USER : null);
  const existingPass = old[`ACC_${K}_PASS`] || (s.id === 'gert' ? old.MAIL_PASS : null);

  if (existingUser && existingPass) {
    if (await yes(`Konto ${existingUser} on juba seadistatud. Jatan alles?`)) {
      keep[`ACC_${K}_USER`] = existingUser;
      keep[`ACC_${K}_PASS`] = existingPass;
      keep[`ACC_${K}_NAME`] = old[`ACC_${K}_NAME`] || old.MAIL_FROM_NAME || s.name;
      ids.push(s.id);
      continue;
    }
  } else if (!(await yes(`Lisan konto ${s.user}?`))) {
    continue;
  }

  const user = await ask('  E-posti aadress', s.user);
  const name = await ask('  Saatja nimi', s.name);
  rl.pause();
  const pass = await askHidden('  Parool (ei kuvata)');
  rl.resume();
  if (!pass) {
    console.error('  Parool oli tuhi - konto jai lisamata.');
    continue;
  }
  keep[`ACC_${K}_USER`] = user;
  keep[`ACC_${K}_PASS`] = pass;
  keep[`ACC_${K}_NAME`] = name;
  ids.push(s.id);
}

if (!ids.length) {
  console.error('\nUhtegi kontot ei seadistatud - ei kirjutanud midagi.');
  process.exit(1);
}

const hosts = {};
for (const [k, v] of Object.entries(HOSTS)) hosts[k] = old[k] || v;
const def = ids.length > 1 ? await ask(`Vaikimisi saatja konto (${ids.join(' / ')})`, ids[0]) : ids[0];
rl.close();

if (existsSync('.env')) {
  writeFileSync('.env.bak', readFileSync('.env'));
  console.log('Vana .env varundatud -> .env.bak');
}

const lines = [
  '# Leisson CRM. Paroolid on siin - ara seda faili kuhugi kopeeri ega commiti.',
  `ACCOUNTS=${ids.join(',')}`,
  `DEFAULT_ACCOUNT=${def}`,
  '',
];
for (const id of ids) {
  const K = id.toUpperCase();
  lines.push(`ACC_${K}_USER=${keep[`ACC_${K}_USER`]}`);
  lines.push(`ACC_${K}_PASS=${keep[`ACC_${K}_PASS`]}`);
  lines.push(`ACC_${K}_NAME=${keep[`ACC_${K}_NAME`]}`);
  lines.push('');
}
for (const [k, v] of Object.entries(hosts)) lines.push(`${k}=${v}`);

writeFileSync('.env', lines.join('\n') + '\n', { mode: 0o600 });
try { chmodSync('.env', 0o600); } catch {}

console.log(`\n.env kirjutatud, ${ids.length} konto(t): ${ids.join(', ')}`);
console.log('Kontrolli uhendust:  npm run doctor');
console.log('Kaivita CRM:         npm start\n');
