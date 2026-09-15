// Default = read-only fixture inventory. --live explicitly consumes ChatGPT/Codex quota, never paid API.
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runCodex} from './codex-runner.mjs';
import {schemaFor,promptFor} from './runtime.mjs';
import {validate} from './schema-validation.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const fixture=JSON.parse(readFileSync(join(here,'fixtures','triage-regression.json'),'utf8'));
if(!process.argv.includes('--live')||process.argv.includes('--dry')) {
 console.log(JSON.stringify({dry:true,count:fixture.messages.length,modelCalls:0,
  cases:fixture.messages.map(m=>({id:m.id,expected:m.expect,legacy_known_fail:!!m.known_fail}))},null,2));
} else {
 let failures=0,seen=0;
 for(let n=0;n<fixture.messages.length;n+=10) {
  const pack=fixture.messages.slice(n,n+10);
  const input={type:'triage',today:new Date().toISOString().slice(0,10),messages:pack.map(m=>({
    message_id:m.id,from:m.from,from_name:m.from_name,subject:m.subject,ts:m.ts,
    body_text:m.body_text,body_complete:!!m.body_text,company_id:null,reply_intent:'unknown'}))};
  const result=await runCodex({type:'triage',prompt:promptFor(input),schema:schemaFor('triage')});
  validate(schemaFor('triage'),result.data);
  if(result.data.items.length!==pack.length||new Set(result.data.items.map(m=>m.message_id)).size!==pack.length)throw new Error('coverage_mismatch');
  for(const expected of pack) {
    const got=result.data.items.find(m=>m.message_id===expected.id);
    const ok=got&&got.category===expected.expect.category&&(!expected.expect.suspicious||got.suspicious);
    if(!ok)failures++;seen++;
    console.log(JSON.stringify({id:expected.id,ok,expected:expected.expect.category,actual:got?.category??null}));
  }
 }
 console.log(JSON.stringify({provider:'codex-chatgpt',seen,failures,paid_api_cost:null}));
 if(failures)process.exitCode=1;
}
