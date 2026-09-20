// Allkirja eelvaate pilt, et lukku silmaga naha.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { ROOT } from '../lib/env.mjs';
const require = createRequire(join(ROOT, '..', 'package.json'));
const { chromium } = require('playwright');
let port = 4310;
const f = join(ROOT, '.env');
if (existsSync(f)) { const m = readFileSync(f, 'utf8').split(/\r?\n/).find((l) => l.startsWith('CRM_PORT=')); if (m) port = Number(m.split('=')[1]) || 4310; }
const OUT = join(ROOT, 'data', 'pildid');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 900, height: 760 } })).newPage();
await p.goto(`http://127.0.0.1:${port}/signature`, { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.screenshot({ path: join(OUT, 'allkiri.png') });
await b.close();
console.log('allkiri.png valmis');
