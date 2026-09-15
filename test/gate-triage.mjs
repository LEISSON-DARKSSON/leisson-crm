// Public synthetic fixture quality; no historical customer messages or claimed benchmark results.
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {schemaFor} from '../agent/runtime.mjs';
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const schema=schemaFor('triage').properties.items.items.properties;
const fixture=JSON.parse(readFileSync(join(ROOT,'agent','fixtures','triage-regression.json'),'utf8'));
assert.equal(fixture.synthetic,true);assert.ok(fixture.messages.length>=12);
assert.equal(new Set(fixture.messages.map(m=>m.id)).size,fixture.messages.length);
for(const m of fixture.messages){
 assert.ok(m.id.startsWith('synthetic:'));assert.match(m.from,/@[^@]*\.example\.test$/);
 assert.ok(m.body_text.length>20);assert.ok(m.why.length>20);
 assert.ok(schema.category.enum.includes(m.expect.category));assert.ok(schema.urgency.enum.includes(m.expect.urgency));assert.ok(schema.reply_intent.enum.includes(m.expect.reply_intent));
}
for(const category of schema.category.enum)assert.ok(fixture.messages.some(m=>m.expect.category===category),category);
for(const intent of schema.reply_intent.enum)assert.ok(fixture.messages.some(m=>m.expect.reply_intent===intent),intent);
assert.ok(fixture.messages.some(m=>m.expect.suspicious));assert.ok(fixture.messages.some(m=>/Palun saatke/.test(m.body_text)&&!m.expect.suspicious));
const temporary=mkdtempSync(join(tmpdir(),'leisson-regression-dry-'));
try{
 for(const args of [[],['--dry']]){
  const child=spawnSync(process.execPath,[join(ROOT,'agent','regression.mjs'),...args],{cwd:temporary,env:{...process.env,CODEX_HOME:temporary,CRM_DB_PATH:join(temporary,'must-not-exist.sqlite')},encoding:'utf8',shell:false,windowsHide:true});
  assert.equal(child.status,0,child.stderr);const report=JSON.parse(child.stdout);assert.equal(report.modelCalls,0);assert.equal(report.dry,true);assert.equal(report.count,fixture.messages.length);assert.equal(readdirSync(temporary).length,0);
 }
}finally{rmSync(temporary,{recursive:true,force:true});}
console.log('PASS: synthetic triage fixtures cover categories/intents/injection; default and --dry are model-free and nonmutating.');
