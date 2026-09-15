import { createHash } from 'node:crypto';
import { importWebInquiry } from './web-inquiry.mjs';

export function migrateMailRecords(db) {
  db.exec("CREATE TABLE IF NOT EXISTS mail_records(source_id TEXT PRIMARY KEY,account TEXT NOT NULL,mailbox TEXT NOT NULL,uidvalidity TEXT NOT NULL,uid INTEGER NOT NULL,msgid TEXT,ts TEXT,direction TEXT,addr TEXT,addr_name TEXT,to_addr TEXT,subject TEXT,body_text TEXT,body_truncated INTEGER DEFAULT 0,unread INTEGER DEFAULT 0,company_id TEXT,fetched_at TEXT NOT NULL,UNIQUE(account,mailbox,uidvalidity,uid));CREATE TABLE IF NOT EXISTS mail_inventory(account TEXT NOT NULL,mailbox TEXT NOT NULL,uidvalidity TEXT NOT NULL,total INTEGER,read_count INTEGER,body_count INTEGER,oldest TEXT,newest TEXT,complete INTEGER NOT NULL DEFAULT 0,error TEXT,checked_at TEXT NOT NULL,PRIMARY KEY(account,mailbox))");
  for (const [table,column,type] of [['mail_records','identity_status',"TEXT NOT NULL DEFAULT 'current'"],['messages','body_truncated','INTEGER NOT NULL DEFAULT 0']]) {
    if (!db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name===column)) db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' '+type);
  }
}

export function sourceId({account,mailbox,uidvalidity,uid}) {
  if (!account || !mailbox || uidvalidity == null || !String(uidvalidity) || !Number.isSafeInteger(Number(uid)) || Number(uid)<=0) throw new Error('invalid_mail_identity');
  return createHash('sha256').update(JSON.stringify([account,mailbox,String(uidvalidity),Number(uid)])).digest('hex');
}

function bodyVersion(old, incoming) {
  if (incoming.body_text == null || (incoming.body_text === '' && old?.body_text)) return {body_text:old?.body_text ?? null,body_truncated:old?.body_truncated ? 1:0};
  if (old?.body_text != null && incoming.body_truncated && (!old.body_truncated || old.body_text.length >= incoming.body_text.length)) {
    return {body_text:old.body_text,body_truncated:old.body_truncated ? 1:0};
  }
  return {body_text:incoming.body_text,body_truncated:incoming.body_truncated ? 1:0};
}

export function saveMailRecord(db, record) {
  const r={...record,uidvalidity:String(record.uidvalidity),source_id:sourceId(record),fetched_at:record.fetched_at || new Date().toISOString()};
  const canonical=db.prepare('SELECT * FROM mail_records WHERE source_id=?').get(r.source_id);
  const changedIdentity=canonical?.msgid && r.msgid && canonical.msgid!==r.msgid;
  const canonicalBody=changedIdentity ? bodyVersion(canonical,{}) : bodyVersion(canonical,r);
  const identity=changedIdentity || canonical?.identity_status==='conflict' ? 'conflict':'current';
  db.prepare('INSERT INTO mail_records(source_id,account,mailbox,uidvalidity,uid,msgid,ts,direction,addr,addr_name,to_addr,subject,body_text,body_truncated,unread,company_id,fetched_at,identity_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET body_text=excluded.body_text,body_truncated=excluded.body_truncated,unread=excluded.unread,fetched_at=excluded.fetched_at,identity_status=excluded.identity_status')
    .run(r.source_id,r.account,r.mailbox,r.uidvalidity,r.uid,r.msgid || null,r.ts || null,r.direction,r.addr || null,r.addr_name || null,r.to_addr || null,r.subject || null,canonicalBody.body_text,canonicalBody.body_truncated,r.unread || 0,r.company_id || null,r.fetched_at,identity);
  const webInquiry = () => r.direction === 'in' && identity !== 'conflict'
    ? importWebInquiry(db,{...db.prepare('SELECT * FROM mail_records WHERE source_id=?').get(r.source_id),reply_to:r.reply_to}) : null;
  if(r.mailbox !== 'INBOX') return {source_id:r.source_id,mirror:false,conflict:identity==='conflict',web_inquiry:webInquiry()};
  const old=db.prepare("SELECT * FROM messages WHERE mailbox='INBOX' AND uid=?").get(r.uid);
  const collisions=db.prepare("SELECT COUNT(*) n FROM mail_records WHERE mailbox='INBOX' AND uid=?").get(r.uid).n;
  // The legacy inbox mirror has a narrower key. Only explicit identity repair
  // may clear quarantine; replaying either account cannot resolve a collision.
  if(identity==='conflict' || collisions>1 || old?.identity_status==='conflict'
    || (old && (old.account!==r.account || (old.uidvalidity && old.uidvalidity!==r.uidvalidity) || (old.msgid && r.msgid && old.msgid!==r.msgid)))) {
    db.prepare("UPDATE messages SET identity_status='conflict' WHERE mailbox='INBOX' AND uid=?").run(r.uid);
    db.prepare("UPDATE mail_records SET identity_status='conflict' WHERE mailbox='INBOX' AND uid=?").run(r.uid);
    return {source_id:r.source_id,mirror:false,conflict:true};
  }
  const body=bodyVersion(old,canonicalBody);
  const ins=db.prepare("INSERT INTO messages(account,mailbox,uid,msgid,ts,direction,addr,addr_name,to_addr,subject,company_id,unread,body_text,body_truncated,body_fetched,source_id,uidvalidity,identity_status) VALUES(?,'INBOX',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'current') ON CONFLICT(mailbox,uid) DO UPDATE SET source_id=excluded.source_id,uidvalidity=excluded.uidvalidity,unread=excluded.unread,body_text=excluded.body_text,body_truncated=excluded.body_truncated,body_fetched=COALESCE(excluded.body_fetched,messages.body_fetched),company_id=COALESCE(messages.company_id,excluded.company_id),identity_status=CASE WHEN messages.identity_status='legacy' THEN 'current' ELSE messages.identity_status END");
  ins.run(r.account,r.uid,r.msgid || null,r.ts || null,r.direction,r.addr || null,r.addr_name || null,r.to_addr || null,r.subject || null,r.company_id || null,r.unread || 0,body.body_text,body.body_truncated,body.body_text == null ? null:r.fetched_at,r.source_id,r.uidvalidity);
  return {source_id:r.source_id,mirror:true,fresh:!old,web_inquiry:webInquiry()};
}
