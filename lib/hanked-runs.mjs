// ULESANNE 7: kaivitaja. Nupp lehel -> lapsprotsess -> rida hanke_runs-is.
//
// Neli reeglit (disainidokument):
//   1. uks jooks korraga kasu kohta (teine paring -> 409);
//   2. serveri taaskaivitusel margitakse pooleli jaanud read katkestatuks;
//   3. "Peata" saadab SIGTERM-i;
//   4. veaga jooks jaab punasena nimekirja koos logi viimaste ridadega.
//
// Baasi kirjutab VANEM. Laps kirjutab ainult stdout-i JSON-ridu ({"progress":…,
// "rows":…} voi {"error":…}) - vt agent/hanked-sync.mjs teata().
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.mjs';

// Logi lagi on disainidokumendist (hanke_runs.log <= 4000 tm) - vaates naidatakse
// viimaseid ridu, mitte kogu jooksu.
export const LOG_MAX = 4000;
// Uhe REA lagi. Laps voib kirjutada pika rea ILMA reavahetuseta (stack trace,
// binaarne praht, katkine JSON) ja siis kasvaks vanema puhver piiramatult - see on
// serveri malu, mitte lapse oma. Karbe on NAHTAV (logisse laheb rida
// "[rida kärbitud: N märki]"), sest vaikne kadu on siin hullem kui puudulik logi.
export const RIDA_MAX = 65536;
// Logi kirjutatakse baasi perioodiliselt, mitte iga rea peale - vt lapseKuulajad.
export const LOOP_MS = 500;

// Serveri KAIVITUSE id. Uks protsess = uks vaartus. Vt migrateHanked kommentaari:
// pid uksi ei toesta, et jooks on meie oma.
export const BOOT_ID = randomUUID();

// Otsejooksu (Task Scheduler / kasurida, ilma serverita) boot_id-prefiks. See EI
// OLE ukski BOOT_ID vaartus, seega selliste ridade "oma" on alati false (vt
// runsView) ja "Peata" nuppu ei pakuta. Elab agent/hanked-sync.mjs
// alustaOtseJooks-is; cleanupOrphans kasutab sama prefiksit, et eristada
// soltumatut jooksu serveri-instantsi omast (vt cleanupOrphans allpool).
export const OTSE_BOOT = 'otse:';

// Valge nimekiri on AINUS tee kaskude juurde. Prototuubita objekt + Object.hasOwn:
// paljas CMD[cmd] laseks labi 'constructor' ja 'toString' (need on Object.prototype-l
// olemas ja toesed), mille jarel join(ROOT, undefined) annaks arusaamatu vea.
export const CMD = Object.freeze(Object.assign(Object.create(null), {
  sync: { script: 'agent/hanked-sync.mjs', label: 'Sünkroon' },
  history: { script: 'agent/hanked-history.mjs', label: 'Lae ajalugu' },
  docs: { script: 'agent/hanked-docs.mjs', label: 'Lae dokumendid' },
  gate: { script: 'test/gate-hanked.mjs', label: 'Värav' },
}));

const onKask = (cmd) => typeof cmd === 'string' && Object.hasOwn(CMD, cmd);

function viga(sonum, code = 400, lisa = {}) {
  const e = new Error(sonum);
  e.code = code;
  Object.assign(e, lisa);
  return e;
}

// `valmis` tuleb KETTALT, mitte kasitsi hoitavast lipust: agent/hanked-history.mjs
// (ulesanne 12) ja agent/hanked-docs.mjs (ulesanne 14) ei ole veel olemas ja kasitsi
// lipp jaaks nende valmimisel uuendamata - nupp oleks katki ilma uhegi punase testita.
export function cmdView(root = ROOT) {
  const out = {};
  for (const cmd of Object.keys(CMD)) {
    out[cmd] = { ...CMD[cmd], valmis: existsSync(join(root, CMD[cmd].script)) };
  }
  return out;
}

// --- argumendid ------------------------------------------------------------
// Shelli EI OLE (spawn ilma shell:true), seega shell-injectionit ei ole. Valve on
// argv-hugiene: '--k=v' kuju peab olema uheselt tagasi loetav ja argv-s ei tohi
// olla '[object Object]'.
const VOTI = /^[a-zA-Z][a-zA-Z0-9-]{0,30}$/;
const VAARTUS_MAX = 200;

export function valideeriArgs(args) {
  if (args === null || args === undefined) return {};
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw viga('Vigased argumendid: oodati objekti, saadi ' + (Array.isArray(args) ? 'massiiv' : typeof args));
  }
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (!VOTI.test(k)) throw viga('Vigane argumendi nimi: ' + JSON.stringify(k));
    if (v === null || v === undefined) continue; // "ei antud" ei ole viga
    const tyyp = typeof v;
    if (tyyp !== 'string' && tyyp !== 'number' && tyyp !== 'boolean') {
      throw viga('Vigane argumendi väärtus (' + k + '): oodati teksti, arvu või tõeväärtust, saadi '
        + (tyyp === 'object' ? 'objekt' : tyyp));
    }
    if (tyyp === 'number' && !Number.isFinite(v)) {
      throw viga('Vigane argumendi väärtus (' + k + '): ei ole kasutatav arv');
    }
    const s = String(v);
    if (s.length > VAARTUS_MAX) {
      throw viga('Argument ' + k + ' on liiga pikk: ' + s.length + ' märki (lubatud ' + VAARTUS_MAX + ')');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(s)) throw viga('Argument ' + k + ' sisaldab juhtmärki');
    // Vaartuses olev '=' teeks '--k=v' mitmemotteliseks (kumb pool on voti?).
    // Uhtegi teadaolevat argumenti see ei valista - vt CMD kasud.
    if (s.includes('=')) throw viga('Argument ' + k + ' sisaldab võrdusmärki');
    out[k] = s;
  }
  return out;
}

// node:sqlite annab lastInsertRowid tuubi number VOI bigint (soltub versioonist ja
// vaartuse suurusest). Segatuupidega ei klapiks === marsruudi JSON-i ja runsView
// vahel - ulesande 10 nupp ei leiaks oma jooksu. Normaliseerime piiril.
const nr = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};

// --- kaivitamine -----------------------------------------------------------

export function startRun(db, cmd, args = {}, { spawnFn = spawn, bootId = BOOT_ID, root = ROOT } = {}) {
  if (!onKask(cmd)) throw viga('Tundmatu käsk: ' + String(cmd));
  const kask = CMD[cmd];
  const puhtad = valideeriArgs(args);

  // Puuduv skript annab EESTIKEELSE vea siin, mitte arusaamatu Node-i vea lapses.
  const tee = join(root, kask.script);
  if (!existsSync(tee)) {
    throw viga(kask.label + ' ei ole veel valmis: skript puudub (' + kask.script + ')');
  }

  // AATOMNE LUKK: INSERT ise on kontroll (osaline unikaalindeks idx_runs_kaib).
  // Eraldi SELECT-kontrolli EI OLE - kaks paringut saaksid sellest molemad labi.
  let id;
  try {
    id = nr(db.prepare(`INSERT INTO hanke_runs (cmd, args, state, started, boot_id)
        VALUES (?, ?, 'käib', datetime('now'), ?)`).run(cmd, JSON.stringify(puhtad), bootId).lastInsertRowid);
  } catch (e) {
    if (!/UNIQUE constraint failed/i.test(String(e && e.message))) throw e;
    const kaib = db.prepare("SELECT id FROM hanke_runs WHERE cmd = ? AND state = 'käib'").get(cmd);
    throw viga(kask.label + ' käib juba', 409, { runId: nr(kaib && kaib.id) });
  }

  const argv = [tee, ...Object.entries(puhtad).map(([k, v]) => `--${k}=${v}`)];
  let laps;
  try {
    // HANKED_RUN_ID UTLEB LAPSELE, ET RIDA ON JUBA OLEMAS. Agendid (hanked-sync,
    // hanked-history) kirjutavad otsekaivitusel ISE hanke_runs rea - Task Scheduler
    // ei jata muidu uhtegi jalge. Nupust kaivitatuna on rida aga juba siin sees
    // tehtud JA ta hoiab osalist unikaalindeksit idx_runs_kaib: lapse oma INSERT
    // kukuks tapselt selle luku peale ja laps teataks "kaib juba — jai vahele",
    // ehk nupuvajutus ei teeks mitte midagi. Uks rida, uks kirjutaja.
    laps = spawnFn(process.execPath, argv, {
      cwd: root, windowsHide: true, env: { ...process.env, HANKED_RUN_ID: String(id) },
    });
  } catch (e) {
    // Ilma selleta jaaks 'käib' rida igaveseks kinni ja LUKUSTAKS kasu - nuppu ei
    // saaks enam kunagi vajutada, kuigi uhtegi protsessi ei kaivitunud.
    finishRun(db, id, { ok: false, error: 'Käivitamine ebaõnnestus: ' + lyhike(e) });
    throw e;
  }

  db.prepare('UPDATE hanke_runs SET pid = ? WHERE id = ?').run(nr(laps && laps.pid), id);
  lapseKuulajad(db, id, laps);
  return { id, state: 'käib', cmd, label: kask.label };
}

const lyhike = (e) => String((e && e.message) || e).replace(/\s+/g, ' ').trim().slice(0, 500);

// --- lapse stdout ----------------------------------------------------------

// Reastaja UHE vooga. Tagastab funktsiooni tukkide jaoks ja `lopeta` poolikule reale.
function reastaja(lisaRida, karbiTeade) {
  let puhver = '';
  let karbitud = 0;
  // Karbeteade tuleb karbitud rea JAREL, mitte ette: logi hoitakse LOG_MAX-i
  // jagu SABA ja ette pandud teade lipsaks tapselt selle pika rea taga valja -
  // ehk karbe oleks jalle vaikne.
  const rida = (r) => {
    // INVARIANT: lisaRida ei nae kunagi RIDA_MAX-ist pikemat rida. Ainult tukipoolne
    // kapp ei piisa - viimane tukk toob veel oma jao märke enne reavahetust kaasa,
    // ehk rida voiks olla RIDA_MAX + tuki jagu pikk.
    if (r.length > RIDA_MAX) { karbitud += r.length - RIDA_MAX; r = r.slice(0, RIDA_MAX); }
    lisaRida(r);
    if (karbitud) { lisaRida(karbiTeade(karbitud)); karbitud = 0; }
  };
  return {
    tukk(tk) {
      const read = (puhver + tk).split('\n');
      puhver = read.pop();
      for (const r of read) rida(r.replace(/\r$/, ''));
      if (puhver.length > RIDA_MAX) {
        // Hoiame rea ALGUSE (seal on JSON-i ja stack trace'i motekaim osa) ja
        // loeme ara visatud margid kokku.
        karbitud += puhver.length - RIDA_MAX;
        puhver = puhver.slice(0, RIDA_MAX);
      }
    },
    lopeta() {
      if (puhver) { rida(puhver.replace(/\r$/, '')); puhver = ''; }
      else if (karbitud) { lisaRida(karbiTeade(karbitud)); karbitud = 0; }
    },
  };
}

function lapseKuulajad(db, id, laps) {
  // PUHVERDATUD LOGI. Naiivne "loe-muuda-kirjuta iga rea peale" teeb sunkimisjooksu
  // peale sadu baasikirjutusi. Hullem: laps kirjutab SAMAL AJAL baasi oma
  // BEGIN IMMEDIATE tehinguga (agent/hanked-sync.mjs), mis hoiab kirjutuslukku kogu
  // tsukli valtel - vanem blokeeruks busy_timeout piirini IGA logirea peale.
  let logi = '';
  let progress = null;
  let read = null;
  let lapseViga = null;
  let lapseTyhjenes = false;
  let must = false;
  let viimaneBaasiViga = null;

  const uuenda = db.prepare(`UPDATE hanke_runs
      SET log = ?, progress = COALESCE(?, progress), rows = COALESCE(?, rows),
          error = COALESCE(error, ?)
      WHERE id = ?`);

  // Tagastab true, kui kirjutus onnestus. Luku peale EI KAOTA me andmeid: `must`
  // jaab pusti ja jargmine katse kirjutab sama puhvri uuesti.
  const kirjuta = () => {
    if (!must) return true;
    try {
      uuenda.run(logi, progress, read, lapseViga, id);
      must = false;
      return true;
    } catch (e) {
      viimaneBaasiViga = e;
      return false;
    }
  };

  const lisaRida = (r) => {
    if (r.length && r[0] === '{') {
      try {
        const o = JSON.parse(r);
        if (o && typeof o === 'object') {
          if (typeof o.progress === 'string') progress = o.progress;
          if (Number.isFinite(o.rows)) read = o.rows;
          // Lapse SISULINE viga (nt "RSS-i ei saanud: RHR vastas 502") on tapsem kui
          // vanema uldine "Protsess lõppes koodiga 1" - esimene voidab.
          if (typeof o.error === 'string' && o.error && lapseViga === null) lapseViga = o.error.slice(0, 500);
          // AUDIT P1 (22.09.2026): tyhjenes ei ole viga (o.error), vaid eraldi
          // lipp - laps ei viska erindit, lopeb koodiga 0. Ilma selleta arvutab
          // lopeta() ok-i AINULT valjumiskoodist ja "feed tuhjenes" jaab
          // markimata (vt agent/hanked-sync.mjs lopetaOtseJooks, mis sama
          // signaali juba oigesti loeb otsejooksu teel).
          if (o.tyhjenes === true) lapseTyhjenes = true;
        }
      } catch { /* tavaline logirida, mitte JSON */ }
    }
    logi = (logi + r + '\n').slice(-LOG_MAX);
    must = true;
  };

  const karbiTeade = (n) => '[rida kärbitud: ' + n + ' märki visati ära]';
  const valja = reastaja(lisaRida, karbiTeade);
  const vead = reastaja(lisaRida, karbiTeade);

  const kell = setInterval(kirjuta, LOOP_MS);
  kell.unref?.();

  laps.stdout?.on('data', (tk) => valja.tukk(String(tk)));
  laps.stderr?.on('data', (tk) => vead.tukk(String(tk)));

  const lopeta = (kood, signaal) => {
    clearInterval(kell);
    valja.lopeta();
    vead.lopeta();
    // Lukus baas: paar korduskatset (busy_timeout ootab ise) ja siis NAHTAV rida
    // serveri logis - vaikselt kaduv logi on tapselt see viga, mida see moodul valvab.
    for (let i = 0; i < 3 && !kirjuta(); i++) { /* busy_timeout on juba oodanud */ }
    if (must) console.error('[hanked] jooksu ' + id + ' logi ei saanud baasi: ' + lyhike(viimaneBaasiViga));
    // AUDIT P1: tyhjenes teeb jooksu vigaseks ka valjumiskoodiga 0 - sama
    // lepingu, mida agent/hanked-sync.mjs lopetaOtseJooks juba jargib
    // (ok: !r.tyhjenes) otsejooksu teel.
    const ok = kood === 0 && !signaal && !lapseTyhjenes;
    finishRun(db, id, {
      ok,
      error: ok ? null : (lapseTyhjenes ? 'Feed tühjenes — vaata hanke_sync rida' : (signaal ? 'Protsess sai signaali ' + signaal : 'Protsess lõppes koodiga ' + kood)),
    });
  };

  // 'close' MITTE 'exit'. 'exit' tuleb ENNE stdout-i voo tuhjenemist ja 'close'
  // parast - 'exit' kulge riputatud lopetamine kaotab viimased logiread (moodetud
  // paris lapsega, test/gate-hanked-runs.mjs plokk E).
  laps.on?.('close', lopeta);
  // spawn-viga (ENOENT) ei anna kunagi 'close'-i. finishRun on `WHERE state='käib'`
  // taga, seega teine kutse on no-op - kaks korda ei kirjutata.
  laps.on?.('error', (e) => {
    clearInterval(kell);
    finishRun(db, id, { ok: false, error: 'Protsessi viga: ' + lyhike(e) });
  });
}

// --- lopetamine ------------------------------------------------------------

// `WHERE state = 'käib'` on IDEMPOTENTSUSE valve: peatatud jooksu ('katkestatud')
// ei tohi lapse close-sundmus tagantjarele "tehtuks" kirjutada.
// `error = COALESCE(error, ?)` hoiab lapse enda veateate alles.
export function finishRun(db, id, { ok = true, rows = null, error = null } = {}) {
  const i = nr(id);
  if (i === null) return false;
  const r = db.prepare(`UPDATE hanke_runs
      SET state = ?, finished = datetime('now'), rows = COALESCE(?, rows), error = COALESCE(error, ?)
      WHERE id = ? AND state = 'käib'`).run(ok ? 'tehtud' : 'viga', nr(rows), error, i);
  return Number(r.changes) > 0;
}

const elab = (pid) => { try { return process.kill(pid, 0), true; } catch { return false; } };
const tapa = (pid) => process.kill(pid, 'SIGTERM');

export function stopRun(db, id, { kill = tapa, bootId = BOOT_ID } = {}) {
  const i = nr(id);
  if (i === null) return { ok: false, error: 'Vigane jooksu id' };
  const r = db.prepare("SELECT id, pid, boot_id FROM hanke_runs WHERE id = ? AND state = 'käib'").get(i);
  if (!r) return { ok: false, error: 'See jooks ei käi' };

  // VOORAST PID-I EI TAPETA. Parast serveri taaskaivitust voib sama pid kuuluda
  // suvalisele protsessile - kill() tapaks siis kellegi teise too.
  const oma = r.boot_id === bootId;
  const margi = db.prepare(`UPDATE hanke_runs SET state = 'katkestatud', finished = datetime('now'),
      error = COALESCE(error, ?) WHERE id = ? AND state = 'käib'`);
  if (!oma) {
    margi.run('Server taaskäivitati — jooks jäi eelmisest serverist pooleli, pid-i ei tapetud', i);
    return { ok: true, tapetud: false, error: 'Jooks kuulub eelmisele serverile — märgitud katkestatuks' };
  }
  let tapetud = false;
  if (r.pid) {
    try { kill(nr(r.pid)); tapetud = true; } catch { /* juba surnud */ }
  }
  margi.run(null, i);
  return { ok: true, tapetud };
}

// Orb = jooks, mille peale ei ole enam kedagi ootamas. Kolm juhtu:
//   1. rida kannab OTSE_BOOT-prefiksit (sõltumatu jooks, Task Scheduler/kasurida) -
//      see EI SÕLTU serveri elueast, seega kontrollime PID-i elususe, mitte
//      boot_id vastavust. Sama muster mis agent/hanked-sync.mjs
//      alustaOtseJooks-is (audit P1, 22.09.2026 - vana kood tabas neid ALATI,
//      olenemata sellest, kas protsess elas);
//   2. rida kuulub TEISELE SERVERI-instantsile (boot_id ei klapi ega kanna
//      OTSE_BOOT prefiksit) - siis on ta orb ALATI, olenemata pid-ist, ja pid-i
//      EI KUSITA ega TAPETA (vt stopRun-i sama pohjendust: parast taaskaivitust
//      voib sama pid kuuluda kellelegi teisele);
//   3. rida on meie oma (sama boot_id), aga protsessi enam ei ole.
export function cleanupOrphans(db, { alive = elab, bootId = BOOT_ID } = {}) {
  const read = db.prepare("SELECT id, pid, boot_id FROM hanke_runs WHERE state = 'käib'").all();
  const margi = db.prepare(`UPDATE hanke_runs SET state = 'katkestatud', finished = datetime('now'),
      error = COALESCE(error, ?) WHERE id = ? AND state = 'käib'`);
  let n = 0;
  for (const r of read) {
    const boot = String(r.boot_id || '');
    let pohjus = null;
    if (boot.startsWith(OTSE_BOOT)) {
      if (r.pid && alive(nr(r.pid))) continue; // elav otsejooks - jäta puutumata
      pohjus = 'Otsejooks suri (pid ei ela)';
    } else if (boot !== bootId) {
      pohjus = 'Server taaskäivitati — eelmise serveri jooks jäi pooleli';
    } else if (!r.pid) {
      pohjus = 'Server taaskäivitati — jooksul ei ole pid-i';
    } else if (!alive(nr(r.pid))) {
      pohjus = 'Server taaskäivitati või protsess suri — pid ' + r.pid + ' ei ela';
    }
    if (!pohjus) continue;
    margi.run(pohjus, nr(r.id));
    n++;
  }
  return n;
}

// `oma` utleb vaatele (ulesanne 10), kas "Peata" nupp saab uldse midagi teha.
export function runsView(db, limit = 5, { bootId = BOOT_ID } = {}) {
  const n = Math.min(Math.max(Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 5, 1), 100);
  return db.prepare('SELECT * FROM hanke_runs ORDER BY id DESC LIMIT ?').all(n)
    .map((r) => ({ ...r, id: nr(r.id), rows: nr(r.rows), pid: nr(r.pid), oma: r.boot_id === bootId }));
}
