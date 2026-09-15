// Persistent native launcher for the trusted CRM server, with scoped identity and private logs.
import {spawn} from 'node:child_process';
import {mkdirSync,openSync,closeSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
mkdirSync(join(root,'data'),{recursive:true});
const log=openSync(join(root,'data','server.log'),'a',0o600);
const child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,env:process.env,shell:false,windowsHide:true,stdio:['ignore',log,log]});
let closed=false;const closeLog=()=>{if(!closed){closed=true;closeSync(log);}};
child.on('error',()=>{closeLog();process.exitCode=1;});
child.on('close',code=>{closeLog();process.exitCode=code??1;});
