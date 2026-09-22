// CRM_ENV_PATH: konfiguratsioonitee peab olema üle kirjutatav ja mitte langema
// vaikselt tagasi repo .env-ile (audit PR2, CFG-1/CFG-2, 22.09.2026).
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rawEnv } from '../lib/env.mjs';

const algne = process.env.CRM_ENV_PATH;
try {
  const dir = mkdtempSync(join(tmpdir(), 'crm-env-'));
  const fail = join(dir, 'fiktiivne.env');
  writeFileSync(fail, 'ACCOUNTS=gate\nACC_GATE_USER=gate@example.invalid\nACC_GATE_PASS=gate\n');
  process.env.CRM_ENV_PATH = fail;
  const e = rawEnv();
  assert.equal(e.ACC_GATE_USER, 'gate@example.invalid');
  console.log('PASS env: CRM_ENV_PATH loeb määratud faili (CFG-1)');

  process.env.CRM_ENV_PATH = join(dir, 'ei-eksisteeri.env');
  assert.throws(() => rawEnv(), /CRM_ENV_PATH osutab olematule failile/,
    'puuduv CRM_ENV_PATH ei tohi vaikselt langeda repo .env-ile');
  console.log('PASS env: puuduv CRM_ENV_PATH annab nähtava vea, mitte vaikse tagasilanguse (CFG-2)');
} finally {
  if (algne === undefined) delete process.env.CRM_ENV_PATH; else process.env.CRM_ENV_PATH = algne;
}
