// Moodab torus olevate lehtede MASINLOETAVA KIHI ja kirjutab tulemuse
// data/mootmised-masinloetav.json-i. Sellest failist soovad:
//   - nahtavuskaart (lib/kaart.mjs)      - redeli aste 0
//   - jarelkirjad  (agent/jarelkiri.mjs) - uus fakt igas kirjas
//   - sihtmarkide nimekiri (win/masinloetav-sihtmargid.mjs)
//
// Kasutus:  node win/moot-masinloetav.mjs          (ainult moatmata lehed)
//           node win/moot-masinloetav.mjs --koik   (mooda koik uuesti)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/env.mjs';
import { open } from '../lib/db.mjs';

const require = createRequire(join(ROOT, 'package.json'));
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.error('Playwright puudub. Jooksuta: npm i -D playwright && npx playwright install chromium'); process.exit(1); }

const OUT = join(ROOT, 'data', 'mootmised-masinloetav.json');
mkdirSync(join(ROOT, 'data'), { recursive: true });
const koik = process.argv.includes('--koik');
const tehtud = (!koik && existsSync(OUT)) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};

const db = open();
const siht = db.prepare("SELECT id, name, url FROM companies WHERE url IS NOT NULL AND url <> ''").all()
  .map((c) => ({ ...c, url: String(c.url).replace(/^http:/, 'https:') }))
  .filter((c) => !tehtud[c.id]);
db.close();

if (!siht.length) { console.log('Kõik mõõdetud. Uuesti: --koik'); process.exit(0); }
console.log(`\nMÕÕDAN MASINLOETAVAT KIHTI — ${siht.length} lehte\n`);

const b = await chromium.launch();
let i = 0, vigu = 0;
async function tootaja() {
  while (i < siht.length) {
    const s = siht[i++]; const n = i;
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, locale: 'et-EE' });
    const p = await ctx.newPage();
    const r = { id: s.id, nimi: s.name, url: s.url, ok: false };
    try {
      const resp = await p.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      r.http = resp ? resp.status() : null;
      await p.waitForTimeout(1500);
      Object.assign(r, await p.evaluate(() => {
        const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((x) => {
          try { const j = JSON.parse(x.textContent); return (Array.isArray(j) ? j : [j]).flatMap((y) => (y['@graph'] ? y['@graph'].map((z) => z['@type']) : [y['@type']])); }
          catch { return []; }
        }).filter(Boolean).map(String);
        return {
          desc: (document.querySelector('meta[name="description"]')?.content || '').trim().length,
          og: document.querySelectorAll('meta[property^="og:"]').length,
          org: ld.some((t) => /Organization|LocalBusiness|Hotel|Restaurant|Store|Corporation/i.test(t)),
          hreflang: document.querySelectorAll('link[rel=alternate][hreflang]').length,
          lang: document.documentElement.getAttribute('lang') || '',
          tLen: (document.title || '').trim().length,
        };
      }));
      r.ok = true;
    } catch (e) { r.viga = String(e.message).split('\n')[0].slice(0, 70); vigu++; }
    finally { await ctx.close().catch(() => {}); }
    tehtud[s.id] = r;
    writeFileSync(OUT, JSON.stringify(tehtud, null, 1));
    console.log(`  ${String(n).padStart(3)}/${siht.length} ${r.ok ? 'OK' : 'X '} ${String(s.name).slice(0, 30).padEnd(30)} ${r.ok ? `desc${r.desc} og${r.og} ld${r.org ? '+' : '-'} hl${r.hreflang} t${r.tLen}` : r.viga}`);
  }
}
await Promise.all(Array.from({ length: 4 }, tootaja));
await b.close();
console.log(`\nValmis: ${Object.keys(tehtud).length} lehte, ${vigu} viga → data\\mootmised-masinloetav.json\n`);
