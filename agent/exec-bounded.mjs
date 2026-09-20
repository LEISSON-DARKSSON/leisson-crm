import { spawn } from 'node:child_process';

// Generic bounded subprocess runner shared by every model-provider runner
// (codex-runner.mjs, claude-runner.mjs). Provider-agnostic on purpose: it
// knows nothing about Codex or Claude, only "run this command, feed it this
// stdin, kill it if it runs too long or writes too much". Extracted
// 20.09.2026 when the Claude runner needed the exact same bounded-exec
// behaviour and duplicating it would have meant two copies of the same
// timeout/byte-cap logic to keep in sync.
export function execBounded(command, args, { cwd, env, input = '', timeoutMs = 600000, maxBytes = 2000000 } = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', stopped = false;
    const stop = (reason) => { if (!stopped) { stopped = true; err += '\n' + reason; child.kill(); } };
    const timer = setTimeout(() => stop('runtime_timeout'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; if (Buffer.byteLength(out) > maxBytes) stop('output_limit'); });
    child.stderr.on('data', (d) => { err += d; if (Buffer.byteLength(err) > maxBytes) stop('stderr_limit'); });
    child.on('error', (e) => { clearTimeout(timer); resolveRun({ code: -1, out, err: e.code ?? 'spawn_error' }); });
    child.on('close', (code) => { clearTimeout(timer); resolveRun({ code: code ?? -1, out, err }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
