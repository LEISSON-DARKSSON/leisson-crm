import assert from 'node:assert/strict';
import {open} from '../lib/db.mjs';
import {migrateSales} from '../lib/salesdb.mjs';
import {migrateOutbound,consumeDispatchAuthorization} from '../lib/outbound.mjs';
import {prepareCampaign,approveCampaign,campaignView,campaignEvidence,nextApprovedCampaign,runCampaignOnce,migrateCampaigns} from '../lib/campaign.mjs';

const now=new Date(2026,8,16,10,0);
const accounts=[{id:'gert',user:'gert@leisson.eu'}];
const limits={perDay:40,perRun:5,perHour:8,minGapMin:7,hourFrom:9,hourTo:17,lists:['parnu']};
const options={accountId:'gert',accounts,composeText:b=>b+'\n\nGert Leisson · gert@leisson.eu',
  composeHtml:b=>'<p>'+b+'</p><p>Gert Leisson · gert@leisson.eu</p>',now};
const makeDb=()=>{
  const db=open({dbPath:':memory:'});migrateSales(db);migrateOutbound(db);migrateCampaigns(db);
  db.prepare("INSERT INTO companies(id,name,email,status,subject,body,need_evidence,listid,sales_state,updated) VALUES('a','Firma A','office@firm-a.example','ootel','Teie veeb','Tere! Üks kontrollitud leid.','Konkreetne vajaduse küsimus','parnu','research',?)").run(now.toISOString());
  db.prepare("INSERT INTO companies(id,name,email,status,subject,body,need_evidence,listid,sales_state,updated) VALUES('b','Firma B','info@firm-b.example','ootel','Teie veeb','Tere! Teine kontrollitud leid.','Konkreetne vajaduse küsimus','parnu','research',?)").run(now.toISOString());
  return db;
};
const sendCalls=[];
const send=async e=>{
  consumeDispatchAuthorization(e.authorization);sendCalls.push(e);
  return {from:'gert@leisson.eu',accepted:[e.to],rejected:[],messageId:e.messageId};
};

{
 const db=makeDb();
 assert.throws(()=>prepareCampaign(db,['a','a'],options),/eri ettevõtet/);
 const prepared=prepareCampaign(db,['a','b'],options),id=prepared.campaign.id;
 assert.equal(nextApprovedCampaign(db),null,'sweep cannot select an unapproved campaign');
 assert.equal(prepareCampaign(db,['a','b'],options).campaign.id,id,'same manifest does not duplicate a campaign');
 assert.equal(prepared.campaign.status,'prepared');
 assert.equal(prepared.items.length,2);
 assert(prepared.items.every(i=>i.snapshot.sender==='gert@leisson.eu'&&i.snapshot.text.includes('Gert Leisson')&&i.snapshot.body.includes('loobun')));
 assert.deepEqual(await runCampaignOnce(db,id,{...options,limits,send}),{status:'waiting',reason:'Kampaania ei ole kinnitatud'});
 assert.equal(sendCalls.length,0);
 assert.throws(()=>approveCampaign(db,id,'wrong'),/räsi/);
 assert.equal(campaignView(db,id).campaign.status,'prepared');
 approveCampaign(db,id,prepared.campaign.snapshot_hash,{now});
 assert.equal(nextApprovedCampaign(db),id);
 assert.equal(campaignView(db,id).campaign.approved_by,'local-crm-operator');
 assert.throws(()=>approveCampaign(db,id,prepared.campaign.snapshot_hash,{now}),/pole kinnitamiseks valmis/);
 const [first,second]=await Promise.all([runCampaignOnce(db,id,{...options,limits,send}),runCampaignOnce(db,id,{...options,limits,send})]);
 assert.equal(first.status,'accepted');assert.notEqual(second.status,'accepted');assert.equal(sendCalls.length,1);
 assert.equal(sendCalls[0].preparedText,prepared.items[0].snapshot.text);
 assert.equal(campaignView(db,id).items[0].status,'accepted');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM outbound_messages').get().n,1);
 assert.equal(db.prepare("SELECT approved_by FROM outbound_previews WHERE approved_by='local-crm-approved-campaign'").get().approved_by,'local-crm-approved-campaign');
 assert.equal((await runCampaignOnce(db,id,{...options,now:new Date(2026,8,16,10,8),limits,send})).status,'accepted');
 assert.equal(sendCalls.length,2);
 assert.equal(nextApprovedCampaign(db),null,'completed campaign is not swept again');
 const evidence=campaignEvidence(db,id);
 assert.equal(evidence.accepted,2);assert.equal(evidence.humanReplies,0);
 assert.equal(evidence.postSendPayments,0);assert.equal(evidence.activeCampaignChanged,false);
 assert.equal(evidence.newVersionRequiresApproval,true);
 db.close();
}
{
 const db=makeDb(),p=prepareCampaign(db,['a'],options);
 db.prepare("UPDATE sales_campaign_items SET company_id='b' WHERE campaign_id=?").run(p.campaign.id);
 assert.throws(()=>approveCampaign(db,p.campaign.id,p.campaign.snapshot_hash,{now}),/loend on muutunud/);
 db.close();
}
{
 const db=makeDb(),p=prepareCampaign(db,['a'],options);approveCampaign(db,p.campaign.id,p.campaign.snapshot_hash,{now});
 db.prepare("UPDATE companies SET body='Muudetud kiri' WHERE id='a'").run();
 const result=await runCampaignOnce(db,p.campaign.id,{...options,limits,send});
 assert.equal(result.status,'blocked');assert.equal(sendCalls.length,2);
 db.close();
}
{
 const db=makeDb(),p=prepareCampaign(db,['a'],options);approveCampaign(db,p.campaign.id,p.campaign.snapshot_hash,{now});
 db.prepare("INSERT INTO messages(mailbox,uid,account,direction,addr,company_id,ts,body_text,subject) VALUES('INBOX',7,'gert','in','office@firm-a.example','a',?,'Soovime pakkumist','Vastus')").run(now.toISOString());
 const result=await runCampaignOnce(db,p.campaign.id,{...options,limits,send});
 assert.equal(result.status,'blocked','any fresh human response invalidates approved copy');
 assert.equal(sendCalls.length,2);db.close();
}
{
 const db=makeDb(),p=prepareCampaign(db,['a'],options);approveCampaign(db,p.campaign.id,p.campaign.snapshot_hash,{now});
 db.prepare("INSERT INTO suppressions(addr,domain,reason,ts) VALUES('office@firm-a.example','firm-a.example','loobumine',?)").run(now.toISOString());
 const result=await runCampaignOnce(db,p.campaign.id,{...options,limits,send});
 assert.notEqual(result.status,'accepted');assert.equal(sendCalls.length,2);db.close();
}
{
 const db=makeDb(),p=prepareCampaign(db,['a'],options);approveCampaign(db,p.campaign.id,p.campaign.snapshot_hash,{now});
 const result=await runCampaignOnce(db,p.campaign.id,{...options,limits,send:async()=>{throw Error('SMTP response lost')}});
 assert.equal(result.status,'unknown');
 assert.equal(campaignView(db,p.campaign.id).items[0].status,'unknown');
 assert.equal((await runCampaignOnce(db,p.campaign.id,{...options,limits,send})).status,'empty');
 assert.equal(sendCalls.length,2);db.close();
}
{
 const db=makeDb();
 for(let i=0;i<6;i++)db.prepare("INSERT INTO companies(id,name,email,status,subject,body,need_evidence,listid,sales_state,priority,updated) VALUES(?,?,'other@other.example','ootel','Other','Body','Reason','parnu','research','A',?)")
   .run('ahead'+i,'A '+i,now.toISOString());
 const p=prepareCampaign(db,['b'],options);approveCampaign(db,p.campaign.id,p.campaign.snapshot_hash,{now});
 assert.equal((await runCampaignOnce(db,p.campaign.id,{...options,limits,send})).status,'accepted','approved recipient is not starved by unrelated queue order');
 db.close();
}
{
 const db=makeDb(),a=prepareCampaign(db,['a'],options),b=prepareCampaign(db,['b'],options);
 approveCampaign(db,a.campaign.id,a.campaign.snapshot_hash,{now});
 approveCampaign(db,b.campaign.id,b.campaign.snapshot_hash,{now});
 let release;
 const pending=runCampaignOnce(db,a.campaign.id,{...options,limits,send:async e=>{
   consumeDispatchAuthorization(e.authorization);
   await new Promise(resolve=>{release=resolve});
   return {from:'gert@leisson.eu',accepted:[e.to],rejected:[],messageId:e.messageId};
 }});
 assert.equal(typeof release,'function');
 const competing=await runCampaignOnce(db,b.campaign.id,{...options,limits,send});
 assert.equal(competing.status,'waiting','another approved campaign cannot burst-send while first is claimed');
 release();assert.equal((await pending).status,'accepted');db.close();
}
console.log('PASS frozen campaign: exact recipients and signed copy, explicit approval, single claim, reply/suppression/change gates, uncertain SMTP no retry');
