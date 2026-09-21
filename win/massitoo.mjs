// Kogu postkast uhe kaeguga labi: kehad alla, siis uuesti klassifitseerida.
// Kaib ELAVA serveri kaudu (/api/bulk/*), seega sama varav ja sama kulupiirang
// mis kasitsi klikkides. Ei saada kunagi midagi valja.
//
//   node win/massitoo.mjs --dry            naita, mis juhtuks
//   node win/massitoo.mjs                  kehad + triaaz kogu postkastile
//   node win/massitoo.mjs --task=kehad     ainult kehad
//   node win/massitoo.mjs --batch=25       paki suurus (vaikimisi 25)
//   node win/massitoo.mjs --saatja=a@b.ee,c@d.ee   ainult nende saatjate kirjad
//   node win/massitoo.mjs --saatja=... --arhiiviga  votab ka arhiveeritud kirjad
//
// --saatja on olemas selleks, et parandatud reeglit saaks rakendada tapselt
// nendele kirjadele, mida ta puudutab, mitte kogu postkastile. Uks jooks ule
// kogu postkasti maksab ~15x rohkem ja muudab enamasti mitte midagi.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : (process.argv.includes('--' + n) ? true : d); };

let port = 4310;
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  // loeb AINULT pordi rea, mitte kogu faili sisu
  const m = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('CRM_PORT='));
  if (m) port = Number(m.split('=')[1]) || 4310;
}
const BASE = `http://127.0.0.1:${arg('port', port)}`;
const DRY = Boolean(arg('dry'));
const BATCH = Number(arg('batch', 25));
const ONLY = arg('task', null);
const usd = (n) => Number(n || 0).toFixed(4) + ' $';

const get = async (p) => {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(p + ' -> HTTP ' + r.status);
  return r.json();
};
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || (p + ' -> HTTP ' + r.status));
  return d;
};

const state = await get('/api/state').catch((e) => {
  console.error('Server ei vasta (' + BASE + '). Kaivita: npm start voi win\\restart-server.ps1');
  console.error('  ' + e.message);
  process.exit(1);
});

const SAATJA = arg('saatja', null);
const ARHIIVIGA = Boolean(arg('arhiiviga'));
const soovitud = SAATJA ? String(SAATJA).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean) : null;

// /api/state naitab ainult aktiivset postkasti. Arhiveeritud kirjade kategooria
// laheb ikka statistikasse (/api/stats loeb koik peale kustutatute), seega
// parandatud reegel peab neile ka jouda. Loeme nimekirja otse baasist (readOnly),
// aga TOO ise kaib ikka serveri /api/bulk kaudu - sama varav, sama kulupiirang.
let koik = state.messages;
if (ARHIIVIGA) {
  if (!soovitud) { console.error('--arhiiviga tootab ainult koos --saatja-ga.'); process.exit(1); }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(ROOT, 'data', 'crm.sqlite'), { readOnly: true });
  koik = db.prepare(
    "SELECT mailbox, uid, addr, unread, (body_text IS NOT NULL AND body_text <> '') AS has_body" +
    " FROM messages WHERE direction='in' AND deleted IS NULL"
  ).all().map((m) => ({ ...m, has_body: Boolean(m.has_body) }));
  db.close();
  console.log(`Arhiiviga: baasis ${koik.length} kirja (aktiivseid ${state.messages.length}).`);
}
const kirjad = soovitud
  ? koik.filter((m) => soovitud.includes(String(m.addr || '').toLowerCase()))
  : koik;
if (soovitud) {
  console.log(`Saatjafilter: ${soovitud.join(', ')} -> ${kirjad.length} kirja ${koik.length}-st`);
  if (!kirjad.length) { console.error('Uhtegi kirja ei leidnud. Kontrolli aadressi.'); process.exit(1); }
}
const ids = kirjad.map((m) => m.mailbox + ':' + m.uid);
const kehata = kirjad.filter((m) => !m.has_body).map((m) => m.mailbox + ':' + m.uid);

console.log(`Postkastis ${kirjad.length} kirja · kehata ${kehata.length} · lugemata ${kirjad.filter((m) => m.unread).length}`);

const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

async function samm(task, list) {
  if (!list.length) { console.log(`\n${task}: midagi teha ei ole.`); return; }
  const g = await post('/api/bulk/preview', { task, ids: list });
  console.log(`\n${task}: ${list.length} kirja · labib ${g.passN} · vahele ${g.skipN} ${JSON.stringify(g.why)}`);
  console.log(`  kulu ${usd(g.cost)} · tana kulutatud ${usd(g.spent)} / ${usd(g.dailyUsd)} · mudel ${g.model || 'mudelivaba'}`);
  if (g.overBudget) { console.log('  PAEVAEELARVE EI LUBA - jatan vahele.'); return; }
  if (DRY) { console.log('  [kuivjooks] ei tee midagi'); return; }
  let n = 0, jobs = 0;
  for (const [i, part] of chunks(list, BATCH).entries()) {
    const r = await post('/api/bulk/run', { task, ids: part });
    n += r.done || 0; jobs += (r.jobs || []).length;
    console.log(`  pakk ${i + 1}: ${r.note}`);
  }
  console.log(`  kokku: ${n} kirja${jobs ? `, ${jobs} tood jarjekorras` : ''}`);
}

if (!ONLY || ONLY === 'kehad') await samm('kehad', kehata);
if (!ONLY || ONLY === 'triaaz') await samm('triaaz', ids);

if (!DRY && (!ONLY || ONLY === 'triaaz')) {
  console.log('\nJargmine samm: node agent/worker.mjs --drain');
  console.log('(tood on jarjekorras, aga mudelit kutsub worker, mitte see skript)');
}
