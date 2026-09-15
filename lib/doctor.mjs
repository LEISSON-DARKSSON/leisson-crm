// Kontrollib mandaadi, SMTP, IMAP ja allkirja ehituse iga konto kohta. Parooli ei kuvata kunagi.
import { loadEnv } from './env.mjs';
import { verifySmtp, verifyImap } from './mail.mjs';
import { buildSignature } from './signature.mjs';

const ok = (s) => console.log('  OK    ' + s);
const bad = (s, e) => console.log('  VIGA  ' + s + (e ? '  -> ' + e : ''));

let fail = 0;
console.log('\nLEISSON CRM doctor\n');

let c;
try {
  c = loadEnv();
  ok(`.env loetud, ${c.accounts.length} konto(t): ${c.accounts.map((a) => a.user).join(', ')}`);
  ok(`vaikimisi saatja: ${c.defaultAccount} · postkasti kontroll iga ${c.pollMinutes} min · port ${c.port}`);
} catch (e) {
  bad('.env', e.message);
  process.exit(1);
}

try {
  const { html } = buildSignature();
  ok(`allkiri ehitatud tokenitest (${html.length} baiti, rgba lahendatud)`);
} catch (e) {
  bad('allkirja ehitus', e.message);
  fail++;
}

for (const a of c.accounts) {
  console.log(`\n  konto ${a.id}  (${a.user}, parool ${'*'.repeat(8)})`);
  try {
    await verifySmtp(a.id);
    ok(`SMTP ${a.smtpHost}:${a.smtpPort} autentimine korras`);
  } catch (e) {
    bad(`SMTP ${a.smtpHost}:${a.smtpPort}`, e.message);
    fail++;
  }
  try {
    const boxes = await verifyImap(a.id);
    ok(`IMAP ${a.imapHost}:${a.imapPort} korras, ${boxes.length} kausta`);
    console.log('        ' + boxes.slice(0, 10).join(', '));
  } catch (e) {
    bad(`IMAP ${a.imapHost}:${a.imapPort}`, e.message);
    fail++;
  }
}

console.log(fail ? `\n${fail} kontroll ebaonnestus.\n` : '\nKoik korras. Kaivita: npm start\n');
process.exit(fail ? 1 : 0);
