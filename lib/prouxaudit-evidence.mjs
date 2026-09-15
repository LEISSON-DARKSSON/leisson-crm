import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { PRIVATE_PROUX_PATH, redactProUXText } from './prouxaudit-import.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const METHODS = new Set(['browser_manual', 'local_html']);
const CATEGORIES = new Set(['structure', 'content', 'visual', 'performance', 'keyboard', 'form_delivery']);
function required(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return redactProUXText(value.trim());
}
function safePublicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('invalid_public_url'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || PRIVATE_PROUX_PATH.test(url.pathname)) throw new Error('public_url_required');
  url.search = ''; url.hash = '';
  return url.toString();
}

export function buildLocalEvidencePack(input, { artifactRoot } = {}) {
  if (!input || typeof input !== 'object') throw new Error('evidence_input_required');
  if (!artifactRoot) throw new Error('artifact_root_required');
  const root = realpathSync(artifactRoot);
  const capturedAt = required(input.capturedAt, 'capture_time_required');
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error('invalid_capture_time');
  if (!METHODS.has(input.method)) throw new Error('local_method_required');
  const url = safePublicUrl(input.url);
  const artifacts = (input.artifacts || []).map((item) => {
    if (!item || typeof item.path !== 'string' || isAbsolute(item.path)) throw new Error('relative_artifact_path_required');
    const absolute = realpathSync(resolve(root, item.path));
    const rel = relative(root, absolute);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('artifact_outside_root');
    const bytes = readFileSync(absolute);
    return { path: rel.replaceAll('\\', '/'), kind: required(item.kind, 'artifact_kind_required'),
      bytes: bytes.length, sha256: digest(bytes) };
  });
  if (!artifacts.length) throw new Error('evidence_artifact_required');
  let viewport = null;
  if (input.method === 'browser_manual') {
    if (!Number.isInteger(input.viewport?.width) || !Number.isInteger(input.viewport?.height)
      || input.viewport.width < 100 || input.viewport.height < 100) throw new Error('browser_viewport_required');
    viewport = { width: input.viewport.width, height: input.viewport.height };
  }
  if (!Array.isArray(input.findings) || input.findings.length < 1 || input.findings.length > 3) throw new Error('one_to_three_findings_required');
  const findings = input.findings.map((finding, index) => {
    if (!CATEGORIES.has(finding.category)) throw new Error('invalid_finding_category');
    if (!['observed', 'hypothesis', 'not_tested'].includes(finding.verdict)) throw new Error('explicit_finding_verdict_required');
    if (!Array.isArray(finding.artifactIndexes) || !finding.artifactIndexes.length
      || finding.artifactIndexes.some((i) => !Number.isInteger(i) || !artifacts[i])) throw new Error('finding_evidence_required');
    if (input.method === 'local_html' && ['visual', 'performance', 'keyboard', 'form_delivery'].includes(finding.category)) {
      throw new Error('browser_evidence_required_for_claim');
    }
    return { id: `finding-${index + 1}`, category: required(finding.category, 'finding_category_required'),
      verdict: finding.verdict, observation: required(finding.observation, 'observation_required'),
      customer_need: required(finding.customerNeed, 'customer_need_required'),
      proposed_change: required(finding.proposedChange, 'proposed_change_required'),
      acceptance_scenario: required(finding.acceptanceScenario, 'acceptance_scenario_required'),
      artifact_indexes: finding.artifactIndexes };
  });
  const pack = {
    schema_version: 'leisson-local-evidence-v1', source: 'local_artifacts', url,
    captured_at: new Date(capturedAt).toISOString(), method: input.method, viewport,
    environment: required(input.environment, 'capture_environment_required'),
    limitations: required(input.limitations, 'capture_limitations_required'),
    network_calls: 0, paid_api_calls: 0, claims_verified_by_script: false,
    stage: input.stage === 'after' ? 'after' : 'before',
    baseline_sha256: input.stage === 'after' ? required(input.baselineSha256, 'baseline_hash_required') : null,
    service_id: required(input.serviceId, 'service_id_required'),
    catalog_version: required(input.catalogVersion, 'catalog_version_required'),
    artifacts, findings,
  };
  if (pack.baseline_sha256 && !/^[a-f0-9]{64}$/.test(pack.baseline_sha256)) throw new Error('invalid_baseline_hash');
  return { ...pack, pack_sha256: digest(JSON.stringify(pack)) };
}
