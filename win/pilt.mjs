// Ekraanipildid elavast serverist, et paigutust silmaga naha.
// Kasutus: node win\pilt.mjs [laius] [korgus]
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { ROOT } from '../lib/env.mjs';

const require = createRequire(join(ROOT, '..', 'package.json'));
const { chromium } = require('playwright');

let port = 4310;
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  const m = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('CRM_PORT='));
  if (m) port = Number(m.split('=')[1]) || 4310;
}
const W = Number(process.argv[2]) || 2650;
const H = Number(process.argv[3]) || 1600;
const OUT = join(ROOT, 'data', 'pildid');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: W, height: H }, locale: 'et-EE', deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await p.waitForSelector('.list .row', { timeout: 10000 });
await p.click('.list .row');
await p.waitForTimeout(900);
await p.screenshot({ path: join(OUT, `toru-${W}.png`) });

await p.click('.view-tab[data-view="inbox"]');
await p.waitForTimeout(700);
const r = await p.$('#mailList .row');
if (r) { await r.click(); await p.waitForTimeout(1200); }
await p.screenshot({ path: join(OUT, `postkast-${W}.png`) });

for (const v of ['stats', 'services', 'billing', 'agents']) {
  await p.click(`.view-tab[data-view="${v}"]`);
  await p.waitForTimeout(700);
  await p.screenshot({ path: join(OUT, `${v}-${W}.png`) });
}
console.log('pildid:', OUT);
await b.close();
