// Trusted mailbox sync process. Never loaded by the model worker.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export async function syncAndReconcile(db,{sync,reconcile}={}) {
 const results=await sync(db,{limit:150,bodies:true});
 // Process refusals even when one account failed; the runner stops before model work on partial sync.
 const changes=reconcile(db,{apply:true});
 return {accounts:results.map(r=>({account:r.account,seen:r.seen??0,fresh:r.fresh??0,bodies:r.bodyCount??0,failed:!!r.error})),reconciled:changes.length,ok:results.length>0&&results.every(r=>!r.error)};
}
async function main(){
 if(process.argv.includes('--dry')){console.log(JSON.stringify({dry:true,networkCalls:0,dbWrites:0,steps:['sync_inbox_bodies','reconcile_refusals']}));return;}
 const [{open},{migrateAgent},{migrateSales},{syncAll},{reconcileSalesReplies}]=await Promise.all([
  import('../lib/db.mjs'),import('../lib/agentdb.mjs'),import('../lib/salesdb.mjs'),import('../lib/mail.mjs'),import('../lib/sales-safety.mjs')
 ]);
 const db=open();
 try{migrateAgent(db);migrateSales(db);const result=await syncAndReconcile(db,{sync:syncAll,reconcile:reconcileSalesReplies});console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;}
 finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('trusted_sync_failed');process.exitCode=1;});
