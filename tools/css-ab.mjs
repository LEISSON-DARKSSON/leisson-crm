#!/usr/bin/env node
// css-ab — CRM-i stiililehtede computed-style A/B: kas CSS-muudatus muudab AINULT seda, mida PR lubab.
//
// MIKS SEE FAIL OLEMAS ON
// 23.09.2026 tehti kaks tüübi-PR-i (#14 poolpikslid, #15 +1/+2 px) sama käsitsi tõestusega
// %TEMP%-i skriptidest. Reegel „2 korda = automatiseeri": nüüd on tõestus repo tööriist ja
// CI samm, mitte kellegi mälu. CRM-i vaated vajavad SQLite/postkasti andmeid, seega ei
// mõõdeta päris lehte, vaid KÕIKI selektoreid: iga app/agent/crm2.css reegli selektor
// (CSSOM, ka @media sees) ehitatakse DOM-ahelaks ja lehed laetakse index.html järjekorras.
//
// Kasutus:
//   node tools/css-ab.mjs                         A = origin/main, B = töökataloog
//   node tools/css-ab.mjs --base <ref> --head <ref>
//   node tools/css-ab.mjs --plan <fail>           luba plaanis nimetatud muutused
//   node tools/css-ab.mjs --shots <kaust>         enne/pärast elemendipildid + leht.html
//   node tools/css-ab.mjs --inject "<css>"        (test) lisa B crm2.css-i lõppu
//
// Reegel:
//   plaanita  → iga font-size/font-family muutus on viga (puhas refaktor = 0 erinevust).
//   plaaniga  → iga muutus peab võrduma oma sihi deltaga (px), perekond ei muutu,
//               ja IGA siht peab muutuma (muidu mõõtmine ei näe seda, mida PR väidab).
// Plaanifail css-ab.plan.json: { "targets": { "<selektor>": <delta px>, ... } }.
// Järjekord loeb: element omistatakse ESIMESELE sihile, mille sees ta on → spetsiifilisem enne.
// Vaikimisi kasutatakse css-ab.plan.json-i AINULT siis, kui see fail muutus vs --base
// (vana commititud plaan ei tohi järgmist PR-i lubada ega kukutada).
// Piirang: orbit.css (@leisson/shared) on mõlemal poolel sama — pin'i tõstmist see ei mõõda.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const JUUR = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAILID = ['app.css', 'agent.css', 'crm2.css'];
const LAIUSED = [1280, 390];
const PLAANI_FAIL = 'css-ab.plan.json';

const arg = (nimi, vaikimisi = null) => {
  const i = process.argv.indexOf(nimi);
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : vaikimisi;
};
const base = arg('--base', 'origin/main');
const head = arg('--head');
const shots = arg('--shots');
const inject = arg('--inject');
let planPath = arg('--plan');

const git = (...a) => execFileSync('git', a, { cwd: JUUR, maxBuffer: 1 << 26 });
// Baitide kaupa (NB: PowerShelli Out-String rikub UTF-8 → võltsid erinevused).
const loeRef = (ref, f) => { try { return git('show', `${ref}:public/${f}`); } catch { return Buffer.from(''); } };
const pool = (ref) => Object.fromEntries(FAILID.map((f) => [f, ref ? loeRef(ref, f) : readFileSync(join(JUUR, 'public', f))]));

if (!planPath) {
  const muutus = (() => {
    try {
      const committed = git('diff', '--name-only', `${base}...${head || 'HEAD'}`, '--', PLAANI_FAIL).toString().trim();
      const tree = head ? '' : git('status', '--porcelain', '--', PLAANI_FAIL).toString().trim();
      return Boolean(committed || tree);
    } catch { return false; }
  })();
  if (muutus && existsSync(join(JUUR, PLAANI_FAIL))) planPath = join(JUUR, PLAANI_FAIL);
}
const PLAN = planPath ? JSON.parse(readFileSync(planPath, 'utf8')) : null;
const TARGETS = PLAN ? Object.keys(PLAN.targets || {}) : [];
if (PLAN && !TARGETS.length) { console.error('css-ab: plaanis pole ühtki sihti'); process.exit(2); }

const A = pool(base);
const B = pool(head);
if (inject) B['crm2.css'] = Buffer.concat([B['crm2.css'], Buffer.from('\n' + inject + '\n')]);

const sama = FAILID.every((f) => A[f].equals(B[f]));
if (sama && !PLAN) { console.log(`css-ab: public/{${FAILID.join(',')}} on ${base} vastu muutmata — 0 erinevust.`); process.exit(0); }

const orbit = readFileSync(join(JUUR, 'node_modules/@leisson/shared/orbit-tokens/dist/orbit.css'));
const LEHT = `<!doctype html><html lang="et"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link rel="stylesheet" href="/orbit.css">${FAILID.map((f) => `<link rel="stylesheet" href="/${f}">`).join('')}
</head><body><div id="fx"></div></body></html>`;

function serveeri(failid) {
  return createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname.slice(1);
    if (!p) { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(LEHT); }
    const sisu = p === 'orbit.css' ? orbit : failid[p];
    if (!sisu) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', 'text/css'); res.end(sisu);
  }).listen(0);
}

// Jookseb lehel: kõik selektorid (CSSOM, ka @media sees).
function selektorid(FAILID) {
  const sels = new Set();
  const kaevu = (rules) => { for (const r of rules) { if (r.selectorText) r.selectorText.split(',').forEach((s) => sels.add(s.trim())); if (r.cssRules) kaevu(r.cssRules); } };
  for (const sh of document.styleSheets) if (FAILID.some((f) => (sh.href || '').endsWith('/' + f))) kaevu(sh.cssRules);
  return [...sels];
}
// Jookseb lehel: ehita iga selektori ahel (A ja B ÜHENDhulk → sama DOM mõlemal pool), tagasta mõõdud.
function ehita({ TARGETS, list }) {
  const tee = (liit) => {
    const c = liit.replace(/::?[\w-]+(\([^)]*\))?/g, '');
    const tag = (c.match(/^[a-z][\w-]*/i) || ['div'])[0];
    if (/^(html|body|head)$/i.test(tag)) return null;
    const e = document.createElement(tag);
    for (const m of c.matchAll(/\.([\w-]+)/g)) e.classList.add(m[1]);
    for (const m of c.matchAll(/#([\w-]+)/g)) e.id = m[1];
    for (const m of c.matchAll(/\[([\w-]+)(?:[~|^$*]?=["']?([^"'\]]*)["']?)?\]/g)) { try { e.setAttribute(m[1], m[2] ?? ''); } catch {} }
    return e;
  };
  const fx = document.getElementById('fx');
  for (const sel of list) {
    let ema = document.createElement('div'); fx.appendChild(ema);
    let komb = ' ';
    for (const osa of sel.replace(/\s*([>+~])\s*/g, ' $1 ').split(/\s+/).filter(Boolean)) {
      if (osa.length === 1 && '>+~'.includes(osa)) { komb = osa; continue; }
      const e = tee(osa); if (!e) continue;
      ((komb === '+' || komb === '~') ? (ema.parentElement || fx) : ema).appendChild(e);
      ema = e; komb = ' ';
    }
    ema.appendChild(document.createTextNode('Ettevõte Pärnu Kohvik OÜ 1 240 €'));
  }
  const kõik = [...fx.querySelectorAll('*')];
  return {
    nSel: list.length,
    katvus: Object.fromEntries(TARGETS.map((t) => [t, fx.querySelectorAll(t).length])),
    m: kõik.map((e) => {
      const s = getComputedStyle(e);
      return [e.tagName.toLowerCase() + (e.classList.length ? '.' + [...e.classList].join('.') : ''),
        s.fontSize, s.fontFamily.split(',')[0].replace(/["']/g, '').trim(), TARGETS.find((t) => e.closest(t)) || null];
    }),
  };
}

const { chromium } = await import('playwright');
const brauser = await chromium.launch();
const serverid = { A: serveeri(A), B: serveeri(B) };
const url = (k) => `http://localhost:${serverid[k].address().port}/`;
const avatud = async (k, w) => {
  const p = await brauser.newPage({ viewport: { width: w, height: 900 } });
  await p.goto(url(k)); await p.waitForLoadState('networkidle');
  return p;
};
// Ühendhulk: PR võib selektoreid lisada või eemaldada.
const list = new Set();
for (const k of ['A', 'B']) { const p = await avatud(k, 1280); (await p.evaluate(selektorid, FAILID)).forEach((s) => list.add(s)); await p.close(); }
const LIST = [...list].sort();

let ok = true;
const pildid = [];
for (const w of LAIUSED) {
  const r = {};
  for (const k of ['A', 'B']) {
    const p = await avatud(k, w);
    r[k] = await p.evaluate(ehita, { TARGETS, list: LIST });
    if (shots && w === LAIUSED[0]) {
      mkdirSync(shots, { recursive: true });
      for (const [ti, t] of TARGETS.entries()) {
        const f = join(shots, `${ti}-${k}.png`);
        // Plokkelement on 1280 px lai → lõika vasak 480 px, muidu jääb tekst lehel nööpnõelapeaks.
        try {
          const bb = await p.locator(`#fx ${t}`).first().boundingBox({ timeout: 3000 });
          if (bb && bb.height > 0) {
            await p.screenshot({ path: f, fullPage: true, clip: { x: bb.x, y: bb.y, width: Math.min(480, Math.max(1, bb.width)), height: bb.height } });
            if (k === 'B') pildid.push([t, ti]);
          }
        } catch (e) { console.log(`   (pilt jäi vahele: ${t} — ${e.message.split('\n')[0]})`); }
      }
    }
    await p.close();
  }
  const { A: a, B: b } = r;
  const muutused = []; const vead = []; const tabas = Object.fromEntries(TARGETS.map((t) => [t, 0]));
  a.m.forEach((x, i) => {
    const y = b.m[i];
    if (x[1] === y[1] && x[2] === y[2]) return;
    const d = parseFloat(y[1]) - parseFloat(x[1]);
    muutused.push(`${x[0]}  ${x[1]} → ${y[1]}  [${x[2]}${x[2] !== y[2] ? ' → ' + y[2] : ''}]`);
    if (y[3]) tabas[y[3]]++;
    const oodatud = PLAN && y[3] ? PLAN.targets[y[3]] : 0;
    if (x[2] !== y[2]) vead.push(`perekond muutus: ${x[0]} ${x[2]} → ${y[2]}`);
    else if (Math.abs(d - oodatud) > 1e-6) vead.push(`OOTAMATU: ${x[0]} ${x[1]} → ${y[1]} (siht ${y[3] || '—'}, oodatud ${oodatud > 0 ? '+' : ''}${oodatud}px)`);
  });
  const kokku = {}; muutused.forEach((m) => { kokku[m] = (kokku[m] || 0) + 1; });
  console.log(`\n== ${w}px: ${LIST.length} selektorit, ${a.m.length} elementi, ${muutused.length} muutus, ${vead.length} viga`);
  Object.entries(kokku).sort().forEach(([m, n]) => console.log(`   ${n} × ${m}`));
  vead.forEach((v) => console.log('   ✗ ' + v));
  if (PLAN) {
    for (const t of TARGETS) {
      if (!b.katvus[t]) { console.log(`   ✗ siht ${t}: 0 elementi (selektor ei vasta ühelegi ehitatud elemendile)`); ok = false; }
      else if (!tabas[t]) { console.log(`   ✗ siht ${t}: ei muutunud (plaan väidab ${PLAN.targets[t]}px)`); ok = false; }
    }
  }
  if (vead.length) ok = false;
}
await brauser.close();
serverid.A.close(); serverid.B.close();

if (shots && pildid.length) {
  const img = (f) => existsSync(f) ? 'data:image/png;base64,' + readFileSync(f).toString('base64') : '';
  const read = pildid.map(([t, i]) => `<tr><td><code>${t}</code><br><small>${PLAN.targets[t] > 0 ? '+' : ''}${PLAN.targets[t]}px</small></td><td><img src="${img(join(shots, `${i}-A.png`))}"></td><td><img src="${img(join(shots, `${i}-B.png`))}"></td></tr>`).join('');
  writeFileSync(join(shots, 'leht.html'), `<!doctype html><meta charset="utf-8"><style>body{font:13px system-ui;margin:16px}td{border-bottom:1px solid #ddd;padding:6px;vertical-align:top}img{display:block;background:#000;image-rendering:pixelated;zoom:2}</style><h1>css-ab ${base} → ${head || 'töökataloog'}</h1><table><tr><th>siht</th><th>enne</th><th>pärast</th></tr>${read}</table>`);
  console.log(`\nenne/pärast: ${join(shots, 'leht.html')}`);
}
console.log(ok ? `\ncss-ab: OK${PLAN ? ` (plaan ${planPath})` : ' (plaanita: 0 lubatud muutust)'}` : '\ncss-ab: FAIL — muuda CSS-i või kirjelda muutus css-ab.plan.json-is');
process.exit(ok ? 0 : 1);
