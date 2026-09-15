import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {restrictedCatalog,resolveCodex,policyArgs,childEnvironment,execBounded,MODEL_BY_JOB} from './codex-runner.mjs';
import {verifyLocalPolicy} from './policy-probe.mjs';
const raw=JSON.parse(readFileSync(join(process.env.CODEX_HOME||join(homedir(),'.codex'),'models_cache.json'),'utf8'));
const bin=resolveCodex(),catalog=restrictedCatalog(raw);
for(const model of new Set(Object.values(MODEL_BY_JOB)))console.log(JSON.stringify(await verifyLocalPolicy({bin,catalog,model,args:policyArgs(),environment:childEnvironment,execute:execBounded})));
