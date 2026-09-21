// Renderdab arve ja pakkumise A4 PDF-iks, et veerist silmaga naha.
// Kasutus: node win\dokumendipilt.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { ROOT } from '../lib/env.mjs';
const require = createRequire(join(ROOT, 'package.json'));
const { chromium } = require('playwright');

let port = 4310;
const f = join(ROOT, '.env');
if (existsSync(f)) { const m = readFileSync(f, 'utf8').split(/\r?\n/).find((l) => l.startsWith('CRM_PORT=')); if (m) port = Number(m.split('=')[1]) || 4310; }
const OUT = join(ROOT, 'data', 'pildid');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1200, height: 1700 } })).newPage();
for (const [kind, id, nimi] of [['arve', 1, 'arve'], ['pakkumine', 1, 'pakkumine']]) {
  await p.goto(`http://127.0.0.1:${port}/doc?kind=${kind}&id=${id}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.emulateMedia({ media: 'print' });
  await p.pdf({ path: join(OUT, `${nimi}.pdf`), format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await p.screenshot({ path: join(OUT, `${nimi}.png`), fullPage: true });
  await p.emulateMedia({ media: 'screen' });
  console.log(nimi, 'valmis');
}
await b.close();
