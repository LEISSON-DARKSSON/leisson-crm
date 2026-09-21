// Vaba pordi kusimine OS-ilt, mitte arvamine.
//
// MIKS SEE FAIL OLEMAS ON. test/gate.mjs valis pordi reaga
//   const PORT = 4300 + Math.floor(Math.random() * 90);
// ehk vahemikust 4300-4389. Gerti ELAV CRM kuulab pordil 4310 (lib/env.mjs
// vaikevaartus, .env-is muudetav). See tahendab, et iga `npm test` jooks oli
// 1:90 toenaosusega vastuolus toodanguserveriga: varav oleks kas kukkunud
// arusaamatu EADDRINUSE-ga, voi - hullem - raakinud oma API-kontrollid PARIS
// CRM-iga ja kirjutanud sinna. Leitud 21.09.2026 ajaloomootmise kaigus.
//
// Lahendus: kusi port OS-ilt (listen 0), mitte loosi teda. Lisaks jaetakse
// seadistatud CRM-i port ALATI valja, ka siis kui OS ta juhuslikult annaks
// (ta on vaba tapselt siis, kui server parasjagu ei kaigi - ja siis on ta veel
// ohtlikum, sest jooks onnestuks ja kirjutaks toodangu kataloogi).
import { createServer } from 'node:net';
import { rawEnv } from '../lib/env.mjs';

/** Kusi OS-ilt uks vaba TCP-port. Seadistatud CRM-i porti ei tagastata kunagi. */
export async function vabaPort({ katseid = 10, keelatud = [] } = {}) {
  // Ainult CRM_PORT, mitte kogu .env - seal on paroolid ja neid siin ei loeta.
  let crmPort = 4310;
  try {
    const e = rawEnv() || {};
    crmPort = Number(process.env.CRM_PORT || e.CRM_PORT || 4310) || 4310;
  } catch { /* .env puudub - vaikeport jaab valja niikuinii */ }
  const valjas = new Set([crmPort, ...keelatud.map(Number)]);
  for (let i = 0; i < katseid; i++) {
    const port = await new Promise((res, rej) => {
      const s = createServer();
      s.on('error', rej);
      s.listen(0, '127.0.0.1', () => {
        const p = s.address().port;
        s.close(() => res(p));
      });
    });
    if (!valjas.has(port)) return port;
  }
  throw new Error('Vaba porti ei leidnud ' + katseid + ' katsega (välistatud: '
    + [...valjas].join(', ') + ')');
}
