// Riigihangete radari andmekiht: hanked, lepingud, sunkimislogi ja jooksud.
// Migratsioon on LISAV (salesdb mustri jargi) - olemasolevaid tabeleid ei puutu.
//
// Reegel: avastusvaljad (RHR-ist tulev info) uuenevad sunkimisel,
// inimese omad (state, note) EI uuene kunagi ule.

export const HANKE_STATES = ['uus','vaatan','valmistun','esitatud','voidetud','kaotatud','jatsin','aegunud'];

// Migratsioon on lisav: CREATE TABLE IF NOT EXISTS ei muuda olemasolevat tabelit.
// ULESANNE 8: enne serveriga uhendamist tuleb kontrollida, kas mone baasi hanked-tabel
// on loodud VANA skeemiga (ref ilma NOT NULL-ita, state ilma CHECK-ita, lepingutel
// tabelisisene UNIQUE) - see vajab eraldi umberehitust, mitte seda funktsiooni.
export function migrateHanked(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hanked (
      ref TEXT PRIMARY KEY NOT NULL,
      rhr_id TEXT, buyer TEXT, buyer_reg TEXT, title TEXT NOT NULL,
      menetlus TEXT, nature TEXT, est INTEGER, cpv TEXT,
      deadline TEXT, published TEXT, segment TEXT,
      score INTEGER, score_why TEXT,
      state TEXT NOT NULL DEFAULT 'uus'
        CHECK (state IN (${HANKE_STATES.map((s) => `'${s}'`).join(',')})),
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

// RSS ja HTML annavad puuduva valja tuupiliselt tuhja stringina voi tuhikutena ('\n  '),
// COALESCE kaitseb ainult NULL-i eest - seega normaliseerime sisendi ENNE SQL-i.
// Tuhi vaartus = "ei tea", mitte "kustuta".
// Nullpikkusega tuhikud (\u200b-\u200d) ja BOM (\ufeff) tulevad HTML-ist ja RSS-ist labi
// nahtamatult: trim() ei puutu neid, seega '\u200b' naeks valja nagu paris vaartus ja
// kirjutaks head andmed ule. Koorime formaadimargid maha ENNE trimmi.
const puhas = (v) => {
  const s = typeof v === 'string' ? v.replace(/[\u200b-\u200d\ufeff]/g, '').trim() : v;
  return (s === '' || s === undefined) ? null : s;
};

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

// Kui baas on vahepeal suletud ja uuesti avatud, on vanad laused lopetatud
// ("statement has been finalized"). Siis viskame vahemalu ara ja proovime uks kord uuesti.
function proovi(db, too) {
  try {
    return too(laused(db));
  } catch (e) {
    if (!String(e && e.message).includes('finalized')) throw e;
    CACHE.delete(db);
    return too(laused(db));
  }
}

// Viitenumbri normaliseerimine on UKS koht - nii upsert kui inimese teed (setState,
// setNote) peavad sama sisendi juures sama rea leidma.
// JS-i number seotaks REAL-ina ja TEXT-afiinsus teeks sellest '12345.0' - seega
// sunnime viitenumbri piiril stringiks.
// String() teeks ka vaartustest false / {} / NaN nagusa viite ('false', '[object Object]',
// 'NaN') ja need joudsid baasi rampsreana - seega valvame ka tuupi. NULL ja undefined
// lahevad edasi tapsema sonumi juurde, sest "valja ei ole" on muu viga kui "vali on katki".
function viide(ref) {
  if (ref !== null && ref !== undefined && typeof ref !== 'string' && !Number.isFinite(ref)) {
    throw new Error('hange vigase viitenumbriga — RHR-i kirje on vigane');
  }
  const s = String(ref ?? '').trim();
  if (!s) throw new Error('hange ilma viitenumbrita — RHR-i kirje on vigane');
  return s;
}

export function upsertHange(db, h) {
  const ref = viide(h.ref);
  const vaartused = FIELDS.map((f) => puhas(h[f]));
  return proovi(db, (q) => {
    if (!q.sel.get(ref)) {
      // Uuel hankel peab pealkiri olema; olemasoleval hoiab tuhi vaartus vana alles (COALESCE).
      // Kontrollime normaliseeritud vaartust, et ka '   ' loeks puuduvaks.
      if (vaartused[FIELDS.indexOf('title')] == null) throw new Error('hange ' + ref + ' ilma pealkirjata');
      q.ins.run(ref, ...vaartused);
      return 'uus';
    }
    // Avastusvaljad uuenevad, inimese omad (state, note) EI uuene kunagi.
    q.upd.run(...vaartused, ref);
    return 'uuendatud';
  });
}

export function listHanked(db, { state = null } = {}) {
  const sql = 'SELECT * FROM hanked' + (state ? ' WHERE state = ?' : '') + " ORDER BY COALESCE(NULLIF(deadline,''),'9999') ASC, ref ASC";
  return state ? db.prepare(sql).all(state) : db.prepare(sql).all();
}

// Inimese teed: seis ja markus. NEED laused EI lahe lausete vahemallu (laused(db)):
// vahemalu ehitatakse innukalt, seega laheks iga sunkimisjooks valmistama kolm lauset,
// mida ta kunagi ei kasuta (ja lohuks vahemalu invariandi "kolm lauset baasi kohta").
// Need kutsed tulevad uhekaupa kasutaja tegevusest, mitte tsuklist - uks prepare kutse
// kohta on siin odavam ja lihtsam, ning varskelt valmistatud lause ei saa olla
// "finalized", seega ei vaja nad ka korduskatset.
export function setState(db, ref, state) {
  if (!HANKE_STATES.includes(state)) throw new Error('Tundmatu seis: ' + state);
  const r0 = viide(ref);
  const r = db.prepare("UPDATE hanked SET state = ?, updated = datetime('now') WHERE ref = ?").run(state, r0);
  if (!r.changes) throw new Error('Hanget ei leitud: ' + r0);
  return { ok: true };
}

// Tuhi markus on NULL, mitte '' - muidu ei saa enam kusida "millistel hangetel on markus".
export function setNote(db, ref, note) {
  const r0 = viide(ref);
  const r = db.prepare("UPDATE hanked SET note = ?, updated = datetime('now') WHERE ref = ?")
    .run(note?.trim() ? note.trim() : null, r0);
  if (!r.changes) throw new Error('Hanget ei leitud: ' + r0);
  return { ok: true };
}

// Aegub ainult see, mida inimene ei ole veel puutunud: seisust 'uus' edasi liikunud
// hange kannab inimese otsust ja masin ei tohi seda ule kirjutada.
// NULLIF(deadline,'') on sama reegel mis listHanked-is: tuhi tahtaeg = "ei tea",
// mitte "ammu mooda" - ilma selleta aeguks tahtajata hange kohe.
export function markExpired(db, today = new Date().toISOString().slice(0, 10)) {
  return db.prepare(`UPDATE hanked SET state = 'aegunud', updated = datetime('now')
      WHERE state = 'uus' AND NULLIF(deadline,'') IS NOT NULL AND deadline < ?`).run(today).changes;
}
