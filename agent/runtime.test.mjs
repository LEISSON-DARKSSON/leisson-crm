import test from 'node:test';
import {messageSelectionId} from '../lib/mail-identity.mjs';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {migrateAgent,enqueue,claimNext,finishJob,messageVersion,fingerprint,runtimePause} from '../lib/agentdb.mjs';
import {prepareInput,applyOutput} from './runtime.mjs';
import {performJob} from './worker.mjs';
import {planConductor} from './conductor.mjs';
import {chatgptAuth,childEnvironment,parseEvents,classifyFailure,policyArgs,restrictedCatalog} from './codex-runner.mjs';
const CRM=dirname(dirname(fileURLToPath(import.meta.url)));
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'leisson-runtime-test-')),path=join(dir,'test.sqlite'),db=new DatabaseSync(path);
 db.exec(`PRAGMA busy_timeout=5000;
  CREATE TABLE messages(mailbox TEXT,uid INTEGER,account TEXT DEFAULT 'gert',msgid TEXT,ts TEXT,direction TEXT DEFAULT 'in',
   addr TEXT,addr_name TEXT,subject TEXT,body_text TEXT,company_id TEXT,archived INTEGER DEFAULT 0,
   deleted TEXT,replied INTEGER DEFAULT 0,PRIMARY KEY(mailbox,uid));
  CREATE TABLE companies(id TEXT PRIMARY KEY,name TEXT,email TEXT,next_step TEXT,status TEXT,sales_state TEXT DEFAULT 'unqualified',need_evidence TEXT);
  CREATE TABLE suppressions(addr TEXT PRIMARY KEY,domain TEXT,reason TEXT);
  CREATE TABLE activity(company_id TEXT,kind TEXT);
  CREATE TABLE meta(k TEXT PRIMARY KEY,v TEXT);`);
 migrateAgent(db);
 db.prepare("INSERT INTO companies(id,name,email,next_step,status) VALUES('c1','Example','buyer@example.test',NULL,'kiri')").run();
 db.prepare(`INSERT INTO messages(mailbox,uid,account,msgid,ts,addr,subject,body_text,company_id,category,classified,reply_intent)
  VALUES ('INBOX',1,'gert','m1',?,'buyer@example.test','Veeb','Soovin pakkumist veebilehele.','c1','paring',1,'positive')`).run(new Date().toISOString());
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 return {db,dir,path};
}
function drafted(db) {
 const id=enqueue(db,'draft',{message_id:'INBOX:1'}),job=claimNext(db),input=prepareInput(db,job);
 applyOutput(db,job,input,{message_id:'INBOX:1',subject:'Re: Veeb',body:'Tere! Teenuse hind on 590 eurot. Kas materjalid on olemas?',lang:'et',confidence:0.9,blocker:null});
 return {id,job,draft:db.prepare('SELECT * FROM drafts').get()};
}
test('dedupe and independent processes claim exactly once',async t=>{
 const {db,path}=fixture(t);const id=enqueue(db,'draft',{message_id:'INBOX:1'});
 assert.equal(enqueue(db,'draft',{message_id:'INBOX:1'}),id);
 const module=pathToFileURL(join(CRM,'lib','agentdb.mjs')).href;
 const code=`import{DatabaseSync}from'node:sqlite';import{claimNext}from ${JSON.stringify(module)};const d=new DatabaseSync(process.argv[1]);d.exec('PRAGMA busy_timeout=5000');const j=claimNext(d);console.log(JSON.stringify(j?.id??null));d.close();`;
 const launch=()=>new Promise((r,j)=>{let out='';const p=spawn(process.execPath,['--input-type=module','-e',code,path],{windowsHide:true,shell:false});p.stdout.on('data',d=>out+=d);p.on('error',j);p.on('close',c=>c===0?r(JSON.parse(out)):j(Error('claim child failed')));});
 const results=await Promise.all([launch(),launch()]);
 assert.deepEqual(results.sort(),[id,null].sort());
});
test('expired lease cannot apply and dependent failure does not run',t=>{
 const {db}=fixture(t);const id=enqueue(db,'draft',{message_id:'INBOX:1'}),job=claimNext(db);
 db.prepare("UPDATE agent_jobs SET lease_until='2000-01-01T00:00:00Z' WHERE id=?").run(id);
 const dependent=enqueue(db,'edit',{message_id:'INBOX:1',draft_revision:1},null,{dependsOn:id});
 assert.equal(claimNext(db),null);
 assert.equal(db.prepare('SELECT status FROM agent_jobs WHERE id=?').get(dependent).status,'needs_human');
 assert.throws(()=>finishJob(db,id,'tehtud',null,job.lease_owner),/lease/);
});
test('draft commit creates immutable revision and edit only after success',t=>{
 const {db}=fixture(t);const {draft,id}=drafted(db);
 const edit=claimNext(db);assert.equal(edit.type,'edit');assert.equal(edit.depends_on,id);
 assert.equal(edit.payload.draft_revision,1);assert.equal(draft.content_hash,fingerprint([draft.subject,draft.body]));
 const input=prepareInput(db,edit);
 applyOutput(db,edit,input,{message_id:'INBOX:1',draft_revision:1,subject:draft.subject,body:draft.body,changed:0,notes:'Parandusi ei olnud.',blocker:null});
 assert.equal(db.prepare('SELECT status FROM drafts').get().status,'ootab_kinnitust');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_draft_versions').get().n,2);
});
test('stale edited revision and protected price changes fail without writing',t=>{
 const {db}=fixture(t);const {draft}=drafted(db);const edit=claimNext(db),input=prepareInput(db,edit);
 const result={message_id:'INBOX:1',draft_revision:1,subject:draft.subject,body:draft.body.replace('590','290'),changed:1,notes:'price',blocker:null};
 assert.throws(()=>applyOutput(db,edit,input,result),/protected_fact/);
 db.prepare('UPDATE drafts SET body=? WHERE id=?').run('Hand edited',draft.id);
 assert.throws(()=>applyOutput(db,edit,input,{...result,body:draft.body}),/revision_changed/);
 assert.equal(db.prepare('SELECT body FROM drafts').get().body,'Hand edited');
});
test('new refusal while model is running blocks all draft writes',t=>{
 const {db}=fixture(t);enqueue(db,'draft',{message_id:'INBOX:1'});const job=claimNext(db),input=prepareInput(db,job);
 db.prepare("UPDATE messages SET body_text='Ei soovi teie teenust.'").run();
 assert.throws(()=>applyOutput(db,job,input,{message_id:'INBOX:1',subject:'Reply',body:'Offer',lang:'et',confidence:1,blocker:null}),/source_changed/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM drafts').get().n,0);
});
test('triage exact scope, refusal override and missing body review',t=>{
 const {db}=fixture(t);db.prepare("UPDATE messages SET classified=0,body_text='Ei soovi teie teenust.'").run();
 enqueue(db,'triage',{message_ids:['INBOX:1']});const job=claimNext(db),input=prepareInput(db,job);
 const item={message_id:'INBOX:1',category:'vastus_pakkumisele',urgency:'madal',reply_intent:'positive',confidence:0.9,suspicious:false,suggest_archive:false,summary:'Keeldub teenusest.'};
 assert.throws(()=>applyOutput(db,job,input,{items:[{...item,message_id:'INBOX:2'}]}),/out_of_scope/);
 applyOutput(db,job,input,{items:[item]});
 assert.equal(db.prepare('SELECT reply_intent FROM messages').get().reply_intent,'declined');
 db.prepare("UPDATE messages SET classified=0,body_text=NULL").run();
 enqueue(db,'triage',{message_ids:['INBOX:1'],source_versions:['new']});const j=claimNext(db),i=prepareInput(db,j);
 applyOutput(db,j,i,{items:[{...item,reply_intent:'unknown',confidence:1,suggest_archive:true}]});
 const m=db.prepare('SELECT * FROM messages').get();assert.equal(m.review,1);assert.equal(m.suggest_archive,0);assert.equal(m.confidence,0.5);
});
test('quota pauses without fallback or immediate requeue',async t=>{
 const {db}=fixture(t);enqueue(db,'draft',{message_id:'INBOX:1'});const job=claimNext(db);let calls=0;
 const r=await performJob(db,job,{runner:async()=>{calls++;throw Error('quota_exhausted');}});
 assert.equal(calls,1);assert.equal(r.error,'quota_exhausted');assert.equal(runtimePause(db),'quota_exhausted');
 assert.equal(claimNext(db),null);
 const run=db.prepare('SELECT * FROM agent_runs').get();assert.equal(run.total_cost_usd,null);assert.equal(run.provider,'codex-chatgpt');
});
test('schema hallucination and tool events cannot be accepted',t=>{
 const {db}=fixture(t);enqueue(db,'draft',{message_id:'INBOX:1'});const job=claimNext(db),input=prepareInput(db,job);
 assert.throws(()=>applyOutput(db,job,input,{message_id:'INBOX:1',subject:'a',body:'b',lang:'et',confidence:1,blocker:null,send:true}),/schema_extra/);
 assert.throws(()=>parseEvents(JSON.stringify({type:'item.started',item:{type:'command_execution'}})),/capability_violation/);
 assert.throws(()=>parseEvents('{"type":"turn.started"}'),/incomplete_model_output/);
 assert.equal(classifyFailure('usage limit reached'),'quota_exhausted');
});
test('auth and environment exclude API/SMTP and every action capability',()=>{
 assert.throws(()=>chatgptAuth({auth_mode:'apikey',OPENAI_API_KEY:'secret'}),/chatgpt_auth_required/);
 const auth=chatgptAuth({auth_mode:'chatgpt',OPENAI_API_KEY:'secret',tokens:{access_token:'a',refresh_token:'r'}});
 assert.equal(auth.OPENAI_API_KEY,undefined);
 const env=childEnvironment('C:/fixture',{PATH:'node',SMTP_PASS:'secret',OPENAI_API_KEY:'secret',CODEX_API_KEY:'secret',HTTPS_PROXY:'secret'});
 assert.equal(env.SMTP_PASS,undefined);assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.CODEX_API_KEY,undefined);assert.equal(env.HTTPS_PROXY,undefined);
 assert.ok(policyArgs().includes('forced_login_method="chatgpt"'));
 const c=restrictedCatalog({models:['gpt-5.6-luna','gpt-5.6-sol'].map(slug=>({slug,tool_mode:'code_mode_only',multi_agent_version:'v2'}))});
 assert.equal(c.models[0].tool_mode,null);assert.equal(c.models[0].multi_agent_version,null);assert.equal(c.models[0].apply_patch_tool_type,null);
});
test('conductor dry and worker status preserve database and create no artifacts',t=>{
 const {db,path,dir}=fixture(t);
 const before=readFileSync(path),files=readdirSync(dir);
 const env={...process.env,CRM_DB_PATH:path};
 for(const [script,arg] of [['conductor.mjs','--dry'],['worker.mjs','--status'],['worker.mjs','--dry']]) {
   const result=spawnSync(process.execPath,[join(CRM,'agent',script),arg],{env,encoding:'utf8',windowsHide:true,shell:false});
   assert.equal(result.status,0,result.stderr);assert.deepEqual(readFileSync(path),before);
 }
 assert.deepEqual(readdirSync(dir),files);assert.equal(planConductor(db).jobs.length,1);
});
test('MCP write environment cannot expose mutation tools',t=>{
 const {path}=fixture(t);
 const request=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n';
 const r=spawnSync(process.execPath,[join(CRM,'agent','mcp-server.mjs')],{env:{...process.env,CRM_DB_PATH:path,CRM_AGENT_MODE:'write'},input:request,encoding:'utf8',windowsHide:true,shell:false});
 assert.equal(r.status,0,r.stderr);
 const tools=JSON.parse(r.stdout).result.tools.map(t=>t.name);
 assert.ok(!tools.includes('save_draft'));assert.ok(!tools.includes('request_send_approval'));assert.ok(!tools.some(t=>/send|write|edit|classify/.test(t)));
});

test('automatic triage skips old or invalid dates and keeps recent exact IDs',t=>{
 const {db}=fixture(t);db.prepare('UPDATE messages SET classified=0').run();
 const add=db.prepare("INSERT INTO messages(mailbox,uid,ts,addr,subject,body_text,classified) VALUES('INBOX',?,?,?,'Question','Palun vastake',0)");
 add.run(2,'2000-01-01T00:00:00Z','old@example.test');add.run(3,'invalid','unknown@example.test');
 const plan=planConductor(db);assert.equal(plan.counts.unclassified,1);
 assert.deepEqual(plan.jobs[0].payload.message_ids,[messageSelectionId(db.prepare('SELECT * FROM messages WHERE uid=1').get())]);assert.equal(plan.skipped.length,2);
 assert.equal(db.prepare('SELECT classified FROM messages WHERE uid=2').get().classified,0);
});
test('daily draft cap counts already created drafts across conductor runs',t=>{
 const {db}=fixture(t);
 const ins=db.prepare("INSERT INTO drafts(account,uid,subject,body,status,created) VALUES('gert',?,'s','b','mustand',?)");
 for(let n=50;n<53;n++)ins.run(n,new Date().toISOString());
 const plan=planConductor(db);assert.equal(plan.counts.draftCandidates,1);
 assert.equal(plan.counts.remainingDrafts,0);assert.equal(plan.jobs.filter(j=>j.type==='draft').length,0);
});
test('manual triage accepts an explicit archived-era message ID without implicit bulk selection',t=>{
 const {db,path}=fixture(t);db.prepare("UPDATE messages SET classified=0,ts='2000-01-01T00:00:00Z'").run();
 const r=spawnSync(process.execPath,[join(CRM,'agent','worker.mjs'),'--enqueue=triage','--message=INBOX:1'],{env:{...process.env,CRM_DB_PATH:path},encoding:'utf8',windowsHide:true,shell:false});
 assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(db.prepare('SELECT payload FROM agent_jobs').get().payload).message_ids,[messageSelectionId(db.prepare('SELECT * FROM messages WHERE uid=1').get())]);
});

test('newer company refusal and suppression block prepared drafts before commit',t=>{
 const {db}=fixture(t);enqueue(db,'draft',{message_id:'INBOX:1'});const job=claimNext(db),input=prepareInput(db,job);
 db.prepare("INSERT INTO messages(mailbox,uid,account,ts,addr,subject,body_text,company_id,category,classified) VALUES('INBOX',2,'gert',?,'buyer@example.test','Re: Veeb','Ei soovi teie teenust.','c1','vastus_pakkumisele',1)").run(new Date(Date.now()+60000).toISOString());
 assert.throws(()=>applyOutput(db,job,input,{message_id:'INBOX:1',subject:'Reply',body:'Offer',lang:'et',confidence:1,blocker:null}),/newer_human_reply_exists/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM drafts').get().n,0);
 db.prepare('DELETE FROM messages WHERE uid=2').run();
 db.prepare("INSERT INTO suppressions VALUES('buyer@example.test',NULL,'unsubscribe')").run();
 assert.throws(()=>prepareInput(db,job),/recipient_suppressed/);
 db.prepare('DELETE FROM suppressions').run();db.prepare("UPDATE companies SET sales_state='not_now'").run();
 assert.throws(()=>prepareInput(db,job),/company_sales_paused/);
});
test('ambiguous triage cannot erase an existing negative intent',t=>{
 const {db}=fixture(t);db.prepare("UPDATE messages SET classified=0,body_text='Tänan kirja eest.',reply_intent='declined'").run();
 enqueue(db,'triage',{message_ids:['INBOX:1']});const job=claimNext(db),input=prepareInput(db,job);
 applyOutput(db,job,input,{items:[{message_id:'INBOX:1',category:'vastus_pakkumisele',urgency:'madal',reply_intent:'positive',confidence:0.9,suspicious:false,suggest_archive:false,summary:'Tänab.'}]});
 assert.equal(db.prepare('SELECT reply_intent FROM messages').get().reply_intent,'declined');
});
test('manual bulk allowance subtracts actual drafts already created today',async t=>{
 const {bulkGate,limits}=await import('../lib/gates.mjs');const {db}=fixture(t);
 db.exec("ALTER TABLE messages ADD COLUMN identity_status TEXT DEFAULT 'current';ALTER TABLE messages ADD COLUMN auto_response INTEGER DEFAULT 0");
 const ins=db.prepare("INSERT INTO drafts(account,uid,subject,body,status,created) VALUES('gert',?,'s','b','mustand',?)");
 for(let n=0;n<limits().maxDrafts;n++)ins.run(200+n,new Date().toISOString());
 const result=bulkGate(db,'mustand',['INBOX:1']);assert.equal(result.passN,0);assert.equal(result.limits.remainingDrafts,0);
});
