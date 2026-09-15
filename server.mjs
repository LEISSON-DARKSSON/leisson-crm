import {randomUUID} from 'node:crypto';
import {migrateOutbound,previewOutbound,dispatchOutbound} from './lib/outbound.mjs';
import {reconcileSalesReplies} from './lib/sales-safety.mjs';
import {revenueSummary} from './lib/salesdb.mjs';
import {activeServices,CATALOG_VERSION} from '../packages/service-catalog/index.mjs';
import {listProUXAuditLeads} from './lib/prouxaudit-import.mjs';
import {listWebInquiries} from './lib/web-inquiry.mjs';
// Leisson CRM — kohalik HTTP-server (ainult 127.0.0.1). Nullsõltuvusega router + taustapoller.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { ROOT, loadEnv } from './lib/env.mjs';
import { open, seed, logActivity, STATUSES, STATUS_LABEL } from './lib/db.mjs';
import { sendMail, syncInbox, syncAll, verifySmtp, verifyImap, fetchBody, markSeen, archive } from './lib/mail.mjs';
import { buildSignature, previewPage } from './lib/signature.mjs';
import { migrateAgent } from './lib/agentdb.mjs';
import * as mail from './lib/mail.mjs';
import { LOOBUMISRIDA, lisaLoobumisrida } from './lib/sendgate.mjs';
import { initSales, salesState, extraRoutes, docPage } from './lib/routes2.mjs';

const cfg = loadEnv();
const db = open();
migrateAgent(db);          // agent_jobs, agent_runs, drafts + messages klassifikatsiooniveerud
initSales(db);             // offers, invoices, invoice_lines, counters, message_groups, suppressions, stages
const seeded = process.env.CRM_NO_SEED === '1' ? {inserted:0} : seed(db);
migrateOutbound(db);
const csrfToken=randomUUID();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

const TOKENS_CSS = join(ROOT, '..', 'packages', 'orbit-tokens', 'dist', 'orbit.css');

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req, limit = 512 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('Päring liiga suur');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function state() {
  const companies = db.prepare(`
    SELECT id,name,seg,loc,regcode,turnover,email,email_note,url,priority,offer,price,
           finding,why,angle,meet_day,subject,body,status,next_step,updated,lang,listid,sales_state,need_evidence,qualified_at,account
    FROM companies
    ORDER BY CASE priority WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 WHEN 'P' THEN 3 ELSE 4 END, name
  `).all();
  const activity = db.prepare('SELECT company_id, ts, kind, note FROM activity ORDER BY ts DESC LIMIT 500').all();
  const messages = db.prepare(`
    SELECT account, mailbox, uid, ts, addr, addr_name, to_addr, subject, company_id, unread, archived, replied,
           (body_text IS NOT NULL) AS has_body, category, urgency, classified, suspicious,
           confidence, summary, suggest_archive, review, group_id, reply_intent, source_id, identity_status
    FROM messages WHERE archived = 0 AND deleted IS NULL ORDER BY ts DESC LIMIT 300
  `).all();
  // Agendi mustandid. Saatmine EI ole agendi kaes - siin on ainult see, mida ta
  // on ette valmistanud ja mis ootab Gerdi klikki.
  let drafts = [];
  try {
    drafts = db.prepare(`
      SELECT account, uid, company_id, lang, subject, body, status, edit_notes, reason, requested
      FROM drafts WHERE status IN ('mustand','toimetatud','ootab_kinnitust') ORDER BY requested DESC, id DESC
    `).all();
  } catch { drafts = []; }   // agendikihti ei pruugi veel olla
  const meta = Object.fromEntries(db.prepare('SELECT k, v FROM meta').all().map((r) => [r.k, r.v]));
  const counts = {};
  for (const s of STATUSES) counts[s] = companies.filter((c) => c.status === s).length;
  return {
    csrfToken,
    revenue:revenueSummary(db,{ownAddresses:cfg.selfEmails}),
    services:activeServices(),catalogVersion:CATALOG_VERSION,
    proUXLeads:listProUXAuditLeads(db),
    webInquiries:listWebInquiries(db),
    salesAccounts:cfg.accounts.filter(a=>String(a.user).toLowerCase()==='gert@leisson.eu').map(a=>({id:a.id,user:a.user,name:a.name})),
    outbound:db.prepare('SELECT id,company_id,recipient,subject,state,created,accepted_at,error FROM outbound_messages ORDER BY created DESC LIMIT 50').all(),
    accounts: cfg.accounts.map((a) => ({ id: a.id, user: a.user, name: a.name })),
    defaultAccount: cfg.defaultAccount,
    pollMinutes: cfg.pollMinutes,
    statuses: STATUSES,
    statusLabels: STATUS_LABEL,
    measured: meta.measured || '',
    lastSync: meta.last_sync || null,
    days: meta.days ? JSON.parse(meta.days) : [],
    counts,
    pipelineValue: companies
      .filter((c) => c.sales_state === 'qualified')
      .reduce((a, c) => a + (c.price || 0), 0),
    companies,
    activity,
    messages,
    drafts,
    ...salesState(db),
  };
}

const routes = {
  ...extraRoutes(db, cfg, { json, readBody, mail }),

  'GET /api/state': async (req, res) => json(res, 200, state()),


  'POST /api/outbound/preview': async(req,res)=>{
    try {const input=await readBody(req);if(input.kind!=='reply') input.body=lisaLoobumisrida(input.body);
      const result=previewOutbound(db,input,{accountId:cfg.defaultAccount,accounts:cfg.accounts,composeText:mail.composeText,composeHtml:mail.composeHtml});json(res,200,result);
    }catch(e){json(res,400,{error:e.message});}
  },
  // Local canonical mail only: opening inquiry evidence does not fetch, mark read or send mail.
  'POST /api/inquiry/message': async(req,res)=>{
    const {source_id}=await readBody(req);
    if(!/^[0-9a-f]{64}$/i.test(String(source_id||'')))return json(res,400,{error:'Kirja allika ID on vigane'});
    if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mail_records'").get())return json(res,404,{error:'Algse kirja inventuur puudub'});
    const message=db.prepare('SELECT source_id,account,mailbox,uid,uidvalidity,subject,addr,ts,body_text,body_truncated FROM mail_records WHERE source_id=?').get(source_id);
    if(!message)return json(res,404,{error:'Algne kiri puudub kohalikust inventuurist'});
    return json(res,200,{message});
  },

  'POST /api/qualification': async(req,res)=>{
    const {id,sales_state,need_evidence}=await readBody(req);
    if(!['research','qualified','in_delivery','delivered'].includes(sales_state)||!String(need_evidence||'').trim()) return json(res,400,{error:'Vajaduse või kontakti põhjendus puudub'});
    const current=db.prepare('SELECT sales_state FROM companies WHERE id=?').get(id);
    if(!current)return json(res,404,{error:'Ettevõtet ei leitud'});
    if(['declined','unsubscribe','not_now','has_provider'].includes(current.sales_state))return json(res,400,{error:'Peatatud müügijada avamine vajab uut kliendipoolset pöördumist'});
    db.prepare('UPDATE companies SET sales_state=?,need_evidence=?,qualified_at=?,updated=? WHERE id=?').run(sales_state,need_evidence.trim(),new Date().toISOString(),new Date().toISOString(),id);
    logActivity(db,id,'qualification',sales_state+': '+need_evidence.trim());json(res,200,{ok:true});
  },
  'POST /api/status': async (req, res) => {
    const { id, status } = await readBody(req);
    if (!STATUSES.includes(status)) return json(res, 400, { error: 'Tundmatu staatus' });
    if (!db.prepare('SELECT 1 FROM companies WHERE id = ?').get(id)) return json(res, 404, { error: 'Ei leitud' });
    db.prepare('UPDATE companies SET status = ?, updated = ? WHERE id = ?').run(status, new Date().toISOString(), id);
    logActivity(db, id, 'status', STATUS_LABEL[status]);
    json(res, 200, { ok: true });
  },

  'POST /api/note': async (req, res) => {
    const { id, note } = await readBody(req);
    if (!note || !note.trim()) return json(res, 400, { error: 'Tühi märkus' });
    logActivity(db, id, 'note', note.trim());
    json(res, 200, { ok: true });
  },

  'POST /api/next-step': async (req, res) => {
    const { id, next_step } = await readBody(req);
    db.prepare('UPDATE companies SET next_step = ?, updated = ? WHERE id = ?')
      .run(next_step || null, new Date().toISOString(), id);
    json(res, 200, { ok: true });
  },

  'POST /api/letter': async (req, res) => {
    const { id, subject, body } = await readBody(req);
    db.prepare('UPDATE companies SET subject = ?, body = ?, updated = ? WHERE id = ?')
      .run(subject || null, body || null, new Date().toISOString(), id);
    json(res, 200, { ok: true });
  },

  'POST /api/send': async (req, res) => {
    const { id, to, subject, body, accountId, approvalId } = await readBody(req);
    const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
    if (!c) return json(res, 404, { error: 'Ettevõtet ei leitud' });
    const recipient = (to || c.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(recipient)) return json(res, 400, { error: 'Saaja aadress on puudu või vigane' });
    if (!subject || !body) return json(res, 400, { error: 'Pealkiri või sisu puudub' });
    // ESS 103-1: iga kaubanduslik kiri peab kandma toimivat loobumisvoimalust.
    // Reegel elab siin, mitte saatjas ega kasutajaliideses - siis katab ta nii
    // inimese kliki kui ka automaatse saatja, ja mooda ei saa kumbki.
    const keha = lisaLoobumisrida(body);
    try {
      const r = await dispatchOutbound(db, approvalId, {id,to:recipient,subject,body:keha,accountId}, sendMail,{accounts:cfg.accounts});
      db.prepare(`UPDATE companies SET subject=?, body=?, email=COALESCE(email,?), account=?,
                  status=CASE WHEN status='ootel' THEN 'kiri' ELSE status END, updated=? WHERE id=?`)
        .run(subject, keha, recipient, accountId || cfg.defaultAccount, new Date().toISOString(), id);
      logActivity(db, id, 'sent', `${r.from} → ${recipient} — ${subject}`);
      json(res, 200, { ok: true, ...r });
    } catch (e) {
      logActivity(db, id, 'error', `Saatmine ebaõnnestus: ${e.message}`);
      json(res, 502, { error: e.message });
    }
  },

  'POST /api/sync': async (req, res) => {
    const { accountId } = await readBody(req);
    try {
      const r = accountId ? [await syncInbox(db, accountId,{bodies:true})] : await syncAll(db,{bodies:true});
      json(res, 200, { ok: true, results: r });
    } catch (e) {
      json(res, 502, { error: e.message });
    }
  },

  'POST /api/message/body': async (req, res) => {
    const { account, uid } = await readBody(req);
    try {
      const r = await fetchBody(db, account, Number(uid));
      json(res, 200, { ok: true, ...r });
    } catch (e) {
      json(res, 502, { error: e.message });
    }
  },

  'POST /api/message/seen': async (req, res) => {
    const { account, uid, seen } = await readBody(req);
    try {
      json(res, 200, await markSeen(db, account, Number(uid), seen !== false));
    } catch (e) {
      json(res, 502, { error: e.message });
    }
  },

  'POST /api/message/archive': async (req, res) => {
    const { account, uid } = await readBody(req);
    try {
      json(res, 200, await archive(db, account, Number(uid)));
    } catch (e) {
      json(res, 502, { error: e.message });
    }
  },

  'POST /api/message/link': async (req, res) => {
    const { account, uid, companyId } = await readBody(req);
    if (companyId && !db.prepare('SELECT 1 FROM companies WHERE id = ?').get(companyId)) {
      return json(res, 404, { error: 'Ettevõtet ei leitud' });
    }
    db.prepare('UPDATE messages SET company_id = ? WHERE account = ? AND uid = ?')
      .run(companyId || null, account, Number(uid));
    if (companyId) {
      const m = db.prepare('SELECT subject, addr FROM messages WHERE account = ? AND uid = ?').get(account, Number(uid));
      logActivity(db, companyId, 'reply', `Seotud kiri: ${m?.subject || '(pealkirjata)'} (${m?.addr || ''})`);
    }
    json(res, 200, { ok: true });
  },

  'POST /api/reply': async (req, res) => {
    const { account, accountId, uid, to, subject, body, companyId, approvalId } = await readBody(req);
    const m = db.prepare('SELECT * FROM messages WHERE account = ? AND uid = ?').get(account, Number(uid));
    if (!m) return json(res, 404, { error: 'Kirja ei leitud' });
    const recipient = (to || m.addr || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(recipient)) return json(res, 400, { error: 'Saaja aadress vigane' });
    if (!body) return json(res, 400, { error: 'Sisu puudub' });
    const subj = subject || (m.subject && /^re:/i.test(m.subject) ? m.subject : 'Re: ' + (m.subject || ''));
    try {
      const r = await dispatchOutbound(db, approvalId, {account,accountId,uid,companyId,to:recipient,subject:subj,body}, sendMail,{accounts:cfg.accounts});
      db.prepare('UPDATE messages SET replied = 1, unread = 0 WHERE account = ? AND uid = ?').run(account, Number(uid));
      await markSeen(db, account, Number(uid), true).catch((e) => console.error('markSeen:', e.message));
      // TEINE VOTI: mustand loetakse saadetuks AINULT siin, inimese klikist.
      // Agendil ei ole tooriista, mis seda seisundit panna saaks.
      try {
        db.prepare("UPDATE drafts SET status = 'saadetud', closed = ? WHERE account = ? AND uid = ?")
          .run(new Date().toISOString(), account, Number(uid));
      } catch (e) { console.error('mustandi sulgemine:', e.message); }
      const cid = companyId || m.company_id;
      if (cid) logActivity(db, cid, 'sent', `Vastus ${recipient} — ${subj}`);
      json(res, 200, { ok: true, ...r });
    } catch (e) {
      json(res, 502, { error: e.message });
    }
  },

  'POST /api/draft/reject': async (req, res) => {
    const { account, uid, note } = await readBody(req);
    const r = db.prepare("UPDATE drafts SET status = 'tagasi_lukatud', reason = ?, closed = ? WHERE account = ? AND uid = ?")
      .run(note || null, new Date().toISOString(), account, Number(uid));
    if (!r.changes) return json(res, 404, { error: 'Mustandit ei leitud' });
    json(res, 200, { ok: true });
  },

  'GET /api/health': async (req, res) => {
    const out = { accounts: [] };
    for (const a of cfg.accounts) {
      const row = { id: a.id, user: a.user, smtp: null, imap: null };
      try { await verifySmtp(a.id); row.smtp = 'ok'; } catch (e) { row.smtp = e.message; }
      try { const b = await verifyImap(a.id); row.imap = `ok (${b.length} kausta)`; } catch (e) { row.imap = e.message; }
      out.accounts.push(row);
    }
    json(res, 200, out);
  },

  'GET /api/signature': async (req, res) => {
    const { html, text } = buildSignature();
    json(res, 200, { html, text });
  },
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const key = `${req.method} ${url.pathname}`;

    const host=req.headers.host;
    if(!['127.0.0.1:'+cfg.port,'localhost:'+cfg.port].includes(host))return json(res,403,{error:'Host ei ole lubatud'});
    if(req.method==='POST' && (req.headers['x-crm-csrf']!==csrfToken || (req.headers.origin && !['http://127.0.0.1:'+cfg.port,'http://localhost:'+cfg.port].includes(req.headers.origin))))return json(res,403,{error:'Ava CRM uuesti; toiming vajab kohalikku seanssi'});
    if (routes[key]) return await routes[key](req, res);

    if (url.pathname === '/signature' || url.pathname === '/signature/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(previewPage());
    }
    if (url.pathname === '/doc') {
      const html = docPage(db, url);
      if (!html) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('Dokumenti ei leitud');
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (url.pathname === '/orbit.css') {
      if (!existsSync(TOKENS_CSS)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('orbit.css puudub — jooksuta packages/orbit-tokens: node build.mjs');
      }
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      return res.end(await readFile(TOKENS_CSS));
    }

    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = join(ROOT, 'public', normalize(rel).replace(/^([/\\])+/, ''));
    if (!file.startsWith(join(ROOT, 'public'))) {
      res.writeHead(403);
      return res.end('Keelatud');
    }
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      return res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Ei leitud');
    }
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

/* ---------- taustapoller: uued kirjad iga N minuti tagant ---------- */
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const r = await syncAll(db, { limit: 60, bodies: true });
    reconcileSalesReplies(db,{apply:true});
    const fresh = r.reduce((a, x) => a + (x.fresh || 0), 0);
    const errs = r.filter((x) => x.error);
    if (fresh) console.log(`[poller ${new Date().toLocaleTimeString('et-EE')}] ${fresh} uut kirja`);
    if (errs.length) console.log(`[poller] ${errs.map((e) => e.account + ': ' + e.error).join(' | ')}`);
  } catch (e) {
    console.log('[poller] viga: ' + e.message);
  } finally {
    polling = false;
  }
}

const POLL_MS = Math.max(1, cfg.pollMinutes) * 60 * 1000;
const timer = process.env.CRM_NO_POLL === '1' ? null : setInterval(poll, POLL_MS);
timer?.unref?.();
if(process.env.CRM_NO_POLL !== '1') setTimeout(poll, 20000).unref?.();

server.listen(cfg.port, '127.0.0.1', () => {
  console.log('');
  console.log('  LEISSON CRM');
  console.log(`  http://127.0.0.1:${cfg.port}`);
  console.log(`  kontod    ${cfg.accounts.map((a) => a.user).join(', ')}`);
  console.log(`  postkast  automaatne kontroll iga ${cfg.pollMinutes} min`);
  console.log(`  andmebaas data/crm.sqlite (${seeded.inserted} kirjet seemnest)`);
  console.log(`  allkiri   http://127.0.0.1:${cfg.port}/signature`);
  console.log('');
});
