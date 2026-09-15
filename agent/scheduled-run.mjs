// Native Node orchestration. Task Scheduler uses IgnoreNew; this lock also guards manual overlap.
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,appendFileSync,rmSync} from 'node:fs';
import {join,dirname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
export function businessWindow(now=new Date()) {
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Tallinn',weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 return ['Mon','Tue','Wed','Thu','Fri'].includes(parts.weekday)&&Number(parts.hour)>=8&&Number(parts.hour)<18;
}
export function schedulePlan(now=new Date()) {return {allowed:businessWindow(now),timezone:'Europe/Tallinn',window:'Mon-Fri 08:00-18:00',steps:['sync-mail.mjs','conductor.mjs','worker.mjs --drain']};}
export function acquireScheduleLock(dataDir) {
 mkdirSync(dataDir,{recursive:true});const lock=join(dataDir,'scheduled-run.lock');
 try{mkdirSync(lock);}catch(e){
  if(e.code!=='EEXIST')throw e;
  let pid;try{pid=JSON.parse(readFileSync(join(lock,'owner.json'),'utf8')).pid;}catch{throw Error('schedule_lock_needs_review');}
  if(!Number.isSafeInteger(pid)||pid<1)throw Error('schedule_lock_needs_review');
  try{process.kill(pid,0);return null;}catch(err){if(err.code!=='ESRCH')return null;}
  if(!resolve(lock).startsWith(resolve(dataDir)+sep))throw Error('unsafe_lock_path');
  rmSync(lock,{recursive:true,force:true});mkdirSync(lock);
 }
 writeFileSync(join(lock,'owner.json'),JSON.stringify({pid:process.pid,started:new Date().toISOString()}),{mode:0o600});
 return ()=>{if(!resolve(lock).startsWith(resolve(dataDir)+sep))throw Error('unsafe_lock_path');rmSync(lock,{recursive:true,force:true});};
}
export async function runSteps(run) {
 for(const [script,args] of [['sync-mail.mjs',[]],['conductor.mjs',[]],['worker.mjs',['--drain']]]) {
  const code=await run(script,args);if(code!==0)return {ok:false,failed:script,code};
 }
 return {ok:true};
}
async function main() {
 const plan=schedulePlan();
 if(process.argv.includes('--dry')){console.log(JSON.stringify({dry:true,dbWrites:0,childProcesses:0,...plan}));return;}
 if(!plan.allowed){console.log('Outside CRM working window.');return;}
 const data=join(ROOT,'data'),release=acquireScheduleLock(data);if(!release){console.log('CRM runner already active.');return;}
 const logfile=join(data,'konduktor.log');
 const log=s=>appendFileSync(logfile,s,{mode:0o600});
 try{
  log('\n'+new Date().toISOString()+' Codex CRM cycle starts\n');
  const result=await runSteps((script,args)=>new Promise((resolveStep,reject)=>{
   const child=spawn(process.execPath,[join(ROOT,'agent',script),...args],{cwd:ROOT,env:process.env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',d=>log(d));child.stderr.on('data',d=>log(d));
   child.on('error',reject);child.on('close',code=>resolveStep(code??1));
  }));
  log(JSON.stringify(result)+'\n');if(!result.ok)process.exitCode=1;
 }finally{release();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error('scheduled_run_failed:'+e.code);process.exitCode=1;});
