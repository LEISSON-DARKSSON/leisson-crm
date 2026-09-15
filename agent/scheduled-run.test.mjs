import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {businessWindow,acquireScheduleLock,runSteps} from './scheduled-run.mjs';
import {syncAndReconcile} from './sync-mail.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
test('schedule uses Tallinn weekday office hours including DST',()=>{
 assert.equal(businessWindow(new Date('2026-09-15T05:00:00Z')),true);
 assert.equal(businessWindow(new Date('2026-09-15T15:00:00Z')),false);
 assert.equal(businessWindow(new Date('2026-09-19T09:00:00Z')),false);
 assert.equal(businessWindow(new Date('2026-12-15T06:00:00Z')),true);
 assert.equal(businessWindow(new Date('2026-12-15T05:59:00Z')),false);
});
test('sync fetches bodies and reconciles refusals even when one account fails',async()=>{
 const calls=[];
 const result=await syncAndReconcile('fixture',{sync:async(db,opts)=>{calls.push(['sync',db,opts]);return [{account:'gert',seen:2,fresh:1,bodyCount:2},{account:'other',error:'offline'}];},reconcile:(db,opts)=>{calls.push(['reconcile',db,opts]);return [{intent:'unsubscribe'}];}});
 assert.deepEqual(calls[0],['sync','fixture',{limit:150,bodies:true}]);
 assert.deepEqual(calls[1],['reconcile','fixture',{apply:true}]);assert.equal(result.ok,false);assert.equal(result.reconciled,1);
});
test('failed sync stops model processes and clean chain orders every stage',async()=>{
 let calls=[];const failed=await runSteps(async(name,args)=>{calls.push([name,args]);return 1;});
 assert.equal(failed.ok,false);assert.deepEqual(calls,[['sync-mail.mjs',[]]]);
 calls=[];const done=await runSteps(async(name,args)=>{calls.push([name,args]);return 0;});
 assert.equal(done.ok,true);assert.deepEqual(calls,[['sync-mail.mjs',[]],['conductor.mjs',[]],['worker.mjs',['--drain']]]);
});
test('live owner prevents second scheduler and dry commands create no files',t=>{
 const path=mkdtempSync(join(tmpdir(),'leisson-scheduled-test-'));t.after(()=>rmSync(path,{recursive:true,force:true}));
 const release=acquireScheduleLock(path);assert.equal(acquireScheduleLock(path),null);release();assert.equal(readdirSync(path).length,0);
 for(const script of ['sync-mail.mjs','scheduled-run.mjs']){
  const child=spawnSync(process.execPath,[join(HERE,script),'--dry'],{cwd:path,env:{...process.env,CRM_DB_PATH:join(path,'must-not-exist.sqlite')},encoding:'utf8',shell:false,windowsHide:true});
  assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).dbWrites,0);assert.equal(readdirSync(path).length,0);
 }
});
