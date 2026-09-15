// Agent persistence only. Importing this module never opens or changes a database.
import { createHash, randomUUID } from 'node:crypto';
export const RUNTIME_VERSION = 'codex-data-v1';
export const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function messageVersion(m) {
  return fingerprint([m.account, m.mailbox, m.uid, m.source_id ?? null, m.msgid,
    m.ts, m.addr, m.subject, m.body_text, m.replied, m.archived, m.deleted,
    m.reply_intent ?? 'unknown']);
}
function addColumn(db, table, name, type) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}
export function migrateAgent(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'ootel',
      attempts INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      created TEXT NOT NULL,
      started TEXT, finished TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER,
      type TEXT NOT NULL,
      model TEXT,
      exit_code INTEGER,
      num_turns INTEGER,
      total_cost_usd REAL,
      duration_ms INTEGER,
      session_id TEXT,
      ok INTEGER NOT NULL DEFAULT 0,
      stderr_tail TEXT,
      ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      uid INTEGER NOT NULL,
      company_id TEXT,
      lang TEXT NOT NULL DEFAULT 'et',
      subject TEXT,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'mustand',
      edit_notes TEXT,
      reason TEXT,
      job_id INTEGER,
      created TEXT NOT NULL,
      edited TEXT,
      requested TEXT,
      closed TEXT,
      UNIQUE (account, uid)
    );
    CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON agent_jobs(status, id);
    CREATE INDEX IF NOT EXISTS idx_runs_job ON agent_runs(job_id);
  `);
  const cols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  const add = (c, d) => { if (!cols.includes(c)) db.exec(`ALTER TABLE messages ADD COLUMN ${c} ${d}`); };
  add('category', 'TEXT');
  add('urgency', 'TEXT');
  add('classified', 'INTEGER NOT NULL DEFAULT 0');
  add('suspicious', 'INTEGER NOT NULL DEFAULT 0');
  add('confidence', 'REAL');
  add('summary', 'TEXT');
  add('suggest_archive', 'INTEGER NOT NULL DEFAULT 0');
  add('review', 'INTEGER NOT NULL DEFAULT 0');
  add('reply_intent', "TEXT NOT NULL DEFAULT 'unknown'");
  for (const [name, type] of Object.entries({ dedupe_key: 'TEXT', lease_owner: 'TEXT', lease_until: 'TEXT',
    source_version: 'TEXT', depends_on: 'INTEGER', runtime_version: 'TEXT' })) addColumn(db, 'agent_jobs', name, type);
  for (const [name, type] of Object.entries({ provider: 'TEXT', effort: 'TEXT', runtime_version: 'TEXT',
    input_tokens: 'INTEGER', cached_input_tokens: 'INTEGER', output_tokens: 'INTEGER', error_code: 'TEXT' })) addColumn(db, 'agent_runs', name, type);
  for (const [name, type] of Object.entries({ mailbox: 'TEXT', source_id: 'TEXT', revision: 'INTEGER NOT NULL DEFAULT 1',
    content_hash: 'TEXT', source_version: 'TEXT' })) addColumn(db, 'drafts', name, type);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_dedupe ON agent_jobs(dedupe_key) WHERE dedupe_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS agent_runtime_state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_draft_versions (draft_id INTEGER NOT NULL, revision INTEGER NOT NULL,
      subject TEXT, body TEXT, content_hash TEXT NOT NULL, source_version TEXT, job_id INTEGER,
      ts TEXT NOT NULL, PRIMARY KEY(draft_id, revision));`);
  db.prepare("UPDATE agent_jobs SET status='needs_human',error='legacy_job_requires_review',finished=? WHERE runtime_version IS NULL AND status='ootel'").run(new Date().toISOString());
  db.exec('CREATE INDEX IF NOT EXISTS idx_msg_classified ON messages(classified, direction, archived)');
}

export function enqueue(db, type, payload = {}, model = null, options = {}) {
  if (!['triage', 'draft', 'edit'].includes(type)) throw new Error('unknown_job_type');
  payload = { ...payload };
  if (payload.message_id && !payload.source_hash) {
    const i = payload.message_id.lastIndexOf(':');
    const m = db.prepare('SELECT * FROM messages WHERE mailbox=? AND uid=?')
      .get(payload.message_id.slice(0, i), Number(payload.message_id.slice(i + 1)));
    if (m) payload.source_hash = messageVersion(m);
  }
  // Generic triage requests share one outstanding slot. Explicit batches dedupe by their source revisions.
  const key = options.dedupeKey ?? fingerprint([RUNTIME_VERSION, type, payload]);
  const prior = db.prepare('SELECT id FROM agent_jobs WHERE dedupe_key=?').get(key);
  if (prior) return prior.id;
  const r = db.prepare(`INSERT OR IGNORE INTO agent_jobs
    (type,payload,model,created,dedupe_key,source_version,depends_on,runtime_version) VALUES (?,?,?,?,?,?,?,?)`)
    .run(type, JSON.stringify(payload), model, new Date().toISOString(), key, payload.source_hash ?? null,
      options.dependsOn ?? null, RUNTIME_VERSION);
  if (!r.changes) return db.prepare('SELECT id FROM agent_jobs WHERE dedupe_key=?').get(key).id;
  return Number(r.lastInsertRowid);
}

export function claimNext(db, type = null, { owner = randomUUID(), now = new Date(), leaseMs = 900000 } = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const stamp = now.toISOString();
    db.prepare(`UPDATE agent_jobs SET status='needs_human', error='lease_expired', finished=?,
      lease_owner=NULL, lease_until=NULL WHERE status='tootab' AND (lease_until IS NULL OR lease_until < ?)`)
      .run(stamp, stamp);
    db.prepare(`UPDATE agent_jobs SET status='needs_human', error='dependency_failed', finished=?
      WHERE status='ootel' AND depends_on IN (SELECT id FROM agent_jobs WHERE status IN ('needs_human','cancelled'))`).run(stamp);
    const row = db.prepare(`UPDATE agent_jobs SET status='tootab', started=?, attempts=attempts+1,
        lease_owner=?, lease_until=? WHERE id=(SELECT j.id FROM agent_jobs j
        WHERE j.status='ootel' AND (? IS NULL OR j.type=?)
          AND (j.depends_on IS NULL OR EXISTS(SELECT 1 FROM agent_jobs p WHERE p.id=j.depends_on AND p.status='tehtud'))
        ORDER BY j.id LIMIT 1) AND status='ootel' RETURNING *`)
      .get(stamp, owner, new Date(now.getTime() + leaseMs).toISOString(), type, type);
    db.exec('COMMIT');
    return row ? { ...row, payload: row.payload ? JSON.parse(row.payload) : {} } : null;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function finishJob(db, id, status, error = null, owner = null) {
  const r = db.prepare(`UPDATE agent_jobs SET status=?, finished=?, error=?, lease_owner=NULL, lease_until=NULL
    WHERE id=? AND (? IS NULL OR (lease_owner=? AND lease_until>=?))`)
    .run(status, new Date().toISOString(), error, id, owner, owner, new Date().toISOString());
  if (!r.changes) throw new Error('job_lease_lost');
}

export function assertLease(db, job) {
  const row = db.prepare("SELECT id FROM agent_jobs WHERE id=? AND status='tootab' AND lease_owner=? AND lease_until>=?")
    .get(job.id, job.lease_owner, new Date().toISOString());
  if (!row) throw new Error('job_lease_lost');
}
export function runtimePause(db) { return db.prepare("SELECT v FROM agent_runtime_state WHERE k='pause'").get()?.v ?? null; }
export function pauseRuntime(db, reason) { db.prepare("INSERT INTO agent_runtime_state(k,v) VALUES('pause',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(reason); }
export function resumeRuntime(db) { db.prepare("DELETE FROM agent_runtime_state WHERE k='pause'").run(); }

export function recordRun(db, r) {
  db.prepare(`INSERT INTO agent_runs
    (job_id,type,model,exit_code,num_turns,total_cost_usd,duration_ms,session_id,ok,stderr_tail,ts,
      provider,effort,runtime_version,input_tokens,cached_input_tokens,output_tokens,error_code)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    r.job_id ?? null, r.type, r.model ?? null, r.exit_code ?? null, r.num_turns ?? null,
    r.total_cost_usd ?? null, r.duration_ms ?? null, r.session_id ?? null,
    r.ok ? 1 : 0, r.stderr_tail ?? null, new Date().toISOString(), r.provider ?? null, r.effort ?? null,
    r.runtime_version ?? null, r.input_tokens ?? null, r.cached_input_tokens ?? null,
    r.output_tokens ?? null, r.error_code ?? null);
}

// Mustandi elukaar. 'saadetud' EI OLE agendi kaes - selle paneb server siis,
// kui inimene on CRM-is Saada vajutanud.
export const DRAFT_STATUS = ['mustand', 'toimetatud', 'ootab_kinnitust', 'saadetud', 'tagasi_lukatud'];

export function spentToday(db) {
  const d = new Date().toISOString().slice(0, 10);
  const r = db.prepare("SELECT COALESCE(SUM(total_cost_usd),0) AS s FROM agent_runs WHERE substr(ts,1,10)=?").get(d);
  return Number(r.s || 0);
}
