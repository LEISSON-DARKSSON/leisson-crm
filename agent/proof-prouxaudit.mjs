// Packages existing local observations. This command does not fetch pages or run AI APIs.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { buildLocalEvidencePack } from '../lib/prouxaudit-evidence.mjs';
const value = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
try {
  if (process.argv.includes('--help')) {
    console.log('node agent/proof-prouxaudit.mjs --input=evidence.json [--output=pack.json]\nReads existing local artifacts, records hashes, URL/time/environment/viewport and up to three findings. No network or paid APIs.');
  } else {
    if (!value('input')) throw new Error('evidence_input_required');
    const path = resolve(value('input'));
    const pack = buildLocalEvidencePack(JSON.parse(readFileSync(path, 'utf8')), { artifactRoot: dirname(path) });
    const json = JSON.stringify(pack, null, 2) + '\n';
    if (value('output')) {
      // Preserve earlier evidence; an existing target must never be silently overwritten.
      writeFileSync(resolve(value('output')), json, { flag: 'wx' });
      console.log(JSON.stringify({ ok: true, sha256: pack.pack_sha256, findings: pack.findings.length, paid_api_calls: 0 }));
    } else process.stdout.write(json);
  }
} catch (error) {
  const code = /^[a-z_]+$/.test(error?.message || '') ? error.message : 'evidence_pack_failed';
  console.error(JSON.stringify({ ok: false, error: code })); process.exitCode = 1;
}
