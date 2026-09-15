// UKS varavareeglistik. Konduktor (hommikune automaatne) ja massitoo (Gerdi
// kasitsi valik) kutsuvad SAMU funktsioone - kaks koopiat triiviks lahku.
//
// Siin ei ole uhtegi saatmist ega mudelikutset. Siin on ainult otsus, MIDA
// tohib jarjekorda panna. Mudelitöö kasutab olemasolevat ChatGPT tellimust.
import { runtimeLimits } from './runtime-limits.mjs';
import { spentToday } from './agentdb.mjs';
import { replyDecision } from './sales-safety.mjs';

// Masin-saatjad. Neile vastamine ei jouaks kunagi inimeseni.
// Arvete ja automaatteadete saatjad ei ole inimvastuse adressaadid.
export const MASIN = /^(no-?reply|do-?not-?reply|notification|notifications|newsletter|news|mailer|bounce|postmaster|automated|alerts?|noreply)/i;

// Kategooriad, kus vastus on uldse motekas.
export const VASTATAVAD = ['paring', 'vastus_pakkumisele', 'kohtumine', 'klienditoo'];
export const VAST_IN = VASTATAVAD.map((x) => `'${x}'`).join(',');

// Bounded controls are readable without a mailbox account or secret file.
export const TRIAGE_BATCH = runtimeLimits().triageBatch;
export function limits() { return runtimeLimits(); }

export function isMachine(addr) {
  const s = String(addr || '');
  return MASIN.test(s.split('@')[0]) || MASIN.test(s);
}

// Legacy numeric cost fields remain zero for compatibility, not as an API bill.
export const TASKS = {
  triaaz:    { label: 'Klassifitseeri uuesti', unit: 0,      model: 'gpt-5.6-luna / medium',    agent: true,  gate: 'draft-vaba' },
  kehad:     { label: 'Lae kehad alla',        unit: 0,      model: null,       agent: false, gate: 'vaba' },
  mustand:   { label: 'Kirjuta mustandid',     unit: 0,      model: 'gpt-5.6-sol / medium', agent: true, gate: 'mustand' },
  grupeeri:  { label: 'Grupeeri lõimeks',      unit: 0,      model: null,       agent: false, gate: 'vaba' },
  loetuks:   { label: 'Märgi loetuks',         unit: 0,      model: null,       agent: false, gate: 'vaba' },
  arhiveeri: { label: 'Arhiveeri',             unit: 0,      model: null,       agent: false, gate: 'vaba' },
  summuta:   { label: 'Summuta saatja',        unit: 0,      model: null,       agent: false, gate: 'vaba' },
  kustuta:   { label: 'Kustuta',               unit: 0,      model: null,       agent: false, gate: 'kinnitus' },
};

const splitId = (id) => { const i = String(id).lastIndexOf(':'); return [String(id).slice(0, i), Number(String(id).slice(i + 1))]; };

function rows(db, ids) {
  if (!ids || !ids.length) return [];
  const out = [];
  const q = db.prepare(`SELECT mailbox || ':' || uid AS id, account, uid, mailbox, addr, subject, category,
                               urgency, review, suspicious, replied, archived, deleted, direction, body_text, ts, reply_intent, identity_status, auto_response,
                               CAST(julianday('now') - julianday(ts) AS INTEGER) AS vanus
                          FROM messages WHERE mailbox=? AND uid=?`);
  for (const id of ids) {
    const [mb, uid] = splitId(id);
    const r = q.get(mb, uid);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Varav enne jarjekorda. Tagastab, mis labib, mis jaab vahele ja miks,
 * ning mida see maksab. EI kirjuta midagi.
 */
export function bulkGate(db, task, ids) {
  const spec = TASKS[task];
  if (!spec) return { error: 'tundmatu ulesanne: ' + task };
  const L = limits();
  const all = rows(db, ids);
  const pass = [];
  const skip = [];

  for (const m of all) {
    if (m.deleted) { skip.push({ id: m.id, why: 'kustutatud' }); continue; }
    if (spec.gate === 'mustand') {
      const decision = replyDecision(m, { maxAgeDays: L.maxAgeDays });
      if (!decision.allowed) { skip.push({id:m.id,why:decision.reason}); continue; }
      if (isMachine(m.addr)) { skip.push({ id: m.id, why: 'masinaadress' }); continue; }
      if (m.vanus > L.maxAgeDays) { skip.push({ id: m.id, why: `vanem kui ${L.maxAgeDays} päeva` }); continue; }
      if (!m.category || !VASTATAVAD.includes(m.category)) { skip.push({ id: m.id, why: 'kategooria ei ole vastatav' }); continue; }
      if (m.review || m.suspicious) { skip.push({ id: m.id, why: 'ülevaatuses või kahtlane' }); continue; }
      if (m.replied) { skip.push({ id: m.id, why: 'juba vastatud' }); continue; }
      const d = db.prepare('SELECT status FROM drafts WHERE account=? AND uid=?').get(m.account, m.uid);
      if (d && d.status !== 'tagasi_lukatud') { skip.push({ id: m.id, why: 'mustand on juba olemas' }); continue; }
    }
    pass.push(m.id);
  }

  // Paevapiir loikab mustandid, mitte muud tood.
  const draftsToday=db.prepare("SELECT COUNT(*) n FROM drafts WHERE substr(created,1,10)=?").get(new Date().toISOString().slice(0,10)).n;
  const remainingDrafts=Math.max(0,L.maxDrafts-draftsToday);
  let capped = [];
  if (spec.gate === 'mustand' && pass.length > remainingDrafts) {
    capped = pass.slice(remainingDrafts);
    for (const id of capped) skip.push({ id, why: `päevapiir ${L.maxDrafts} mustandit` });
  }
  const final = spec.gate === 'mustand' ? pass.slice(0, remainingDrafts) : pass;

  const spent = spentToday(db);
  const cost = Number((spec.unit * final.length).toFixed(4));
  const budgetLeft = null; // A subscription quota is not a dollar budget.
  const overBudget = false; // Subscription quota is enforced by the Codex adapter; historical USD is not a current bill.

  const why = {};
  for (const s of skip) why[s.why] = (why[s.why] || 0) + 1;

  return {
    task, label: spec.label, model: spec.model, agent: spec.agent, billingMode: 'chatgpt_subscription',
    requested: ids.length, pass: final, passN: final.length,
    skip, skipN: skip.length, why,
    unit: spec.unit, cost, spent, dailyUsd: null, budgetLeft, overBudget,
    jobs: spec.agent ? (task === 'mustand' ? final.length * 2 : Math.ceil(final.length / L.triageBatch)) : 0,
    needsConfirm: spec.gate === 'kinnitus',
    limits: {...L,remainingDrafts},
  };
}

/** Konduktori mustandikandidaadid — sama varav, teine sisend. */
export function draftCandidates(db) {
  const L = limits();
  const c = db.prepare(`
    SELECT m.*, m.mailbox || ':' || m.uid AS id
      FROM messages m LEFT JOIN drafts d ON d.account = m.account AND d.uid = m.uid
     WHERE m.direction='in' AND m.archived=0 AND m.deleted IS NULL AND m.classified=1
       AND m.replied=0 AND m.review=0 AND m.suspicious=0
       AND julianday('now') - julianday(m.ts) <= ${L.maxAgeDays}
       AND m.category IN (${VAST_IN}) AND d.id IS NULL
     ORDER BY CASE m.urgency WHEN 'korge' THEN 0 WHEN 'keskmine' THEN 1 ELSE 2 END, m.ts DESC
  `).all();
  const sobivad = c.filter((k) => !isMachine(k.addr) && replyDecision(k, { maxAgeDays:L.maxAgeDays }).allowed);
  return { kandidaadid: c, sobivad, votame: sobivad.slice(0, L.maxDrafts), limits: L };
}
