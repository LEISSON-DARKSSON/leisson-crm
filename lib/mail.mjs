import { requireCurrentMessage } from './mail-identity.mjs';
// IMAP lugemine ja opereerimine (imapflow) + SMTP saatmine (nodemailer). Zone.eu serverid.
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { consumeDispatchAuthorization } from './outbound.mjs';
import { migrateMailRecords, saveMailRecord } from './mail-records.mjs';
import { simpleParser } from 'mailparser';
import { loadEnv, account } from './env.mjs';
import { buildSignature } from './signature.mjs';
import { LOOBUMISRIDA } from './sendgate.mjs';
import { logActivity } from './db.mjs';

const cfg = () => loadEnv();

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function textToHtml(body) {
  const { tokens: T } = buildSignature();
  return String(body).trim().split(/\n{2,}/).map((p) => {
    const inner = esc(p).replace(/\n/g, '<br>');
    return `<p style="margin:0 0 14px 0;font-family:${T.body};font-size:15px;line-height:1.55;letter-spacing:0.01em;color:${T.ink};">${inner}</p>`;
  }).join('\n');
}

// Kui keha kannab lisaLoobumisrida()-ga lisatud loobumisrida (ESS 103-1 opt-out +
// saatja tuvastus), lahutame selle pohisonumist, et allkiri (buildSignature())
// saaks tulla LOOBUMISRIDA ETTE, mitte selle taha. Ilma selleta nagi kiri kaks
// jarjestikust "loppu": loobumisrida (mis ISE kordab "LEISSON OU * 16952932",
// sest ESS-i varav nouab, et opt-out rida oleks omaette tuvastatav) ja kohe
// jarel paris allkiri (mis kordab sama ettevotte identiteeti uuesti). Tavaparane
// turundusklirja tava on: isiklik allkiri LOPUKS, vaike vastavuse/loobumise
// jalus KOIGE all - mitte kaks "loppu" jarjest. Sisu ei kao kummastki kohast,
// ainult jarjekord muutub. Kui loobumisrida puudub (vastused, muu kirjavahetus),
// kaitub funktsioon tapselt nagu enne.
function splitLoobumisrida(body) {
  const raw = String(body ?? '');
  if (raw.endsWith(LOOBUMISRIDA)) {
    return { main: raw.slice(0, raw.length - LOOBUMISRIDA.length).trim(), tail: LOOBUMISRIDA };
  }
  return { main: raw.trim(), tail: null };
}

export function composeHtml(body, sigOpts = {}) {
  const { html: sig, tokens: T } = buildSignature(sigOpts);
  const { main, tail } = splitLoobumisrida(body);
  const tailBlock = tail
    ? `<div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>${textToHtml(tail)}`
    : '';
  return `<!doctype html><html lang="et"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${T.canvas};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;background:${T.canvas};">
<tr><td style="padding:0 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:560px;">
<tr><td style="padding:8px 0 0 0;">
${textToHtml(main)}
<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>
${sig}
${tailBlock}
</td></tr></table>
</td></tr></table>
</body></html>`;
}

export function composeText(body, sigOpts = {}) {
  const { text: sig } = buildSignature(sigOpts);
  const { main, tail } = splitLoobumisrida(body);
  return tail ? `${main}\n\n${sig}\n\n${tail}\n` : `${main}\n\n${sig}\n`;
}

/* ---------------- SMTP ---------------- */

function smtp(acc) {
  const t = nodemailer.createTransport({
    host: acc.smtpHost,
    port: acc.smtpPort,
    secure: acc.smtpPort === 465,
    requireTLS: acc.smtpPort !== 465,
    auth: { user: acc.user, pass: acc.pass },
  });
  return t;
}

export async function verifySmtp(accId) {
  const acc = account(cfg(), accId);
  await smtp(acc).verify();
  return acc.user;
}

export async function sendMail({ accountId, to, subject, body, cc, inReplyTo, references, authorization, messageId, preparedText, preparedHtml }) {
  consumeDispatchAuthorization(authorization);
  const acc = account(cfg(), accountId);
  if(String(acc.user).toLowerCase() !== 'gert@leisson.eu') throw new Error('Kõik müügikirjad saadetakse aadressilt gert@leisson.eu');
  const headers = { 'X-Mailer': 'Leisson CRM (Orbit)' };
  const raw = await new MailComposer({
    from: { name: acc.name, address: acc.user },
    to,
    cc: cc || undefined,
    replyTo: acc.user,
    subject,
    messageId,
    text: preparedText || composeText(body),
    html: preparedHtml || composeHtml(body),
    inReplyTo: inReplyTo || undefined,
    references: references || (inReplyTo ? [inReplyTo] : undefined),
    headers,
  }).compile().build();
  const info = await smtp(acc).sendMail({ envelope: { from:acc.user, to:[to] }, raw });
  let sentCopy;
  try { sentCopy = await appendToSent(acc.id, raw); } catch { sentCopy={ok:false,reason:'Sent-koopia vajab kontrolli; SMTP-d ei korrata'}; }
  return { messageId: messageId || info.messageId, accepted: info.accepted, rejected: info.rejected, from: acc.user, sentCopy };
}

/* ---------------- IMAP ---------------- */

async function client(acc) {
  const c = new ImapFlow({
    host: acc.imapHost,
    port: acc.imapPort,
    secure: true,
    auth: { user: acc.user, pass: acc.pass },
    logger: false,
    socketTimeout: 45000,
  });
  await c.connect();
  return c;
}

export async function verifyImap(accId) {
  const acc = account(cfg(), accId);
  const c = await client(acc);
  const boxes = await c.list();
  await c.logout().catch(() => {});
  return boxes.map((b) => b.path);
}

async function findBox(c, kinds, names) {
  const boxes = await c.list();
  for (const k of kinds) {
    const hit = boxes.find((b) => (b.specialUse || '') === k);
    if (hit) return hit.path;
  }
  const re = new RegExp(`(^|\\.)(${names.join('|')})( items)?$`, 'i');
  const hit = boxes.find((b) => re.test(b.path));
  return hit ? hit.path : null;
}

export function matchCompany(db, addr) {
  if (!addr) return null;
  const lower = addr.toLowerCase();
  const exact = db.prepare('SELECT id FROM companies WHERE LOWER(email) = ?').get(lower);
  if (exact) return exact.id;
  const domain = lower.split('@')[1];
  if (!domain) return null;
  if (['gmail.com','hotmail.com','outlook.com','yahoo.com','mail.ee','online.ee','icloud.com'].includes(domain)) return null;
  const candidates = db.prepare('SELECT id FROM companies WHERE lower(email) LIKE ?').all('%@' + domain);
  const byDomain = candidates.length === 1 ? candidates[0] : null;
  if (byDomain) return byDomain.id;
  const bare = domain.replace(/^www\./, '');
  const matches = db.prepare('SELECT id,url FROM companies WHERE url IS NOT NULL').all().filter(row => { try { return new URL(row.url).hostname.replace(/^www\./,'')===bare; } catch { return false; } });
  return matches.length===1 ? matches[0].id : null;
}

/** Read-only IMAP fetch; source retrieval uses BODY.PEEK and never sets Seen. */
export async function syncMailbox(db, accId, mailbox = 'INBOX', {limit = 150, bodies = false} = {}) {
  migrateMailRecords(db);
  const acc=account(cfg(),accId), c=await client(acc);
  let seen=0,matched=0,fresh=0,bodyCount=0,oldest=null,newest=null;
  try {
    const lock=await c.getMailboxLock(mailbox, {readOnly:true});
    try {
      const total=c.mailbox.exists, validity=String(c.mailbox.uidValidity);
      const start=limit===null ? 1:Math.max(1,total-limit+1);
      const isSent=/sent|saadetud/i.test(mailbox);
      if(total) for await (const msg of c.fetch(start+':*', {envelope:true,flags:true,uid:true,source:bodies})) {
        const env=msg.envelope || {}, sender=env.from?.[0] || {}, recipient=env.to?.[0] || {};
        const direction=isSent || String(sender.address || '').toLowerCase()===acc.user.toLowerCase() ? 'out':'in';
        const person=direction==='out'?recipient:sender;
        const addr=String(person.address || '').toLowerCase(), cid=matchCompany(db,addr);
        const ts=env.date ? new Date(env.date).toISOString():null;
        let text=null,replyTo=null;
        if(bodies && msg.source) { const parsed=await simpleParser(msg.source);text=await toText(parsed,true);replyTo=parsed.replyTo?.value?.[0]?.address;bodyCount++; }
        const result=saveMailRecord(db,{account:acc.id,mailbox,uidvalidity:validity,uid:msg.uid,msgid:env.messageId,ts,direction,addr,addr_name:person.name,to_addr:recipient.address,subject:env.subject,reply_to:replyTo,company_id:cid,unread:msg.flags?.has('\\Seen') ? 0:1,body_text:text,body_truncated:text?.length>=250000});
        seen++; if(cid)matched++; if(result.fresh)fresh++;
        if(ts){oldest=!oldest || ts<oldest?ts:oldest;newest=!newest || ts>newest?ts:newest;}
      }
      db.prepare('INSERT INTO mail_inventory(account,mailbox,uidvalidity,total,read_count,body_count,oldest,newest,complete,error,checked_at) VALUES(?,?,?,?,?,?,?,?,?,NULL,?) ON CONFLICT(account,mailbox) DO UPDATE SET uidvalidity=excluded.uidvalidity,total=excluded.total,read_count=excluded.read_count,body_count=excluded.body_count,oldest=excluded.oldest,newest=excluded.newest,complete=excluded.complete,error=NULL,checked_at=excluded.checked_at')
        .run(acc.id,mailbox,validity,total,seen,bodyCount,oldest,newest,seen===total && (!bodies || bodyCount===seen)?1:0,new Date().toISOString());
      if(mailbox==='INBOX') for(const key of ['last_sync_'+acc.id,'last_sync']) db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(key,new Date().toISOString());
      return {account:acc.id,mailbox,total,seen,matched,fresh,bodyCount,oldest,newest,complete:seen===total};
    } finally { lock.release(); }
  } finally { await c.logout().catch(()=>{}); }
}
export function syncInbox(db, accId, options={}) { return syncMailbox(db,accId,'INBOX',options); }

export async function inventoryMail(db, {includeBodies=true,onProgress}={}) {
  const results=[];
  for(const acc of cfg().accounts) {
    let boxes;
    try {boxes=await verifyImap(acc.id);} catch(e) {results.push({account:acc.id,error:'Postkasti kaustu ei saanud lugeda'});continue;}
    for(const mailbox of boxes) {
      try {results.push(await syncMailbox(db,acc.id,mailbox,{limit:null,bodies:includeBodies}));}
      catch(e) {results.push({account:acc.id,mailbox,error:String(e.message).slice(0,180)});}
      onProgress?.(results[results.length-1]);
    }
  }
  return results;
}

export async function syncAll(db, opts) {
  const out = [];
  for (const a of cfg().accounts) {
    try {
      out.push(await syncInbox(db, a.id, opts));
    } catch (e) {
      out.push({ account: a.id, error: String(e.message).slice(0, 160) });
    }
  }
  return out;
}

/** Loeb ühe kirja sisu ja salvestab teksti vahemällu. */
/** Parsitud kirjast loetav tekst + manuste nimed. */
async function toText(content, alreadyParsed = false) {
  const parsed = alreadyParsed ? content : await simpleParser(content);
  let text = parsed.text || '';
  if (!text && parsed.html) {
    text = String(parsed.html)
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  text = text.slice(0, 250000);
  const atts = (parsed.attachments || []).map((a) => `${a.filename || 'manus'} (${Math.round((a.size || 0) / 1024)} kB)`);
  if (atts.length) text += `\n\n— Manused: ${atts.join(', ')}`;
  return text;
}

export async function fetchBody(db, accId, uid) {
  const row = db.prepare("SELECT * FROM messages WHERE account=? AND mailbox='INBOX' AND uid=?").get(accId, uid);
  if (!row || row.identity_status !== 'current' || !row.source_id) throw new Error('Kirja identiteet vajab ülevaatust');
  if (row.body_text && !row.body_truncated) return {text:row.body_text,cached:true};
  const out=await fetchBodies(db,accId,[uid]);
  if(out.vead.length) throw new Error(out.vead[0].error);
  return {text:db.prepare("SELECT body_text FROM messages WHERE source_id=?").get(row.source_id)?.body_text,cached:false};
}

export async function fetchBodies(db, accId, uids, {onProgress}={}) {
  const todo=[...new Set(uids.map(Number))].filter(Boolean);
  const out={ok:0,vahele:0,vead:[]};
  if(!todo.length) return out;
  const c=await client(account(cfg(),accId));
  try {
    const lock=await c.getMailboxLock('INBOX',{readOnly:true});
    try {
      for(const uid of todo){
        try{
          const row=requireCurrentMessage(db,accId,uid,c.mailbox.uidValidity);
          if(row.body_text && !row.body_truncated){out.vahele++;continue;}
          const dl=await c.download(String(uid),undefined,{uid:true});
          if(!dl?.content) throw new Error('Kirja ei leitud postkastist');
          const parsed=await simpleParser(dl.content); const text=await toText(parsed,true),stamp=new Date().toISOString();
          requireCurrentMessage(db,accId,uid,c.mailbox.uidValidity);
          const original=db.prepare('SELECT * FROM mail_records WHERE source_id=?').get(row.source_id);
          if(!original) throw new Error('Canonical mail missing');
          saveMailRecord(db,{...original,body_text:text,body_truncated:Number(text.length>=250000),reply_to:parsed.replyTo?.value?.[0]?.address,fetched_at:stamp});
          out.ok++;
        }catch(e){out.vead.push({uid,error:e.message});}
        onProgress?.(out);
      }
    }finally{lock.release();}
  }finally{await c.logout().catch(()=>{});}
  return out;
}

export async function markSeen(db, accId, uid, seen = true) {
  const acc = account(cfg(), accId);
  const c = await client(acc);
  try {
    const lock = await c.getMailboxLock('INBOX');
    try {
      requireCurrentMessage(db,accId,uid,c.mailbox.uidValidity);
      if (seen) await c.messageFlagsAdd({ uid: String(uid) }, ['\\Seen'], { uid: true });
      else await c.messageFlagsRemove({ uid: String(uid) }, ['\\Seen'], { uid: true });
      db.prepare('UPDATE messages SET unread = ? WHERE account = ? AND uid = ?').run(seen ? 0 : 1, accId, uid);
      return { ok: true };
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => {});
  }
}

export async function archive(db, accId, uid) {
  const acc = account(cfg(), accId);
  const c = await client(acc);
  try {
    const box = await findBox(c, ['\\Archive'], ['archive', 'arhiiv']);
    const lock = await c.getMailboxLock('INBOX');
    try {
      requireCurrentMessage(db,accId,uid,c.mailbox.uidValidity);
      await c.messageFlagsAdd({ uid: String(uid) }, ['\\Seen'], { uid: true });
      if (box) {
        await c.messageMove({ uid: String(uid) }, box, { uid: true });
      }
      db.prepare('UPDATE messages SET archived = 1, unread = 0 WHERE account = ? AND uid = ?').run(accId, uid);
      return { ok: true, box: box || null, moved: !!box };
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => {});
  }
}

export async function appendToSent(accId, raw) {
  const acc = account(cfg(), accId);
  const c = await client(acc);
  try {
    const box = await findBox(c, ['\\Sent'], ['sent', 'saadetud']);
    if (!box) return { ok: false, reason: 'Sent-kausta ei leitud' };
    await c.append(box, raw, ['\\Seen']);
    return { ok: true, box };
  } finally {
    await c.logout().catch(() => {});
  }
}

// Mustand Drafts-kausta. EI SAADA: ainult IMAP APPEND lipuga \Draft.
// Inimene avab Zone webmaili/Outlooki mustandi ja vajutab ise "Saada".
// Idempotentne: sama Message-ID-ga mustand olemas -> ei lisa teist korda.
export async function appendToDrafts(accId, raw, messageId) {
  const acc = account(cfg(), accId);
  if (String(acc.user).toLowerCase() !== 'gert@leisson.eu') throw new Error('Mustandid ainult gert@leisson.eu kasti');
  const c = await client(acc);
  try {
    const box = await findBox(c, ['\\Drafts'], ['drafts', 'mustandid', 'draft']);
    if (!box) return { ok: false, reason: 'Drafts-kausta ei leitud' };
    if (messageId) {
      const lock = await c.getMailboxLock(box);
      try {
        const hits = await c.search({ header: { 'message-id': messageId } }, { uid: true });
        if (hits && hits.length) return { ok: true, box, skipped: true, reason: 'sama Message-ID juba mustandites' };
      } finally { lock.release(); }
    }
    await c.append(box, raw, ['\\Draft']);
    return { ok: true, box, skipped: false };
  } finally {
    await c.logout().catch(() => {});
  }
}
