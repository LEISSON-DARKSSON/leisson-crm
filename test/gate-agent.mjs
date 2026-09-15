// Runtime contracts use disposable fixtures; the live CRM database is never opened.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {schemaFor,promptFor} from '../agent/runtime.mjs';
import {validate as validateSchema} from '../agent/schema-validation.mjs';
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const skills=['eesti-keele-toimetaja','leisson-mail-triage','leisson-kirja-toimetaja','leisson-crm-agent','leisson-prospect-audit'];
let passed=0;
function check(name,fn){fn();passed++;console.log('  ok '+name);}
for(const name of skills)check('Codex skill '+name,()=>{
 const text=readFileSync(join(ROOT,'.agents','skills',name,'SKILL.md'),'utf8');
 assert.match(text,/^---\r?\n/);assert.match(text,/\nname:\s*\S/);assert.match(text,/\ndescription:\s*\S/);
});
for(const type of ['triage','draft','edit'])check('Strict output schema and trusted skill input: '+type,()=>{
 const schema=schemaFor(type);assert.equal(schema.additionalProperties,false);assert.ok(schema.required.length);
 const prompt=promptFor({type,messages:[]});assert.ok(prompt.includes('name: '+(type==='triage'?'leisson-mail-triage':'leisson-kirja-toimetaja')));
 if(type==='edit')assert.ok(prompt.includes('name: eesti-keele-toimetaja'));
 assert.ok(prompt.includes('messages'));assert.throws(()=>validateSchema(schema,{unknown:true}));
});
const readers=['list_inbox','get_message','search_companies','get_company','get_pricing','next_step_offer','list_groups'];
for(const mode of ['read','write'])check('MCP '+mode+' stays read only, including malicious mutation calls',()=>{
 const input=[
  {jsonrpc:'2.0',id:1,method:'tools/list'},
  {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'save_draft',arguments:{account:'gert',uid:1,body:'Injected'}}},
  {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'list_inbox',arguments:{limit:5}}}
 ].map(x=>JSON.stringify(x)).join('\n')+'\n';
 const r=spawnSync(process.execPath,[join(ROOT,'agent','mcp-server.mjs')],{env:{...process.env,CRM_AGENT_SOURCE:'fixture',CRM_AGENT_MODE:mode},input,encoding:'utf8',shell:false,windowsHide:true});
 assert.equal(r.status,0,r.stderr);const messages=r.stdout.trim().split('\n').map(x=>JSON.parse(x));
 assert.deepEqual(messages.find(x=>x.id===1).result.tools.map(x=>x.name).sort(),readers.slice().sort());
 const rejected=messages.find(x=>x.id===2);assert.ok(rejected.error||rejected.result?.isError);
 assert.equal(JSON.parse(messages.find(x=>x.id===3).result.content[0].text).length,4);
});
check('Runtime documentation references existing components',()=>{
 const text=readFileSync(join(ROOT,'agent','README.md'),'utf8');
 for(const f of ['runtime.mjs','policy-probe.mjs','mcp-server.mjs','worker.mjs','conductor.mjs'])assert.ok(text.includes(f)&&existsSync(join(ROOT,'agent',f)),f);
 for(const name of readers)assert.ok(text.includes(name),name);
});
console.log(passed+' agent contract checks passed. Behavioral isolation/queue tests run in agent/runtime.test.mjs.');
