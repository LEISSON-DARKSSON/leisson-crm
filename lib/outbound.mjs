import { createHash, randomUUID } from 'node:crypto';
import { BLOCKED_INTENTS, latestHumanReply, replyDecision, suppressionReason } from './sales-safety.mjs';

export const SALES_SENDER = 'gert@leisson.eu';
function senderAccount(accountId, accounts) {
  const account = accounts?.find(a => a.id === accountId);
  if (!account || String(account.user || '').trim().toLowerCase() !== SALES_SENDER) {
    throw new Error('Kõik müügikirjad tuleb saata kontolt gert@leisson.eu; teist saatjat ei kasutata');
  }
  return account;
}

const tokens = new WeakSet();
export function consumeDispatchAuthorization(token) {
  if (!token || !tokens.has(token)) throw new Error('Saatmine nõuab täpse saaja ja teksti kinnitust CRM-is');
  tokens.delete(token);
}
export const envelopeHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function migrateOutbound(db) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS outbound_previews(id TEXT PRIMARY KEY,kind TEXT NOT NULL,company_id TEXT,account TEXT NOT NULL,uid INTEGER,envelope TEXT NOT NULL,content_hash TEXT NOT NULL,source_hash TEXT NOT NULL,created TEXT NOT NULL,expires TEXT NOT NULL,approved_at TEXT,approved_by TEXT)',
    'CREATE TABLE IF NOT EXISTS outbound_messages(id TEXT PRIMARY KEY,approval_id TEXT NOT NULL UNIQUE,content_hash TEXT NOT NULL,company_id TEXT,account TEXT NOT NULL,recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,text TEXT NOT NULL,html TEXT NOT NULL,message_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL,created TEXT NOT NULL,accepted_at TEXT,result TEXT,error TEXT,FOREIGN KEY(approval_id) REFERENCES outbound_previews(id))'
  ].join(';'));
}

function currentSource(db, value, now) {
  const reason = suppressionReason(db, value.to);
  if (reason) throw new Error('Saatmine peatatud: ' + reason);
  const m = value.kind === 'reply' ? db.prepare("SELECT * FROM messages WHERE account=? AND mailbox='INBOX' AND uid=?").get(value.sourceAccount,value.uid) : null;
  if (value.kind === 'reply') {
    if (!m) throw new Error('Kirja ei leitud');
    if (value.companyId && m.company_id !== value.companyId) throw new Error('Kirja ja ettevõtte seos on muutunud');
    value.companyId = m.company_id || null;
  }
  const c = value.companyId ? db.prepare('SELECT * FROM companies WHERE id=?').get(value.companyId) : null;
  if (value.companyId && !c) throw new Error('Ettevõtet ei leitud');
  if (c && (c.status === 'ei' || BLOCKED_INTENTS.has(c.sales_state))) throw new Error('Ettevõtte müügijada on peatatud');
  if (value.kind === 'reply') {
    const decision = replyDecision(m, {now});
    if (!decision.allowed) throw new Error(decision.reason);
    const latest = c ? latestHumanReply(db,c.id) : null;
    if (latest && (latest.account !== m.account || latest.mailbox !== m.mailbox || latest.uid !== m.uid)) {
      throw new Error('Vali kliendi viimane inimvastus; varasem kiri ei anna saatmisluba');
    }
    if (String(m.addr || '').toLowerCase() !== value.to.toLowerCase()) throw new Error('Vastuse adressaat erineb algsest saatjast');
    const draft = db.prepare('SELECT body,subject,status FROM drafts WHERE account=? AND uid=?').get(value.sourceAccount, value.uid);
    return {message:m.source_id || m.msgid || [m.account,m.mailbox,m.uid],companyId:m.company_id,body:m.body_text,ts:m.ts,intent:decision.intent,draft,cstate:c?.sales_state};
  }
  if (!c) throw new Error('Müügikirjal peab olema ettevõte');
  const latest=latestHumanReply(db,c.id);
  const latestDecision=latest?replyDecision(latest,{now}):null;
  if(latestDecision && BLOCKED_INTENTS.has(latestDecision.intent) && latestDecision.intent!=='automatic') throw new Error('Kliendi viimane vastus peatab müügijada: '+latestDecision.intent);
  if(latest?.category==='vastus_pakkumisele' && latestDecision?.intent==='unknown') throw new Error('Kliendi viimane vastus vajab ülevaatust');
  if (!String(c.need_evidence || '').trim()) throw new Error('Lisa esmalt kontakti põhjendus või kliendi kinnitatud vajadus');
  return {company:c.id,body:c.body,subject:c.subject,email:c.email,state:c.sales_state,need:c.need_evidence,updated:c.updated,latest:latest?[latest.source_id,latest.ts,latest.body_text,latest.reply_intent]:null};
}

export function previewOutbound(db, input, {accountId, accounts, composeText, composeHtml, now = new Date()} = {}) {
  const value = {
    kind: input.kind === 'reply' ? 'reply' : 'sales',
    companyId: input.companyId || input.id || null,
    accountId: input.accountId || input.account || accountId,
    sourceAccount: input.kind === 'reply' ? (input.sourceAccount || input.account || input.accountId || accountId) : null,
    uid: input.uid == null ? null : Number(input.uid),
    to: String(input.to || '').trim(), subject: String(input.subject || '').trim(), body: String(input.body || '').trim(),
  };
  if (!value.accountId || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(value.to)) throw new Error('Konto või saaja aadress puudub või on vigane');
  senderAccount(value.accountId,accounts);
  if (!value.subject || !value.body || value.subject.length > 500 || /[\r\n]/.test(value.subject)) throw new Error('Pealkiri või sisu on vigane');
  const source = currentSource(db,value,now);
  const envelope = {...value,sender:SALES_SENDER,text:composeText(value.body),html:composeHtml(value.body)};
  const id=randomUUID(), expires=new Date(+now+15*60000).toISOString();
  db.prepare('INSERT INTO outbound_previews(id,kind,company_id,account,uid,envelope,content_hash,source_hash,created,expires) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id,value.kind,value.companyId,value.accountId,value.uid,JSON.stringify(envelope),envelopeHash(envelope),envelopeHash(source),now.toISOString(),expires);
  return {approvalId:id,expires,...envelope};
}

export async function dispatchOutbound(db, id, input, send, {now=new Date(),accounts} = {}) {
  const preview=db.prepare('SELECT * FROM outbound_previews WHERE id=?').get(id);
  if (!preview || Date.parse(preview.expires)<+now) throw new Error('Eelvaade puudub või on aegunud; kontrolli saajat ja teksti uuesti');
  const envelope=JSON.parse(preview.envelope);
  senderAccount(envelope.accountId,accounts);
  if (envelope.sender !== SALES_SENDER || envelopeHash(envelope) !== preview.content_hash) throw new Error('Saatja või kinnitatud sisu muutus');
  if((envelope.kind !== 'reply' || input.id || input.companyId) && (input.id||input.companyId||null)!==envelope.companyId) throw new Error('Ettevõte muutus');
  if(input.uid!=null && Number(input.uid)!==envelope.uid) throw new Error('Vastatav kiri muutus');
  for(const key of ['to','subject','body']) if(String(input[key] || '').trim()!==envelope[key]) throw new Error('Tekst või saaja muutus pärast eelvaadet');
  if ((input.accountId || input.account || envelope.accountId)!==envelope.accountId) throw new Error('Saatjakonto muutus');
  if (envelope.kind === 'reply' && (input.sourceAccount || input.account || envelope.sourceAccount)!==envelope.sourceAccount) throw new Error('Algse kirja konto muutus');
  if (envelopeHash(currentSource(db,envelope,now))!==preview.source_hash) throw new Error('Kirja või kliendi seis muutus; ava uus eelvaade');
  const messageId='<'+randomUUID()+'@leisson.eu>', outId=randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    if(db.prepare('SELECT id FROM outbound_messages WHERE approval_id=?').get(id)) throw new Error('See kinnitus on juba kasutatud; kontrolli saatmisajalugu');
    db.prepare("UPDATE outbound_previews SET approved_at=?,approved_by='user:local-crm' WHERE id=?").run(now.toISOString(),id);
    db.prepare("INSERT INTO outbound_messages(id,approval_id,content_hash,company_id,account,recipient,subject,body,text,html,message_id,state,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,'sending',?)")
      .run(outId,id,preview.content_hash,envelope.companyId,envelope.accountId,envelope.to,envelope.subject,envelope.body,envelope.text,envelope.html,messageId,now.toISOString());
    db.exec('COMMIT');
  } catch(e){ db.exec('ROLLBACK'); throw e; }
  const token={}; tokens.add(token);
  try {
    const original = envelope.kind === 'reply' ? db.prepare("SELECT msgid FROM messages WHERE account=? AND mailbox='INBOX' AND uid=?").get(envelope.sourceAccount,envelope.uid) : null;
    const result=await send({...envelope,messageId,preparedText:envelope.text,preparedHtml:envelope.html,inReplyTo:original?.msgid || undefined,authorization:token});
    if (String(result.from || '').trim().toLowerCase() !== SALES_SENDER) throw new Error('SMTP saatjakonto ei vasta kinnitatud aadressile gert@leisson.eu');
    if(!result.accepted?.length || result.rejected?.length) throw new Error('SMTP ei kinnitanud kõiki adressaate');
    db.prepare("UPDATE outbound_messages SET state='accepted',accepted_at=?,result=? WHERE id=?").run(new Date().toISOString(),JSON.stringify(result),outId);
    return {...result,outboundId:outId,state:'accepted'};
  } catch(e) {
    tokens.delete(token);
    db.prepare("UPDATE outbound_messages SET state='unknown',error=? WHERE id=?").run(String(e.message).slice(0,300),outId);
    throw new Error('Saatmise tulemus vajab kontrolli; automaatset kordussaatmist ei tehta. '+e.message);
  }
}
