import test from 'node:test';
import assert from 'node:assert/strict';
import {policyArgs,childEnvironment,classifyFailure,parseResult,resolveClaude,MODEL_BY_JOB,EFFORT,MAX_BUDGET_USD,PROVIDER_ID,POLICY_VERSION} from './claude-runner.mjs';

// Mirrors agent/runtime.test.mjs's coverage of codex-runner.mjs's equivalent pure
// functions (chatgptAuth/childEnvironment/classifyFailure/policyArgs/restrictedCatalog).
// claude-runner.mjs has no live-tool/MCP surface to restrict (unlike Codex's
// restrictedCatalog), so its policy is entirely in policyArgs()+childEnvironment();
// this file is the regression test that keeps that policy from silently drifting.

test('policyArgs rejects unknown job types and encodes the hardened, single-turn, no-tools policy',()=>{
 assert.throws(()=>policyArgs('nonsense'),/unknown_job_type/);
 const args=policyArgs('triage');
 assert.equal(args[args.indexOf('--model')+1],MODEL_BY_JOB.triage);
 assert.equal(args[args.indexOf('--tools')+1],'');
 assert.ok(args.includes('--restricted'));
 assert.ok(args.includes('--no-session-persistence'));
 assert.equal(args[args.indexOf('--max-turns')+1],'1');
 assert.equal(args[args.indexOf('--max-budget-usd')+1],String(MAX_BUDGET_USD.triage));
 assert.equal(args[args.indexOf('--permission-mode')+1],'dontAsk');
 assert.equal(args[args.indexOf('--permission-prompts')+1],'none');
 // Deliberate omissions (see file header comment in claude-runner.mjs): no MCP
 // surface and no --append-system-prompt[-file], because either one silently
 // pulls in Claude Code's default agentic system prompt (measured ~180k extra
 // cache-creation tokens for zero benefit, since promptFor() already has everything).
 assert.equal(args.includes('--mcp-config'),false);
 assert.equal(args.includes('--append-system-prompt'),false);
 assert.equal(args.includes('--append-system-prompt-file'),false);
 assert.equal(args.includes('--dangerously-skip-permissions'),false);
});

test('childEnvironment excludes every secret and API key, keeps only the isolation triad',()=>{
 const env=childEnvironment('C:/fixture-home',{PATH:'node',SMTP_PASS:'secret',ANTHROPIC_API_KEY:'secret',OPENAI_API_KEY:'secret',HTTPS_PROXY:'secret',SystemRoot:'C:/Windows'});
 assert.equal(env.SMTP_PASS,undefined);assert.equal(env.ANTHROPIC_API_KEY,undefined);assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.HTTPS_PROXY,undefined);
 assert.equal(env.PATH,'node');assert.equal(env.SystemRoot,'C:/Windows');
 assert.equal(env.CLAUDE_CONFIG_DIR,'C:/fixture-home');assert.equal(env.USERPROFILE,'C:/fixture-home');assert.equal(env.HOME,'C:/fixture-home');
 assert.equal(env.NO_COLOR,'1');
});

test('classifyFailure buckets known failure text and defaults unknown text to runtime_error',()=>{
 assert.equal(classifyFailure('rate limit exceeded, 429'),'quota_exhausted');
 assert.equal(classifyFailure('usage limit reached'),'quota_exhausted');
 assert.equal(classifyFailure('authentication_error: not logged in'),'auth_required');
 assert.equal(classifyFailure('permission_denial: Bash'),'capability_violation');
 assert.equal(classifyFailure('runtime_timeout'),'runtime_error');
 assert.equal(classifyFailure('something entirely unexpected'),'runtime_error');
});

test('parseResult accepts only a clean, schema-validated, tool-free success',()=>{
 const ok=parseResult(JSON.stringify({is_error:false,subtype:'success',structured_output:{a:1},usage:{input_tokens:10,output_tokens:2,cache_read_input_tokens:0},session_id:'s1',total_cost_usd:0.01,permission_denials:[]}));
 assert.deepEqual(ok.data,{a:1});assert.equal(ok.session_id,'s1');assert.equal(ok.total_cost_usd,0.01);assert.equal(ok.usage.input_tokens,10);
 // is_error can be true even while subtype says "success" (measured against an
 // invalid-model-name call) - is_error is the only signal this parser trusts.
 assert.throws(()=>parseResult(JSON.stringify({is_error:true,subtype:'success',result:'boom',api_error_status:404})));
 assert.throws(()=>parseResult(JSON.stringify({is_error:false,permission_denials:[{tool:'Bash'}]})),/capability_violation/);
 assert.throws(()=>parseResult(JSON.stringify({is_error:false,result:'no schema here',permission_denials:[]})),/missing_structured_output/);
 assert.throws(()=>parseResult('not json'),/invalid_json_output/);
});

test('resolveClaude trusts only an existing CRM_CLAUDE_BIN override',()=>{
 const prior=process.env.CRM_CLAUDE_BIN;
 try {
  process.env.CRM_CLAUDE_BIN=process.execPath;
  assert.equal(resolveClaude(),process.execPath);
  process.env.CRM_CLAUDE_BIN='Z:/definitely/not/a/real/path/claude.exe';
  assert.throws(()=>resolveClaude(),/claude_binary_invalid/);
 } finally {
  if(prior===undefined)delete process.env.CRM_CLAUDE_BIN;else process.env.CRM_CLAUDE_BIN=prior;
 }
});

test('module identity matches the worker.mjs provider contract (AGENT_MODEL_PROVIDER=claude)',()=>{
 assert.equal(PROVIDER_ID,'claude');
 assert.equal(typeof POLICY_VERSION,'string');
 assert.deepEqual(Object.keys(MODEL_BY_JOB).sort(),['draft','edit','triage']);
 assert.equal(EFFORT,'medium');
});
