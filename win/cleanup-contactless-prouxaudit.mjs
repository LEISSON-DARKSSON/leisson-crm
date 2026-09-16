// One-time local cleanup. SQLite backup includes the live WAL state.
import { backup, DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/env.mjs';

const databasePath = join(ROOT, 'data', 'crm.sqlite');
const backupDirectory = join(ROOT, 'data', 'backup');
const backupPath = join(backupDirectory, 'prouxaudit-before-contact-cleanup-20260916.sqlite');
if (!existsSync(databasePath)) throw new Error('CRM database is missing');
if (existsSync(backupPath)) throw new Error('Backup already exists; refusing to overwrite it');

const db = new DatabaseSync(databasePath);
try {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='prouxaudit_leads'").get();
  if (!table) throw new Error('PROUXAUDIT lead table is missing');
  const protectedRows = db.prepare("SELECT COUNT(*) n FROM prouxaudit_leads WHERE (contact_state!='available' OR email IS NULL) AND (company_id IS NOT NULL OR trim(coalesce(local_note,''))!='' OR local_status!='unreviewed')").get().n;
  if (protectedRows) throw new Error(`Refusing to remove ${protectedRows} reviewed or linked rows`);
  const removable = db.prepare("SELECT COUNT(*) n FROM prouxaudit_leads WHERE contact_state!='available' OR email IS NULL").get().n;
  mkdirSync(backupDirectory, { recursive: true });
  await backup(db, backupPath);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare("DELETE FROM prouxaudit_leads WHERE contact_state!='available' OR email IS NULL").run();
    if (result.changes !== removable) throw new Error('Count changed during cleanup');
    db.exec('COMMIT');
    console.log(JSON.stringify({ removed: result.changes, remaining: db.prepare('SELECT COUNT(*) n FROM prouxaudit_leads').get().n, backup: backupPath, integrity: db.prepare('PRAGMA integrity_check').get().integrity_check }));
  } catch (error) { db.exec('ROLLBACK'); throw error; }
} finally { db.close(); }
