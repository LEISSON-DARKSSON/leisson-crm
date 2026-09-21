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
import { open } from '../lib/db.mjs';
import { migrateHanked, parseRss, upsertHange, markExpired, score } from '../lib/hanked.mjs';

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
const teata = (o) => process.stdout.write(JSON.stringify(o) + '\n');

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
  const tyhjenes = Boolean(loend.kirjeid === 0 && eelmine && eelmine.ok === 1 && eelmine.rows > 0);

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
    const kirjutaSkoor = db.prepare('UPDATE hanked SET score = ?, score_why = ? WHERE ref = ?');

    for (const h of read) {
      if (upsertHange(db, h) === 'uus') uus++; else uuendatud++;
      const rida = loeRida.get(String(h.ref).trim());
      const s = score(rida, { today });
      // score_why on JSON-massiiv, sest ulesande 13 hangeDetail teeb JSON.parse-i.
      kirjutaSkoor.run(s.points, JSON.stringify(s.why), rida.ref);
    }

    // SKOOR JAI AEGUNUKS RIDADEL, MIS FEEDIST VALJA KUKUVAD. Skoori arvutati ainult
    // jooksva feedi ref-ide jaoks, seega hange, mis RSS-i aknast valja libises, kandis
    // vana skoori edasi: "tahtajani < 3 paeva" karistus (-15) ei rakendunud talle
    // KUNAGI ja vaate jarjestus triivis vaikselt. Arvutame sama tehingu sees umber
    // koik read, mida inimene ei ole veel puutunud (state = 'uus') - neid on kumneid,
    // mitte tuhandeid, ja kogu jooks on nagunii uks fsync. Inimese liigutatud rida
    // (vaatan, valmistun, ...) jaab puutumata: tema jarjekord on juba tema otsus.
    for (const rida of db.prepare("SELECT * FROM hanked WHERE state = 'uus'").all()) {
      const s = score(rida, { today });
      kirjutaSkoor.run(s.points, JSON.stringify(s.why), rida.ref);
    }

    // markExpired ei ava ise tehingut (uks UPDATE), seega pesastumist ei teki -
    // kontrollitud lib/hanked.mjs-ist, mitte eeldatud.
    aegunud = markExpired(db, today);
    // Paris tuhi feed jaab roheliseks ainult siis, kui ka eelmine oli tuhi.
    const note = tyhjenes
      ? 'feed tühjenes: eelmine jooks andis ' + vorm(eelmine.rows, 'kirje', 'kirjet')
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
  try {
    db = avaBaas();
    migrateHanked(db);
    teata({ progress: margiAllikas('laen RSS-i') });

    let xml;
    try {
      const res = await fetch(RSS, {
        signal: AbortSignal.timeout(AEGUMINE),
        headers: { accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.1' },
      });
      // Mitte-200 keha EI lahe parserisse: RHR-i 502 on HTML ja parser teeks
      // sellest vaikse "0 uut" jooksu.
      if (!res.ok) {
        // Lugemata keha hoiaks uhendust lahti kuni prugikoristuseni.
        await res.body?.cancel();
        throw new Error('RHR vastas ' + res.status + ' ' + (res.statusText || ''));
      }
      xml = await res.text();
    } catch (e) {
      // Timeout, DNS, TLS, 500 - koik uhe nahtava sonumi alla.
      throw new Error('RSS-i ei saanud: ' + lyhike(e));
    }

    const r = syncFromXml(db, xml);
    teata({ progress: r.uus + ' uut · ' + r.uuendatud + ' uuendatud · ' + r.aegunud + ' aegunud',
      rows: r.kokku });
    teata({ done: true, rows: r.kokku, uus: r.uus, uuendatud: r.uuendatud, aegunud: r.aegunud,
      tyhjenes: r.tyhjenes });
  } catch (e) {
    if (db === null) {
      teata({ error: 'Baasi ei saanud avada: ' + lyhike(e) });
    } else {
      if (!(e && e.jalg)) logiSyncKindel(db, { ok: 0, note: margiAllikas(lyhike(e)) });
      teata({ error: baasiViga(e) });
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
