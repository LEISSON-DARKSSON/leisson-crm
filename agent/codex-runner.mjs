import { execFileSync } from 'node:child_process';
import { execBounded } from './exec-bounded.mjs';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {fileURLToPath} from 'node:url';
import {acquireAuthCache} from './auth-cache.mjs';
const AGENT_DIR=dirname(fileURLToPath(import.meta.url));
export const POLICY_VERSION = 'isolated-no-tools-v1';
export const DISABLED_FEATURES = ['shell_tool','unified_exec','apps','plugins','remote_plugin','browser_use',
  'browser_use_external','browser_use_full_cdp_access','computer_use','image_generation','view_image',
  'multi_agent','multi_agent_v2','hooks','memories','skill_search','skill_mcp_dependency_install',
  'skill_env_var_dependency_prompt','code_mode','code_mode_host','workspace_dependencies','goals',
  'tool_suggest','sleep_tool','in_app_browser','in_app_local_automation','unbounded_connection_retries'];
export const MODEL_BY_JOB = { triage: 'gpt-5.6-luna', draft: 'gpt-5.6-sol', edit: 'gpt-5.6-sol' };
export const EFFORT = 'medium';
export function policyArgs() {
  return ['--ignore-user-config','--ignore-rules','--strict-config','--skip-git-repo-check',
    '--ephemeral','--sandbox','read-only','--json','--color','never',
    '-c','forced_login_method="chatgpt"','-c','model_provider="openai"',
    '-c','approval_policy="never"','-c','web_search="disabled"','-c','mcp_servers={}',
    '-c','apps._default.enabled=false','-c','history.persistence="none"',
    '-c','model_instructions_file='+JSON.stringify(join(AGENT_DIR,'model-instructions.md')),
    '-c','project_doc_max_bytes=0','-c','shell_environment_policy.inherit="none"',
    '-c','sandbox_workspace_write.network_access=false',
    ...DISABLED_FEATURES.flatMap(f=>['--disable',f])];
}
export function childEnvironment(runtimeHome, env = process.env) {
  const result = {};
  // Allowlist: no API keys, SMTP/IMAP credentials, proxies or user hooks.
  for(const key of ['SystemRoot','WINDIR','COMSPEC','PATH','PATHEXT','TEMP','TMP','LOCALAPPDATA','APPDATA']) {
    const found = Object.keys(env).find(k=>k.toLowerCase()===key.toLowerCase());
    if(found) result[key]=env[found];
  }
  result.CODEX_HOME = runtimeHome;
  result.USERPROFILE = dirname(runtimeHome);
  result.HOME = dirname(runtimeHome);
  result.NO_COLOR='1';
  return result;
}
export function chatgptAuth(auth) {
  if(auth.auth_mode !== 'chatgpt' || !auth.tokens?.access_token || !auth.tokens?.refresh_token)
    throw new Error('chatgpt_auth_required');
  const { id_token, access_token, refresh_token, account_id } = auth.tokens;
  return { auth_mode:'chatgpt', tokens:{ id_token,access_token,refresh_token,account_id },
    last_refresh:auth.last_refresh ?? new Date().toISOString() };
}
export function resolveCodex() {
  if(process.env.CRM_CODEX_BIN) {
    const p=resolve(process.env.CRM_CODEX_BIN);
    if(!existsSync(p) || !/\.(exe|js)$/i.test(p)) throw new Error('codex_binary_invalid');
    return p.endsWith('.js') ? {command:process.execPath,prefix:[p]} : {command:p,prefix:[]};
  }
  if(process.platform==='win32') {
    const found=execFileSync('where.exe',['codex'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/);
    for(const p of found) {
      const script=join(dirname(p),'node_modules','@openai','codex','bin','codex.js');
      const native=join(dirname(script),'..','node_modules','@openai','codex-win32-x64','vendor','x86_64-pc-windows-msvc','bin','codex.exe');
      if(existsSync(native)) return {command:native,prefix:[]};
    }
    const exe=found.find(p=>p.toLowerCase().endsWith('.exe'));
    if(exe) return {command:exe,prefix:[]};
    throw new Error('native_codex_binary_missing');
  }
  return {command:'codex',prefix:[]};
}
export function classifyFailure(text) {
  if(/usage.limit|quota|rate.limit|limit reached|insufficient_quota|429/i.test(text)) return 'quota_exhausted';
  if(/refresh.token|unauthor|authentication|not logged|401|chatgpt_auth_required/i.test(text)) return 'auth_required';
  if(/tool|capability/i.test(text)) return 'capability_violation';
  return 'runtime_error';
}
export function parseEvents(output) {
  const events=output.split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s));
  const forbidden=events.find(e=>e.item && !['agent_message','reasoning','error'].includes(e.item.type));
  if(forbidden) throw new Error('capability_violation:'+forbidden.item.type);
  const failed=events.find(e=>e.type==='turn.failed' || e.type==='error');
  if(failed) throw new Error(classifyFailure(JSON.stringify(failed)));
  const completed=events.findLast(e=>e.type==='turn.completed');
  const final=events.findLast(e=>e.type==='item.completed' && e.item?.type==='agent_message');
  if(!completed || !final) throw new Error('incomplete_model_output');
  return { data:JSON.parse(final.item.text),usage:completed.usage??{},
    session_id:events.find(e=>e.type==='thread.started')?.thread_id??null };
}
// execBounded moved to ./exec-bounded.mjs (shared with claude-runner.mjs) 20.09.2026; re-exported below for existing importers.
export { execBounded };
export function restrictedCatalog(raw) {
  const models=raw.models?.filter(m=>Object.values(MODEL_BY_JOB).includes(m.slug)).map(m=>({...m,
    multi_agent_version:null,multi_agent_reasoning_effort:null,tool_mode:null,apply_patch_tool_type:null,
    experimental_supported_tools:[],node_repl_disabled:true,supports_search_tool:false,use_responses_lite:false}));
  if(!models||new Set(models.map(m=>m.slug)).size!==new Set(Object.values(MODEL_BY_JOB)).size)throw new Error('policy_unverified:catalog_models_missing');
  return {models};
}
export async function runCodex({type,prompt,schema,timeoutMs=600000}) {
  if(!MODEL_BY_JOB[type]) throw new Error('unknown_job_type');
  const base=mkdtempSync(join(tmpdir(),'leisson-codex-'));
  const runtimeHome=join(base,'home'),cwd=join(base,'work');
  mkdirSync(runtimeHome);mkdirSync(cwd);
  const originalHome=process.env.CODEX_HOME || join(homedir(),'.codex');
  let authCache=null;
  try {
    const catalog=restrictedCatalog(JSON.parse(readFileSync(join(originalHome,'models_cache.json'),'utf8')));
    const bin=resolveCodex();
    const {verifyLocalPolicy}=await import('./policy-probe.mjs');
    await verifyLocalPolicy({bin,catalog,model:MODEL_BY_JOB[type],args:policyArgs(),environment:childEnvironment,execute:execBounded});
    const catalogPath=join(base,'catalog.json');
    writeFileSync(catalogPath,JSON.stringify(catalog));
    authCache=acquireAuthCache(join(AGENT_DIR,'..','data','codex-auth-cache'),readFileSync(join(originalHome,'auth.json'),'utf8'),chatgptAuth);
    const auth=authCache.auth;
    writeFileSync(join(runtimeHome,'auth.json'),JSON.stringify(auth),{mode:0o600});
    const schemaPath=join(base,'response.schema.json');
    writeFileSync(schemaPath,JSON.stringify(schema),{mode:0o600});
    const result=await execBounded(bin.command,[...bin.prefix,'exec',...policyArgs(),
      '-C',cwd,'-c','model_catalog_json='+JSON.stringify(catalogPath),'-m',MODEL_BY_JOB[type],'-c','model_reasoning_effort="'+EFFORT+'"',
      '--output-schema',schemaPath,'-'],{cwd,env:childEnvironment(runtimeHome),input:prompt,timeoutMs});
    if(result.code!==0) throw new Error(classifyFailure(result.err+'\n'+result.out));
    return {...parseEvents(result.out),exit_code:result.code};
  } finally {
    try {
      if(authCache){
        try {if(existsSync(join(runtimeHome,'auth.json')))authCache.save(JSON.parse(readFileSync(join(runtimeHome,'auth.json'),'utf8')));}
        finally{authCache.release();}
      }
    } finally {
      const checked=resolve(base),allowed=resolve(tmpdir())+sep;
      if(!checked.startsWith(allowed) || !checked.slice(allowed.length).startsWith('leisson-codex-')) throw new Error('unsafe_runtime_cleanup');
      rmSync(checked,{recursive:true,force:true,maxRetries:5,retryDelay:200});
    }
  }
}
