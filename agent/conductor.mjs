// Deterministic planner. --dry opens SQLite read-only and creates no files.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync,readFileSync,existsSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { eelfilter } from '../lib/eelfilter.mjs';
import {draftDecision} from './draft-policy.mjs';
import { VASTATAVAD } from '../lib/gates.mjs';
import { migrateAgent,enqueue,messageVersion,runtimePause } from '../lib/agentdb.mjs';
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
export function planConductor(db,{now=new Date(),maxDrafts=3,batch=10,maxAgeDays=21}={}) {
  batch=Math.min(10,Math.max(1,batch));maxDrafts=Math.min(5,Math.max(1,maxDrafts));
  const rows=db.prepare("SELECT * FROM messages WHERE direction='in' AND archived=0 AND deleted IS NULL ORDER BY ts DESC").all();
  const sentDomains=new Set(db.prepare("SELECT DISTINCT lower(c.email) e FROM activity a JOIN companies c ON c.id=a.company_id WHERE a.kind='sent' AND c.email IS NOT NULL").all().map(r=>r.e.split('@')[1]).filter(Boolean));
  const prefilter=[],unclassified=[],drafts=[],skipped=[];
  const draftRows=db.prepare('SELECT account,uid,status,created FROM drafts').all();
  const existing=new Set(draftRows.map(d=>d.account+':'+d.uid));
  const remainingDrafts=Math.max(0,maxDrafts-draftRows.filter(d=>d.created?.slice(0,10)===now.toISOString().slice(0,10)).length);
  for(const m of rows) {
    const id=m.mailbox+':'+m.uid;
    if(!m.classified) {
      const ts=Date.parse(m.ts);
      if(!Number.isFinite(ts)||ts>+now+300000||+now-ts>maxAgeDays*86400000) {
        skipped.push({message_id:id,reason:'old_or_invalid_date_requires_explicit_review'});continue;
      }
      const r=eelfilter(m,sentDomains);
      if(r)prefilter.push({message_id:id,account:m.account,mailbox:m.mailbox,uid:m.uid,...r});
      else unclassified.push(m);
      continue;
    }
    if(existing.has(m.account+':'+m.uid))continue;
    const decision=draftDecision(db,m,{now});
    if(decision.allowed && VASTATAVAD.includes(m.category))
      drafts.push({message_id:id,source_hash:messageVersion(m)});
    else if(VASTATAVAD.includes(m.category))skipped.push({message_id:id,reason:decision.reason||'category'});
  }
  const jobs=[];
  for(let i=0;i<Math.min(unclassified.length,80);i+=batch) {
    const pack=unclassified.slice(i,i+batch);
    jobs.push({type:'triage',payload:{message_ids:pack.map(m=>m.mailbox+':'+m.uid),source_versions:pack.map(messageVersion)}});
  }
  jobs.push(...drafts.slice(0,remainingDrafts).map(payload=>({type:'draft',payload})));
  return {prefilter,jobs,skipped,counts:{unclassified:unclassified.length,draftCandidates:drafts.length,remainingDrafts}};
}
export function applyPlan(db,plan) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const m of plan.prefilter) db.prepare(`UPDATE messages SET classified=1,category=?,urgency='madal',
      confidence=?,summary=?,reply_intent='automatic' WHERE mailbox=? AND uid=? AND account=? AND classified=0`)
      .run(m.category,m.kindlus,'eelfilter: '+m.miks,m.mailbox,m.uid,m.account);
    const ids=plan.jobs.map(j=>enqueue(db,j.type,j.payload));
    db.exec('COMMIT');return ids;
  } catch(e){db.exec('ROLLBACK');throw e;}
}
function main() {
 const dry=process.argv.includes('--dry');
 const path=process.env.CRM_DB_PATH||join(ROOT,'data','crm.sqlite');
 if(!existsSync(path))throw new Error('CRM database missing: start CRM before conductor');
 const db=new DatabaseSync(path,{readOnly:dry});
 db.exec('PRAGMA busy_timeout=5000');
 try{
  if(!dry)migrateAgent(db);
  const hasRuntime=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_runtime_state'").get();
  const paused=hasRuntime?runtimePause(db):null;
  const plan=planConductor(db,{maxDrafts:Number(process.env.AGENT_MAX_DRAFTS)||3,batch:Number(process.env.AGENT_TRIAGE_BATCH)||10});
  console.log(JSON.stringify({dry,paused,...plan},null,2));
  if(dry||paused)return;
  const ids=applyPlan(db,plan);
  const summary=['# CRM-i tööjärjekord',new Date().toISOString(),'',
   'Provider: Codex / ChatGPT tellimus. Ajalooline Claude API kulu ei ole Codexi kulu.',
   'Planeeritud tööd: '+ids.length,'Mudelita lahendatud: '+plan.prefilter.length,
   'Ülevaatust vajavad: '+plan.skipped.length,
   'Mudelil puuduvad välised tegevustööriistad; saatmine vajab saaja ja täpse teksti kinnitust.'].join('\n')+'\n';
  if(!process.env.CRM_DB_PATH) {
    const f=join(ROOT,'data','digest.md');
    if(!existsSync(f)||readFileSync(f,'utf8')!==summary)writeFileSync(f,summary);
  }
  db.prepare("INSERT INTO meta(k,v) VALUES('digest',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(summary);
  db.prepare("INSERT INTO meta(k,v) VALUES('digest_ts',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(new Date().toISOString());
 }finally{db.close();}
 if(process.argv.includes('--run')) {
  const r=spawnSync(process.execPath,[join(ROOT,'agent','worker.mjs'),'--drain'],{stdio:'inherit',windowsHide:true,shell:false});
  process.exitCode=r.status??1;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try{main();}catch(e){console.error(e.message);process.exitCode=1;}
}
