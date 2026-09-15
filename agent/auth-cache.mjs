// Private runtime auth cache. The user's global auth.json is never modified.
import {readFileSync,writeFileSync,mkdirSync,renameSync,rmSync,existsSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export function acquireAuthCache(cacheRoot,sourceRaw,sanitize) {
 cacheRoot=resolve(cacheRoot);mkdirSync(cacheRoot,{recursive:true,mode:0o700});
 const auth=sanitize(JSON.parse(sourceRaw));
 if(!auth.tokens.account_id)throw new Error('chatgpt_account_identity_required');
 const originHash=createHash('sha256').update(sourceRaw).digest('hex');
 const key=createHash('sha256').update(originHash+':'+auth.tokens.account_id).digest('hex');
 const lock=join(cacheRoot,'writer.lock');
 try{mkdirSync(lock);}
 catch(e){
  if(e.code!=='EEXIST')throw e;
  let owner=null;
  try{owner=JSON.parse(readFileSync(join(lock,'owner.json'),'utf8'));}catch{throw new Error('auth_cache_lock_review');}
  let alive=true;
  try{process.kill(owner.pid,0);}catch(err){if(err.code==='ESRCH')alive=false;else throw new Error('auth_cache_lock_review');}
  if(alive)throw new Error('auth_cache_busy');
  if(resolve(lock)!==cacheRoot+sep+'writer.lock')throw new Error('unsafe_auth_lock');
  rmSync(lock,{recursive:true,force:true});mkdirSync(lock);
 }
 writeFileSync(join(lock,'owner.json'),JSON.stringify({pid:process.pid,started:new Date().toISOString()}),{mode:0o600});
 const file=join(cacheRoot,key+'.json');
 let selected=auth;
 try{
  if(existsSync(file)){
   const cached=JSON.parse(readFileSync(file,'utf8'));
   selected=sanitize(cached.auth);
   if(cached.origin_hash!==originHash||selected.tokens.account_id!==auth.tokens.account_id)throw new Error('auth_cache_identity');
  }
 }catch(e){rmSync(lock,{recursive:true,force:true});throw e;}
 return {auth:selected,
  save(candidate){
   const next=sanitize(candidate);
   if(next.tokens.account_id!==auth.tokens.account_id)throw new Error('auth_cache_identity');
   const temp=join(cacheRoot,key+'.'+randomUUID()+'.tmp');
   writeFileSync(temp,JSON.stringify({origin_hash:originHash,auth:next}),{mode:0o600});
   renameSync(temp,file);
  },
  release(){if(resolve(lock)!==cacheRoot+sep+'writer.lock')throw new Error('unsafe_auth_lock');rmSync(lock,{recursive:true,force:true});}
 };
}
