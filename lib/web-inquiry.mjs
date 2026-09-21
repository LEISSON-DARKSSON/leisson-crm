import { createHash } from 'node:crypto';
import { CATALOG_VERSION, serviceById } from '@leisson/shared/service-catalog';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
const MARKER = '\n\n— leisson.eu kontaktivorm\nLEISSON_INQUIRY_JSON:';
const fail = reason => ({ ok: false, reason });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function replyAddress(value) {
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (Array.isArray(value?.value) && value.value.length === 1) return String(value.value[0].address ?? '').trim().toLowerCase();
  return null;
}

/** A matching mail body is an untrusted claim, never evidence of consent or identity. */
export function parseWebInquiry(record) {
  if (record?.direction !== 'in') return fail('not_incoming');
  if (record.body_truncated) return fail('truncated_body');
  const body = typeof record.body_text === 'string' ? record.body_text.replace(/\r\n/g, '\n').trimEnd() : '';
  if (!body.includes('LEISSON_INQUIRY_JSON:')) return fail('not_web_inquiry');
  if (body.length > 12_000) return fail('body_too_large');
  const markerAt = body.lastIndexOf(MARKER);
  if (markerAt < 0) return fail('invalid_form_envelope');
  const rawMetadata = body.slice(markerAt + MARKER.length);
  if (rawMetadata.length > 2048 || /[\r\n]/.test(rawMetadata)) return fail('invalid_metadata');
  let input;
  try { input = JSON.parse(rawMetadata); } catch { return fail('invalid_metadata'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('invalid_metadata');
  if (!UUID.test(String(input.inquiry_id ?? ''))) return fail('invalid_inquiry_id');
  if (input.source !== 'leisson.eu' || !['/et/contact', '/en/contact'].includes(input.source_path)) return fail('invalid_source');
  if (input.catalog_version !== CATALOG_VERSION) return fail('catalog_version_mismatch');
  const service = serviceById(input.service_id);
  if (input.service_id !== 'other' && (!service || service.status !== 'active' || service.id !== input.service_id)) return fail('invalid_service');
  const parts = body.slice(0, markerAt).match(/^Nimi: ([^\n]+)\nE-post: ([^\n]+)\nEttevõte: ([^\n]+)\nVajadus: ([^\n]+)\nVeeb: ([^\n]+)\n\n([\s\S]+)$/);
  if (!parts) return fail('invalid_form_envelope');
  const [, name, rawEmail, rawCompany, scope, rawWebsite, message] = parts;
  const email = rawEmail.trim().toLowerCase(), company = rawCompany === '—' ? '' : rawCompany, website = rawWebsite === '—' ? '' : rawWebsite;
  if (name.length > 120 || company.length > 160 || scope.length > 240 || message.length > 6000
      || !message.trim() || email.length > 254 || !EMAIL.test(email) || /[\u0000-\u0008\u000b-\u001f]/.test(name + company + scope + email)) return fail('invalid_contact');
  if (website) {
    try {
      const url = new URL(website);
      if (website.length > 501 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return fail('invalid_website');
    } catch { return fail('invalid_website'); }
  }
  const lang = input.source_path === '/en/contact' ? 'en' : 'et';
  if (scope !== (service?.name[lang] ?? (lang === 'en' ? 'Other work' : 'Muu töö'))) return fail('service_label_mismatch');
  const metadata = {
    inquiry_id: input.inquiry_id.toLowerCase(), service_id: input.service_id,
    catalog_version: input.catalog_version, source: 'leisson.eu', source_path: input.source_path,
  };
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
    if (typeof input[key] === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(input[key])) metadata[key] = input[key];
  }
  const replyTo = replyAddress(record.reply_to);
  const replyMismatch = replyTo !== null && (!EMAIL.test(replyTo) || replyTo !== email);
  const payload = { metadata, name, email, company, scope, website, message };
  return { ok: true, data: {
    ...payload, source_id: 'leisson.eu:' + metadata.inquiry_id, payload_hash: digest(payload),
    contact_origin: replyTo && !replyMismatch ? 'body_and_reply_to_claim' : 'body_claim',
    reply_to_mismatch: replyMismatch ? 1 : 0,
  } };
}

export function migrateWebInquiries(db) {
  db.exec('CREATE TABLE IF NOT EXISTS web_inquiries (' +
    'source_id TEXT PRIMARY KEY, inquiry_id TEXT NOT NULL, service_id TEXT NOT NULL, catalog_version TEXT NOT NULL,' +
    'source_path TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, company TEXT NOT NULL, scope TEXT NOT NULL,' +
    'website TEXT NOT NULL, message TEXT NOT NULL, metadata_json TEXT NOT NULL, payload_hash TEXT NOT NULL,' +
    "contact_origin TEXT NOT NULL, authenticity TEXT NOT NULL DEFAULT 'unverified', reply_to_mismatch INTEGER NOT NULL DEFAULT 0," +
    "status TEXT NOT NULL DEFAULT 'needs_review', qualified INTEGER NOT NULL DEFAULT 0, approved_for_send INTEGER NOT NULL DEFAULT 0," +
    'first_mail_source_id TEXT NOT NULL, first_imported_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS web_inquiry_messages (' +
    'source_id TEXT NOT NULL, mail_source_id TEXT NOT NULL, payload_hash TEXT NOT NULL, imported_at TEXT NOT NULL,' +
    'PRIMARY KEY (source_id,mail_source_id,payload_hash), FOREIGN KEY(source_id) REFERENCES web_inquiries(source_id));');
}

/** Add only local review records; never mutate companies, jobs, drafts or outbound mail. */
export function importWebInquiry(db, record) {
  const parsed = parseWebInquiry(record);
  if (!parsed.ok) return { imported: false, reason: parsed.reason };
  if (!/^[0-9a-f]{64}$/i.test(String(record.source_id ?? ''))) return { imported: false, reason: 'canonical_source_id_required' };
  const p = parsed.data, now = new Date().toISOString();
  migrateWebInquiries(db);
  // Savepoint also works inside a caller's canonical-mail transaction.
  db.exec('SAVEPOINT web_inquiry_import');
  try {
    const inserted = db.prepare('INSERT INTO web_inquiries (' +
      'source_id,inquiry_id,service_id,catalog_version,source_path,name,email,company,scope,website,message,metadata_json,payload_hash,' +
      'contact_origin,reply_to_mismatch,first_mail_source_id,first_imported_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO NOTHING')
      .run(p.source_id,p.metadata.inquiry_id,p.metadata.service_id,p.metadata.catalog_version,p.metadata.source_path,
        p.name,p.email,p.company,p.scope,p.website,p.message,JSON.stringify(p.metadata),p.payload_hash,
        p.contact_origin,p.reply_to_mismatch,record.source_id,now,now).changes;
    const old = db.prepare('SELECT payload_hash,status FROM web_inquiries WHERE source_id=?').get(p.source_id);
    const conflict = old.payload_hash !== p.payload_hash;
    // Preserve the first payload and all local review state on an ordinary re-import.
    // Conflicting identity or contact claims always remove any readiness granted later.
    if (conflict || p.reply_to_mismatch) {
      db.prepare("UPDATE web_inquiries SET last_seen_at=?, status=?,qualified=0,approved_for_send=0,reply_to_mismatch=MAX(reply_to_mismatch,?) WHERE source_id=?")
        .run(now, conflict || old.status === 'identity_conflict' ? 'identity_conflict' : 'needs_review',p.reply_to_mismatch,p.source_id);
    } else {
      db.prepare('UPDATE web_inquiries SET last_seen_at=? WHERE source_id=?').run(now,p.source_id);
    }
    const linked = db.prepare('INSERT INTO web_inquiry_messages (source_id,mail_source_id,payload_hash,imported_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING')
      .run(p.source_id,record.source_id,p.payload_hash,now).changes;
    const status = db.prepare('SELECT status FROM web_inquiries WHERE source_id=?').get(p.source_id).status;
    db.exec('RELEASE web_inquiry_import');
    return { imported: true, duplicate: !inserted, linked: Boolean(linked), source_id: p.source_id,
      mail_source_id: record.source_id, status, conflict: conflict || status === 'identity_conflict', sendable: false };
  } catch (error) {
    db.exec('ROLLBACK TO web_inquiry_import'); db.exec('RELEASE web_inquiry_import'); throw error;
  }
}

export function listWebInquiries(db, { limit = 100 } = {}) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='web_inquiries'").get()) return [];
  limit = Number.isFinite(Number(limit)) ? Math.min(200, Math.max(1, Math.floor(Number(limit)))) : 100;
  return db.prepare('SELECT * FROM web_inquiries ORDER BY first_imported_at DESC,source_id LIMIT ?').all(limit)
    .map(row => ({ ...row, readiness: { sendable: false, requires_review: true, requires_exact_recipient_and_text_approval: true } }));
}
