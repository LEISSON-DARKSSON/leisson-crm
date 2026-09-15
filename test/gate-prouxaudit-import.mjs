import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fetchProUXAuditLeads, importProUXAuditLeads, listProUXAuditLeads, normalizeProUXAuditPayload } from '../lib/prouxaudit-import.mjs';
import { buildLocalEvidencePack } from '../lib/prouxaudit-evidence.mjs';

const now = '2026-09-15T12:00:00.000Z';
const source = (overrides = {}) => ({ id: 'lead-1', auditId: 'audit-1', pollTokenId: 'token-row-id', userId: 'user-1',
  email: 'owner@example.test', source: 'public_audit_status', intent: 'implementation_help',
  message: 'Please help improve the contact form.', status: 'new', createdAt: now, updatedAt: now, ...overrides });
const payload = (leads = [source()]) => ({ ok: true, leads });
const options = { fetchedAt: now };
const db = new DatabaseSync(':memory:');
const directory = mkdtempSync(join(tmpdir(), 'leisson-prouxaudit-test-'));
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
try {
  check('dry run creates no tables and accepts a missing database', () => {
    assert.equal(importProUXAuditLeads(null, payload(), { ...options, dryRun: true }).dry_run, true);
    importProUXAuditLeads(db, payload(), { ...options, dryRun: true });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sqlite_master').get().n, 0);
  });
  check('source ID is idempotent; import does not create outbound tables', () => {
    assert.equal(importProUXAuditLeads(db, payload(), options).inserted, 1);
    assert.equal(importProUXAuditLeads(db, payload(), options).unchanged, 1);
    assert.equal(listProUXAuditLeads(db, { now: new Date(now) }).length, 1);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name), ['prouxaudit_leads']);
  });
  check('manual review is required and imports never authorize sending', () => {
    const [lead] = listProUXAuditLeads(db, { now: new Date(now) });
    assert.equal(lead.readiness.can_prepare, true);
    assert.equal(lead.readiness.sendable, false);
    assert.equal(lead.readiness.requires_exact_recipient_and_text_approval, true);
  });
  check('no contact, bad email and PROUX-owned followup cannot prepare sales', () => {
    importProUXAuditLeads(db, payload([source({ id: 'missing', email: null }),
      source({ id: 'invalid', email: 'Owner <owner@example.test>\r\nBcc:a@b.test' }),
      source({ id: 'trailing-dot', email: 'owner@example.test.' }),
      source({ id: 'followup', intent: 'result_followup' })]), options);
    const all = listProUXAuditLeads(db, { now: new Date(now) });
    for (const id of ['missing','invalid','trailing-dot','followup']) assert.equal(all.find((l) => l.source_id === id).readiness.can_prepare, false);
    assert.equal(all.find((l) => l.source_id === 'followup').readiness.followup_owner, 'prouxaudit');
  });
  check('upstream handled and stale source snapshots block action', () => {
    importProUXAuditLeads(db, payload([source({ id: 'contacted', status: 'contacted' }), source({ id: 'closed', status: 'closed' })]), options);
    const all = listProUXAuditLeads(db, { now: new Date(now) });
    for (const id of ['contacted','closed']) assert.equal(all.find((l) => l.source_id === id).readiness.can_prepare, false);
    assert.equal(listProUXAuditLeads(db, { now: new Date('2026-09-17T12:00:00Z') }).every((l) => !l.readiness.can_prepare), true);
  });
  check('new import preserves local decisions; old source cannot reopen a lead', () => {
    db.prepare("UPDATE prouxaudit_leads SET local_status='declined',company_id='real-company',local_note='Keep this' WHERE source_id='lead-1'").run();
    const later = source({ status: 'closed', updatedAt: '2026-09-15T13:00:00Z' });
    assert.equal(importProUXAuditLeads(db, payload([later]), options).updated, 1);
    assert.equal(importProUXAuditLeads(db, payload(), options).stale, 1);
    const lead = listProUXAuditLeads(db, { now: new Date(now) }).find((l) => l.source_id === 'lead-1');
    assert.equal(lead.upstream_status, 'closed'); assert.equal(lead.local_status, 'declined');
    assert.equal(lead.company_id, 'real-company'); assert.equal(lead.local_note, 'Keep this');
  });
  check('invalid or duplicate payload rejects atomically', () => {
    const before = db.prepare('SELECT COUNT(*) n FROM prouxaudit_leads').get().n;
    assert.throws(() => importProUXAuditLeads(db, payload([source({ id: 'valid-new' }), source({ id: '../bad' })]), options), /invalid_lead_id/);
    assert.throws(() => importProUXAuditLeads(db, payload([source(),source()]), options), /duplicate_source_id/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM prouxaudit_leads').get().n, before);
  });
  check('tokens and public bearer URLs never enter stored import', () => {
    const secret = 'secret-poll-value-123';
    importProUXAuditLeads(db, payload([source({ id: 'redaction', pollToken: secret, accessToken: 'api-secret-value',
      message: `Check https://prouxaudit.com/report/${secret} https://prouxaudit.com/audit/status/unknown-poll-secret https://prouxaudit.com/api/public-reports/unknown-share-secret and https://site.test/contact?token=${secret}#private Cookie=topsecret Bearer secrettoken. ${secret}` })]), options);
    const row = db.prepare("SELECT * FROM prouxaudit_leads WHERE source_id='redaction'").get();
    const serialized = JSON.stringify(row);
    for (const prohibited of [secret,'unknown-poll-secret','unknown-share-secret','api-secret-value','topsecret','secrettoken','token-row-id','user-1','?token=']) assert.ok(!serialized.includes(prohibited), prohibited);
    assert.equal(row.audit_reference, 'https://prouxaudit.com/dashboard/audits/audit-1');
  });
  check('maximum response is not described as complete history', () => {
    const full = normalizeProUXAuditPayload(payload(Array.from({ length: 250 }, (_, i) => source({ id: `lead-${i}` }))));
    assert.equal(full.coverage.possibly_truncated, true); assert.equal(full.coverage.full_history_proven, false);
  });
  check('failed transaction leaves no partial imported rows', () => {
    db.exec("CREATE TRIGGER fixture_reject BEFORE INSERT ON prouxaudit_leads WHEN NEW.source_id='reject-me' BEGIN SELECT RAISE(ABORT,'fixture rejection'); END");
    assert.throws(() => importProUXAuditLeads(db, payload([source({ id: 'would-insert' }),source({ id: 'reject-me' })]), options), /fixture rejection/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM prouxaudit_leads WHERE source_id='would-insert'").get().n, 0);
    db.exec('DROP TRIGGER fixture_reject');
  });
  let called = 0;
  const fetched = await fetchProUXAuditLeads({ cookie: 'auth=private', fetchImpl: async (url, init) => {
    called++; assert.equal(url, 'https://prouxaudit.com/api/admin/implementation-help-leads?limit=250');
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    return new Response(JSON.stringify(payload()), { status: 200 });
  } });
  assert.equal(called, 1); assert.equal(fetched.leads.length, 1); checks++;
  await assert.rejects(() => fetchProUXAuditLeads({ sourceBase: 'https://evil.test', cookie: 'auth=private', fetchImpl: () => { throw Error('must not fetch'); } }), /invalid_source_base/);
  await assert.rejects(() => fetchProUXAuditLeads({ cookie: 'secret', fetchImpl: async () => { throw Error('private cookie secret leaked'); } }), /^Error: prouxaudit_read_failed$/); checks++;
  check('CLI dry run leaves SQLite byte-for-byte unchanged', () => {
    const path = join(directory, 'database.sqlite'); const local = new DatabaseSync(path); local.exec('CREATE TABLE sentinel(v)'); local.close();
    const input = join(directory, 'leads.json'); writeFileSync(input, JSON.stringify(payload()));
    const before = readFileSync(path);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../agent/import-prouxaudit.mjs', import.meta.url)), `--file=${input}`, `--db=${path}`, '--dry'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(readFileSync(path), before);
  });
  writeFileSync(join(directory, 'page.html'), '<html><title>Local proof</title></html>');
  const evidence = { url: 'https://example.test/contact?utm=test', capturedAt: now, method: 'local_html',
    environment: 'Saved HTML from browser; no JavaScript execution', limitations: 'No visual, keyboard or delivery test.',
    serviceId: 'test-service', catalogVersion: 'test-catalog', artifacts: [{ path: 'page.html', kind: 'html' }],
    findings: [{ category: 'structure', verdict: 'observed', observation: 'Saved HTML has a title.', customerNeed: 'Client requested title check.',
      proposedChange: 'Confirm desired title with client.', acceptanceScenario: 'Reopen delivered page and inspect the title.', artifactIndexes: [0] }] };
  check('local evidence records hashes and honest method without network', () => {
    const pack = buildLocalEvidencePack(evidence, { artifactRoot: directory });
    assert.equal(pack.paid_api_calls, 0); assert.equal(pack.network_calls, 0); assert.equal(pack.claims_verified_by_script, false);
    assert.equal(pack.viewport, null); assert.equal(pack.url, 'https://example.test/contact');
    assert.match(pack.artifacts[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(buildLocalEvidencePack(evidence, { artifactRoot: directory }).pack_sha256, pack.pack_sha256);
  });
  check('HTML-only evidence cannot impersonate visual or performance proof', () => {
    assert.throws(() => buildLocalEvidencePack({ ...evidence, findings: [{ ...evidence.findings[0], category: 'performance' }] }, { artifactRoot: directory }), /browser_evidence_required/);
    assert.throws(() => buildLocalEvidencePack({ ...evidence, method: 'browser_manual' }, { artifactRoot: directory }), /browser_viewport_required/);
    assert.throws(() => buildLocalEvidencePack({ ...evidence, findings: [{ ...evidence.findings[0], category: 'screenshots' }] }, { artifactRoot: directory }), /invalid_finding_category/);
    assert.throws(() => buildLocalEvidencePack({ ...evidence, stage: 'after' }, { artifactRoot: directory }), /baseline_hash_required/);
    assert.throws(() => buildLocalEvidencePack({ ...evidence, url: 'https://prouxaudit.com/report/secret' }, { artifactRoot: directory }), /public_url_required/);
    assert.throws(() => buildLocalEvidencePack({ ...evidence, url: 'https://prouxaudit.com/audit/status/secret' }, { artifactRoot: directory }), /public_url_required/);
    assert.throws(() => buildLocalEvidencePack({ ...evidence, url: 'https://prouxaudit.com/api/public-reports/secret' }, { artifactRoot: directory }), /public_url_required/);
  });
  check('evidence pack CLI uses local files and preserves existing output', () => {
    const inputPath = join(directory, 'evidence.json'); const outputPath = join(directory, 'evidence-pack.json');
    writeFileSync(inputPath, JSON.stringify(evidence));
    const cliPath = fileURLToPath(new URL('../agent/proof-prouxaudit.mjs', import.meta.url));
    const first = spawnSync(process.execPath, [cliPath, `--input=${inputPath}`, `--output=${outputPath}`], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const bytes = readFileSync(outputPath);
    const second = spawnSync(process.execPath, [cliPath, `--input=${inputPath}`, `--output=${outputPath}`], { encoding: 'utf8' });
    assert.equal(second.status, 1); assert.deepEqual(readFileSync(outputPath), bytes);
  });
  console.log(`PROUXAUDIT bridge: ${checks} checks passed (fixtures only, no live writes or paid API).`);
} finally {
  db.close();
  const relativeTarget = relative(resolve(tmpdir()), resolve(directory));
  if (!relativeTarget.startsWith('leisson-prouxaudit-test-') || relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) throw new Error('unsafe_test_cleanup_target');
  rmSync(resolve(directory), { recursive: true, force: true });
}
