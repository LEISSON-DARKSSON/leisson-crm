import { createHash } from 'node:crypto';

export const PROUX_IMPORT_VERSION = '2026-09-15.1';
export const PROUX_LEAD_LIMIT = 250;
const INTENTS = new Set(['implementation_help', 'result_followup']);
const STATUSES = new Set(['new', 'reviewed', 'contacted', 'closed']);
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
export const PRIVATE_PROUX_PATH = /\/(?:report|public-reports|public-audits|audit\/status)\//i;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function fail(code) { throw new Error(code); }
function date(value, code) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(code);
  return new Date(value).toISOString();
}

export function safeSourceBase(value = 'https://prouxaudit.com') {
  let url;
  try { url = new URL(value); } catch { fail('invalid_source_base'); }
  const hasCredentials = [url.username, url.password].some(Boolean);
  if (url.protocol !== 'https:' || !['prouxaudit.com', 'www.prouxaudit.com'].includes(url.hostname)
      || hasCredentials || url.port || url.pathname !== '/' || url.search || url.hash) {
    fail('invalid_source_base');
  }
  return url.origin;
}

// Imported prose is untrusted context. Never persist bearer links or opaque auth fields.
export function redactProUXText(value, knownSecrets = []) {
  let text = String(value ?? '').slice(0, 10_000);
  for (const secret of knownSecrets.filter((v) => typeof v === 'string' && v.length >= 6)) {
    text = text.split(secret).join('[redacted]');
  }
  return text
    .replace(/https?:\/\/[^\s<>"']+/gi, (candidate) => {
      try {
        const url = new URL(candidate);
        if (PRIVATE_PROUX_PATH.test(url.pathname)) return '[private report link removed]';
        url.username = ''; url.password = ''; url.search = ''; url.hash = '';
        return url.toString();
      } catch { return '[invalid link removed]'; }
    })
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(?:poll[_-]?token|share[_-]?token|access[_-]?token|api[_-]?key|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, '[credential removed]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .slice(0, 1000);
}

function normalizeLead(input, sourceBase) {
  if (!input || typeof input !== 'object' || typeof input.id !== 'string' || !ID.test(input.id)) fail('invalid_lead_id');
  if (!INTENTS.has(input.intent)) fail('invalid_lead_intent');
  if (!STATUSES.has(input.status)) fail('invalid_lead_status');
  if (input.source !== 'public_audit_status') fail('invalid_lead_source');
  const auditId = input.auditId == null ? null : String(input.auditId);
  if (auditId !== null && !ID.test(auditId)) fail('invalid_audit_id');
  const rawEmail = String(input.email ?? '').trim().toLowerCase();
  const local = rawEmail.split('@')[0];
  const email = rawEmail.length <= 254 && local.length <= 64 && EMAIL.test(rawEmail)
    && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') ? rawEmail : null;
  const knownSecrets = [input.pollToken, input.shareToken, input.accessToken, input.cookie];
  const lead = {
    source_id: input.id, source_base: sourceBase, intent: input.intent,
    upstream_status: input.status, source: input.source, audit_id: auditId,
    // This is a protected internal reference, never a public bearer-token URL.
    audit_reference: auditId ? `${sourceBase}/dashboard/audits/${encodeURIComponent(auditId)}` : null,
    email, contact_state: email ? 'available' : rawEmail ? 'invalid' : 'missing',
    message: redactProUXText(input.message, knownSecrets),
    source_created_at: date(input.createdAt, 'invalid_created_at'),
    source_updated_at: date(input.updatedAt, 'invalid_updated_at'),
  };
  if (lead.source_updated_at < lead.source_created_at) fail('invalid_lead_dates');
  return { ...lead, content_hash: hash(lead) };
}

export function migrateProUXAuditImports(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS prouxaudit_leads (
    source_base TEXT NOT NULL, source_id TEXT NOT NULL, intent TEXT NOT NULL,
    upstream_status TEXT NOT NULL, source TEXT NOT NULL, audit_id TEXT,
    audit_reference TEXT, email TEXT, contact_state TEXT NOT NULL, message TEXT NOT NULL,
    source_created_at TEXT NOT NULL, source_updated_at TEXT NOT NULL,
    content_hash TEXT NOT NULL, first_imported_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
    import_version TEXT NOT NULL, local_status TEXT NOT NULL DEFAULT 'unreviewed',
    company_id TEXT, local_note TEXT, PRIMARY KEY(source_base, source_id)
  )`);
}

export function normalizeProUXAuditPayload(payload, { sourceBase = 'https://prouxaudit.com', fetchedAt = new Date().toISOString() } = {}) {
  sourceBase = safeSourceBase(sourceBase);
  fetchedAt = date(fetchedAt, 'invalid_fetched_at');
  if (!payload || payload.ok !== true || !Array.isArray(payload.leads)) fail('invalid_lead_response');
  if (payload.leads.length > PROUX_LEAD_LIMIT) fail('lead_limit_exceeded');
  const leads = payload.leads.map((lead) => normalizeLead(lead, sourceBase));
  if (new Set(leads.map((lead) => lead.source_id)).size !== leads.length) fail('duplicate_source_id_in_response');
  return {
    leads, sourceBase, fetchedAt,
    coverage: { scope: leads.some((lead) => lead.intent === 'result_followup') ? 'provided_export' : 'implementation_help_only', limit: PROUX_LEAD_LIMIT,
      returned: leads.length, possibly_truncated: leads.length === PROUX_LEAD_LIMIT,
      result_followup_inventory: 'not_exposed_by_admin_endpoint', full_history_proven: false },
  };
}

export function importProUXAuditLeads(db, payload, options = {}) {
  // Validate the entire response before any DDL or row writes. --dry works without a DB.
  const normalized = normalizeProUXAuditPayload(payload, options);
  if (options.dryRun) return { dry_run: true, changed: null, inspected: normalized.leads.length, coverage: normalized.coverage };
  if (!db) fail('database_required');
  migrateProUXAuditImports(db);
  const columns = ['source_base','source_id','intent','upstream_status','source','audit_id','audit_reference','email','contact_state','message','source_created_at','source_updated_at','content_hash'];
  const insert = db.prepare(`INSERT INTO prouxaudit_leads (${columns.join(',')},first_imported_at,last_seen_at,import_version)
    VALUES (${columns.map(() => '?').join(',')},?,?,?)`);
  // Import never overwrites local review, notes or linking, and never creates companies/jobs/drafts.
  const update = db.prepare(`UPDATE prouxaudit_leads SET ${columns.slice(2).map((c) => `${c}=?`).join(',')},last_seen_at=?,import_version=? WHERE source_base=? AND source_id=?`);
  const get = db.prepare('SELECT content_hash,source_updated_at FROM prouxaudit_leads WHERE source_base=? AND source_id=?');
  let inserted = 0, updated = 0, unchanged = 0, stale = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const lead of normalized.leads) {
      const old = get.get(lead.source_base, lead.source_id);
      if (!old) {
        insert.run(...columns.map((key) => lead[key]), normalized.fetchedAt, normalized.fetchedAt, PROUX_IMPORT_VERSION); inserted++;
      } else if (old.source_updated_at > lead.source_updated_at) { stale++; }
      else if (old.content_hash === lead.content_hash) {
        db.prepare('UPDATE prouxaudit_leads SET last_seen_at=? WHERE source_base=? AND source_id=?')
          .run(normalized.fetchedAt, lead.source_base, lead.source_id); unchanged++;
      } else {
        update.run(...columns.slice(2).map((key) => lead[key]), normalized.fetchedAt, PROUX_IMPORT_VERSION, lead.source_base, lead.source_id); updated++;
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { dry_run: false, inserted, updated, unchanged, stale, inspected: normalized.leads.length, coverage: normalized.coverage };
}

export function proUXLeadReadiness(lead, { now = new Date(), maxAgeDays = 21 } = {}) {
  const reasons = [];
  if (lead.intent !== 'implementation_help') reasons.push('followup_owned_by_prouxaudit');
  if (lead.contact_state !== 'available' || !lead.email) reasons.push('contact_unavailable');
  if (!['new', 'reviewed'].includes(lead.upstream_status)) reasons.push('upstream_already_handled');
  if (['contacted', 'closed', 'declined', 'suppressed'].includes(lead.local_status)) reasons.push('local_sales_stopped');
  const age = now.getTime() - Date.parse(lead.source_created_at);
  if (!Number.isFinite(age) || age < -300_000 || age > maxAgeDays * 86_400_000) reasons.push('lead_needs_fresh_review');
  const lastSeenAge = now.getTime() - Date.parse(lead.last_seen_at);
  if (!Number.isFinite(lastSeenAge) || lastSeenAge < -300_000 || lastSeenAge > 86_400_000) reasons.push('refresh_source_before_action');
  return { can_prepare: reasons.length === 0, sendable: false, requires_exact_recipient_and_text_approval: true,
    followup_owner: lead.intent === 'result_followup' ? 'prouxaudit' : 'manual', reasons };
}

export function listProUXAuditLeads(db, options = {}) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='prouxaudit_leads'").get()) return [];
  return db.prepare('SELECT * FROM prouxaudit_leads ORDER BY source_created_at DESC,source_id').all()
    .map((lead) => ({ ...lead, readiness: proUXLeadReadiness(lead, options) }));
}

export async function fetchProUXAuditLeads({ sourceBase = 'https://prouxaudit.com', cookie, fetchImpl = fetch } = {}) {
  const base = safeSourceBase(sourceBase);
  if (typeof cookie !== 'string' || !cookie.trim() || /[\r\n]/.test(cookie)) fail('admin_cookie_required');
  let response;
  try {
    response = await fetchImpl(`${base}/api/admin/implementation-help-leads?limit=${PROUX_LEAD_LIMIT}`, {
      method: 'GET', headers: { Cookie: cookie, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(20_000),
    });
  } catch { fail('prouxaudit_read_failed'); }
  if (!response.ok) fail(`prouxaudit_http_${response.status}`);
  if (Number(response.headers?.get?.('content-length') ?? 0) > 2_000_000) fail('lead_response_too_large');
  let payload;
  try {
    const text = await response.text();
    if (text.length > 2_000_000) fail('lead_response_too_large');
    payload = JSON.parse(text);
  } catch { fail('invalid_lead_response'); }
  normalizeProUXAuditPayload(payload, { sourceBase: base });
  return payload;
}
