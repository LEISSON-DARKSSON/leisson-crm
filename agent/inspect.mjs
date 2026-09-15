// Vaata, mida agent andmebaasi kirjutas. Ainult lugemine.
//   node agent/inspect.mjs              -> viimased klassifitseeritud kirjad
//   node agent/inspect.mjs --runs       -> käivitused ja tellimuse kasutus
//   node agent/inspect.mjs --suspicious -> ainult kahtlased
//   node agent/inspect.mjs --limit=40
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : (process.argv.includes('--' + n) ? true : d); };
const db = new DatabaseSync(process.env.CRM_DB_PATH || join(ROOT, 'data', 'crm.sqlite'), { readOnly: true });
const p = (s, n) => String(s ?? '').padEnd(n).slice(0, n);

const yksMustand = arg('draft');
if (yksMustand && yksMustand !== true) {
  const [acc, uid] = String(yksMustand).split(':');
  const r = db.prepare(`SELECT d.*, m.addr, m.subject AS orig FROM drafts d
      LEFT JOIN messages m ON m.account=d.account AND m.uid=d.uid
     WHERE d.account=? AND d.uid=?`).get(acc, Number(uid));
  if (!r) { console.log('Mustandit ei ole: ' + yksMustand); db.close(); process.exit(1); }
  const mts = db.prepare('SELECT ts FROM messages WHERE account=? AND uid=?').get(acc, Number(uid));
  console.log(`\nseisund:  ${r.status}`);
  console.log(`algkiri:  ${mts ? mts.ts : '?'}`);
  console.log(`saaja:    ${r.addr}`);
  console.log(`pealkiri: ${r.subject}`);
  console.log(`\n--- sisu ---\n${r.body}\n--- sisu lopp ---`);
  if (r.edit_notes) console.log(`\nkeeletoimetus:\n${r.edit_notes}`);
  if (r.reason) console.log(`\npohjendus:\n${r.reason}`);
  console.log('\nSaatmine: CRM-is Postkast -> see kiri -> Saada vastus. Agent seda teha ei saa.\n');
  db.close(); process.exit(0);
}

if (arg('drafts')) {
  let rows = [];
  try {
    rows = db.prepare(`SELECT d.account, d.uid, d.status, d.subject, d.edit_notes, d.reason, d.created, d.requested,
                              m.addr, m.subject AS orig
                         FROM drafts d LEFT JOIN messages m ON m.account=d.account AND m.uid=d.uid
                        ORDER BY d.id DESC LIMIT 30`).all();
  } catch { rows = []; }
  if (!rows.length) console.log('\nMustandeid ei ole.\n');
  for (const r of rows) {
    console.log(`\n[${r.status}]  ${r.account}:${r.uid}  ->  ${r.addr || '?'}`);
    console.log(`  pealkiri: ${r.subject || '-'}`);
    if (r.edit_notes) console.log(`  keeletoimetus: ${String(r.edit_notes).slice(0, 200)}`);
    if (r.reason) console.log(`  pohjendus: ${String(r.reason).slice(0, 200)}`);
  }
  console.log('');
  db.close(); process.exit(0);
}

if (arg('stats')) {
  console.log('\nkategooria          korge  keskm  madal  kokku  kesk.kindlus');
  for (const r of db.prepare(`SELECT category,
        SUM(urgency='korge') k, SUM(urgency='keskmine') m, SUM(urgency='madal') l,
        COUNT(*) n, AVG(confidence) c
      FROM messages WHERE classified=1 GROUP BY category ORDER BY n DESC`).all()) {
    console.log([p(r.category, 19), p(r.k, 6), p(r.m, 6), p(r.l, 6), p(r.n, 6), Number(r.c).toFixed(2)].join(' '));
  }
  const b = db.prepare("SELECT SUM(body_text IS NOT NULL) y, COUNT(*) n FROM messages WHERE direction='in'").get();
  console.log(`\nkeha alla laetud: ${b.y || 0}/${b.n} kirjal; ülejäänud kirjade sisu ei ole kohalikus inventuuris kättesaadav.`);
  const s2 = db.prepare('SELECT SUM(suspicious) s, SUM(review) r FROM messages WHERE classified=1').get();
  console.log(`kahtlasi: ${s2.s || 0} · ulevaatust ootab: ${s2.r || 0}\n`);
  db.close(); process.exit(0);
}

if (arg('runs')) {
  console.log('\nViimased mudelikäivitused; tokenid ei ole API arve.');
  for (const r of db.prepare('SELECT * FROM agent_runs ORDER BY id DESC LIMIT 20').all()) {
    const codex=r.provider==='codex-chatgpt';
    const billing=codex?'ChatGPT tellimus':r.total_cost_usd==null?'ajalooline API-kulu teadmata':'ajalooline API-kulu '+Number(r.total_cost_usd).toFixed(4)+' USD';
    const duration=r.duration_ms==null?'teadmata':Math.round(r.duration_ms/1000)+'s';
    const tokens=(r.input_tokens??'?')+'/'+(r.output_tokens??'?');
    console.log([r.id,'töö '+r.job_id,r.type,r.provider||'ajalooline teenusepakkuja',r.model||'mudel teadmata',
      r.effort||'effort teadmata','tokenid sisse/välja '+tokens,billing,duration,r.ok?'OK':'VIGA',r.ts?.slice(0,19)||'?'].join(' · '));
    // Raw provider stderr can contain customer content. Only the bounded error code is displayed.
    if (r.error_code) console.log('  veakood: '+String(r.error_code).replace(/[^a-z0-9_-]/gi,'').slice(0,80));
  }
  const s=db.prepare("SELECT COUNT(*) n,SUM(provider='codex-chatgpt') codex,SUM(CASE WHEN provider IS NULL OR provider!='codex-chatgpt' THEN total_cost_usd END) historical,SUM((provider IS NULL OR provider!='codex-chatgpt') AND total_cost_usd IS NULL) unknown FROM agent_runs").get();
  console.log('\nKokku '+s.n+' käivitust; ChatGPT tellimus: '+(s.codex||0)+'.');
  console.log('Ajalooline teadaolev API-kulu: '+(s.historical==null?'teadmata':Number(s.historical).toFixed(4)+' USD')+'; puuduva API-kuluga ajaloolisi kirjeid: '+(s.unknown||0)+'.\n');
  db.close(); process.exit(0);
}

const where = arg('suspicious') ? 'AND suspicious=1' : (arg('review') ? 'AND review=1' : '');
const rows = db.prepare(
  `SELECT mailbox || ':' || uid AS id, substr(ts,1,10) AS paev, category, urgency, suspicious, review, confidence, company_id, addr, subject, summary
     FROM messages WHERE classified=1 ${where} ORDER BY
       CASE urgency WHEN 'korge' THEN 0 WHEN 'keskmine' THEN 1 ELSE 2 END, category
     LIMIT ?`).all(Number(arg('limit', 30)));

console.log('\nid          kuupaev     kategooria          kiirus    !      kindl  saatja                    kokkuvote');
console.log('-'.repeat(150));
for (const r of rows) {
  console.log([p(r.id, 11), p(r.paev, 11), p(r.category, 19), p(r.urgency, 9),
    p(r.suspicious ? 'KAHTL' : (r.review ? 'ULEV' : ''), 6),
    p(Number(r.confidence ?? 0).toFixed(2), 6), p(r.addr, 25), p(r.summary, 46)].join(' '));
}
const tot = db.prepare("SELECT COUNT(*) n FROM messages WHERE direction='in' AND archived=0").get().n;
const cls = db.prepare("SELECT COUNT(*) n FROM messages WHERE classified=1 AND direction='in' AND archived=0").get().n;
const sus = db.prepare('SELECT COUNT(*) n FROM messages WHERE suspicious=1').get().n;
const rev = db.prepare('SELECT COUNT(*) n FROM messages WHERE review=1').get().n;
console.log(`\n${cls}/${tot} klassifitseeritud · ${sus} kahtlast · ${rev} ootab ulevaatust (--review)\n`);
db.close();
