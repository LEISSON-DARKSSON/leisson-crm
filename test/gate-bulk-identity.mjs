import assert from 'node:assert/strict';
import {open} from '../lib/db.mjs';
import {migrateAgent,enqueue,claimNext} from '../lib/agentdb.mjs';
import {migrateSales} from '../lib/salesdb.mjs';
import {migrateMailRecords,saveMailRecord} from '../lib/mail-records.mjs';
import {messageSelectionId,resolveMessageSelection} from '../lib/mail-identity.mjs';
import {bulkGate,TASKS} from '../lib/gates.mjs';
import {extraRoutes} from '../lib/routes2.mjs';
import {planConductor} from '../agent/conductor.mjs';
import {prepareInput} from '../agent/runtime.mjs';
import {performJob} from '../agent/worker.mjs';

function fixture(){
 const db=open({dbPath:':memory:'});migrateAgent(db);migrateSales(db);migrateMailRecords(db);
 return db;
}
const add=(db,account,uid)=>saveMailRecord(db,{
 account,mailbox:'INBOX',uid,uidvalidity:'100',msgid:account+'-'+uid+'@example.test',
 direction:'in',ts:new Date().toISOString(),addr:account+'@example.test',subject:'Inquiry',body_text:'Soovime pakkumist.',
});
const invoke=async(db,task,ids,mail={})=>{
 let result;await extraRoutes(db,{},{
  json:(_,status,body)=>result={status,body},readBody:async()=>({task,ids,confirm:true}),mail,
 })['POST /api/bulk/run']({},{});return result;
};
const snapshot=db=>Object.fromEntries(['messages','agent_jobs','message_groups','suppressions'].map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));

{
 const db=fixture();const first=add(db,'one',42),second=add(db,'two',42);
 assert.equal(db.prepare("SELECT identity_status FROM messages WHERE uid=42").get().identity_status,'conflict');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM mail_records WHERE uid=42').get().n,2);
 const ids=['INBOX:42','source:'+first.source_id,'source:'+second.source_id];
 const before=snapshot(db);
 const forbid=async()=>{throw Error('ambiguous IMAP operation attempted');};
 for(const task of Object.keys(TASKS)){
  const gate=bulkGate(db,task,ids);assert.equal(gate.passN,0,task);assert.equal(gate.skipN,3,task);
  const result=await invoke(db,task,ids,{fetchBodies:forbid,markSeen:forbid,archive:forbid});
  assert.equal(result.status,200);assert.equal(result.body.done,0,task);
 }
 assert.deepEqual(snapshot(db),before,'no ambiguous local update, group, suppression or job');
 assert.equal(planConductor(db).jobs.length,0);
 // A previously queued mailbox-only job must fail before any model call.
 enqueue(db,'triage',{message_ids:['INBOX:42']});const job=claimNext(db);let calls=0;
 const result=await performJob(db,job,{runner:async()=>{calls++;throw Error('should not run');}});
 assert.equal(calls,0);assert.match(result.error,/identity_ambiguous/);
 db.close();
}
{
 const db=fixture();add(db,'one',1);const second=add(db,'two',2);
 db.prepare('UPDATE messages SET classified=1,review=1').run();
 const id='source:'+second.source_id;
 const result=await invoke(db,'triaaz',[id]);
 assert.equal(result.body.done,1);
 assert.equal(db.prepare('SELECT classified FROM messages WHERE uid=1').get().classified,1);
 assert.equal(db.prepare('SELECT classified FROM messages WHERE uid=2').get().classified,0);
 const job=claimNext(db);assert.deepEqual(job.payload.message_ids,[id]);
 const input=prepareInput(db,job);assert.equal(input.messages[0].message_id,id);
 assert.equal(input.messages[0].account,'two');assert.equal(input.messages[0].source_id,second.source_id);
 assert.equal(resolveMessageSelection(db,id).account,'two');
 // Account reassignment after selection cannot silently redirect the request.
 db.prepare("UPDATE messages SET account='one' WHERE uid=2").run();
 assert.equal(bulkGate(db,'kustuta',[id]).passN,0);
 await invoke(db,'kustuta',[id]);assert.equal(db.prepare('SELECT deleted FROM messages WHERE uid=2').get().deleted,null);
 db.close();
}
{
 const db=fixture();
 db.prepare("INSERT INTO messages(account,mailbox,uid,ts,addr,body_text) VALUES('one','INBOX',7,?,'one@example.test','Legacy')").run(new Date().toISOString());
 const row=db.prepare('SELECT * FROM messages WHERE uid=7').get();
 const id=messageSelectionId(row);assert.ok(id.startsWith('legacy:'));
 assert.equal(resolveMessageSelection(db,id).account,'one');
 const wrong='legacy:'+encodeURIComponent(JSON.stringify(['two','INBOX',7]));
 assert.equal(bulkGate(db,'kustuta',[wrong]).passN,0);
 await invoke(db,'kustuta',[wrong]);assert.equal(db.prepare('SELECT deleted FROM messages WHERE uid=7').get().deleted,null);
 // Backward compatibility is retained only when the old ID is unambiguous.
 assert.equal(resolveMessageSelection(db,'INBOX:7').account,'one');
 db.close();
}
console.log('PASS bulk identity: two-account UID quarantine, every mutation blocked, exact source queue/runtime, stale account and explicit legacy guards.');
