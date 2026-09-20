import {assertMailSource,CRM_MAIL_SOURCE_ACCOUNT} from '../lib/mail-source-scope.mjs';
// One leased job per process turn. No SMTP/IMAP imports or Claude/API fallback.
import {messageSelectionId,resolveMessageSelection} from '../lib/mail-identity.mjs';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateAgent,enqueue,claimNext,finishJob,recordRun,runtimePause,pauseRuntime,resumeRuntime,RUNTIME_VERSION } from '../lib/agentdb.mjs';
import {prepareInput,promptFor,schemaFor,applyOutput} from './runtime.mjs';
import {runCodex,MODEL_BY_JOB,EFFORT} from './codex-runner.mjs';
import {runClaude,MODEL_BY_JOB as CLAUDE_MODEL_BY_JOB,EFFORT as CLAUDE_EFFORT,PROVIDER_ID as CLAUDE_PROVIDER_ID} from './claude-runner.mjs';
import {rawEnv} from '../lib/env.mjs';
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
// Parallel, flag-selected model provider (20.09.2026). Default stays 'codex' so
// unset AGENT_MODEL_PROVIDER preserves exact prior behaviour (agent/runtime.test.mjs
// asserts provider==='codex-chatgpt' when the caller passes no overrides at all).
const PROVIDERS={
 codex:{runner:runCodex,provider:'codex-chatgpt',model:MODEL_BY_JOB,effort:EFFORT},
 claude:{runner:runClaude,provider:CLAUDE_PROVIDER_ID,model:CLAUDE_MODEL_BY_JOB,effort:CLAUDE_EFFORT},
};
export function selectProvider(env=process.env) {
 // .env fallback mirrors lib/env.mjs's own AGENT_DAILY_USD/AGENT_MAX_DRAFTS pattern
 // (process env wins, then .env file, then default) - this is the single place every
 // caller funnels through (manual win\*.cmd, conductor.mjs's spawned --drain, the
 // Task Scheduler run), so setting AGENT_MODEL_PROVIDER in .env alone is enough to
 // switch every automated path, with no per-caller env wiring needed. Never logs or
 // surfaces any other .env content - reads exactly this one key.
 let fileValue;
 try{fileValue=rawEnv().AGENT_MODEL_PROVIDER;}catch{fileValue=undefined;}
 const key=env.AGENT_MODEL_PROVIDER||fileValue||'codex';
 const sel=PROVIDERS[key];
 if(!sel)throw new Error('unknown_model_provider:'+key);
 return sel;
}
function arg(name,fallback=null) {
 const i=process.argv.findIndex(x=>x==='--'+name||x.startsWith('--'+name+'='));
 if(i<0)return fallback;
 const a=process.argv[i];
 return a.includes('=')?a.slice(a.indexOf('=')+1):(process.argv[i+1]&&!process.argv[i+1].startsWith('--')?process.argv[i+1]:true);
}
export async function performJob(db,job,{runner=runCodex,provider='codex-chatgpt',model=MODEL_BY_JOB,effort=EFFORT}={}) {
 const t=Date.now();let result,error=null;
 try {
  const input=prepareInput(db,job);
  if(!input.messages.length){finishJob(db,job.id,'tehtud',null,job.lease_owner);return {skipped:true};}
  result=await runner({type:job.type,prompt:promptFor(input),schema:schemaFor(job.type)});
  applyOutput(db,job,input,result.data);
 } catch(e) {
  error=String(e.message).slice(0,160);
  // Never store raw model stderr/body/credentials in a shared run log.
  const pause=/quota_exhausted|auth_required|chatgpt_auth_required|policy_unverified/.test(error);
  if(pause)pauseRuntime(db,error);
  try{finishJob(db,job.id,pause?'paused':'needs_human',error,job.lease_owner);}catch{error='job_lease_lost';}
 } finally {
  recordRun(db,{job_id:job.id,type:job.type,model:model[job.type],provider,
   effort,runtime_version:RUNTIME_VERSION,exit_code:error?1:0,total_cost_usd:result?.total_cost_usd??null,
   input_tokens:result?.usage?.input_tokens,cached_input_tokens:result?.usage?.cached_input_tokens,
   output_tokens:result?.usage?.output_tokens,duration_ms:Date.now()-t,session_id:result?.session_id,
   ok:!error,error_code:error,stderr_tail:null});
 }
 return {ok:!error,error};
}
async function main() {
 const path=process.env.CRM_DB_PATH||join(ROOT,'data','crm.sqlite');
 if(!existsSync(path))throw new Error('CRM database missing: start CRM before worker');
 const readOnly=Boolean(arg('status')||arg('dry'));
 const db=new DatabaseSync(path,{readOnly});
 db.exec('PRAGMA busy_timeout=5000');
 const sel=selectProvider();
 try {
  if(readOnly) {
   const jobs=db.prepare('SELECT status,COUNT(*) n FROM agent_jobs GROUP BY status').all();
   console.log(JSON.stringify({readOnly:true,provider:sel.provider,jobs},null,2));return;
  }
  migrateAgent(db);
  if(arg('reset'))throw new Error('Bulk reset removed: use explicit reviewed message selection.');
  if(arg('resume')) {
   resumeRuntime(db);
   db.prepare("UPDATE agent_jobs SET status='ootel',error=NULL,finished=NULL WHERE status='paused'").run();
  }
  if(arg('enqueue')) {
   const type=String(arg('enqueue')),message=arg('message');
   if(['draft','edit'].includes(type)&&!message)throw new Error('message_id_required');
   if(type==='edit')throw new Error('Edit is scheduled only after a successful versioned draft.');
   const selectedId=message?messageSelectionId(assertMailSource(resolveMessageSelection(db,String(message)))):null;
   const payload=selectedId?(type==='triage'?{message_ids:[selectedId],request_id:new Date().toISOString()}:{message_id:selectedId}):{message_ids:db.prepare("SELECT * FROM messages WHERE account=? AND direction='in' AND classified=0 AND archived=0 AND deleted IS NULL AND julianday('now')-julianday(ts) BETWEEN -0.0035 AND 21 ORDER BY ts DESC LIMIT ?").all(CRM_MAIL_SOURCE_ACCOUNT,Math.min(10,Number(arg('limit',10))||10)).filter(m=>{try{resolveMessageSelection(db,messageSelectionId(m));return true;}catch{return false;}}).map(messageSelectionId),request_id:new Date().toISOString()};
   if(type==='triage'&&!payload.message_ids.length){console.log('No unclassified messages.');return;}
   console.log('Queued #'+enqueue(db,type,payload));
   if(!arg('drain'))return;
  }
  if(runtimePause(db)){console.log('Runtime paused: '+runtimePause(db));return;}
  const cap=Math.max(1,Math.min(100,Number(process.env.AGENT_MAX_RUNS_DAILY)||24));
  const today=db.prepare("SELECT COUNT(*) n FROM agent_runs WHERE provider=? AND substr(ts,1,10)=?").get(sel.provider,new Date().toISOString().slice(0,10)).n;
  for(let i=0;i<(arg('drain')?6:1)&&today+i<cap;i++) {
    const job=claimNext(db);if(!job){console.log('No queued jobs.');break;}
    const r=await performJob(db,job,{runner:sel.runner,provider:sel.provider,model:sel.model,effort:sel.effort});
    console.log(JSON.stringify({job:job.id,type:job.type,...r}));
    if(runtimePause(db))break;
  }
 }finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
