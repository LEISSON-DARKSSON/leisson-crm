import assert from 'node:assert/strict';
import {open} from '../lib/db.mjs';
import {migrateAgent} from '../lib/agentdb.mjs';
import {migrateSales,createOffer,createInvoice,recordPayment,deleteDoc,revenueSummary} from '../lib/salesdb.mjs';
import {migrateOutbound,previewOutbound,dispatchOutbound,consumeDispatchAuthorization,envelopeHash} from '../lib/outbound.mjs';
import {migrateMailRecords,saveMailRecord} from '../lib/mail-records.mjs';
import {reconcileSalesReplies,replyDecision,latestHumanReply} from '../lib/sales-safety.mjs';
import {extraRoutes} from '../lib/routes2.mjs';
import {parseContact,contactMail} from '@leisson/shared/contact-data';
import {requireCurrentMessage,resolveMessageSelection} from '../lib/mail-identity.mjs';

const now=new Date('2026-09-15T12:00:00Z');
const accounts=[{id:'gert',user:'gert@leisson.eu'},{id:'info',user:'info@leisson.eu'}];
const options={accounts,now,composeText:b=>b,composeHtml:b=>'<p>'+b+'</p>'};
const input={kind:'sales',companyId:'a',accountId:'gert',to:'owner@example.ee',subject:'Scope',body:'One agreed page'};
function fixture(){
  const db=open({dbPath:':memory:'});migrateAgent(db);migrateSales(db);migrateOutbound(db);migrateMailRecords(db);
  db.prepare("INSERT INTO companies(id,name,email,status,price,sales_state,need_evidence,updated) VALUES('a','Buyer A','owner@example.ee','ootel',590,'qualified','Client asked for one page','manual-stamp')").run();
  return db;
}
function mail(db,uid,body,extra={}){
  return saveMailRecord(db,{account:'gert',mailbox:'INBOX',uidvalidity:'100',uid,msgid:'<'+uid+'@example.ee>',ts:new Date(+now-(100-uid)*1000).toISOString(),direction:'in',addr:'owner@example.ee',subject:'Re: Scope',body_text:body,company_id:'a',...extra});
}
function offer(db){const o=createOffer(db,{company_id:'a',serviceId:'landing-page'});db.prepare("UPDATE offers SET state='kinnitatud' WHERE id=?").run(o.id);return o;}
let checks=0;
async function check(name,fn){const db=fixture();try{await fn(db);checks++;console.log('PASS '+name);}finally{db.close();}}

await check('only configured gert sender can preview or dispatch',async db=>{
  assert.throws(()=>previewOutbound(db,{...input,accountId:'info'},options),/gert@leisson.eu/);
  assert.throws(()=>previewOutbound(db,input,{...options,accounts:undefined}),/gert@leisson.eu/);
  const p=previewOutbound(db,input,options);let sent=0;
  await assert.rejects(dispatchOutbound(db,p.approvalId,input,async()=>{sent++;},{now,accounts:[{id:'gert',user:'info@leisson.eu'}]}),/gert@leisson.eu/);
  assert.equal(sent,0);assert.equal(p.sender,'gert@leisson.eu');
});
await check('unexpected SMTP sender produces unknown state and no retry',async db=>{
  const p=previewOutbound(db,input,options);let sent=0;
  const smtp=async e=>{consumeDispatchAuthorization(e.authorization);sent++;return {accepted:[e.to],rejected:[],from:'info@leisson.eu'};};
  await assert.rejects(dispatchOutbound(db,p.approvalId,input,smtp,{now,accounts}),/gert@leisson.eu/);
  assert.equal(db.prepare('SELECT state FROM outbound_messages').get().state,'unknown');
  await assert.rejects(dispatchOutbound(db,p.approvalId,input,smtp,{now,accounts}),/juba kasutatud/);assert.equal(sent,1);
});
await check('manual reply preview and historical approval reject another source account',async db=>{
  mail(db,1,'Soovime pakkumist.',{account:'info'});
  const reply={...input,kind:'reply',companyId:undefined,account:'info',accountId:'gert',uid:1};
  assert.throws(()=>previewOutbound(db,reply,options),/ainult gert@leisson.eu/);
  assert.throws(()=>previewOutbound(db,{...reply,uid:999},options),/Kirja ei leitud/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM outbound_previews').get().n,0);
  // A synthetic approval from the former policy must fail at dispatch too.
  const envelope={kind:'reply',companyId:'a',accountId:'gert',sourceAccount:'info',uid:1,
    to:input.to,subject:input.subject,body:input.body,sender:'gert@leisson.eu',text:input.body,html:'<p>'+input.body+'</p>'};
  db.prepare('INSERT INTO outbound_previews(id,kind,company_id,account,uid,envelope,content_hash,source_hash,created,expires) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('legacy-info-reply','reply','a','gert',1,JSON.stringify(envelope),envelopeHash(envelope),'legacy-source',now.toISOString(),new Date(+now+60000).toISOString());
  let calls=0;
  await assert.rejects(dispatchOutbound(db,'legacy-info-reply',reply,async()=>{calls++;throw Error('must not send');},{now,accounts}),/ainult gert@leisson.eu/);
  assert.equal(calls,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM outbound_messages').get().n,0);
});
await check('authorized gert reply retains original message threading',async db=>{
  mail(db,1,'Soovime pakkumist.');
  const reply={...input,kind:'reply',companyId:undefined,account:'gert',accountId:'gert',uid:1};
  const p=previewOutbound(db,reply,options);assert.equal(p.sourceAccount,'gert');
  await dispatchOutbound(db,p.approvalId,reply,async e=>{
    consumeDispatchAuthorization(e.authorization);assert.equal(e.accountId,'gert');assert.equal(e.inReplyTo,'<1@example.ee>');
    return {accepted:[e.to],rejected:[],from:'gert@leisson.eu'};
  },{now,accounts});
});
await check('reply derives company and cannot bypass newer refusal by omitting it',db=>{
  mail(db,1,'Soovime pakkumist.');
  const reply={...input,kind:'reply',companyId:undefined,uid:1};
  assert.equal(previewOutbound(db,reply,options).companyId,'a');
  mail(db,2,'Ei soovi teie teenust kasutada.');
  assert.throws(()=>previewOutbound(db,reply,options),/viimane inimvastus/);
  assert.throws(()=>previewOutbound(db,input,options),/peatab/);
  db.prepare("UPDATE companies SET sales_state='declined' WHERE id='a'").run();
  assert.throws(()=>previewOutbound(db,reply,options),/peatatud/);
});
await check('balance waits for actual full deposit payment',db=>{
  const o=offer(db), d=createInvoice(db,{offer_id:o.id,kind:'deposit'});
  assert.throws(()=>createInvoice(db,{offer_id:o.id,kind:'balance'}),/täielikult tasutud/);
  recordPayment(db,{invoice_id:d.id,amount:100,reference:'partial'});
  assert.throws(()=>createInvoice(db,{offer_id:o.id,kind:'balance'}),/täielikult tasutud/);
  recordPayment(db,{invoice_id:d.id,amount:195,reference:'rest'});
  const b=createInvoice(db,{offer_id:o.id,kind:'balance'});assert.equal(b.payable,295);assert.equal(b.prepaid,295);
});
await check('explicit unpaid-deposit void permits full balance without imaginary credit',db=>{
  const o=offer(db),d=createInvoice(db,{offer_id:o.id,kind:'deposit'});
  db.prepare("UPDATE invoices SET state='tuhistatud' WHERE id=?").run(d.id);
  const b=createInvoice(db,{offer_id:o.id,kind:'balance'});assert.equal(b.payable,590);assert.equal(b.prepaid,0);
  assert.throws(()=>createInvoice(db,{offer_id:o.id,kind:'deposit'}),/Lõpparve/);
});
await check('payments cannot exceed offer cash total even with legacy overlapping invoices',db=>{
  const o=offer(db),d=createInvoice(db,{offer_id:o.id,kind:'deposit'});
  recordPayment(db,{invoice_id:d.id,amount:295,reference:'deposit'});
  const b=createInvoice(db,{offer_id:o.id,kind:'balance'});
  db.prepare('UPDATE invoices SET total=590,prepaid=0,payable=590 WHERE id=?').run(b.id);
  assert.throws(()=>recordPayment(db,{invoice_id:b.id,amount:500,reference:'overlap'}),/pakkumise kogusummat/);
  assert.equal(db.prepare('SELECT SUM(amount) n FROM payments').get().n,295);
  assert.throws(()=>deleteDoc(db,'pakkumine',o.id),/seos peab säilima/);
});
await check('free buyer invoice retains immutable offer ownership',db=>{
  const a={name:'Free Buyer A',reg:'12345',email:'a@example.ee',addr:'A street'};
  const o=createOffer(db,{buyer:a,price:590,title:'One page'});db.prepare("UPDATE offers SET state='kinnitatud' WHERE id=?").run(o.id);
  for(const buyer of [{name:'Free Buyer B'},{reg:'99999'},{email:'b@example.ee'}]) assert.throws(()=>createInvoice(db,{offer_id:o.id,buyer,price:590,kind:'deposit'}),/teisele ostjale/);
  const d=createInvoice(db,{offer_id:o.id,kind:'deposit'});
  const inv=db.prepare('SELECT * FROM invoices WHERE id=?').get(d.id);assert.equal(inv.buyer_name,a.name);assert.equal(inv.buyer_email,a.email);assert.equal(inv.company_id,null);
});
await check('paid unsent invoice deletion returns explicit accounting error',db=>{
  const d=createInvoice(db,{buyer:{name:'One-time buyer'},price:100});recordPayment(db,{invoice_id:d.id,amount:20,reference:'cash'});
  assert.throws(()=>deleteDoc(db,'arve',d.id),e=>!(e instanceof TypeError)&&/Laekumisega arvet/.test(e.message));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,1);
});
await check('full mail survives truncation and missing-body refresh in both stores',db=>{
  mail(db,1,'Complete original text');mail(db,1,'Complete',{body_truncated:1});mail(db,1,null,{body_truncated:1});
  for(const table of ['messages','mail_records']) {const row=db.prepare('SELECT body_text,body_truncated FROM '+table).get();assert.equal(row.body_text,'Complete original text');assert.equal(row.body_truncated,0);}
});
await check('full refresh clears truncated flag and permits fresh decision',db=>{
  mail(db,1,'Soovime',{body_truncated:1});assert.equal(replyDecision(db.prepare('SELECT * FROM messages').get(),{now}).allowed,false);
  mail(db,1,'Soovime pakkumist.',{body_truncated:0});
  for(const table of ['messages','mail_records'])assert.equal(db.prepare('SELECT body_truncated FROM '+table).get().body_truncated,0);
  assert.equal(replyDecision(db.prepare('SELECT * FROM messages').get(),{now}).allowed,true);
});
await check('account collision remains quarantined after either account syncs again',db=>{
  mail(db,1,'First');mail(db,1,'Other account',{account:'other',msgid:'<other@example.ee>'});
  assert.equal(mail(db,1,'First').conflict,true);assert.equal(mail(db,1,'Other account',{account:'other',msgid:'<other@example.ee>'}).conflict,true);
  assert.equal(db.prepare('SELECT identity_status FROM messages').get().identity_status,'conflict');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mail_records WHERE identity_status='conflict'").get().n,2);
});
await check('UIDVALIDITY rollover and changed Message-ID never replace original mirror',db=>{
  mail(db,1,'Original');assert.equal(mail(db,1,'Changed',{uidvalidity:'101'}).conflict,true);
  mail(db,2,'Original second');assert.equal(mail(db,2,'Injected replacement',{msgid:'<different@example.ee>'}).conflict,true);
  assert.equal(db.prepare('SELECT body_text FROM messages WHERE uid=2').get().body_text,'Original second');
  assert.equal(db.prepare('SELECT body_text FROM mail_records WHERE uid=2').get().body_text,'Original second');
});
await check('IMAP operation guard requires current source, account and UIDVALIDITY without mutation',db=>{
  const saved=mail(db,1,'Original');
  assert.equal(requireCurrentMessage(db,'gert',1,'100').source_id,saved.source_id);
  const before=db.prepare('SELECT * FROM messages').get();
  for (const [account,uid,validity] of [['other',1,'100'],['gert',1,'101'],['gert',2,'100']]) assert.throws(()=>requireCurrentMessage(db,account,uid,validity),/identiteet/);
  assert.deepEqual(db.prepare('SELECT * FROM messages').get(),before);
  mail(db,1,'Another account',{account:'other'});assert.throws(()=>requireCurrentMessage(db,'gert',1,'100'),/identiteet/);
  db.prepare("UPDATE messages SET identity_status='current',source_id=NULL WHERE uid=1").run();assert.throws(()=>requireCurrentMessage(db,'gert',1,'100'),/identiteet/);
});
await check('mail sync imports one unqualified web inquiry using canonical source identity',db=>{
  const form=new FormData();for(const [key,value] of Object.entries({name:'Form Buyer',email:'buyer@example.ee',company:'Form Company',message:'Please improve the contact form.',service_id:'inquiry-repair',lang:'et',inquiry_id:'4f4b44b5-0479-45db-8bf5-10331451ddee'}))form.set(key,value);
  const parsed=parseContact(form);assert.equal(parsed.ok,true);const body=contactMail(parsed.data).text;
  const first=mail(db,5,body,{company_id:null,reply_to:'buyer@example.ee'});assert.equal(first.web_inquiry.imported,true);
  mail(db,5,body,{company_id:null});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM web_inquiries').get().n,1);
  assert.equal(db.prepare('SELECT mail_source_id FROM web_inquiry_messages').get().mail_source_id,first.source_id);
  const inquiry=db.prepare('SELECT qualified,approved_for_send,status FROM web_inquiries').get();assert.equal(inquiry.qualified,0);assert.equal(inquiry.approved_for_send,0);assert.equal(inquiry.status,'needs_review');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM companies').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_jobs').get().n,0);
});
await check('new positive reply resumes old decline and replay preserves manual qualification',db=>{
  mail(db,1,'Ei soovi teie teenust kasutada.');reconcileSalesReplies(db,{now,apply:true});
  assert.equal(db.prepare("SELECT sales_state FROM companies WHERE id='a'").get().sales_state,'declined');
  mail(db,2,'Soovime pakkumist.');reconcileSalesReplies(db,{now,apply:true});
  assert.equal(db.prepare("SELECT sales_state FROM companies WHERE id='a'").get().sales_state,'inquiry');
  db.prepare("UPDATE companies SET sales_state='qualified',next_step='Manual delivery scope',updated='manual-new' WHERE id='a'").run();
  const before=db.prepare('SELECT * FROM companies').get();reconcileSalesReplies(db,{now:new Date(+now+60000),apply:true});assert.deepEqual(db.prepare('SELECT * FROM companies').get(),before);
});
await check('delivery stage survives new refusal while actual outbound stops',db=>{
  mail(db,1,'Soovime pakkumist.');reconcileSalesReplies(db,{now,apply:true});
  db.prepare("UPDATE companies SET sales_state='in_delivery',next_step='Deliver agreed work',updated='manual-delivery'").run();
  mail(db,2,'Ei soovi teie teenust kasutada.');reconcileSalesReplies(db,{now,apply:true});
  assert.equal(db.prepare('SELECT sales_state FROM companies').get().sales_state,'in_delivery');assert.throws(()=>previewOutbound(db,input,options),/peatab/);
});
await check('unknown heuristic preserves reviewed refusal and automatic reply is not authoritative',db=>{
  mail(db,1,'Our internal position remains unchanged.');db.prepare("UPDATE messages SET reply_intent='declined' WHERE uid=1").run();
  mail(db,2,'Thank you for contacting us.',{subject:'Auto: Re: Scope'});reconcileSalesReplies(db,{now,apply:true});
  mail(db,3,'Our September newsletter.',{subject:'September news',addr:'newsletter@example.ee'});reconcileSalesReplies(db,{now,apply:true});
  assert.equal(db.prepare('SELECT reply_intent FROM messages WHERE uid=1').get().reply_intent,'declined');
  assert.equal(latestHumanReply(db,'a').uid,1);assert.equal(db.prepare('SELECT sales_state FROM companies').get().sales_state,'declined');
});
await check('manual triage batches contain exact selected IDs and distinct request identity',async db=>{
  for(let uid=1;uid<=13;uid++)mail(db,uid,'Please classify');
  const ids=Array.from({length:11},(_,i)=>'INBOX:'+(i+2));let result;
  const routes=extraRoutes(db,{}, {readBody:async()=>({task:'triaaz',ids}),json:(_res,status,data)=>{assert.equal(status,200);result=data;},mail:{}});
  await routes['POST /api/bulk/run']({},{});assert.equal(result.jobs.length,2);
  const first=db.prepare('SELECT payload FROM agent_jobs ORDER BY id').all().map(r=>JSON.parse(r.payload));
  assert.deepEqual(first.flatMap(x=>x.message_ids).map(id=>{const m=resolveMessageSelection(db,id);assert.equal(m.account,'gert');return m.mailbox+':'+m.uid;}),ids);assert.equal(new Set(first.map(x=>x.request_id)).size,1);assert.match(first[0].request_id,/^[a-f0-9-]{36}$/);
  await routes['POST /api/bulk/run']({},{});const all=db.prepare('SELECT payload FROM agent_jobs ORDER BY id').all().map(r=>JSON.parse(r.payload));
  assert.equal(all.length,4);assert.notEqual(all[0].request_id,all[2].request_id);assert.ok(all.every(x=>!x.message_ids.map(id=>resolveMessageSelection(db,id).uid).includes(1)&&!x.message_ids.map(id=>resolveMessageSelection(db,id).uid).includes(13)));
});
await check('awaiting replies counts only recent actionable business humans, never old tags or self-tests',db=>{
  const add=(uid,extra={})=>mail(db,uid,'Soovime pakkumist.',{company_id:null,...extra});
  add(1);add(2,{ts:'2026-03-01T12:00:00Z'});add(3,{subject:'Auto: Re: Scope'});
  add(4,{addr:'gert@leisson.eu'});add(5,{addr:'synthetic@gmail.com'});add(6,{subject:'Vormitest'});
  add(7,{body_text:'Contact form\nE-mail: gert@leisson.eu\nSoovime pakkumist.'});
  add(8);add(9);add(10,{ts:'2026-09-16T12:00:00Z'});add(11,{body_text:null});add(12,{body_truncated:1});add(13);
  add(14,{addr:'blocked@example.ee'});
  add(15,{company_id:'a'});add(16,{company_id:'a',body_text:'Ei soovi teie teenust kasutada.'});
  db.prepare("UPDATE messages SET category='paring',reply_intent='positive',classified=1").run();
  db.prepare('UPDATE messages SET category=NULL WHERE uid=8').run();db.prepare("UPDATE messages SET category='uudiskiri' WHERE uid=9").run();
  db.prepare('UPDATE messages SET review=1 WHERE uid=13').run();
  db.prepare("INSERT INTO suppressions(addr,reason,ts) VALUES('blocked@example.ee','No contact',?)").run(now.toISOString());
  const summary=revenueSummary(db,{now,ownAddresses:['synthetic@gmail.com']});assert.equal(summary.awaitingReply,1);assert.equal(summary.awaitingReplyDefinition.confirmedBuyers,false);assert.equal(summary.awaitingReplyLabel,'Vastamist vajavad kirjad');
  assert.equal(revenueSummary(db,{now:new Date(+now+23*86400000)}).awaitingReply,0);
});
console.log('PASS '+checks+' state invariants; isolated SQLite and fake SMTP only.');
