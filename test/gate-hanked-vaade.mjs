// ULESANNE 9: riigihangete vaade PARIS brauseris (sama muster mis gate-campaign-ui.mjs).
//
// test/gate-hanked-ui.mjs toestab puhast loogikat ilma DOM-ita ja jookseb igal
// masinal. SIIN avatakse paris index.html paris app.js-i, views.js-i ja
// hanked-loogika.js-iga volts API peal: sakivahetus, tabeli sisu, filtririba,
// seisumuutus ILMA taislaadimiseta, tuhi olek, vigane vastus ja - koige tahtsam -
// et RHR-ist tulev pealkiri joudis lehele TEKSTINA, mitte HTML-ina.
//
// Vorku ei kasutata: kontekst blokeerib koik peale oma origini.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { HANKE_STATES, LOPUSEISUD } from '../lib/hanked.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const KURI = '<img src=x onerror="window.__xss=1">';
const TANA = new Date().toISOString().slice(0, 10);
const paeva = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const rida = (o) => ({
  ref: 'R-0', rhr_id: '1', buyer: 'Tallinna Linnavalitsus', buyer_reg: '1', title: 'Veebilehe uuendus',
  menetlus: 'avatud', nature: 'teenus', est: 40000, cpv: '72000000', deadline: paeva(10),
  published: TANA, segment: 'veeb', score: 50, score_why: null, state: 'uus', note: null,
  docs_dir: null, docs_count: 0, seen: TANA, seen_last: null, updated: TANA, ...o,
});

// Kolm rida: kiireloomuline (marki jaoks), tavaline ja LOPPSEISUS rida, mis
// "aktiivsed"-filtri all EI tohi nahtav olla.
const HANKED = [
  rida({ ref: 'R-KIIRE', title: KURI, buyer: KURI, deadline: paeva(3), score: 75, state: 'uus' }),
  rida({ ref: 'R-TAVA', deadline: paeva(40), score: 20, state: 'vaatan' }),
  rida({ ref: 'R-LOPP', deadline: paeva(-5), score: 10, state: 'kaotatud' }),
  // 'voidetud' on samuti LOPPSEIS. Ta on siin TEADLIKULT: kliendi kasitsi
  // kirjutatud loend ['aegunud','kaotatud','jatsin'] peidaks R-LOPP-i, aga
  // JATAKS selle rea aktiivsete hulka - ilma temata oleks see varav pime.
  rida({ ref: 'R-VOIT', deadline: paeva(-30), score: 90, state: 'voidetud' }),
];

const RUNS = [{
  id: 1, cmd: 'sync', args: '{}', state: 'tehtud', started: TANA + 'T10:00:00Z',
  finished: TANA + 'T10:01:00Z', progress: null, rows: 3, error: null, pid: 1, oma: false,
  logTail: null, logPikkus: 0,
}];

const STATE_FIXTURE = {
  csrfToken: 'fixture-csrf', revenue: { }, services: [], catalogVersion: 'test', proUXLeads: [],
  webInquiries: [], revenueWorkbench: { available: false, prospects: [], summary: {} },
  salesAccounts: [], outbound: [], accounts: [], defaultAccount: null, pollMinutes: 5,
  statuses: [], statusLabels: {}, measured: '', lastSync: null, days: [], counts: {},
  pipelineValue: 0, companies: [], activity: [], messages: [], drafts: [], docs: [],
  lists: [], vatRegistered: false, limits: { maxDrafts: 3, maxAgeDays: 7 },
};

let hankedAll = HANKED.map((h) => ({ ...h }));
let tyhi = false;
let katki = false;
const kirjed = [];

const json = (res, data, kood = 200) => {
  res.writeHead(kood, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};
const FAILID = {
  '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/views.js': 'views.js',
  '/hanked-loogika.js': 'hanked-loogika.js', '/app.css': 'app.css', '/crm2.css': 'crm2.css',
  '/agent.css': 'agent.css',
};
async function keha(req) { let raw = ''; for await (const c of req) raw += c; return raw ? JSON.parse(raw) : {}; }

const server = createServer(async (req, res) => {
  if (req.url === '/api/state') return json(res, STATE_FIXTURE);
  if (req.url === '/api/hanked') {
    if (katki) return json(res, { error: 'Ootamatu viga — täpsem põhjus on serveri logis' }, 500);
    return json(res, {
      hanked: tyhi ? [] : hankedAll,
      tasks: { sync: { script: 'agent/hanked-sync.mjs', label: 'Sünkroon', valmis: true } },
      runs: tyhi ? [] : RUNS, states: HANKE_STATES, lopuseisud: LOPUSEISUD,
    });
  }
  if (req.url === '/api/hanked/runs') return json(res, { runs: tyhi ? [] : RUNS });
  if (req.method === 'POST') {
    kirjed.push(req.url);
    const b = await keha(req);
    if (req.url === '/api/hanked/state') {
      const h = hankedAll.find((x) => x.ref === b.ref);
      if (!h) return json(res, { error: 'Hanget ei leitud: ' + b.ref }, 404);
      if (!HANKE_STATES.includes(b.state)) return json(res, { error: 'Tundmatu seis: ' + b.state }, 400);
      h.state = b.state;
      return json(res, { ok: true });
    }
    res.writeHead(400); return res.end(JSON.stringify({ error: 'Ootamatu kirje: ' + req.url }));
  }
  // Fail loetakse ENNE writeHead-i: puuduv fail annaks muidu
  // ERR_HTTP_HEADERS_SENT-i ja varjaks paris pohjust (vale failinimi).
  const nimi = FAILID[req.url];
  let sisu = null;
  // orbit.css ei ela public/-is, vaid tokenite dist-is (vt server.mjs) - ilma
  // temata on leht ilma Orbit muutujateta ja ekraanipilt valetaks.
  if (req.url === '/orbit.css') sisu = await readFile(new URL('../../packages/orbit-tokens/dist/orbit.css', import.meta.url)).catch(() => null);
  else if (nimi) sisu = await readFile(new URL('../public/' + nimi, import.meta.url)).catch(() => null);
  if (sisu === null) { res.writeHead(404); return res.end(); }
  const tyyp = req.url.endsWith('.css') ? 'text/css' : req.url.endsWith('.js') ? 'text/javascript' : 'text/html';
  res.writeHead(200, { 'content-type': tyyp + '; charset=utf-8' });
  res.end(sisu);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await context.route('**/*', (r) => (new URL(r.request().url()).origin === origin ? r.continue() : r.abort()));
  const page = await context.newPage();
  const vead = [];
  page.on('pageerror', (e) => vead.push(e.message));

  await page.goto(origin + '/');
  // Sakk on olemas ja vaade on ALGUSES peidetud - sakivahetus peab teda avama.
  const sakk = page.locator('.view-tab[data-view="hanked"]');
  await sakk.waitFor();
  assert.equal(await sakk.getAttribute('role'), 'tab');
  assert.equal(await page.locator('#viewHanked').isVisible(), false, 'vaade on alguses peidus');
  await sakk.click();
  await page.locator('#viewHanked table.tbl tbody tr').first().waitFor();
  assert.equal(await sakk.getAttribute('aria-selected'), 'true', 'sakk peab märkima end valituks');
  assert.equal(await page.locator('#viewPipeline').isVisible(), false, 'teised vaated peidetakse');

  /* --- XSS: voeras pealkiri on TEKST, mitte element --- */
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'RHR-i pealkirjast ei tohi tekkida skripti');
  assert.equal(await page.locator('#viewHanked tbody img').count(), 0, 'pealkirjast ei tohi tekkida <img>');
  const kuriTekst = await page.locator('tr[data-ref="R-KIIRE"] td.nimetus').textContent();
  assert.equal(kuriTekst.trim(), KURI, 'pealkiri peab olema nähtav täpselt sellisena, nagu RHR ta andis');

  /* --- filter: lõppseisus rida ei ole "aktiivsed" all --- */
  assert.equal(await page.locator('tbody tr[data-ref]').count(), 2, 'aktiivseid on kaks');
  assert.equal(await page.locator('tr[data-ref="R-LOPP"]').count(), 0, 'lõppseisus rida on peidus');
  assert.equal(await page.locator('tr[data-ref="R-VOIT"]').count(), 0,
    'ka võidetud on lõppseis — filter peab tulema serveri lopuseisud-väljast, mitte kliendi loendist');
  await page.locator('.chip[data-seis="kõik"]').click();
  assert.equal(await page.locator('tbody tr[data-ref]').count(), 4, '"kõik" näitab ka lõppseisud');
  await page.locator('.chip[data-seis="kaotatud"]').click();
  assert.equal(await page.locator('tbody tr[data-ref]').count(), 1);
  assert.equal(await page.locator('.chip[data-seis="kaotatud"]').getAttribute('aria-pressed'), 'true');
  await page.locator('.chip[data-seis="aktiivsed"]').click();
  assert.equal(await page.locator('tbody tr[data-ref]').count(), 2);

  /* --- märk näitab ainult kiireloomulisi --- */
  assert.equal(await page.locator('#hankedBadge').isHidden(), false, 'märk peab olema nähtav');
  assert.equal((await page.locator('#hankedBadge').textContent()).trim(), '1', 'kiireloomulisi on üks');

  /* --- päised ja rippmenüü silt --- */
  assert.equal(await page.locator('#viewHanked thead th[scope="col"]').count(),
    await page.locator('#viewHanked thead th').count(), 'iga päis kannab scope="col"');
  const seisSelect = page.locator('tr[data-ref="R-KIIRE"] select');
  assert.ok((await seisSelect.getAttribute('aria-label') || '').includes('R-KIIRE'), 'rippmenüül on silt');
  assert.equal(await seisSelect.locator('option').count(), HANKE_STATES.length, 'seisud tulevad serverilt');

  /* --- valik klaviatuuriga: reaklikk ei ole ainus tee --- */
  await page.locator('tr[data-ref="R-KIIRE"] button.linkbtn').focus();
  await page.keyboard.press('Enter');
  await page.locator('#hankedDetail').waitFor({ state: 'visible' });
  assert.ok(((await page.locator('#hankedDetail').textContent()) || '').includes('R-KIIRE'),
    'klaviatuurivalik peab valima rea');
  assert.equal(await page.locator('tr[data-ref="R-KIIRE"]').getAttribute('aria-current'), 'true');

  /* --- seisumuutus EI lae nimekirja uuesti --- */
  let hankedParinguid = 0;
  page.on('request', (r) => { if (r.url().endsWith('/api/hanked')) hankedParinguid += 1; });
  await page.locator('tr[data-ref="R-TAVA"] select').selectOption('kaotatud');
  await page.waitForFunction(() => !document.querySelector('tr[data-ref="R-TAVA"]'));
  assert.equal(hankedParinguid, 0, 'seisumuutus ei tohi kogu nimekirja uuesti laadida');
  assert.equal(await page.locator('tbody tr[data-ref]').count(), 1,
    'lõppseisu läinud rida kaob aktiivsete filtri alt');
  assert.equal(hankedAll.find((h) => h.ref === 'R-TAVA').state, 'kaotatud', 'server sai muudatuse kätte');
  await page.locator('.chip[data-seis="kõik"]').click();
  assert.equal(await page.locator('tr[data-ref="R-TAVA"] select').inputValue(), 'kaotatud',
    'kohalik mudel kannab uut seisu ka ilma täislaadimiseta');

  /* --- tühi olek ütleb, MIKS tabel on tühi --- */
  tyhi = true;
  await page.locator('.view-tab[data-view="stats"]').click();
  await page.locator('.view-tab[data-view="hanked"]').click();
  await page.waitForFunction(() => /sünkimist ei ole veel/i.test(document.querySelector('#hankedBody').textContent));
  assert.equal(await page.locator('#hankedBadge').isHidden(), true, 'ilma kiireloomulisteta märk kaob');
  assert.equal(await page.locator('tbody tr[data-ref]').count(), 0);

  /* --- vigane vastus jätab vaate kasutatavaks --- */
  tyhi = false; katki = true;
  await page.locator('.view-tab[data-view="stats"]').click();
  await page.locator('.view-tab[data-view="hanked"]').click();
  await page.getByRole('button', { name: 'Proovi uuesti' }).waitFor();
  const veatekst = await page.locator('#hankedBody').textContent();
  assert.ok(/täpsem põhjus on serveri logis/.test(veatekst), 'serveri eestikeelne põhjus on näha: ' + veatekst);
  assert.ok(!/\b(Failed|Error|undefined|NaN)\b/.test(veatekst), 'veateade on eestikeelne: ' + veatekst);
  katki = false;
  await page.getByRole('button', { name: 'Proovi uuesti' }).click();
  await page.locator('tbody tr[data-ref]').first().waitFor();

  /* --- ükski võõras otspunkt ei saanud kirjet --- */
  assert.deepEqual([...new Set(kirjed)], ['/api/hanked/state'],
    'vaade kirjutab ainult seisu otspunkti: ' + JSON.stringify(kirjed));
  assert.deepEqual(vead, [], 'lehel ei tohi olla püüdmata vigu');

  console.log('PASS hanked-vaade: sakk avab vaate, võõras pealkiri jääb tekstiks, filter kuulab serveri lõppseise,'
    + ' seisumuutus ei tee täislaadimist, tühi olek ja vigane vastus on eestikeelsed.');
  await context.close();
} finally { await browser.close(); await new Promise((r) => server.close(r)); }
