// Muugimootori ja massitoo marsruudid. Eraldi failis, et server.mjs jaaks loetavaks.
// Siin EI OLE uhtegi saatmist - saatmine on server.mjs-is ja see on inimese klikk.
import { migrateSales, createOffer, createInvoice, deleteDoc, docList, markOverdue, recordPayment, revenueSummary, OFFER_STATES, INVOICE_STATES } from './salesdb.mjs';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.mjs';
import { renderKaart } from './kaart.mjs';
import { bulkGate, TASKS, limits, TRIAGE_BATCH } from './gates.mjs';
import { renderInvoice, renderOffer, VAT_REGISTERED } from './doc.mjs';
import { enqueue, spentToday, runtimePause } from './agentdb.mjs';
import { logActivity } from './db.mjs';
import { randomUUID } from 'node:crypto';

const splitId = (id) => { const i = String(id).lastIndexOf(':'); return [String(id).slice(0, i), Number(String(id).slice(i + 1))]; };

export function initSales(db) { migrateSales(db); markOverdue(db); }

export function salesState(db) {
  return {
    docs: docList(db),
    payments:db.prepare('SELECT id,invoice_id,amount,reference,received_at FROM payments ORDER BY received_at DESC').all(),
    groups: db.prepare(`SELECT g.id, g.name, g.rule, COUNT(m.rowid) AS n
                          FROM message_groups g LEFT JOIN messages m ON m.group_id=g.id
                         GROUP BY g.id ORDER BY n DESC`).all(),
    suppressed: db.prepare('SELECT addr, reason, ts FROM suppressions ORDER BY ts DESC').all(),
    vatRegistered: VAT_REGISTERED,
    tasks: Object.fromEntries(Object.entries(TASKS).map(([k, v]) => [k, { label: v.label, unit: v.unit, model: v.model, agent: v.agent }])),
    limits: limits(),
  };
}

export function stats(db, cfg = {}) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const L = limits();
  return {
    revenue:revenueSummary(db,{ownAddresses:cfg.selfEmails}),
    pipeline: all(`SELECT status, COUNT(*) n, COALESCE(SUM(price),0) eur FROM companies GROUP BY status`),
    offers: all(`SELECT offer AS k, COUNT(*) n, COALESCE(SUM(price),0) eur FROM companies
                  WHERE price IS NOT NULL GROUP BY offer ORDER BY eur DESC`),
    priority: all(`SELECT priority AS k, COUNT(*) n, COALESCE(SUM(price),0) eur FROM companies
                    GROUP BY priority ORDER BY eur DESC`),
    categories: all(`SELECT COALESCE(category,'sorteerimata') AS k, COUNT(*) n FROM messages
                      WHERE direction='in' AND deleted IS NULL GROUP BY k ORDER BY n DESC`),
    runs: all(`SELECT type AS k, model, COUNT(*) n, ROUND(COALESCE(SUM(total_cost_usd),0),4) usd,
                      ROUND(AVG(duration_ms)/1000.0,1) s FROM agent_runs WHERE total_cost_usd IS NOT NULL AND COALESCE(provider,'claude') <> 'codex-chatgpt' GROUP BY type, model ORDER BY usd DESC`),
    letters: one(`SELECT COUNT(*) n FROM companies WHERE body IS NOT NULL AND body <> ''`).n,
    sent: one(`SELECT COUNT(*) n FROM companies WHERE status <> 'ootel'`).n,
    classified: one('SELECT COUNT(*) n FROM messages WHERE classified=1').n,
    unclassified: one("SELECT COUNT(*) n FROM messages WHERE direction='in' AND archived=0 AND deleted IS NULL AND classified=0").n,
    confidence: one('SELECT ROUND(AVG(confidence),2) c FROM messages WHERE classified=1').c,
    highOpen: one("SELECT COUNT(*) n FROM messages WHERE urgency='korge' AND replied=0 AND archived=0 AND deleted IS NULL").n,
    review: one('SELECT COALESCE(SUM(review),0) n FROM messages').n,
    suspicious: one('SELECT COALESCE(SUM(suspicious),0) n FROM messages').n,
    bodies: one(`SELECT COUNT(*) n FROM messages WHERE body_text IS NOT NULL AND body_text <> ''`).n,
    messages: one('SELECT COUNT(*) n FROM messages').n,
    spentToday: Number(spentToday(db).toFixed(4)),
    spentTotal: Number(one(`SELECT COALESCE(SUM(total_cost_usd),0) s FROM agent_runs WHERE total_cost_usd IS NOT NULL AND COALESCE(provider,'claude') <> 'codex-chatgpt'`).s.toFixed(4)),
    limits: L,
    invoices: all(`SELECT state AS k, COUNT(*) n, COALESCE(SUM(payable),0) eur FROM invoices GROUP BY state`),
    offersDocs: all(`SELECT state AS k, COUNT(*) n, COALESCE(SUM(price),0) eur FROM offers GROUP BY state`),
  };
}

export function agentState(db) {
  return {
    runtimePause:runtimePause(db),
    jobs: db.prepare(`SELECT id, type, status, model, payload, created, finished, error
                        FROM agent_jobs ORDER BY id DESC LIMIT 40`).all(),
    runs: db.prepare(`SELECT id, job_id, type, model, exit_code, num_turns, total_cost_usd, duration_ms, ok, ts, provider,effort,input_tokens,output_tokens,error_code
                        FROM agent_runs ORDER BY id DESC LIMIT 40`).all(),
    queue: db.prepare('SELECT status, COUNT(*) n FROM agent_jobs GROUP BY status').all(),
    spentToday: Number(spentToday(db).toFixed(4)),
    limits: limits(),
    digest: db.prepare("SELECT v FROM meta WHERE k='digest'").get()?.v || '',
    digestTs: db.prepare("SELECT v FROM meta WHERE k='digest_ts'").get()?.v || null,
  };
}

// --- massitoo ---------------------------------------------------------------
async function doBulk(db, task, ids, mail) {
  const g = bulkGate(db, task, ids);
  if (g.error) throw new Error(g.error);
  if (g.overBudget) throw new Error(`Päevaeelarve ei luba: vaja ${g.cost} $, alles ${g.budgetLeft} $`);
  const now = new Date().toISOString();
  const res = { gate: g, done: 0, jobs: [], note: null };
  if (!g.passN) { res.note = 'Värav ei lasknud ühtegi kirja läbi.'; return res; }

  const setRow = (id, sql, ...p) => { const [mb, uid] = splitId(id); return db.prepare(sql).run(...p, mb, uid).changes; };

  if (task === 'triaaz') {
    const selected = [...new Set(g.pass)], requestId = randomUUID();
    for (const id of selected) setRow(id, 'UPDATE messages SET classified=0, review=0 WHERE mailbox=? AND uid=?');
    // Paki suurus tuleb lib/gates.mjs-ist - sama arv, mida konduktor kasutab.
    const pakke = Math.ceil(selected.length / TRIAGE_BATCH);
    for (let i = 0; i < pakke; i++) res.jobs.push(enqueue(db, 'triage', {
      message_ids:selected.slice(i*TRIAGE_BATCH,(i+1)*TRIAGE_BATCH),request_id:requestId,
    }, 'gpt-5.6-luna'));
    res.done = selected.length;
    res.note = `${g.passN} kirja märgitud uuesti sorteerimata, ${pakke} triaažitööd à ${TRIAGE_BATCH} kirja järjekorras.`;
  } else if (task === 'mustand') {
    for (const id of g.pass) {
      res.jobs.push(enqueue(db, 'draft', { message_id: id }, 'gpt-5.6-sol'));
    }
    res.done = g.passN;
    res.note = `${res.jobs.length} tööd järjekorras. Saatmine on ikka sinu klikk.`;
  } else if (task === 'kehad') {
    const kontod = {};
    for (const id of g.pass) {
      const [mb, uid] = splitId(id);
      const m = db.prepare('SELECT account FROM messages WHERE mailbox=? AND uid=?').get(mb, uid);
      if (m) (kontod[m.account] ||= []).push(uid);
    }
    let ok = 0, vigu = 0;
    for (const [acc, uids] of Object.entries(kontod)) {
      try { const r = await mail.fetchBodies(db, acc, uids); ok += r.ok; vigu += r.vead.length; }
      catch (e) { vigu += uids.length; console.error('fetchBodies:', e.message); }
    }
    res.done = ok;
    res.note = `Keha alla laetud: ${ok}/${g.passN}` + (vigu ? ` (${vigu} viga)` : '');
  } else if (task === 'grupeeri') {
    const byDomain = {};
    for (const id of g.pass) {
      const [mb, uid] = splitId(id);
      const m = db.prepare('SELECT addr FROM messages WHERE mailbox=? AND uid=?').get(mb, uid);
      const dom = String(m?.addr || '').split('@')[1] || 'tundmatu';
      (byDomain[dom] ||= []).push(id);
    }
    for (const [dom, list] of Object.entries(byDomain)) {
      let grp = db.prepare('SELECT id FROM message_groups WHERE name=?').get(dom);
      if (!grp) {
        const r = db.prepare('INSERT INTO message_groups (name, rule, created) VALUES (?,?,?)').run(dom, 'domeen=' + dom, now);
        grp = { id: Number(r.lastInsertRowid) };
      }
      for (const id of list) setRow(id, 'UPDATE messages SET group_id=? WHERE mailbox=? AND uid=?', grp.id);
      res.done += list.length;
    }
    res.note = `${Object.keys(byDomain).length} gruppi, ${res.done} kirja.`;
  } else if (task === 'loetuks') {
    for (const id of g.pass) {
      const [mb, uid] = splitId(id);
      const m = db.prepare('SELECT account FROM messages WHERE mailbox=? AND uid=?').get(mb, uid);
      try { await mail.markSeen(db, m.account, uid, true); res.done++; }
      catch (e) { console.error('markSeen ' + id + ':', e.message); }
    }
    res.note = `${res.done} kirja märgitud loetuks.`;
  } else if (task === 'arhiveeri') {
    for (const id of g.pass) {
      const [mb, uid] = splitId(id);
      const m = db.prepare('SELECT account FROM messages WHERE mailbox=? AND uid=?').get(mb, uid);
      try { await mail.archive(db, m.account, uid); res.done++; }
      catch (e) { console.error('archive ' + id + ':', e.message); }
    }
    res.note = `${res.done} kirja arhiveeritud.`;
  } else if (task === 'summuta') {
    const ins = db.prepare(`INSERT INTO suppressions (addr, domain, reason, ts, by) VALUES (?,?,?,?,'inimene')
                            ON CONFLICT(addr) DO UPDATE SET reason=excluded.reason, ts=excluded.ts`);
    const seen = new Set();
    for (const id of g.pass) {
      const [mb, uid] = splitId(id);
      const m = db.prepare('SELECT addr FROM messages WHERE mailbox=? AND uid=?').get(mb, uid);
      const addr = String(m?.addr || '').toLowerCase();
      if (!addr || seen.has(addr)) continue;
      seen.add(addr);
      ins.run(addr, addr.split('@')[1] || null, 'massitöö: summutatud postkastist', now);
      res.done++;
    }
    res.note = `${res.done} aadressi summutusnimekirjas. Neile ei lähe ükski äriline kiri.`;
  } else if (task === 'kustuta') {
    for (const id of g.pass) res.done += setRow(id, 'UPDATE messages SET deleted=?, archived=1 WHERE mailbox=? AND uid=?', now);
    res.note = `${res.done} kirja kustutatud (pehme, taastatav 30 päeva).`;
  } else {
    throw new Error('tundmatu ülesanne: ' + task);
  }
  return res;
}

export function extraRoutes(db, cfg, { json, readBody, mail }) {
  return {
    'GET /api/stats': async (req, res) => json(res, 200, stats(db,cfg)),
    'GET /api/agent': async (req, res) => json(res, 200, agentState(db)),
    'GET /api/docs': async (req, res) => json(res, 200, { docs: docList(db) }),

    'POST /api/bulk/preview': async (req, res) => {
      const { task, ids } = await readBody(req);
      const g = bulkGate(db, task, Array.isArray(ids) ? ids : []);
      if (g.error) return json(res, 400, g);
      json(res, 200, g);
    },

    'POST /api/bulk/run': async (req, res) => {
      const { task, ids, confirm } = await readBody(req);
      if (!Array.isArray(ids) || !ids.length) return json(res, 400, { error: 'Ühtegi kirja ei ole valitud' });
      if (TASKS[task]?.gate === 'kinnitus' && confirm !== true) {
        return json(res, 400, { error: 'Kustutamine vajab eraldi kinnitust' });
      }
      try { json(res, 200, { ok: true, ...(await doBulk(db, task, ids, mail)) }); }
      catch (e) { json(res, 400, { error: e.message }); }
    },

    'POST /api/offer': async (req, res) => {
      const { companyId, buyer, title, price, validDays,serviceId } = await readBody(req);
      try {
        const r = createOffer(db, {
          company_id: companyId || null, buyer, title, price,serviceId,
          validDays: Number(validDays) || 14,
        });
        if (r.existing) return json(res, 200, { ok: true, ...r, note: 'Avatud pakkumine on juba olemas: ' + r.number });
        // Tegevuslogi kaib muugitoru kirje kohta; vabal ostjal seda ei ole.
        if (companyId) logActivity(db, companyId, 'offer', 'Pakkumine ' + r.number + ' koostatud');
        json(res, 200, { ok: true, ...r });
      } catch (e) { json(res, 400, { error: e.message }); }
    },

    'POST /api/invoice': async (req, res) => {
      const { companyId, buyer, title, price, offerId, prepaidPct, dueDays,kind } = await readBody(req);
      try {
        const r = createInvoice(db, {
          company_id: companyId || null, buyer, title, price, offer_id: offerId || null,kind:kind||'full',
          prepaidPct: prepaidPct === undefined ? 50 : Number(prepaidPct),
          dueDays: Number(dueDays) || 14,
        });
        if (companyId) logActivity(db, companyId, 'invoice', `Arve ${r.number} — tasumisele ${r.payable} €`);
        json(res, 200, { ok: true, ...r });
      } catch (e) { json(res, 400, { error: e.message }); }
    },


    'POST /api/payment': async(req,res)=>{
      try {const {invoiceId,amount,reference,receivedAt}=await readBody(req);const result=recordPayment(db,{invoice_id:Number(invoiceId),amount:Number(amount),reference,received_at:receivedAt||new Date().toISOString()});json(res,200,{ok:true,...result});}
      catch(e){json(res,400,{error:e.message});}
    },
    'POST /api/doc/delete': async (req, res) => {
      const { kind, id, confirm } = await readBody(req);
      if (confirm !== true) return json(res, 400, { error: 'Kustutamine vajab eraldi kinnitust' });
      try {
        const r = deleteDoc(db, kind, id);
        json(res, 200, r);
      } catch (e) { json(res, 400, { error: e.message }); }
    },

    'POST /api/doc/state': async (req,res)=>{
      const {kind,id,state}=await readBody(req), now=new Date().toISOString();
      const allowed=kind==='pakkumine'?OFFER_STATES:INVOICE_STATES;
      if(!['pakkumine','arve'].includes(kind)||!allowed.includes(state))return json(res,400,{error:'Tundmatu dokumendi seis'});
      if(kind==='arve' && ['tasutud','osaliselt_tasutud'].includes(state))return json(res,400,{error:'Märgi tegelik laekumine summa ja makseviitega'});
      try {
        if(kind==='pakkumine') {
          const column=state==='kinnitatud'?'accepted':state==='saadetud'?'sent':'closed';
          const result=db.prepare('UPDATE offers SET state=?,'+column+'=? WHERE id=?').run(state,now,Number(id));
          if(!result.changes)return json(res,404,{error:'Pakkumist ei leitud'});
        } else {
          const inv=db.prepare('SELECT * FROM invoices WHERE id=?').get(Number(id));
          if(!inv)return json(res,404,{error:'Arvet ei leitud'});
          if(inv.paid_at || db.prepare('SELECT 1 FROM payments WHERE invoice_id=?').get(inv.id))return json(res,400,{error:'Laekumisega arve muutmine vajab eraldi raamatupidamistoimingut'});
          db.prepare('UPDATE invoices SET state=?,sent=CASE WHEN ?=\'saadetud\' THEN COALESCE(sent,?) ELSE sent END WHERE id=?').run(state,state,now,Number(id));
        }
        json(res,200,{ok:true});
      }catch(e){json(res,400,{error:e.message});}
    },

  };
}

export function docPage(db, url) {
  const kind = url.searchParams.get('kind');
  const id = url.searchParams.get('id');
  if (!id) return null;
  if (kind === 'kaart') return kaartPage(db, id);
  return kind === 'pakkumine' ? renderOffer(db, id) : renderInvoice(db, id);
}

// Nahtavuskaart (redeli aste 0). Mootmine tuleb juba tehtud failist -
// kaart EI mooda uuesti, muidu ei oleks ta enam tasuta.
export function kaartPage(db, companyId) {
  const tee = join(ROOT, 'data', 'mootmised-masinloetav.json');
  if (!existsSync(tee)) return null;
  const M = JSON.parse(readFileSync(tee, 'utf8'));
  const m = M[companyId];
  if (!m || !m.ok) return null;
  const c = db.prepare('SELECT name, url FROM companies WHERE id = ?').get(companyId);
  if (!c) return null;
  return renderKaart({
    nimi: c.name,
    url: c.url || m.url,
    m,
    kuupaev: statSync(tee).mtime.toISOString(),
  });
}
