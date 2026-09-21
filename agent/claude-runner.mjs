// Leisson CRM agent runner: Claude Code CLI, isolated per call.
//
// Built 20.09.2026 as a parallel, flag-selected alternative to codex-runner.mjs
// (see AGENT_MODEL_PROVIDER in worker.mjs). Same public contract as runCodex:
// runClaude({type,prompt,schema,timeoutMs}) -> {data,usage,session_id,total_cost_usd,exit_code}.
// Everything measured against Claude Code 2.1.276 on this machine before being
// written here - see project memory ("Lahtine arhitektuuriotsus") for the recon
// transcript. Nothing in this file was guessed from documentation alone.
//
// Design note vs. Codex: the model needs ZERO live tools and ZERO MCP access.
// runtime.mjs's promptFor(input) already bakes the relevant skill text, the
// job-specific instructions and the pre-fetched data into ONE prompt string
// before this module ever sees it (confirmed by reading runtime.mjs - the
// worker pipeline is a pure text-in/JSON-out transform, which is exactly why
// codex-runner.mjs sets mcp_servers={} for the same jobs). So this runner
// passes NO --mcp-config and NO --append-system-prompt[-file]: adding either
// only pulls in Claude Code's large default agentic system prompt (measured:
// ~180k extra cache-creation tokens and a much higher bill for nothing used),
// which the isolated, prompt-only call below does not pay.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execBounded } from './exec-bounded.mjs';

export const PROVIDER_ID = 'claude';
export const POLICY_VERSION = 'isolated-no-tools-claude-v1';
// Aliases, not full model slugs: Claude Code CLI resolves 'haiku'/'sonnet' to
// whatever first-party model that alias currently points at. Matches the
// original leisson-crm-agent skill design (triage=haiku, draft/edit=sonnet).
// Measured 20.09.2026: 'haiku' -> claude-haiku-4-5-20251001.
export const MODEL_BY_JOB = { triage: 'haiku', draft: 'sonnet', edit: 'sonnet' };
export const EFFORT = 'medium';
// Defense-in-depth per-call ceiling via the CLI's own --max-budget-usd, well
// above the leisson-crm-agent skill's measured batch costs (triage batch
// 0.05-0.47 $, mustand+toimetus 1.14 $) and far below a runaway. This is on
// top of, not instead of, the .env AGENT_DAILY_USD-style cap the caller enforces.
export const MAX_BUDGET_USD = { triage: 1, draft: 3, edit: 3 };

// No --mcp-config, no built-in tools, no persisted session, one turn (there is
// nothing a second turn could do without tools). --restricted is belt-and-
// braces on top of --tools '': even a future flag or config change that
// re-enables a built-in tool still can't touch files outside the isolated cwd
// or bypass permissions.
export function policyArgs(type) {
  if (!MODEL_BY_JOB[type]) throw new Error('unknown_job_type');
  return ['-p', '--model', MODEL_BY_JOB[type], '--effort', EFFORT, '--output-format', 'json',
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
    '--tools', '', '--restricted', '--no-session-persistence',
    '--max-turns', '1', '--max-budget-usd', String(MAX_BUDGET_USD[type])];
}

export function childEnvironment(runtimeHome, env = process.env) {
  const result = {};
  // Allowlist: no API keys, SMTP/IMAP credentials, proxies or user hooks.
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA']) {
    const found = Object.keys(env).find((k) => k.toLowerCase() === key.toLowerCase());
    if (found) result[key] = env[found];
  }
  // Measured 20.09.2026: pointing CLAUDE_CONFIG_DIR, USERPROFILE and HOME all
  // at the same isolated temp dir (holding only a copied .credentials.json)
  // authenticates correctly with no other ambient config discovered.
  result.CLAUDE_CONFIG_DIR = runtimeHome;
  result.USERPROFILE = runtimeHome;
  result.HOME = runtimeHome;
  result.NO_COLOR = '1';
  return result;
}

export function resolveClaude() {
  if (process.env.CRM_CLAUDE_BIN) {
    const p = resolve(process.env.CRM_CLAUDE_BIN);
    if (!existsSync(p)) throw new Error('claude_binary_invalid');
    return p;
  }
  if (process.platform === 'win32') {
    const found = execFileSync('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/);
    for (const p of found) {
      const exe = join(dirname(p), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (existsSync(exe)) return exe;
    }
    throw new Error('native_claude_binary_missing');
  }
  return 'claude';
}

export function classifyFailure(text) {
  if (/rate.?limit|429|overloaded_error|usage.limit|quota/i.test(text)) return 'quota_exhausted';
  if (/auth|401|unauthor|not logged|invalid.*api.*key|authentication_error|claude_auth_required/i.test(text)) return 'auth_required';
  if (/permission_denial|disallowed|capability_violation/i.test(text)) return 'capability_violation';
  if (/runtime_timeout|output_limit|stderr_limit|spawn_error/.test(text)) return 'runtime_error';
  return 'runtime_error';
}

// Parses the single-object JSON that `claude -p --output-format json` prints.
// Measured 20.09.2026 (real calls, isolated env, both success and induced
// failure): success carries is_error:false and, when --json-schema was given,
// a pre-parsed structured_output object alongside the raw `result` string;
// failure carries is_error:true with a human-readable `result` and usually
// api_error_status/terminal_reason. permission_denials is always present and
// empty on a clean run - any entry there means the model tried to use
// something it was not given, which must never be treated as a normal error
// path (it is the one signal --tools '' existing to prevent didn't prevent).
export function parseResult(output) {
  let parsed;
  try { parsed = JSON.parse(output); } catch { throw new Error('invalid_json_output'); }
  if (Array.isArray(parsed.permission_denials) && parsed.permission_denials.length) {
    throw new Error('capability_violation:' + JSON.stringify(parsed.permission_denials));
  }
  if (parsed.is_error) throw new Error(classifyFailure(JSON.stringify(parsed)));
  if (typeof parsed.structured_output === 'undefined') {
    // A schema was always requested for worker jobs. No structured_output
    // means the CLI did not validate against it - never fall back to
    // guessing the shape of the free-text `result` field instead.
    throw new Error('missing_structured_output');
  }
  return {
    data: parsed.structured_output,
    usage: {
      input_tokens: parsed.usage?.input_tokens ?? null,
      cached_input_tokens: parsed.usage?.cache_read_input_tokens ?? null,
      output_tokens: parsed.usage?.output_tokens ?? null,
    },
    session_id: parsed.session_id ?? null,
    total_cost_usd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null,
  };
}

export async function runClaude({ type, prompt, schema, timeoutMs = 600000 }) {
  if (!MODEL_BY_JOB[type]) throw new Error('unknown_job_type');
  const base = mkdtempSync(join(tmpdir(), 'leisson-claude-'));
  try {
    const originalConfigDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    const credsPath = join(originalConfigDir, '.credentials.json');
    if (!existsSync(credsPath)) throw new Error('claude_auth_required');
    const originalCreds = readFileSync(credsPath, 'utf8');
    writeFileSync(join(base, '.credentials.json'), originalCreds, { mode: 0o600 });
    const bin = resolveClaude();
    const args = [...policyArgs(type), '--json-schema', JSON.stringify(schema)];
    const result = await execBounded(bin, args, { cwd: base, env: childEnvironment(base), input: prompt, timeoutMs });
    if (result.code !== 0) throw new Error(classifyFailure(result.err + '\n' + result.out));
    const parsed = parseResult(result.out);
    // Best-effort refresh-token carry-back: if Claude Code CLI rotated the
    // token during this isolated call, the rotated copy lives only in `base`
    // and is about to be deleted. Single-writer, no locking - acceptable
    // because worker.mjs runs one leased job per process turn (never
    // concurrent workers against the same account); if this runner is ever
    // promoted to run with real concurrency, port auth-cache.mjs's
    // mkdir-based lock over the way runCodex() already does for ChatGPT auth.
    try {
      const after = readFileSync(join(base, '.credentials.json'), 'utf8');
      if (after !== originalCreds) writeFileSync(credsPath, after, { mode: 0o600 });
    } catch { /* best-effort only: never fail the job over token carry-back */ }
    return { ...parsed, exit_code: result.code };
  } finally {
    const checked = resolve(base), allowed = resolve(tmpdir()) + sep;
    if (!checked.startsWith(allowed) || !checked.slice(allowed.length).startsWith('leisson-claude-')) throw new Error('unsafe_runtime_cleanup');
    rmSync(checked, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
