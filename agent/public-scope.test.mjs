import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {runtimeLimits} from '../lib/runtime-limits.mjs';
const CRM=dirname(dirname(fileURLToPath(import.meta.url)));

test('non-secret runtime limits require no account config and reject invalid controls',()=>{
 assert.deepEqual(runtimeLimits({}),{maxDrafts:3,maxAgeDays:21,triageBatch:10,maxRunsDaily:24});
 assert.deepEqual(runtimeLimits({AGENT_MAX_DRAFTS:'0',AGENT_MAX_AGE_DAYS:'7',AGENT_TRIAGE_BATCH:'5',AGENT_MAX_RUNS_DAILY:'0'}),
  {maxDrafts:0,maxAgeDays:7,triageBatch:5,maxRunsDaily:0});
 assert.deepEqual(runtimeLimits({AGENT_MAX_DRAFTS:'Infinity',AGENT_MAX_AGE_DAYS:'-1',AGENT_TRIAGE_BATCH:'0',AGENT_MAX_RUNS_DAILY:'no'}),
  runtimeLimits({}));
});

test('read-only next-step tool returns current primary catalog without automatic upsell',()=>{
 const request=(id,args)=>JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:'next_step_offer',arguments:args}})+'\n';
 const r=spawnSync(process.execPath,[join(CRM,'agent','mcp-server.mjs')],{
  env:{...process.env,CRM_DB_PATH:join(tmpdir(),'never-needed-for-catalog.sqlite')},
  input:request(1,{saavutatud:99})+request(2,{service_id:'inquiry-repair'})+request(3,{service_id:'retired-package'}),
  encoding:'utf8',windowsHide:true,shell:false,
 });
 assert.equal(r.status,0,r.stderr);
 const data=r.stdout.trim().split('\n').map(line=>JSON.parse(JSON.parse(line).result.content[0].text));
 assert.equal(data[0].automatic_selection,false);assert.equal(data[0].selected,null);
 assert.deepEqual(data[0].services.map(s=>s.hind_eur),[290,590,1190]);
 assert.equal(data[1].selected.id,'inquiry-repair');assert.equal(data[1].requires_exact_recipient_and_text_approval,true);
 assert.equal(data[2].error,'tundmatu_esmane_teenus');
});

test('inspect separates subscription, historical known and missing API cost and suppresses raw stderr',t=>{
 const dir=mkdtempSync(join(tmpdir(),'leisson-inspect-test-')),path=join(dir,'fixture.sqlite');
 t.after(()=>rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
 const db=new DatabaseSync(path);
 db.exec('CREATE TABLE agent_runs(id INTEGER,job_id INTEGER,type TEXT,provider TEXT,model TEXT,effort TEXT,input_tokens INTEGER,output_tokens INTEGER,total_cost_usd REAL,duration_ms INTEGER,ok INTEGER,ts TEXT,error_code TEXT,stderr_tail TEXT)');
 const add=db.prepare('INSERT INTO agent_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 add.run(1,1,'triage','codex-chatgpt','gpt-5.6-luna','medium',100,20,null,1000,1,'2026-09-15T12:00:00Z',null,'PRIVATE_FIXTURE_STDERR');
 add.run(2,2,'draft',null,'historical-model',null,null,null,1.25,1000,1,'2026-09-14T12:00:00Z',null,null);
 add.run(3,3,'draft',null,null,null,null,null,null,null,0,'2026-09-13T12:00:00Z','fixture_failure','PRIVATE_FIXTURE_STDERR');
 db.close();
 const r=spawnSync(process.execPath,[join(CRM,'agent','inspect.mjs'),'--runs'],{env:{...process.env,CRM_DB_PATH:path},encoding:'utf8',windowsHide:true,shell:false});
 assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/ChatGPT tellimus/);assert.match(r.stdout,/gpt-5.6-luna.*medium.*100\/20/);
 assert.match(r.stdout,/ajalooline API-kulu teadmata/);assert.match(r.stdout,/Ajalooline teadaolev API-kulu: 1.2500 USD/);
 assert.match(r.stdout,/puuduva API-kuluga ajaloolisi kirjeid: 1/);
 assert.ok(!r.stdout.includes('PRIVATE_FIXTURE_STDERR'));
});
