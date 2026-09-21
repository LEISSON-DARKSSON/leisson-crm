// ULESANNE 9 + 10: riigihangete vaade PARIS brauseris (sama muster mis gate-campaign-ui.mjs).
//
// test/gate-hanked-ui.mjs toestab puhast loogikat ilma DOM-ita ja jookseb igal
// masinal. SIIN avatakse paris index.html paris app.js-i, views.js-i ja
// hanked-loogika.js-iga volts API peal: sakivahetus, tabeli sisu, filtririba,
// seisumuutus ILMA taislaadimiseta, tuhi olek, vigane vastus ja - koige tahtsam -
// et RHR-ist tulev pealkiri joudis lehele TEKSTINA, mitte HTML-ina.
//
// ULESANNE 10 lisas siia PARIS KAITUMISE, mida tekstisobitus ei kata:
//   - pollimine kusib ainult /api/hanked/runs (mitte kogu nimekirja);
//   - jooksu LOPPEDES tuleb TAPSELT UKS /api/hanked - muidu jaaks tabel vanaks;
//   - pollimine lopeb vaatelt lahkudes ja veaahelas (mitte igavene spinner);
//   - 409 naidatakse SELLE kasu juures koos runId-ga;
//   - valmimata kask on keelatud ja seletatud, "Peata" ainult oma jooksul;
//   - detailpaneel: pohjendused, verdikt, RHR-i link, markus ja seisunupud.
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
  published: TANA, segment: 'veeb', score: 50, score_why: null, verdict: 'KAALU', state: 'uus', note: null,
  docs_dir: null, docs_count: 0, seen: TANA, seen_last: null, updated: TANA, ...o,
});

// Kolm rida: kiireloomuline (marki jaoks), tavaline ja LOPPSEISUS rida, mis
// "aktiivsed"-filtri all EI tohi nahtav olla.
const HANKED = [
  rida({ ref: 'R-KIIRE', title: KURI, buyer: KURI, deadline: paeva(3), score: 40, verdict: 'ALLTÖÖVÕTT', state: 'uus' }),
  rida({ ref: 'R-TAVA', deadline: paeva(40), score: 20, verdict: 'JÄTA', state: 'vaatan', rhr_id: null }),
  rida({ ref: 'R-LOPP', deadline: paeva(-5), score: 10, verdict: 'JÄTA', state: 'kaotatud' }),
  // 'voidetud' on samuti LOPPSEIS. Ta on siin TEADLIKULT: kliendi kasitsi
  // kirjutatud loend ['aegunud','kaotatud','jatsin'] peidaks R-LOPP-i, aga
  // JATAKS selle rea aktiivsete hulka - ilma temata oleks see varav pime.
  rida({ ref: 'R-VOIT', deadline: paeva(-30), score: 90, verdict: 'PAKU', state: 'voidetud' }),
];

const TASKS = {
  sync: { script: 'agent/hanked-sync.mjs', label: 'Sünkroon', valmis: true },
  history: { script: 'agent/hanked-history.mjs', label: 'Lae ajalugu', valmis: false },
  gate: { script: 'test/gate-hanked.mjs', label: 'Värav', valmis: true },
  docs: { script: 'agent/hanked-docs.mjs', label: 'Lae dokumendid', valmis: true },
};
// Millised kasud NOUAVAD argumenti. Fikstuur peab siin olema sama range kui paris
// server (lib/hanked-runs.mjs valideeriArgs + agent/hanked-docs.mjs --ref), muidu
// ei saa varav kinni puuduvat argumenti - ja tapselt see viga oli: "Lae dokumendid"
// nupp saatis ainult {cmd}, oli klikitav ja ALATI kukkuv, samal ajal kui paneel
// utles "vajuta Lae dokumendid". Varav oli roheline, sest keegi ei vajutanud nuppu.
const NOUAB_ARGUMENTI = { docs: 'ref' };
// Iga kaivituspaaring, mille server TAGASI LUKKAS. Ribateksti peale ei saa
// vaidet ehitada - seal seisavad ka eelmiste plokkide read -, seega loeb
// varav paris vastuseid.
const keeldud = [];

// ULESANNE 13: detailpaneeli plokk "Sarnased lepingud". Kolm ERI vastust, sest
// kolm eri asja peab lehel valja paistma:
//   R-KIIRE  - CPV-alus ule miinimumlave: mediaanid ja read on naha, voitja nimi
//              tuleb RHR-ist ja peab jaama TEKSTIKS;
//   R-TAVA   - CPV-d ei ole, alus on SEGMENT ja alus on ALLA lave: varutee ja
//              ebakindlus peavad olema NAHTAVALT margitud, mitte vaikitud;
//   R-VOIT   - ajalugu on tuhi: "ei ole veel kordagi paritud" ei ole sama, mis
//              "sarnaseid lepinguid ei ole".
const SARNASED = {
  'R-KIIRE': {
    alus: 'cpv', cpv: '72000000', segment: null, n: 6, koguArv: 8, koguRidu: 11,
    valjaJai: 2, medianAmount: 32070, medianTenders: 8.5, piisav: true,
    read: [
      { ref: '306243', lot: 'LOT-0000', date: '2026-08-04', title: KURI, buyer: 'Tallinna Linnavalitsus',
        winner: KURI, winner_reg: '1', voitjaid: 1, amount: 50000, tenders: 16,
        konsortsium: 0, segment_allikas: 'pealkiri' },
      { ref: '313251', lot: 'LOT-0001', date: '2026-08-13', title: 'Encrypted DNS', buyer: 'RIA',
        winner: 'FOB Solutions OÜ', winner_reg: '2', voitjaid: 1, amount: 14140, tenders: 1,
        konsortsium: 0, segment_allikas: 'pealkiri' },
    ],
  },
  'R-TAVA': {
    alus: 'segment', cpv: null, segment: 'nišš', n: 2, koguArv: 3, koguRidu: 4,
    valjaJai: 1, medianAmount: 44527, medianTenders: 2, piisav: false,
    read: [
      { ref: '309231', lot: 'LOT-0000', date: '2026-08-14', title: 'Ainekavad', buyer: 'HTM',
        winner: 'Sihtasutus Estonian Business School', winner_reg: '3', voitjaid: 2,
        amount: 161978, tenders: 2, konsortsium: 1, segment_allikas: 'pealkiri' },
    ],
  },
  vaikimisi: {
    alus: null, cpv: null, segment: null, n: 0, koguArv: 0, koguRidu: 0, valjaJai: 0,
    medianAmount: null, medianTenders: null, piisav: false, read: [],
  },
};

const valmisJooks = (o = {}) => ({
  id: 1, cmd: 'sync', args: '{}', state: 'tehtud', started: TANA + 'T10:00:00Z',
  finished: TANA + 'T10:01:00Z', progress: null, rows: 3, error: null, pid: 1, oma: false,
  logTail: null, logPikkus: 0, ...o,
});

const STATE_FIXTURE = {
  csrfToken: 'fixture-csrf', revenue: { }, services: [], catalogVersion: 'test', proUXLeads: [],
  webInquiries: [], revenueWorkbench: { available: false, prospects: [], summary: {} },
  salesAccounts: [], outbound: [], accounts: [], defaultAccount: null, pollMinutes: 5,
  statuses: [], statusLabels: {}, measured: '', lastSync: null, days: [], counts: {},
  pipelineValue: 0, companies: [], activity: [], messages: [], drafts: [], docs: [],
  lists: [], vatRegistered: false, limits: { maxDrafts: 3, maxAgeDays: 7 },
  hankedKiireid: 1,
};

let hankedAll = HANKED.map((h) => ({ ...h }));
let runs = [valmisJooks()];
let tyhi = false;
let katki = false;
let konflikt = false;        // POST /api/hanked/run vastab 409-ga
let runsKatki = false;       // GET /api/hanked/runs vastab 500-ga
let jargmineOma = true;      // jargmise kaivitatud jooksu `oma`-lipp
let jooksuId = 100;
const kirjed = [];
const saadetud = [];         // POST-ide kehad
const loendur = { hanked: 0, runs: 0, detail: 0 };

// Jooksu elukaar: iga /runs paring viib teda uhe sammu edasi. Kolmas samm
// LOPETAB jooksu ja lisab kaks uut hanget - tapselt see, mida paris sunk teeb.
function samm(r) {
  r.tick = (r.tick || 0) + 1;
  if (r.tick === 1) { r.logTail = 'laen RSS-i\nRHR vastas 200\n'; return; }
  if (r.tick === 2) { r.progress = '6 uut · 0 uuendatud'; return; }
  if (r.tick >= 3 && r.state === 'käib') {
    r.state = 'tehtud';
    r.rows = 6;
    r.finished = new Date().toISOString();
    r.progress = '6 uut · 0 uuendatud';
    hankedAll.push(rida({ ref: 'R-UUS1', title: 'Sünkimisega tulnud hange', deadline: paeva(5), state: 'uus' }));
    hankedAll.push(rida({ ref: 'R-UUS2', title: 'Teine uus hange', deadline: paeva(9), state: 'uus' }));
  }
}

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
    loendur.hanked++;
    if (katki) return json(res, { error: 'Ootamatu viga — täpsem põhjus on serveri logis' }, 500);
    return json(res, {
      hanked: tyhi ? [] : hankedAll,
      tasks: TASKS,
      runs: tyhi ? [] : runs, states: HANKE_STATES, lopuseisud: LOPUSEISUD,
    });
  }
  if (req.url === '/api/hanked/runs') {
    loendur.runs++;
    if (runsKatki) return json(res, { error: 'Ootamatu viga — täpsem põhjus on serveri logis' }, 500);
    for (const r of runs) if (r.state === 'käib') samm(r);
    return json(res, { runs: tyhi ? [] : runs });
  }
  if (req.method === 'POST') {
    kirjed.push(req.url);
    const b = await keha(req);
    saadetud.push({ url: req.url, keha: b });
    if (req.url === '/api/hanked/state') {
      const h = hankedAll.find((x) => x.ref === b.ref);
      if (!h) return json(res, { error: 'Hanget ei leitud: ' + b.ref }, 404);
      if (!HANKE_STATES.includes(b.state)) return json(res, { error: 'Tundmatu seis: ' + b.state }, 400);
      h.state = b.state;
      return json(res, { ok: true });
    }
    if (req.url === '/api/hanked/note') {
      const h = hankedAll.find((x) => x.ref === b.ref);
      if (!h) return json(res, { error: 'Hanget ei leitud: ' + b.ref }, 404);
      h.note = b.note && b.note.trim() ? b.note : null;
      return json(res, { ok: true });
    }
    if (req.url === '/api/hanked/detail') {
      loendur.detail++;
      const h = hankedAll.find((x) => x.ref === b.ref);
      if (!h) return json(res, { error: 'Hanget ei leitud: ' + b.ref }, 404);
      return json(res, { hange: h, why: [KURI, '+40 · sobiv segment: nišš', '-25 · 3 rolli CV-nõuet — üksi ei kvalifitseeru'],
        sarnased: SARNASED[b.ref] || SARNASED.vaikimisi });
    }
    if (req.url === '/api/hanked/run') {
      if (!TASKS[b.cmd]) return json(res, { error: 'Tundmatu käsk: ' + b.cmd }, 400);
      if (!TASKS[b.cmd].valmis) {
        keeldud.push({ cmd: b.cmd, pohjus: 'ei ole veel valmis' });
        return json(res, { error: TASKS[b.cmd].label + ' ei ole veel valmis: skript puudub' }, 400);
      }
      const noutud = NOUAB_ARGUMENTI[b.cmd];
      if (noutud && !(b.args && b.args[noutud])) {
        keeldud.push({ cmd: b.cmd, pohjus: 'Puudub --' + noutud });
        return json(res, { error: 'Puudub --' + noutud + '=<viitenumber>' }, 400);
      }
      if (konflikt) return json(res, { error: TASKS[b.cmd].label + ' käib juba', runId: 77 }, 409);
      const r = { id: ++jooksuId, cmd: b.cmd, args: '{}', state: 'käib', started: new Date().toISOString(),
        finished: null, progress: null, rows: null, error: null, pid: 1, oma: jargmineOma,
        logTail: null, logPikkus: 0, tick: 0 };
      runs.unshift(r);
      return json(res, { id: r.id, state: 'käib', cmd: b.cmd, label: TASKS[b.cmd].label });
    }
    if (req.url === '/api/hanked/stop') {
      const r = runs.find((x) => x.id === Number(b.id));
      if (!r || r.state !== 'käib') return json(res, { ok: false, error: 'See jooks ei käi' });
      r.state = 'katkestatud';
      r.finished = new Date().toISOString();
      r.error = 'Protsess sai signaali SIGTERM';
      return json(res, { ok: true, tapetud: true });
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
  const riba = page.locator('#hankedRunbar');
  const detail = page.locator('#hankedDetail');

  await page.goto(origin + '/');
  // Mark peab olema sakil ENNE esimest sakiklikki: ta tuleb /api/state vastusest.
  await page.waitForFunction(() => document.querySelector('#hankedBadge')
    && !document.querySelector('#hankedBadge').hidden);
  assert.equal((await page.locator('#hankedBadge').textContent()).trim(), '1',
    'märk peab tulema load()-i peale, mitte alles pärast sakiklikki');

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

  /* --- VERDIKT on tabelis, mitte ainult punktid --- */
  const otsus = (await page.locator('tr[data-ref="R-KIIRE"] td.skoor').textContent()).trim();
  assert.ok(otsus.includes('ALLTÖÖVÕTT'),
    'ALLTÖÖVÕTT ei ole punktidest tagasi arvutatav — ta peab tulema baasist: ' + otsus);
  assert.ok(otsus.includes('40'), 'punktid jäävad verdikti kõrvale nähtavaks: ' + otsus);
  assert.ok((await page.locator('tr[data-ref="R-KIIRE"] td.skoor').getAttribute('class')).includes('allt'),
    'alltöövõtul on oma klass, mitte punktide oma');

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

  /* ================= ÜLESANNE 10: nupud ================= */

  // Valmimata kask (agent/hanked-history.mjs puudub) on KEELATUD ja SELETATUD,
  // mitte "vajuta ja saa 400".
  const ajalugu = riba.getByRole('button', { name: /Lae ajalugu/ });
  assert.equal(await ajalugu.isDisabled(), true, 'valmimata käsu nupp peab olema keelatud');
  assert.equal(await ajalugu.getAttribute('aria-disabled'), 'true');
  const seletus = await ajalugu.getAttribute('title') || '';
  assert.ok(/ei ole veel valmis/.test(seletus), 'keeld peab olema seletatud: ' + seletus);
  assert.ok(seletus.includes('agent/hanked-history.mjs'), 'seletus nimetab puuduva skripti: ' + seletus);

  // Lopprida eelmisest jooksust.
  assert.ok(/3 rida/.test(await riba.textContent()), 'viimane jooks peab jätma nähtava rea: ' + await riba.textContent());

  /* --- 409 naidatakse SELLE kasu juures, koos runId-ga ---
     409 tuleb siis, kui jooks on juba kaimas (kasurealt, teisest aknast, oondsest
     serverist) - seega on ka fikstuuris paris kaiv jooks, mitte ainult veakood. */
  konflikt = true;
  runs.unshift({ id: 77, cmd: 'sync', args: '{}', state: 'käib', started: new Date().toISOString(),
    finished: null, progress: 'mujalt käivitatud jooks', rows: null, error: null, pid: 1, oma: false,
    logTail: null, logPikkus: 0, tick: -1000 });
  await riba.getByRole('button', { name: /^Sünkroon$/ }).click();
  await page.waitForFunction(() => /käib juba/.test(document.querySelector('#hankedRunbar').textContent));
  const konfliktiTekst = await riba.textContent();
  assert.ok(/käib juba/.test(konfliktiTekst), '409 peab olema nähtav: ' + konfliktiTekst);
  assert.ok(/77/.test(konfliktiTekst), '409 runId peab jõudma kliendini: ' + konfliktiTekst);
  // ...ja kui SEE jooks on labi, ei ole teade enam tosi - ta ei tohi ribale seisma jaada.
  konflikt = false;
  runs = runs.filter((r) => r.id !== 77);
  await page.waitForFunction(() => !/käib juba/.test(document.querySelector('#hankedRunbar').textContent),
    null, { timeout: 15000 });
  await page.waitForTimeout(2500);

  /* --- jooks: progress, logirida, lopp ja UUED READ --- */
  const hankedEnne = loendur.hanked;
  await riba.getByRole('button', { name: /^Sünkroon$/ }).click();
  await page.waitForFunction(() => /Sünkroon …/.test(document.querySelector('#hankedRunbar').textContent));
  assert.equal(await riba.getByRole('button', { name: /^Sünkroon/ }).isDisabled(), true,
    'käiva jooksu ajal ei tohi nuppu uuesti vajutada');
  assert.equal(await riba.getAttribute('aria-live'), 'polite', 'jooksva käsu seis peab jõudma ekraanilugejani');
  assert.equal(await riba.getAttribute('aria-busy'), 'true', 'käiva jooksu ajal on riba aria-busy');

  // progress on NULL esimesel sammul: nahtav peab olema logi viimane sisukas rida.
  await page.waitForFunction(() => /RHR vastas 200/.test(document.querySelector('#hankedRunbar').textContent));
  // "Peata" on olemas, sest jooks on MEIE oma.
  assert.equal(await riba.getByRole('button', { name: /^Peata/ }).count(), 1,
    'oma jooksu peab saama peatada');
  // ...ja tabelit ei laetud pollimise ajal uuesti.
  assert.equal(loendur.hanked, hankedEnne, 'pollimine ei tohi kogu nimekirja uuesti laadida');
  await page.waitForFunction(() => /6 uut/.test(document.querySelector('#hankedRunbar').textContent));

  // Jooks lopeb -> TAPSELT UKS taislaadimine ja uued read on tabelis.
  await page.locator('tr[data-ref="R-UUS1"]').waitFor();
  assert.equal(loendur.hanked, hankedEnne + 1,
    'lõppenud jooks peab tooma uued read TÄPSELT ühe /api/hanked päringuga, oli ' + (loendur.hanked - hankedEnne));
  assert.equal(await riba.getByRole('button', { name: /^Sünkroon$/ }).isDisabled(), false,
    'lõppenud jooks vabastab nupu');
  assert.ok(/6 rida/.test(await riba.textContent()), 'lõpprida ütleb ridade arvu: ' + await riba.textContent());
  assert.ok(/korras/.test(await riba.textContent()));
  assert.equal(await riba.getAttribute('aria-busy'), 'false', 'lõppenud jooks lõpetab aria-busy');

  // Pollimine LOPPES: ukski jooks ei kai.
  const runsSeis = loendur.runs;
  await page.waitForTimeout(3000);
  assert.equal(loendur.runs, runsSeis, 'ilma käiva jooksuta ei tohi pollimine edasi käia');

  /* --- VOORAS jooks: "Peata" ei tohi lubada seda, mida ta teha ei saa ---
     Voeras jooks EI TULE meie klikist, vaid ilmub pollimisel: ta kuulub eelmisele
     serveri-instantsile (boot_id ei klapi) ja server KEELDUB tema pid-i tapmast.
     Vaate avamine peab sellise jooksu peale ise ahela kaima panema. */
  runs.unshift({ id: 900, cmd: 'sync', args: '{}', state: 'käib', started: new Date().toISOString(),
    finished: null, progress: 'eelmise serveri jooks', rows: null, error: null, pid: 1, oma: false,
    logTail: null, logPikkus: 0, tick: -1000 });
  await page.locator('.view-tab[data-view="stats"]').click();
  await page.locator('.view-tab[data-view="hanked"]').click();
  await page.waitForFunction(() => /Sünkroon …/.test(document.querySelector('#hankedRunbar').textContent));
  assert.equal(await riba.getByRole('button', { name: /^Peata/ }).count(), 0,
    'võõra serveri-instantsi jooksu EI SAA tappa — nuppu ei tohi näidata');
  assert.ok(/eelmisele serverile/.test(await riba.textContent()),
    'peatamatu jooks peab olema seletatud: ' + await riba.textContent());
  // Vaate avamine pani ahela ise kaima (jooks kais juba enne avamist).
  const runsAvamisel = loendur.runs;
  await page.waitForTimeout(2500);
  assert.ok(loendur.runs > runsAvamisel, 'juba käiv jooks peab vaate avamisel pollimise käima panema');

  /* --- pollimine peab LOPPEMA, kui kasutaja lahkub vaatelt --- */
  await page.locator('.view-tab[data-view="stats"]').click();
  await page.waitForTimeout(500);
  const runsLahkudes = loendur.runs;
  await page.waitForTimeout(5000);
  assert.equal(loendur.runs, runsLahkudes,
    'vaatelt lahkumine peab pollimise peatama, muidu koputab leht serverit taustal ('
    + (loendur.runs - runsLahkudes) + ' lisapäringut)');
  for (const r of runs) if (r.state === 'käib') { r.state = 'tehtud'; r.rows = 6; r.finished = new Date().toISOString(); }

  /* --- pollimise VIGA ei tohi jätta igavest spinnerit --- */
  await page.locator('.view-tab[data-view="hanked"]').click();
  await page.locator('#viewHanked table.tbl tbody tr').first().waitFor();
  runsKatki = true;
  await riba.getByRole('button', { name: /^Värav$/ }).click();
  await page.waitForFunction(() => /ei saanud/i.test(document.querySelector('#hankedRunbar').textContent));
  assert.ok(/serveri logis|ei saanud/i.test(await riba.textContent()),
    'pollimise viga peab olema nähtav: ' + await riba.textContent());
  await page.waitForTimeout(7000);
  const runsPeaLoppema = loendur.runs;
  await page.waitForTimeout(5000);
  assert.equal(loendur.runs, runsPeaLoppema,
    'pärast korduvaid vigu peab pollimine loobuma, mitte igavesti proovima');
  runsKatki = false;
  for (const r of runs) if (r.state === 'käib') { r.state = 'tehtud'; r.rows = 0; r.finished = new Date().toISOString(); }

  /* ================= ÜLESANNE 10: detailpaneel ================= */
  await page.locator('.view-tab[data-view="stats"]').click();
  await page.locator('.view-tab[data-view="hanked"]').click();
  await page.locator('#viewHanked table.tbl tbody tr').first().waitFor();

  /* --- valik klaviatuuriga: reaklikk ei ole ainus tee --- */
  await page.locator('tr[data-ref="R-KIIRE"] button.linkbtn').focus();
  await page.keyboard.press('Enter');
  await detail.waitFor({ state: 'visible' });
  await page.waitForFunction(() => /sobiv segment/.test(document.querySelector('#hankedDetail').textContent));
  assert.equal(await page.locator('tr[data-ref="R-KIIRE"]').getAttribute('aria-current'), 'true');
  assert.equal(await detail.getAttribute('aria-live'), 'polite', 'detailpaneel on aria-live');

  const detailTekst = await detail.textContent();
  assert.ok(detailTekst.includes('R-KIIRE'), 'detail peab ütlema, mis hange see on');
  assert.ok(detailTekst.includes('ALLTÖÖVÕTT'), 'verdikt peab detailis olema: ' + detailTekst.slice(0, 200));
  assert.ok(detailTekst.includes('72000000'), 'CPV peab detailis olema');
  assert.ok(detailTekst.includes('3 rolli CV-nõuet'), 'skoori põhjendusread peavad olema näha');
  // Pohjendus tuleb RHR-i kaudu valisest allikast - ta EI TOHI olla HTML.
  assert.equal(await page.locator('#hankedDetail img').count(), 0, 'põhjendusest ei tohi tekkida <img>');
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'põhjendusest ei tohi tekkida skripti');
  assert.ok(detailTekst.includes(KURI), 'võõras põhjendusrida jääb TEKSTIKS');

  // Link RHR-i.
  const link = detail.locator('a[href*="riigihanked.riik.ee"]');
  assert.equal(await link.count(), 1, 'RHR-i link puudub');
  assert.equal(await link.getAttribute('href'),
    'https://riigihanked.riik.ee/rhr-web/#/procurement/1/general-info', 'link peab tulema rhr_id väljast');
  assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');

  /* --- ULESANNE 13: sarnased lepingud --- */
  assert.ok(detailTekst.includes('Sarnased lepingud'), 'sarnaste lepingute plokk puudub');
  const sarnased = detail.locator('#hankedSarnased');
  const sTekst = await sarnased.textContent();
  // Mediaan ja tema ALUS kaivad KOOS: paljas arv ei utle, kas ta on usaldusvaarne.
  assert.ok(/6\s*lepingu/.test(sTekst), 'mediaani alus peab olema kirjas: ' + sTekst);
  assert.ok(/8[.,]5/.test(sTekst), 'mediaanne pakkujate arv peab olema näha: ' + sTekst);
  assert.ok(/32\s*070|32070/.test(sTekst.replace(/\u00a0/g, ' ')),
    'mediaanhind peab olema näha: ' + sTekst);
  assert.ok(/CPV/.test(sTekst) && /72000000/.test(sTekst),
    'CPV-alus peab olema nimetatud: ' + sTekst);
  assert.ok(sTekst.includes('FOB Solutions OÜ'), 'võitja peab reas olema: ' + sTekst);
  assert.ok(/2\s*lepingut? jäi|välja/.test(sTekst), 'väljajäänud lepingud peavad olema öeldud: ' + sTekst);
  // Voitja nimi tuleb RHR-ist - ta on TEKST, mitte HTML.
  assert.equal(await sarnased.locator('img').count(), 0, 'võitja nimest ei tohi tekkida <img>');
  assert.equal(await page.evaluate(() => window.__xss), undefined,
    'sarnaste lepingute plokist ei tohi tekkida skripti');
  assert.ok(sTekst.includes(KURI), 'võõras võitja nimi jääb TEKSTIKS');

  // Markus: onblur -> POST /api/hanked/note.
  const note = detail.locator('textarea');
  await note.fill('Küsi majutuse kohta');
  await note.blur();
  await page.waitForFunction(() => document.querySelector('#toast')
    && !document.querySelector('#toast').hidden);
  const noteKirje = saadetud.filter((x) => x.url === '/api/hanked/note').pop();
  assert.ok(noteKirje, 'märkus peab serverisse jõudma');
  assert.equal(noteKirje.keha.ref, 'R-KIIRE');
  assert.equal(noteKirje.keha.note, 'Küsi majutuse kohta');

  // Seisunupud detailis: sama tee mis rippmenüü, ilma taislaadimiseta.
  const hankedEnneSeisu = loendur.hanked;
  await detail.getByRole('button', { name: 'valmistun' }).click();
  await page.waitForFunction(() => document.querySelector('tr[data-ref="R-KIIRE"] select').value === 'valmistun');
  assert.equal(hankedAll.find((h) => h.ref === 'R-KIIRE').state, 'valmistun', 'server sai seisu kätte');
  assert.equal(loendur.hanked, hankedEnneSeisu, 'seisunupp ei tohi kogu nimekirja uuesti laadida');
  assert.equal(await detail.getByRole('button', { name: 'valmistun' }).getAttribute('aria-pressed'), 'true',
    'valitud seis peab olema märgitud');

  // Ilma rhr_id-ta rida: link ASENDATAKSE seletusega, mitte katkise lingiga.
  await page.locator('tr[data-ref="R-TAVA"] button.linkbtn').click();
  await page.waitForFunction(() => {
    const n = document.querySelector('#hankedDetail');
    return n && /R-TAVA/.test(n.textContent) && n.querySelector('#hankedSarnased');
  });
  assert.equal(await detail.locator('a[href*="riigihanked.riik.ee"]').count(), 0,
    'ilma rhr_id-ta ei tohi linki välja mõelda');
  assert.ok(/RHR-i viide puudub/.test(await detail.textContent()),
    'puuduv viide peab olema seletatud: ' + await detail.textContent());

  // SEGMENDI-VARUTEE PEAB OLEMA NAHTAV. RSS ei anna CPV-d uldse, seega see on
  // TAVALINE vastus - ja mediaan, mis pohineb kahel lepingul, ei tohi valja
  // naha sama kindel kui kuuel pohinev.
  const sTava = await detail.locator('#hankedSarnased').textContent();
  assert.ok(/CPV-d ei ole/.test(sTava), 'segmendi-varutee peab olema välja öeldud: ' + sTava);
  assert.ok(/nišš/.test(sTava), 'segment peab olema nimetatud: ' + sTava);
  assert.ok(/pealkirja/i.test(sTava), 'pealkirjaeelistus peab olema välja öeldud: ' + sTava);
  assert.ok(/ei mõjuta|skoori ei/i.test(sTava),
    'alla läve jääv alus peab ütlema, et ta skoori ei liiguta: ' + sTava);
  assert.equal(await detail.locator('#hankedSarnased .warn').count(), 1,
    'nõrk alus peab olema märgitud hoiatusena');
  // Eesti keel käänab: „+ 1 konsortsiumipartnerit" on vale ja see tekst on
  // kasutaja ees iga mitmevõitjalise osa juures.
  assert.ok(/\+ 1 konsortsiumipartner(?!it)/.test(sTava),
    'ühe kaaslase puhul on ainsus: ' + sTava);

  /* --- seisumuutus EI lae nimekirja uuesti --- */
  const hankedEnneRippu = loendur.hanked;
  await page.locator('tr[data-ref="R-TAVA"] select').selectOption('kaotatud');
  await page.waitForFunction(() => !document.querySelector('tr[data-ref="R-TAVA"]'));
  assert.equal(loendur.hanked, hankedEnneRippu, 'seisumuutus ei tohi kogu nimekirja uuesti laadida');
  assert.equal(hankedAll.find((h) => h.ref === 'R-TAVA').state, 'kaotatud', 'server sai muudatuse kätte');
  await page.locator('.chip[data-seis="kõik"]').click();
  assert.equal(await page.locator('tr[data-ref="R-TAVA"] select').inputValue(), 'kaotatud',
    'kohalik mudel kannab uut seisu ka ilma täislaadimiseta');
  await page.locator('.chip[data-seis="aktiivsed"]').click();

  /* --- tühi olek ütleb, MIKS tabel on tühi --- */
  tyhi = true;
  await page.locator('.view-tab[data-view="stats"]').click();
  await page.locator('.view-tab[data-view="hanked"]').click();
  await page.waitForFunction(() => /sünkimist ei ole veel/i.test(document.querySelector('#hankedBody').textContent));
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

  /* ---------------------------------------------------------------------
     NUPUSUITS: iga LUBATUD nupp saab kliki ja ei tohi anda viga.

     Miks see plokk on olemas. Lopukontroll (ulesanne 15) leidis kaks viga,
     MOLEMAD sama klassi: nupp lubab midagi, mida ta teha ei saa.
       - "Lae dokumendid" saatis ainult {cmd}, aga agent noab --ref -> nupp oli
         klikitav ja ALATI kukkuv, samal ajal kui detailpaneel utles "vajuta
         Lae dokumendid";
       - valiHange ei pannud serveri `dokumendid`-valja vahemallu -> kogu
         ulesande 14 toendiplokk oli ekraanil kattesaamatu.
     Molemad varavad olid rohelised, sest struktuurne kontroll vaatab koodi ja
     brauserivarav klikkis ainult "Sunkroon". Nuud klikitakse KOIKI - uue kasu
     lisamine toob ta automaatselt siia, sest nimekiri tuleb DOM-ist.
     -------------------------------------------------------------------- */
  {
    // Valitud hange on olemas, et --ref-i noudev kask saaks toota.
    await page.locator('tbody tr[data-ref] .linkbtn').first().click();
    await page.waitForFunction(() => document.querySelector('#hankedDetail')?.textContent?.length > 0);

    const enneVigu = vead.length;
    const nupud = page.locator('#hankedRunbar button:not([disabled])');
    const arv = await nupud.count();
    assert.ok(arv >= 3, 'lubatud kaske peab olema vahemalt kolm, on ' + arv);

    for (let i = 0; i < arv; i++) {
      const nupp = page.locator('#hankedRunbar button:not([disabled])').nth(i);
      const silt = (await nupp.textContent() || '').trim();
      if (/^Peata/.test(silt)) continue;               // Peata on eelmise jooksu oma
      await nupp.click();
      // Kas vastus tuli ja kas ta on VIGA. Ootame, kuni riba midagi utleb.
      await page.waitForFunction(
        () => (document.querySelector('#hankedRunbar')?.textContent || '').length > 0);
      // Vaide kaib PARIS VASTUSE, mitte ribateksti peale: ribal seisavad ka
      // eelmiste plokkide read ja tekstisobitus annaks vale-punase.
      assert.deepEqual(keeldud, [],
        'lubatud nupp "' + silt + '" sai serverilt keeldumise: ' + JSON.stringify(keeldud));
      // Ja paring pidi PARISELT valja minema, mitte klikk tuhja.
      assert.ok(saadetud.some((x) => x.url === '/api/hanked/run'),
        'nupp "' + silt + '" ei saatnud ühtegi käivituspäringut');
    }

    // --ref-i noudev kask peab selle PARISELT kaasa andma.
    const docsPar = saadetud.filter((x) => x.url === '/api/hanked/run' && x.keha.cmd === 'docs');
    assert.equal(docsPar.length >= 1, true, '"Lae dokumendid" peab käivituspäringu saatma');
    assert.ok(docsPar[docsPar.length - 1].keha.args && docsPar[docsPar.length - 1].keha.args.ref,
      '"Lae dokumendid" peab andma valitud hanke viitenumbri kaasa: '
      + JSON.stringify(docsPar[docsPar.length - 1].keha));

    // VALMIMATA kask (history, valmis:false) peab olema keelatud ja SELETATUD,
    // mitte peidetud. Kaivad kasud on samuti keelatud, aga hoopis muul pohjusel -
    // seega otsime just selle nupu, mille silt kuulub valmimata kasule.
    const valmimata = Object.entries(TASKS).find(([, t]) => !t.valmis);
    if (valmimata) {
      const nupp = page.locator('#hankedRunbar button', { hasText: valmimata[1].label }).first();
      assert.equal(await nupp.isDisabled(), true,
        'valmimata käsk "' + valmimata[1].label + '" peab olema keelatud');
      const t = await nupp.getAttribute('title');
      assert.ok(t && /ei ole veel valmis|puudub/i.test(t),
        'keelatud nupp peab seletama, MIKS: ' + t);
    }
    assert.deepEqual(vead.slice(enneVigu), [], 'nuppude klikkimine ei tohi anda püüdmata vigu');
  }

  /* --- ükski võõras otspunkt ei saanud kirjet --- */
  assert.deepEqual([...new Set(kirjed)].sort(),
    ['/api/hanked/detail', '/api/hanked/note', '/api/hanked/run', '/api/hanked/state'].sort(),
    'vaade kirjutab ainult teadaolevatesse otspunktidesse: ' + JSON.stringify([...new Set(kirjed)]));
  assert.deepEqual(vead, [], 'lehel ei tohi olla püüdmata vigu');

  console.log('PASS hanked-vaade: sakk avab vaate, võõras pealkiri jääb tekstiks, filter kuulab serveri lõppseise,'
    + ' seisumuutus ei tee täislaadimist, tühi olek ja vigane vastus on eestikeelsed.');
  console.log('PASS hanked-vaade: nupud, 409 runId-ga, progressita logirida, üks täislaadimine jooksu lõpus,'
    + ' pollimine lõpeb vaatelt lahkudes ja veaahelas, detailpaneel koos märkuse ja seisunuppudega.');
  await context.close();
} finally { await browser.close(); await new Promise((r) => server.close(r)); }
