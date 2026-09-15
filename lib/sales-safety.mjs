// Shared decisions for drafting and dispatch. Email text is evidence, never authority.
import { createHash } from 'node:crypto';
export const REPLY_INTENTS = ['positive', 'not_now', 'declined', 'unsubscribe', 'has_provider', 'automatic', 'unknown'];
export const BLOCKED_INTENTS = new Set(['not_now', 'declined', 'unsubscribe', 'has_provider', 'automatic']);
const MACHINE_ADDRESS = /^(?:no-?reply|do-?not-?reply|notifications?|newsletter|mailer|bounce|postmaster|automated|alerts?)(?:[-_.+@]|$)/i;

export function latestMessageText(text) {
  return String(text || '').split(/\n(?:On .{0,180}wrote:|.*kirjutas:|From:|Saatja:|[-_]{3,}\s*Original Message)/i)[0]
    .split('\n').filter(line => !/^\s*>/.test(line)).join('\n').trim();
}

export function assessReplyIntent({ text, subject = '', autoResponse = false } = {}) {
  const value = latestMessageText(text).toLowerCase();
  if (autoResponse || /^auto:|automatic reply|auto.?reply|out of office|automaatvastus|automaatne vastus|kontorist väljas/i.test(subject)) return 'automatic';
  if (/ärge (?:enam )?(?:kirjutage|saatke)|eemaldage (?:mind|meid)|loobun (?:kirjadest|pakkumistest)|unsubscribe|stop (?:emailing|contacting)|do not contact|remove me/.test(value)) return 'unsubscribe';
  if (/ei (?:ole |pea )?.{0,35}prioritee|pole.{0,35}prioritee|(?:hetkel|praegu).{0,70}(?:ei soovi|ei vaja|ei ole vaja)|(?:hetkel|praegu).{0,70}(?:ei ole.{0,20}soovi|vastu ei võta|ei võta)|not (?:a )?priority|not (?:right )?now|not at this time/.test(value)) return 'not_now';
  if (/ei soovi.{0,80}(?:teenus|pakkumis|koostöö|kasutada)|(?:teenus|pakkumin).{0,60}ei (?:soovi|sobi)|ei ole.{0,65}eesmärk|loobume|not interested|no thanks|decline your offer/.test(value)) return 'declined';
  if (/arendajale.{0,80}(?:edasta|antud)|(?:edasta|and).{0,90}(?:arendaj|veebipartner)|(?:oma|meie).{0,25}(?:arendaja|veebipartner)|already.{0,40}(?:developer|agency)|passed.{0,40}developer/.test(value)) return 'has_provider';
  if (/(?:soovime|soovin|vajame|vajan).{0,70}(?:pakkumist|kodulehte|veebilehte|abi)|huvitatud|palun.{0,40}hinnapakkumis|interested|please.{0,25}(?:quote|proposal)/.test(value)) return 'positive';
  return 'unknown';
}

export function replyDecision(message, { now = new Date(), maxAgeDays = 21 } = {}) {
  if (!message) return { allowed: false, intent: 'unknown', reason: 'Kirja ei leitud' };
  const intent = effectiveReplyIntent(message);
  const deny = reason => ({ allowed: false, intent, reason });
  if (MACHINE_ADDRESS.test(message.addr || '')) return deny('Masinaadressile ei koostata vastust');
  if (message.identity_status === 'conflict') return deny('Kirja identiteet vajab ülevaatust');
  if (message.body_truncated) return deny('Kirja täielik sisu vajab laadimist');
  if (message.direction && message.direction !== 'in') return deny('See ei ole sissetulev kiri');
  if (message.deleted || message.archived) return deny('Kiri on suletud või arhiveeritud');
  if (!String(message.body_text || '').trim()) return deny('Kirja sisu puudub');
  if (BLOCKED_INTENTS.has(intent)) return deny('Müügivastus peatatud: ' + intent);
  if (message.category === 'vastus_pakkumisele' && intent === 'unknown') return deny('Vastuse kavatsus vajab ülevaatust');
  const ts = Date.parse(message.ts);
  if (!Number.isFinite(ts) || ts > +now + 300000 || +now - ts > maxAgeDays * 86400000) return deny('Kiri on aegunud või kuupäev puudub');
  if (message.suspicious || message.review) return deny('Kiri vajab inimese ülevaatust');
  if (message.replied) return deny('Kirjale on juba vastatud');
  return { allowed: true, intent, reason: null };
}

export function effectiveReplyIntent(message) {
  const observed = assessReplyIntent({text:message.body_text,subject:message.subject,autoResponse:!!message.auto_response});
  if (BLOCKED_INTENTS.has(observed)) return observed;
  if (BLOCKED_INTENTS.has(message.reply_intent)) return message.reply_intent;
  if (observed !== 'unknown') return observed;
  return REPLY_INTENTS.includes(message.reply_intent) ? message.reply_intent : 'unknown';
}

export function latestHumanReply(db, companyId) {
  return db.prepare("SELECT * FROM messages WHERE company_id=? AND direction='in' ORDER BY ts DESC,uid DESC")
    .all(companyId).find(m => effectiveReplyIntent(m) !== 'automatic' && !MACHINE_ADDRESS.test(m.addr || '')) || null;
}

export function suppressionReason(db, address) {
  const addr = String(address || '').trim().toLowerCase();
  const domain = addr.split('@')[1];
  const row = db.prepare('SELECT addr,reason FROM suppressions WHERE lower(addr)=? OR (lower(addr)=? AND domain=?)').get(addr, '@' + domain, domain);
  return row ? (row.reason || 'Adressaat on loobunud') : null;
}

export function reconcileSalesReplies(db, { now = new Date(), apply = false } = {}) {
  const changes = [];
  if (apply) db.exec('CREATE TABLE IF NOT EXISTS sales_reply_reconciliations(company_id TEXT PRIMARY KEY,reply_version TEXT NOT NULL,intent TEXT NOT NULL,applied_at TEXT NOT NULL)');
  const hasMarkers = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_reply_reconciliations'").get();
  const companyIds = new Set();
  for (const m of db.prepare("SELECT * FROM messages WHERE direction='in' AND body_text IS NOT NULL ORDER BY ts ASC").all()) {
    const intent = effectiveReplyIntent(m);
    const d = replyDecision({ ...m, reply_intent: intent }, { now });
    if (m.company_id) companyIds.add(m.company_id);
    if (intent !== 'unknown' || !d.allowed) changes.push({ account: m.account, uid: m.uid, companyId: m.company_id, intent, reason: d.reason });
    if (!apply) continue;
    if (intent !== 'unknown' && m.reply_intent !== intent) db.prepare('UPDATE messages SET reply_intent=? WHERE account=? AND mailbox=? AND uid=?').run(intent, m.account, m.mailbox, m.uid);
    if (!d.allowed) db.prepare("UPDATE drafts SET status='tagasi_lukatud', reason=?, closed=? WHERE account=? AND uid=? AND status IN ('mustand','toimetatud','ootab_kinnitust')")
      .run(d.reason, now.toISOString(), m.account, m.uid);
    if (intent === 'unsubscribe' && m.addr) db.prepare("INSERT INTO suppressions(addr,domain,reason,ts,by) VALUES(?,NULL,?,?,'inbound') ON CONFLICT(addr) DO NOTHING")
      .run(m.addr.toLowerCase(), 'Kirjas väljendatud loobumine', now.toISOString());
  }
  for (const companyId of companyIds) {
    const m = latestHumanReply(db, companyId);
    if (!m) continue;
    const intent = effectiveReplyIntent(m), decision = replyDecision(m,{now});
    const version = createHash('sha256').update(JSON.stringify([m.source_id,m.account,m.mailbox,m.uid,m.msgid,m.ts,m.body_text,intent])).digest('hex');
    const marker = hasMarkers ? db.prepare('SELECT reply_version FROM sales_reply_reconciliations WHERE company_id=?').get(companyId) : null;
    if (marker?.reply_version === version || !apply) continue;
    const c = db.prepare('SELECT * FROM companies WHERE id=?').get(companyId);
    if (!c) continue;
    const delivery = ['in_delivery','delivered','completed','paid','won'].includes(c.sales_state);
    let state = c.sales_state, next = c.next_step;
    if (!delivery && BLOCKED_INTENTS.has(intent) && intent !== 'automatic') {
      state = intent; next = 'Müügijada peatatud: ' + intent;
    } else if (!delivery && intent === 'positive' && decision.allowed
      && c.sales_state !== 'qualified' && !suppressionReason(db,m.addr)) {
      state = 'inquiry'; next = 'Täpsusta kliendi praegune vajadus';
    }
    if (state !== c.sales_state || next !== c.next_step) db.prepare('UPDATE companies SET sales_state=?,next_step=?,updated=? WHERE id=?')
      .run(state,next,now.toISOString(),companyId);
    db.prepare('INSERT INTO sales_reply_reconciliations(company_id,reply_version,intent,applied_at) VALUES(?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET reply_version=excluded.reply_version,intent=excluded.intent,applied_at=excluded.applied_at')
      .run(companyId,version,intent,now.toISOString());
  }
  return changes;
}
