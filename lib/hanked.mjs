// Riigihangete radari andmekiht: hanked, lepingud, sunkimislogi ja jooksud.
// Migratsioon on LISAV (salesdb mustri jargi) - olemasolevaid tabeleid ei puutu.
//
// Reegel: avastusvaljad (RHR-ist tulev info) uuenevad sunkimisel,
// inimese omad (state, note) EI uuene kunagi ule.

export const HANKE_STATES = ['uus','vaatan','valmistun','esitatud','voidetud','kaotatud','jatsin','aegunud'];

export function migrateHanked(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hanked (
      ref TEXT PRIMARY KEY NOT NULL,
      rhr_id TEXT, buyer TEXT, buyer_reg TEXT, title TEXT NOT NULL,
      menetlus TEXT, nature TEXT, est INTEGER, cpv TEXT,
      deadline TEXT, published TEXT, segment TEXT,
      score INTEGER, score_why TEXT,
      state TEXT NOT NULL DEFAULT 'uus'
        CHECK (state IN ('uus','vaatan','valmistun','esitatud','voidetud','kaotatud','jatsin','aegunud')),
      note TEXT,
      docs_dir TEXT, docs_count INTEGER NOT NULL DEFAULT 0,
      seen TEXT NOT NULL DEFAULT (datetime('now')),
      updated TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS hanke_lepingud (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT, date TEXT NOT NULL, buyer TEXT, title TEXT, cpv TEXT,
      winner TEXT, winner_reg TEXT, winner_size TEXT,
      amount INTEGER, tenders INTEGER, menetlus TEXT, segment TEXT
    );
    -- SQLite-s ei ole kaks NULL-i vordsed, seega tabelisisene UNIQUE laseks identsed
    -- poolikud read mitu korda sisse. Avaldisindeks normaliseerib NULL-id enne vordlust.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lep_uniq
      ON hanke_lepingud(COALESCE(ref,''), COALESCE(winner_reg,''), COALESCE(amount,-1));
    CREATE INDEX IF NOT EXISTS idx_lep_cpv ON hanke_lepingud(cpv);
    CREATE INDEX IF NOT EXISTS idx_lep_date ON hanke_lepingud(date);
    CREATE TABLE IF NOT EXISTS hanke_sync (
      key TEXT PRIMARY KEY, ts TEXT NOT NULL, rows INTEGER, ok INTEGER NOT NULL DEFAULT 1, note TEXT
    );
    CREATE TABLE IF NOT EXISTS hanke_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cmd TEXT NOT NULL, args TEXT, state TEXT NOT NULL,
      started TEXT NOT NULL, finished TEXT,
      progress TEXT, rows INTEGER, log TEXT, error TEXT, pid INTEGER
    );
  `);
}

// RSS annab puuduva valja tuupiliselt tuhja stringina - COALESCE kaitseb ainult NULL-i eest,
// seega normaliseerime sisendi ENNE SQL-i. Tuhi vaartus = "ei tea", mitte "kustuta".
const puhas = (v) => (v === '' || v === undefined ? null : v);

const FIELDS = ['rhr_id','buyer','buyer_reg','title','menetlus','nature','est','cpv','deadline','published','segment'];

// Ettevalmistatud laused on kallid - hoiame neid baasi kohta vahemalus.
// WeakMap: kui baas suletakse ja unustatakse, laheb ka vahemalu prugiks.
const CACHE = new WeakMap();

function laused(db) {
  let c = CACHE.get(db);
  if (!c) {
    c = {
      sel: db.prepare('SELECT ref FROM hanked WHERE ref = ?'),
      ins: db.prepare(`INSERT INTO hanked (ref,${FIELDS.join(',')}) VALUES (?,${FIELDS.map(() => '?').join(',')})`),
      upd: db.prepare(`UPDATE hanked SET ${FIELDS.map((f) => f + ' = COALESCE(?, ' + f + ')').join(', ')},
              updated = datetime('now') WHERE ref = ?`),
    };
    CACHE.set(db, c);
  }
  return c;
}

export function upsertHange(db, h) {
  if (!h.ref) throw new Error('hange ilma viitenumbrita — RHR-i kirje on vigane');
  const q = laused(db);
  const vaartused = FIELDS.map((f) => puhas(h[f]));
  if (!q.sel.get(h.ref)) {
    // Uuel hankel peab pealkiri olema; olemasoleval hoiab tuhi vaartus vana alles (COALESCE).
    if (!h.title) throw new Error('hange ' + h.ref + ' ilma pealkirjata');
    q.ins.run(h.ref, ...vaartused);
    return 'uus';
  }
  // Avastusvaljad uuenevad, inimese omad (state, note) EI uuene kunagi.
  q.upd.run(...vaartused, h.ref);
  return 'uuendatud';
}

export function listHanked(db, { state = null } = {}) {
  const sql = 'SELECT * FROM hanked' + (state ? ' WHERE state = ?' : '') + " ORDER BY COALESCE(NULLIF(deadline,''),'9999') ASC, ref ASC";
  return state ? db.prepare(sql).all(state) : db.prepare(sql).all();
}
