// ULESANNE 5: RSS -> baas. Uks jooks = uks tehing = uks rida hanke_sync-is.
// Kasutus: node agent/hanked-sync.mjs   (npm run hanked:sync)
//
// Tookorraldus: syncFromXml on puhas-ish (baas sisse, XML sisse, arvud valja) ja
// teda saab varavast ilma vorguta katsetada; main() on ainus koht, kus on vork.
//
// KES KIRJUTAB BAASI. Disainidokument utleb "baasi kirjutab ainult server; laps ei
// ava baasi" - see reegel sundis kumnete minutite pikkusest ajalooimpordist, kus kaks
// kirjutajat lukustavad teineteist. RSS-jooks kestab sekundeid ja open() paneb
// WAL + busy_timeout 5000, seega siin kirjutab laps ISE. Vastasel korral ei tooks
// `npm run hanked:sync` kasurealt mitte midagi ara, kuigi see on tana ainus tee
// (serveri marsruut tuleb ulesandes 11). Kui see kunagi muutub, on muudatus uhes
// kohas: server impordib syncFromXml-i ja main() jaab ainult JSON-ridu trukkima.
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { open } from '../lib/db.mjs';
import { migrateHanked, parseRss, upsertHange, markExpired, score,
  sarnasedLepingud, docsReast,
} from '../lib/hanked.mjs';
// Otsekaivitus kirjutab SAMASSE tabelisse, mida serveri kaivitaja kasutab (ulesanne 7).
// finishRun ja LOG_MAX tulevad sealt, mitte teise koopiana - kaks eri lopetajat
// tahendaks kaht eri 'tehtud'-definitsiooni.
import { finishRun, LOG_MAX, CMD, OTSE_BOOT } from '../lib/hanked-runs.mjs';
// OTSE_BOOT elab nüüd lib/hanked-runs.mjs-is (cleanupOrphans vajab sama
// prefiksit) - re-eksport, et olemasolevad importijad (test/gate-hanked.mjs)
// ei katkeks.
export { OTSE_BOOT };
import { laeTekst } from '../lib/hanked-net.mjs';

// URL on ulekirjutatav AINULT selleks, et varav saaks main()-i paris lapsprotsessina
// kohaliku serveri vastu jooksutada - ilma selleta jaaks vorguveakasitlus katsetamata.
const VAIKE_RSS = 'https://riigihanked.riik.ee/rhr/api/public/v1/rss';
const RSS = process.env.HANKED_RSS_URL || VAIKE_RSS;
const VOTI = 'rss';

// VALE ALLIKAGA JOOKS PEAB JATMA JALJE. SSRF-risk on vaike (lib/env.mjs loeb .env-i
// omaenda objekti, mitte process.env-i), aga ilma jaljeta ei ole tagantjarele
// NAHTAV, kust andmed tulid: 5 rida kohalikust katseserverist naeb vaates tapselt
// samasugune valja nagu 5 rida RHR-ist. Jalg on ainult siis, kui allikas EI OLE
// vaikevaartus - paris RHR-i pealt oleks see rida mura.
const ALLIKAS = (() => {
  if (RSS === VAIKE_RSS) return null;
  try { return new URL(RSS).host; } catch { return String(RSS).slice(0, 80); }
})();

const margiAllikas = (tekst, allikas = ALLIKAS) => (allikas ? tekst + ' · allikas: ' + allikas : tekst);
const AEGUMINE = 60000;

// Server (ulesanne 11) loeb neid ridu lapse stdout-ist. Uks rida = uks JSON.
//
// OTSEKAIVITUSEL EI LOE NEID KEEGI. Task Scheduler viskab lapse stdout-i ara,
// seega peab jalg jouma sinna, kust inimene teda nagunii vaatab: hanke_runs.log -
// tapselt sama veerg, mida serveri kaivitaja taidab. Faili EI KIRJUTATA: ei
// install-saatja.ps1 ega install-konduktor.ps1 suuna midagi logifaili, nende jalg
// on baasis, ja teine logikoht tahendaks teist tode.
let LOGI = '';
let VIIMANE_PROGRESS = null;
const teata = (o) => {
  if (o && typeof o.progress === 'string') VIIMANE_PROGRESS = o.progress;
  const rida = JSON.stringify(o);
  // Sama lagi mis serveri poolel (lib/hanked-runs.mjs) ja sama saba-loige:
  // pikk jooks ei tohi rida paisutada.
  LOGI = (LOGI + rida + '\n').slice(-LOG_MAX);
  process.stdout.write(rida + '\n');
};

// Veateade laheb baasi veergu ja sealt vaatesse: uks rida, piiratud pikkus.
const lyhike = (e) => String((e && e.message) || e).replace(/\s+/g, ' ').trim().slice(0, 500);

// Eesti keel: 1 kirje, 2 kirjet. Mitmus on ka nulli jaoks ("0 kirjet").
const vorm = (n, ainsus, mitmus) => n + ' ' + (n === 1 ? ainsus : mitmus);

// Mahakukkunud kirjed on NAHTAVAD. Ilma selleta naeb inimene sunkimislogis ainult
// "5 rida" ega tea, kas feedis oli 700 kirjet voi RHR muutis kujundust ja alles jai
// kaks. Numbrid on ammendavad - need liidetuna annavad feedi kirjete arvu, seega
// rida kontrollib ise ennast.
export function loendiTekst(loend) {
  return [
    vorm(loend.kirjeid, 'kirje', 'kirjet') + ' feedis',
    loend.nisis + ' nišis',
    vorm(loend.dublikaate, 'dublikaat', 'dublikaati'),
    loend.valjaspool + ' väljaspool nišši',
    vorm(loend.loetamatuid, 'loetamatu', 'loetamatut'),
  ].join(' · ');
}

// hanke_sync.key on PRIMARY KEY (vt migrateHanked), seega ON CONFLICT(key) on
// olemas - kontrollitud migratsioonist, mitte eeldatud.
const SYNC_SQL = `INSERT INTO hanke_sync (key, ts, rows, ok, note)
    VALUES (?, datetime('now'), ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET ts = excluded.ts, rows = excluded.rows,
      ok = excluded.ok, note = excluded.note`;

// VIGANE JOOKS PEAB JATMA JALJE. Kui ebaonnestumine ei kirjuta midagi, naitab vaade
// eelmist edukat aega ja inimene arvab, et sunk tootab - vaikne rike on siin hullem
// kui punane rida. Seda kutsub ka main() vorguvea peal, kus syncFromXml-ini ei joutud.
export function logiSync(db, { rows = null, ok = 1, note = null, key = VOTI } = {}) {
  migrateHanked(db);
  db.prepare(SYNC_SQL).run(key, rows, ok ? 1 : 0, note);
}

// Sunkroonne paus. setTimeout ei kolba: korduskatse peab juhtuma ENNE, kui
// funktsioon vastuse annab, ja main() ainsana on async - syncFromXml ei ole.
const oota = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

// SQLITE_BUSY (5) ja SQLITE_LOCKED (6). Korduskatse on LUKU jaoks, mitte pusiva rikke
// jaoks: kataloogi baasiks avamine ei parane ootamisega ja kolm pausi teeksid sellest
// ainult aeglase vea.
const LUKUS = (e) => Boolean(e)
  && (e.errcode === 5 || e.errcode === 6 || /locked|is busy/i.test(String((e && e.message) || '')));

// Baasivead lahevad vaatesse EESTI KEELES nagu koik muu selles failis. Moodetud oli
// {"error":"database is locked"} - ainus ingliskeelne teade kogu ahelas. Meie oma
// eestikeelsed vead (need ei kanna errcode'i) lahevad labi puutumata.
export const baasiViga = (e) => (LUKUS(e) || (e && e.code === 'ERR_SQLITE_ERROR')
  ? 'Baasi ei saanud kirjutada: ' + lyhike(e)
  : lyhike(e));

// open() JOOKSUTAB MIGRATSIOONE, ehk ta on kirjutaja. Kui server kirjutab samal
// hetkel, viskab ta "database is locked" ja main() sureb ilma uheainsa stdout-i
// JSON-reata - ulesande 11 server ei saaks isegi veateadet naidata. Tegu on
// LUHIAJALISE konkurentsiga (serveri kirjutus kestab millisekundeid), seega paar
// korduskatset lahendab selle taielikult; pusiv lukk peab endiselt valja tulema.
export function avaBaas({ katseid = 3, paus = 2000, ...valikud } = {}) {
  let viimane = null;
  for (let katse = 1; katse <= katseid; katse++) {
    try { return open(valikud); } catch (e) {
      viimane = e;
      if (!LUKUS(e) || katse === katseid) break;
      oota(paus);
    }
  }
  throw viimane;
}

// OK = 0 JALG KAOB TAPSELT SIIS, KUI TEDA KOIGE ROHKEM VAJA ON. logiSync vajab SAMA
// kirjutuslukku, mille peale jooks ise kukkus: tuhi catch neelas "database is locked" alla ja
// hanke_sync jai vanale reale ok = 1 - vaade naitas rohelist, kuigi jooks kukkus.
// Seega: paar korduskatset, ja kui jalge IKKAGI ei onnestu jatta, laheb see fakt
// stdout-i ({"jalgeta": true}), et ulesande 11 server teaks vaate olevat vana.
//
// ULESANNE 11 (varskus): jooksu tervist EI TOHI lugeda ainult hanke_sync.ok pealt -
// see lipp ei liigu, kui jalge ei saanud jatta. Varskus tuleb arvutada hanke_sync.ts
// pealt: punane, kui rida on vanem kui 2x sunkimisintervall.
export function logiSyncKindel(db, valikud = {}, { katseid = 3, paus = 300 } = {}) {
  let viimane = null;
  for (let katse = 1; katse <= katseid; katse++) {
    try { logiSync(db, valikud); return true; } catch (e) {
      viimane = e;
      // Muu kui lukk (katkine skeem, ketas tais) ei parane ootamisega.
      if (!LUKUS(e) || katse === katseid) break;
      oota(paus);
    }
  }
  teata({ error: valikud.note || lyhike(viimane), jalgeta: true, baas: baasiViga(viimane) });
  return false;
}

// --- OTSEKAIVITUSE JOOKSURIDA ---------------------------------------------
//
// PROBLEEM. Ulesanne 7 tegi hanke_runs SERVERI kaivitaja jaoks: nupp -> lapsprotsess
// -> rida, mille kirjutab VANEM. Task Scheduler kutsub aga seda faili OTSE, ilma
// vanemata - ja siis ei ole oisest jooksust CRM-i vaates MITTE UHTEGI jalge, ainult
// hanke_sync rida. Plaan lubab ise: "Oine Task Scheduleri jooks kirjutab samasse
// tabelisse." Seega kirjutab laps otsekaivitusel rea ISE.
//
// boot_id = 'otse:<uuid>'. See EI OLE ukski serveri BOOT_ID, seega runsView annab
// oma = false ja vaade ei paku "Peata" nuppu - ta ei tohikski, sest see pid ei
// kuulu serverile ja parast masina taaskaivitust voib ta kuuluda kellelegi teisele.
// (OTSE_BOOT konstant ise elab lib/hanked-runs.mjs-is, imporditud ja
// re-eksporditud ülalt.)
const OTSE_CMD = 'sync';

const nr = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};

// EPERM tahendab "protsess on olemas, aga ei ole minu oma" - see on ELAV.
const pidElab = (pid) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return Boolean(e) && e.code === 'EPERM'; }
};

const ORVU_POHJUS = 'Eelmine ajastatud jooks katkes (masin kustus või protsess suri) — jäi pooleli';

// Ulesande 7 OSALINE UNIKAALINDEKS idx_runs_kaib(cmd) WHERE state='käib' on
// AATOMNE LUKK. Naiivne INSERT kukuks siin "UNIQUE constraint failed" veaga -
// ingliskeelne SQLite-teade keset ood, mille peale Task Scheduler naitab punast ja
// keegi ei saa aru, et CRM lihtsalt sunkis parasjagu ise.
//
// Kaks erinevat olukorda, kaks erinevat vastust:
//   1. lukku hoiab ELAV jooks (serveri nupp voi teine ajastatud jooks) -> jaame
//      VAHELE. See ei ole rike: sama too tehakse nagunii ara ja kaks paralleelset
//      BEGIN IMMEDIATE-i ainult lukustaksid teineteist.
//   2. lukku hoiab MEIE OMA surnud jooks -> koristame ta ise. Otsejooksu taga EI
//      OLE serverit, kes cleanupOrphans-iga koristaks; ilma selleta jaaks uks
//      kustunud masin sunkimise IGAVESEKS kinni, ilma uhegi punase reata.
// VOORAST rida (serveri boot_id) me EI puutu kunagi - see on serveri too.
//
// KASK ON PARAMEETER: ulesande 12 ajaloo import (cmd = 'history') kaib SAMA teed ja
// tema lukk on OMA - kuine ajalugu ja paevane sunk ei tohi teineteist vahele jatta.
//
// SERVERI LAPS EI TEE OMA RIDA. Kui jooksu kaivitas CRM-i nupp (lib/hanked-runs.mjs
// startRun), on rida juba olemas ja VANEM kirjutab teda; laps saab tema id
// keskkonnamuutujas HANKED_RUN_ID. Ilma selle valveta kukuks laps oma INSERT-iga
// tapselt sellesse lukku, mille vanem hetk tagasi votis, ja teataks "kaib juba" -
// ehk nupuvajutus ei teeks MITTE MIDAGI ja jalg utleks, et jooks jai vahele.
export function alustaOtseJooks(db, { pid = process.pid, elab = pidElab, bootId = null,
  cmd = OTSE_CMD, vanemaJooks = process.env.HANKED_RUN_ID } = {}) {
  migrateHanked(db);
  const vanem = nr(vanemaJooks);
  if (vanem !== null) return { id: null, vanem, bootId: null, pohjus: null, blokeerija: null };
  const silt = (CMD[cmd] && CMD[cmd].label) || cmd;
  const boot = bootId || OTSE_BOOT + randomUUID();
  const lisa = () => nr(db.prepare(`INSERT INTO hanke_runs (cmd, args, state, started, boot_id, pid)
      VALUES (?, '{}', 'käib', datetime('now'), ?, ?)`).run(cmd, boot, pid).lastInsertRowid);

  // Kaks katset: esimene kukub luku peale, teine jookseb koristatud luku pealt.
  for (let katse = 1; katse <= 2; katse++) {
    try { return { id: lisa(), vanem: null, bootId: boot, pohjus: null, blokeerija: null }; } catch (e) {
      if (!/UNIQUE constraint failed/i.test(String(e && e.message))) throw e;
      const kaib = db.prepare("SELECT id, pid, boot_id FROM hanke_runs WHERE cmd = ? AND state = 'käib'")
        .get(cmd);
      const meieOrb = Boolean(kaib) && String(kaib.boot_id || '').startsWith(OTSE_BOOT)
        && !elab(nr(kaib.pid));
      if (!meieOrb || katse === 2) {
        return {
          id: null,
          vanem: null,
          bootId: boot,
          blokeerija: kaib ? nr(kaib.id) : null,
          pohjus: silt + ' käib juba' + (kaib ? ' (jooks ' + kaib.id + ')' : '')
            + ' — ajastatud jooks jäi vahele',
        };
      }
      db.prepare(`UPDATE hanke_runs SET state = 'katkestatud', finished = datetime('now'),
          error = COALESCE(error, ?) WHERE id = ? AND state = 'käib'`).run(ORVU_POHJUS, nr(kaib.id));
    }
  }
  // Siia ei joua: tsukkel tagastab molemal katsel.
  return { id: null, vanem: null, bootId: boot, pohjus: silt + ' käib juba', blokeerija: null };
}

// Logi ja progress kirjutatakse UHE korraga lopus, mitte rea kaupa: vahepeal hoiab
// syncFromXml kirjutuslukku (BEGIN IMMEDIATE) ja iga vahepealne UPDATE ootaks
// busy_timeout-i. Logi kadu ei tohi jooksu LOPPTULEMUST varjata, seega eraldi try.
export function lopetaOtseJooks(db, id, { ok = true, rows = null, error = null,
  progress = null, log = null } = {}) {
  const i = nr(id);
  if (i === null) return false;
  try {
    db.prepare(`UPDATE hanke_runs SET log = COALESCE(?, log), progress = COALESCE(?, progress)
        WHERE id = ?`).run(log, progress, i);
  } catch { /* logi kadu ei tohi lopptulemust varjata */ }
  try { return finishRun(db, i, { ok, rows, error }); } catch { return false; }
}

// Vastus peab olema RSS, mitte HTML-veateade ega tuhi keha. Ilma selle valveta
// annaks proxy 502-leht parseRss-ilt tuhja massiivi ja jooks LOPPEKS EDUKALT
// ("0 uut"), keerates baasi aegumise sisse ilma uhegi varskendatud hanketa.
const RSS_KUJU = /<(rss|feed|channel)[\s>]/i;

function kirjeldaKeha(xml) {
  if (typeof xml !== 'string') return 'keha tüüp on ' + (xml === null ? 'null' : typeof xml);
  const s = xml.replace(/\s+/g, ' ').trim();
  if (!s) return 'tühi keha';
  return s.length > 120 ? s.slice(0, 120) + '…' : s;
}

export function syncFromXml(db, xml, { today = new Date().toISOString().slice(0, 10),
  allikas = ALLIKAS } = {}) {
  migrateHanked(db);

  if (typeof xml !== 'string' || !RSS_KUJU.test(xml)) {
    const viga = new Error('RHR ei andnud RSS-i: ' + kirjeldaKeha(xml));
    logiSync(db, { rows: 0, ok: 0, note: margiAllikas(viga.message, allikas) });
    throw viga;
  }

  const loend = {};
  const read = parseRss(xml, loend);
  let uus = 0;
  let uuendatud = 0;
  let aegunud = 0;

  // RSS_KUJU valvab ainult UMBRIST. Kui RHR jatab <rss version="2.0"> alles, aga
  // nimetab kirjed umber, on vastus "korrektne RSS" ja jooks lopeks ok = 1, rows = 0:
  // roheline jooks, null hanget. Loendurid olid olemas, aga miski ei sidunud neid
  // ok-lipuga. Eelmine rida on ainus, mis teab vahet "feed ongi tuhi" ja "feed
  // tuhjenes" vahel - seega loeme ta ENNE kirjutamist.
  const eelmine = db.prepare('SELECT rows, ok FROM hanke_sync WHERE key = ?').get(VOTI);
  const eelmineAndis = Boolean(eelmine && eelmine.ok === 1 && eelmine.rows > 0);

  // Valve kaib TULEMUSE, mitte feedi kuju peale. Esimene versioon vaatas ainult
  // loend.kirjeid === 0 ehk "feedis ei ole uhtegi <item>-it". Aga sama vaikne kadu
  // tuleb ka teist teed: RHR jatab <item>-id alles ja muudab ainult PEALKIRJA KUJU
  // ("314159 - ..." eraldaja kaob), mille peale VIIDE_JA_PEALKIRI ei klapi ja
  // parseRss tagastab tuhja massiivi. Siis on kirjeid = 700, nisis = 0 ja jooks
  // oleks ok = 1 - roheline jooks, null hanget, tapselt see, mida see valve pidi
  // arastama. Seega: kui eelmine ONNESTUNUD jooks andis ridu ja see ei anna uhtegi,
  // on see punane, olenemata sellest, KUS ahelas tulemus kaduma laks.
  const tyhjenes = eelmineAndis && read.length === 0;

  // Kas MEIE alustasime tehingut. Kui BEGIN IMMEDIATE ise kukub (kutsujal on juba
  // tehing lahti), siis ei tohi catch-plokk teha ROLLBACK-i: see keeraks tagasi
  // KUTSUJA too ja neelaks algse vea ("cannot rollback - no transaction is active")
  // alla. Sel juhul ei kirjuta me ka jalge - voorasse tehingusse ei ole meil asja.
  let meieTehing = false;
  try {
    db.exec('BEGIN IMMEDIATE'); // koik voi mitte midagi
    meieTehing = true;

    // Skoor on ERALDI kirjutus ja see on teadlik: upsertHange tohib puutuda ainult
    // avastusvalju (FIELDS) ja tema leping "inimese valju ei puutu" on ulesande 2
    // varava all - score/score_why sinna toppimine nouaks talle ka `today` ja
    // ajaloo andmist, ehk puhta upserti muutmist skoorimootoriks. Uhe tehingu sees
    // on teine UPDATE odav (uks fsync kogu jooksu peale).
    //
    // Skoor arvutatakse BAASIREA pealt, mitte RSS-i kirje pealt: upsert hoiab
    // COALESCE-iga alles valjad, mida RSS ei anna (maksumus, CPV, eForms-ist tulnu),
    // ja RSS-i kirje pealt skoorides utleks score_why "maksumus teadmata" rea kohta,
    // mille maksumus on inimesel ekraanil nahtav.
    const loeRida = db.prepare('SELECT * FROM hanked WHERE ref = ?');
    // VERDIKT lakeb samas UPDATE-is. score() annab ta juba valja ja ta EI OLE
    // punktidest tagasi arvutatav (ALLTOOVOTT on ulimuslik) - kui ta siin ara
    // visata, ei saa vaade teda kunagi naidata.
    const kirjutaSkoor = db.prepare('UPDATE hanked SET score = ?, score_why = ?, verdict = ? WHERE ref = ?');

    // ULESANNE 13: varasemate lepingute mediaan laheb skoorile. VAHEMALU ON
    // JOOKSU OMA ja teda jagavad MOLEMAD tsuklid - sama hange kaib siit labi
    // kaks korda (feedi ring ja 'uus'-ridade umberarvutus) ja RSS-i ridadel on
    // kusimus identne, sest RSS EI ANNA CPV-d uldse (moodetud ulesandes 9) ja
    // segment on kogu nisil sama. Ilma vahemaluta teeks uks jooks kumneid
    // taiesti samu paringuid; mooduli tasemel vahemalu seevastu valetaks, sest
    // ajaloo import kirjutab samasse tabelisse.
    const ajalooVahemalu = new Map();
    const ajalugu = (rida) => sarnasedLepingud(db, rida.cpv,
      { segment: rida.segment, cache: ajalooVahemalu });

    for (const h of read) {
      if (upsertHange(db, h) === 'uus') uus++; else uuendatud++;
      const rida = loeRida.get(String(h.ref).trim());
      const s = score(rida, { today, ajalugu: ajalugu(rida), docs: docsReast(rida) });
      // score_why on JSON-massiiv, sest ulesande 13 hangeDetail teeb JSON.parse-i.
      kirjutaSkoor.run(s.points, JSON.stringify(s.why), s.verdict, rida.ref);
    }

    // SKOOR JAI AEGUNUKS RIDADEL, MIS FEEDIST VALJA KUKUVAD. Skoori arvutati ainult
    // jooksva feedi ref-ide jaoks, seega hange, mis RSS-i aknast valja libises, kandis
    // vana skoori edasi: "tahtajani < 3 paeva" karistus (-15) ei rakendunud talle
    // KUNAGI ja vaate jarjestus triivis vaikselt. Arvutame sama tehingu sees umber
    // koik read, mida inimene ei ole veel puutunud (state = 'uus') - neid on kumneid,
    // mitte tuhandeid, ja kogu jooks on nagunii uks fsync. Inimese liigutatud rida
    // (vaatan, valmistun, ...) jaab puutumata: tema jarjekord on juba tema otsus.
    for (const rida of db.prepare("SELECT * FROM hanked WHERE state = 'uus'").all()) {
      const s = score(rida, { today, ajalugu: ajalugu(rida), docs: docsReast(rida) });
      // Verdikt kaib SAMA teed mis punktid. Kui ta siit valja jatta, kannaks
      // feedist valja libisenud rida vana verdikti (voi mitte uhtegi) ja vaade
      // naitaks kahe eri reegli jargi arvutatud otsuseid korvuti.
      kirjutaSkoor.run(s.points, JSON.stringify(s.why), s.verdict, rida.ref);
    }

    // markExpired ei ava ise tehingut (uks UPDATE), seega pesastumist ei teki -
    // kontrollitud lib/hanked.mjs-ist, mitte eeldatud.
    aegunud = markExpired(db, today);
    // Paris tuhi feed jaab roheliseks ainult siis, kui ka eelmine oli tuhi.
    // Pohjus loeb: "feed on tuhi" ja "feed on tais, aga filter ei taba midagi" on
    // kaks eri riket ja nouavad eri parandust.
    const pohjus = loend.kirjeid === 0
      ? 'feed tühjenes'
      : 'filter ei tabanud ühtegi kirjet — kontrolli, kas RHR muutis kirje kuju';
    const note = tyhjenes
      ? pohjus + ': eelmine jooks andis ' + vorm(eelmine.rows, 'kirje', 'kirjet')
        + ' · ' + loendiTekst(loend)
      : loendiTekst(loend);
    db.prepare(SYNC_SQL).run(VOTI, read.length, tyhjenes ? 0 : 1, margiAllikas(note, allikas));
    db.exec('COMMIT');
  } catch (e) {
    if (meieTehing) {
      // Tagasikeeramine ja jalje jatmine ei tohi kumbki algset viga varjata.
      try { db.exec('ROLLBACK'); } catch { /* tehing voib olla juba ise katkenud */ }
      // Jalg on TAPNE: rows = read.length. main() ei tea seda arvu ja tema teine
      // logiSync kirjutaks sama rea rows = NULL-iga ule - margime vea ara, et seda
      // ei juhtuks.
      if (logiSyncKindel(db, { rows: read.length, ok: 0, note: margiAllikas(lyhike(e), allikas) })
        && e && typeof e === 'object') e.jalg = true;
    }
    throw e;
  }

  return { uus, uuendatud, aegunud, kokku: read.length, tyhjenes };
}

async function main() {
  // db on valjaspool try-plokki, et finally saaks ta sulgeda ka siis, kui AVAMINE ise
  // kukkus - ja et catch teaks vahet, kas kukkus avamine voi jooks.
  let db = null;
  // Jooksurida on samuti valjaspool: catch peab teda punaseks margima.
  let jooks = { id: null, vanem: null };
  try {
    db = avaBaas();
    migrateHanked(db);

    jooks = alustaOtseJooks(db);
    // vanem !== null: jooksu kaivitas CRM-i nupp ja rida kuulub serverile.
    if (jooks.id === null && jooks.vanem === null) {
      // VAHELEJATT EI OLE RIKE. Valjumiskood jaab 0-ks: kui inimene parasjagu
      // vajutas CRM-is "Sünkroon", naitaks kood 1 Task Scheduleris punast riket,
      // mida ei ole. Pohjus laheb stdout-i ja elav jooks on vaates nagunii nahtav.
      teata({ vahelejaetud: true, pohjus: jooks.pohjus, jooks: jooks.blokeerija });
      return;
    }

    teata({ progress: margiAllikas('laen RSS-i') });

    let xml;
    try {
      // laeTekst katab aegumisega PAISE JA KEHA. Varem oli siin fetch(signal) +
      // eraldi res.text(), mis ei olnud aegumine: ulesande 13 mootmisel jai sama
      // muster hanked-history-s rippuma ULE 9 MINUTI 5-minutilise aegumise juures
      // (Node 25.6.1, Windows). Mitte-200 keha EI lahe parserisse - RHR-i 502 on
      // HTML ja parser teeks sellest vaikse "0 uut" jooksu; selle eest hoolitseb
      // laeTekst ise ja sulgeb ka lugemata keha.
      xml = await laeTekst(RSS, {
        aegumine: AEGUMINE,
        headers: { accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.1' },
      });
    } catch (e) {
      // Timeout, DNS, TLS, 500 - koik uhe nahtava sonumi alla.
      throw new Error('RSS-i ei saanud: ' + lyhike(e));
    }

    const r = syncFromXml(db, xml);
    teata({ progress: r.uus + ' uut · ' + r.uuendatud + ' uuendatud · ' + r.aegunud + ' aegunud',
      rows: r.kokku });
    teata({ done: true, rows: r.kokku, uus: r.uus, uuendatud: r.uuendatud, aegunud: r.aegunud,
      tyhjenes: r.tyhjenes });
    // Tuhjenenud feed on hanke_sync-is punane (ok = 0) - sama otsus peab kanduma
    // jooksuritta, muidu naitaks vaade sama jooksu kohta kaht eri vastust.
    lopetaOtseJooks(db, jooks.id, {
      ok: !r.tyhjenes, rows: r.kokku, progress: VIIMANE_PROGRESS, log: LOGI,
      error: r.tyhjenes ? 'Feed tühjenes — vaata hanke_sync rida' : null,
    });
  } catch (e) {
    if (db === null) {
      teata({ error: 'Baasi ei saanud avada: ' + lyhike(e) });
    } else {
      if (!(e && e.jalg)) logiSyncKindel(db, { ok: 0, note: margiAllikas(lyhike(e)) });
      teata({ error: baasiViga(e) });
      lopetaOtseJooks(db, jooks.id, {
        ok: false, error: baasiViga(e), progress: VIIMANE_PROGRESS, log: LOGI,
      });
    }
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}

// Otsekaivituse valve. `import.meta.url === 'file://' + process.argv[1]` on
// Windowsis katki: draivitaht, kurakaldkriipsud ja URL-kodeering (see tee SISALDAB
// tuhikut - "Leisson Creative" -> "Leisson%20Creative"). pathToFileURL teeb tapselt
// sama teisenduse, mida Node ise mooduli URL-i jaoks kasutab.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
