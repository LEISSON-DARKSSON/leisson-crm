// A dry run does not invoke a model, open the CRM database, or write an artifact.
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const fixture=JSON.parse(readFileSync(join(here,'fixtures','triage-sample.json'),'utf8'));
console.log(JSON.stringify({dry:true,provider:'codex-chatgpt',modelCalls:0,databaseWrites:0,
 messages:fixture.messages.map(m=>({message_id:m.id,body_present:Boolean(m.body_text)})),
 next:'node agent/probe-codex-policy.mjs checks actual tools with fake auth; node agent/regression.mjs --live uses the ChatGPT subscription.'},null,2));
