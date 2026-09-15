// Explicit --apply writes only the local import table. All upstream requests are GET.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { fetchProUXAuditLeads, importProUXAuditLeads, listProUXAuditLeads } from '../lib/prouxaudit-import.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = args.includes('--apply');
const dry = args.includes('--dry') || !apply;
let db;
try {
  if (args.includes('--help')) {
    console.log('node agent/import-prouxaudit.mjs --file=private-export.json [--apply] [--db=existing.sqlite]\nnode agent/import-prouxaudit.mjs --fetch [--apply]\nnode agent/import-prouxaudit.mjs --status\nDefault: read-only dry run. --fetch reads PROUXAUDIT_ADMIN_COOKIE from the environment, never arguments. No mail is sent.');
  } else {
    const dbPath = resolve(value('db') || resolve(root, 'data', 'crm.sqlite'));
    if (args.includes('--status')) {
      if (!existsSync(dbPath)) throw new Error('existing_database_required');
      db = new DatabaseSync(dbPath, { readOnly: true });
      const leads = listProUXAuditLeads(db);
      console.log(JSON.stringify({ total: leads.length, can_prepare: leads.filter((l) => l.readiness.can_prepare).length,
        missing_contact: leads.filter((l) => l.contact_state !== 'available').length,
        sendable: 0, ids: leads.map((l) => ({ source_id: l.source_id, intent: l.intent, status: l.upstream_status, readiness: l.readiness })) }, null, 2));
    } else {
      if (Boolean(value('file')) === args.includes('--fetch')) throw new Error('choose_file_or_fetch');
      const sourceBase = value('source') || 'https://prouxaudit.com';
      const payload = value('file') ? JSON.parse(readFileSync(resolve(value('file')), 'utf8'))
        : await fetchProUXAuditLeads({ sourceBase, cookie: process.env.PROUXAUDIT_ADMIN_COOKIE });
      // Validate before opening an existing writable database; never call CRM open()/seed().
      const preview = importProUXAuditLeads(null, payload, { sourceBase, dryRun: true });
      if (dry) console.log(JSON.stringify(preview, null, 2));
      else {
        if (!existsSync(dbPath)) throw new Error('existing_database_required');
        db = new DatabaseSync(dbPath);
        db.exec('PRAGMA busy_timeout=5000');
        console.log(JSON.stringify(importProUXAuditLeads(db, payload, { sourceBase }), null, 2));
      }
    }
  }
} catch (error) {
  // Do not echo upstream bodies, cookies, file contents or URLs containing credentials.
  const code = error instanceof Error && /^[a-z_]+(?:_\d+)?$/.test(error.message) ? error.message : 'prouxaudit_import_failed';
  console.error(JSON.stringify({ ok: false, error: code })); process.exitCode = 1;
} finally { db?.close(); }
