import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {acquireAuthCache} from './auth-cache.mjs';
import {chatgptAuth} from './codex-runner.mjs';
function base(t){const p=mkdtempSync(join(tmpdir(),'leisson-auth-test-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
const source=(account='test',token='access')=>JSON.stringify({auth_mode:'chatgpt',OPENAI_API_KEY:'MUST_NOT_COPY',tokens:{account_id:account,access_token:token,refresh_token:'refresh',id_token:'id'},last_refresh:'2026-09-15T00:00:00Z'});
test('refresh persists privately, strips API auth and rejects concurrent writer',t=>{
 const path=base(t),raw=source(),first=acquireAuthCache(path,raw,chatgptAuth);
 assert.throws(()=>acquireAuthCache(path,raw,chatgptAuth),/auth_cache_busy/);
 first.save({...first.auth,tokens:{...first.auth.tokens,access_token:'refreshed',refresh_token:'rotated'}});
 first.release();
 const next=acquireAuthCache(path,raw,chatgptAuth);
 assert.equal(next.auth.tokens.access_token,'refreshed');
 assert.equal(next.auth.OPENAI_API_KEY,undefined);
 assert.ok(!readFileSync(join(path,readdirSync(path).find(n=>n.endsWith('.json'))),'utf8').includes('MUST_NOT_COPY'));
 next.release();
});
test('new global login hash or account never picks another cached auth',t=>{
 const path=base(t);
 const a=acquireAuthCache(path,source(),chatgptAuth);a.save({...a.auth,tokens:{...a.auth.tokens,access_token:'old-cache'}});a.release();
 const b=acquireAuthCache(path,source('test','fresh-login'),chatgptAuth);assert.equal(b.auth.tokens.access_token,'fresh-login');b.release();
 const c=acquireAuthCache(path,source('second-account'),chatgptAuth);assert.equal(c.auth.tokens.account_id,'second-account');
 assert.throws(()=>c.save({...c.auth,tokens:{...c.auth.tokens,account_id:'test'}}),/identity/);c.release();
});
