// Kohalik SQLite ilma ühegi natiivse sõltuvuseta (node:sqlite, Node >= 22.5).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ROOT } from './env.mjs';

const DATA_DIR = join(ROOT, 'data');
const DB_PATH = join(DATA_DIR, 'crm.sqlite');

export const STATUSES = ['ootel', 'kiri', 'kohtumine', 'pakkumine', 'voidetud', 'ei'];
export const STATUS_LABEL = {
  ootel: 'Ootel',
  kiri: 'Kiri saadetud',
  kohtumine: 'Kohtumine kokku',
  pakkumine: 'Pakkumine väljas',
  voidetud: 'Võidetud',
  ei: 'Ei sobi',
};

function addColumn(db, table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

// busyTimeout on ulekirjutatav AINULT selleks, et lukukonkurentsi saaks varavas
// paris teise uhendusega katsetada ilma varavat sekunditesse venitamata. Toos jaab
// 5000 - see on aeg, mille jooksul serveri kirjutus tuupiliselt lopeb.
export function open({ dbPath = process.env.CRM_DB_PATH || DB_PATH, busyTimeout = 5000 } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = ' + (Number(busyTimeout) || 0));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      seg TEXT, loc TEXT, regcode TEXT, turnover TEXT,
      email TEXT, email_note TEXT, url TEXT,
      priority TEXT, offer TEXT, price INTEGER,
      finding TEXT, why TEXT, angle TEXT, meet_day TEXT,
      subject TEXT, body TEXT,
      status TEXT NOT NULL DEFAULT 'ootel',
      next_step TEXT, updated TEXT
    );
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id TEXT NOT NULL,
      ts TEXT NOT NULL, kind TEXT NOT NULL, note TEXT,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS messages (
      mailbox TEXT NOT NULL,
      uid INTEGER NOT NULL,
      msgid TEXT, ts TEXT,
      direction TEXT NOT NULL DEFAULT 'in',
      addr TEXT, addr_name TEXT, subject TEXT, snippet TEXT,
      company_id TEXT, unread INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (mailbox, uid)
    );
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    CREATE INDEX IF NOT EXISTS idx_act_company ON activity(company_id);
  `);

  // migratsioonid (üks konto -> mitu kontot, postkasti opereerimine)
  addColumn(db, 'messages', 'account', "TEXT NOT NULL DEFAULT 'gert'");
  addColumn(db, 'messages', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'messages', 'body_text', 'TEXT');
  addColumn(db, 'messages', 'body_fetched', 'TEXT');
  addColumn(db, 'messages', 'to_addr', 'TEXT');
  addColumn(db, 'messages', 'replied', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'messages', 'flagged', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'messages', 'source_id', 'TEXT');
  addColumn(db, 'messages', 'uidvalidity', 'TEXT');
  addColumn(db, 'messages', 'identity_status', "TEXT NOT NULL DEFAULT 'legacy'");
  addColumn(db, 'messages', 'auto_response', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'messages', 'reply_intent', "TEXT NOT NULL DEFAULT 'unknown'");
  addColumn(db, 'companies', 'sales_state', "TEXT NOT NULL DEFAULT 'unqualified'");
  addColumn(db, 'companies', 'need_evidence', 'TEXT');
  addColumn(db, 'companies', 'qualified_at', 'TEXT');
  addColumn(db, 'companies', 'account', 'TEXT');
  addColumn(db, 'companies', 'lang', "TEXT NOT NULL DEFAULT 'et'");
  addColumn(db, 'companies', 'listid', "TEXT NOT NULL DEFAULT 'parnu'");
  db.exec('CREATE INDEX IF NOT EXISTS idx_msg_company ON messages(company_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_msg_acc ON messages(account, archived, unread)');
  return db;
}

// Ühtne allikas seed()-ile JA lib/seed-dedupe.mjs-ile, et need kaks kunagi
// lahku ei jookseks (uus seed-fail lisa SIIA, mitte ainult ühte kohta).
export const SEED_FILES = ['parnu.json', 'plaan.json', 'parnu2.json'];

export function seed(db, { seedDir = join(ROOT, 'seed') } = {}) {
  // parnu2.json = teine laine, 14.09.2026: 50 moodetud Parnumaa sihtmarki.
  const files = SEED_FILES;
  let inserted = 0;
  const existing = db.prepare('SELECT COUNT(*) AS n FROM companies').get().n;

  // need_evidence saab vaikimisi finding-valjast (moodetud leid on juba
  // legitiimne kontakti pohjendus) - vt lib/outbound.mjs currentSource(),
  // mis blokeerib IGA saatmise, kui need_evidence on tuhi. 20.09.2026.
  const ins = db.prepare(`
    INSERT INTO companies (id,name,seg,loc,regcode,turnover,email,email_note,url,priority,offer,price,
                           finding,why,angle,meet_day,subject,body,lang,listid,need_evidence,status,updated)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE((SELECT status FROM companies WHERE id = ?),'ootel'),?)
    ON CONFLICT(id) DO NOTHING
  `);
  const setMeta = db.prepare('INSERT INTO meta (k,v) VALUES (?,?) ON CONFLICT(k) DO NOTHING');
  const now = new Date().toISOString();

  for (const f of files) {
    const p = join(seedDir, f);
    if (!existsSync(p)) continue;
    const data = JSON.parse(readFileSync(p, 'utf8'));
    for (const c of data.companies) {
      const result = ins.run(
        c.id, c.name, c.seg ?? null, c.loc ?? null, c.regcode ?? null, c.turnover ?? null, c.email ?? null,
        c.email_note ?? null, c.url ?? null, c.priority ?? null, c.offer ?? null, c.price ?? null,
        c.finding ?? null, c.why ?? null, c.angle ?? null, c.day ?? null,
        c.subject ?? null, c.body ?? null, c.lang || 'et', c.listid || 'parnu',
        c.need_evidence ?? c.finding ?? null,
        c.id, now,
      );
      inserted += Number(result.changes);
      // ON CONFLICT DO NOTHING ei uuenda olemasolevat rida. Registrikood on
      // aga hiljem juurde tulnud väli (agent/registry-backfill.mjs, 20.09.2026)
      // ja see peab jõudma ka juba baasis olevatele ettevõtetele — muidu jääb
      // CRM-i vaade ilma stabiilse identiteedita. Täidame AINULT siis, kui
      // baasis on tühi: käsitsi parandatud koodi me üle ei kirjuta.
      if (c.regcode) {
        db.prepare("UPDATE companies SET regcode = ? WHERE id = ? AND (regcode IS NULL OR regcode = '')")
          .run(String(c.regcode), c.id);
      }
      // Sama lugu e-postiga (agent/registry-website-fallback.mjs, 20.09.2026):
      // see täidab ainult seed-faili, ON CONFLICT DO NOTHING ei uuenda juba
      // baasis olevat rida. Ilma selleta jääks baasis olev ettevõte ilma
      // e-postita, kuigi seed juba selle leidis — täpselt sama viga, mida
      // regcode'iga eespool juba parandati. Ei kirjuta üle: kui baasis on
      // juba mingi e-post (ka käsitsi parandatud), see jääb puutumata.
      if (c.email) {
        db.prepare("UPDATE companies SET email = ? WHERE id = ? AND (email IS NULL OR email = '')")
          .run(c.email, c.id);
      }
    }
    if (data.measured) setMeta.run('measured', data.measured);
    if (data.signature_text) setMeta.run('signature_text', data.signature_text);
    if (data.days) setMeta.run('days', JSON.stringify(data.days));
  }
  return { inserted, existingBefore: existing };
}

export function logActivity(db, companyId, kind, note) {
  db.prepare('INSERT INTO activity (company_id, ts, kind, note) VALUES (?,?,?,?)')
    .run(companyId, new Date().toISOString(), kind, note || null);
  db.prepare('UPDATE companies SET updated = ? WHERE id = ?').run(new Date().toISOString(), companyId);
}

if (process.argv.includes('--reseed')) {
  const db = open();
  console.log('Seeded:', seed(db, { force: true }));
  db.close();
}
