import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {open} from '../lib/db.mjs';
import {migrateAgent,enqueue,claimNext} from '../lib/agentdb.mjs';
import {migrateSales} from '../lib/salesdb.mjs';
import {migrateMailRecords,saveMailRecord} from '../lib/mail-records.mjs';
import {MAIL_SOURCE_SCOPE_REASON} from '../lib/mail-source-scope.mjs';
import {bulkGate} from '../lib/gates.mjs';
import {planConductor,applyPlan} from '../agent/conductor.mjs';
import {prepareInput} from '../agent/runtime.mjs';
import {performJob} from '../agent/worker.mjs';

const dir=mkdtempSync(join(tmpdir(),'leisson-mail-source-')),path=join(dir,'fixture.sqlite'),db=open({dbPath:path});
const CRM=dirname(dirname(fileURLToPath(import.meta.url)));
try {
 migrateAgent(db);migrateSales(db);migrateMailRecords(db);
 const record={mailbox:'INBOX',uidvalidity:'100',direction:'in',ts:new Date().toISOString(),subject:'Inquiry',body_text:'Soovin pakkumist.'};
 const allowed=saveMailRecord(db,{...record,account:'gert',uid:1,msgid:'1@example.test',addr:'newbuyer@gmail.com'});
 const denied=saveMailRecord(db,{...record,account:'private-account',uid:2,msgid:'2@example.test',addr:'other@example.test',body_text:'UNAUTHORIZED_FIXTURE_BODY'});
 const yes='source:'+allowed.source_id,no='source:'+denied.source_id;
 const plan=planConductor(db);
 assert.deepEqual(plan.jobs.flatMap(j=>j.payload.message_ids||[]),[yes]);
 assert.equal(bulkGate(db,'triaaz',[yes]).passN,1,'sender using Gmail is not a Gmail source account');
 for(const task of ['triaaz','mustand','kehad','loetuks','arhiveeri','grupeeri','summuta','kustuta']){
  const gate=bulkGate(db,task,[no]);assert.equal(gate.passN,0,task);assert.equal(gate.skip[0].why,MAIL_SOURCE_SCOPE_REASON);
 }
 assert.throws(()=>applyPlan(db,{prefilter:[{message_id:no,account:'private-account',mailbox:'INBOX',uid:2,category:'uudiskiri',kindlus:1,miks:'test'}],jobs:[]}),/ainult gert@leisson.eu/);
 assert.equal(db.prepare('SELECT classified FROM messages WHERE uid=2').get().classified,0);
 assert.throws(()=>applyPlan(db,{prefilter:[],jobs:[{type:'triage',payload:{message_ids:[no]}}]}),/ainult gert@leisson.eu/);
 for(const [type,payload] of [
  ['triage',{message_ids:[no]}],['triage',{message_ids:['INBOX:2']}],
  ['draft',{message_id:no}],['edit',{message_id:no,draft_id:1,draft_revision:1}],
 ]){
  enqueue(db,type,payload);const job=claimNext(db);let called=0;
  const result=await performJob(db,job,{runner:async()=>{called++;throw Error('unexpected model');}});
  assert.equal(called,0);assert.equal(result.error,MAIL_SOURCE_SCOPE_REASON);
 }
 const oldFallback=prepareInput(db,{type:'triage',payload:{limit:10}});
 assert.equal(oldFallback.messages.length,1);assert.equal(oldFallback.messages[0].account,'gert');
 assert.ok(!JSON.stringify(oldFallback).includes('UNAUTHORIZED_FIXTURE_BODY'));
 const before=db.prepare('SELECT COUNT(*) n FROM agent_jobs').get().n;
 const cli=spawnSync(process.execPath,[join(CRM,'agent/worker.mjs'),'--enqueue=triage','--message='+no],{
  env:{...process.env,CRM_DB_PATH:path},encoding:'utf8',windowsHide:true,shell:false,
 });
 assert.notEqual(cli.status,0);assert.match(cli.stderr,/ainult gert@leisson.eu/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_jobs').get().n,before);
 enqueue(db,'triage',{message_ids:[yes]});const job=claimNext(db);let calls=0;
 const result=await performJob(db,job,{runner:async({prompt})=>{
  calls++;assert.ok(!prompt.includes('UNAUTHORIZED_FIXTURE_BODY'));
  return {data:{items:[{message_id:yes,category:'paring',urgency:'keskmine',reply_intent:'positive',confidence:0.9,suspicious:false,suggest_archive:false,summary:'Soovib pakkumist.'}]}};
 }});
 assert.equal(calls,1);assert.equal(result.ok,true);
 assert.equal(db.prepare('SELECT classified FROM messages WHERE uid=1').get().classified,1);
 assert.equal(db.prepare('SELECT classified FROM messages WHERE uid=2').get().classified,0);
 console.log('PASS mail source scope: only gert mailbox selected, explicit/legacy/manual queued jobs fail before model, plan injection fails, other-account bodies never enter prompts, inbound Gmail sender remains allowed.');
} finally {
 db.close();rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
