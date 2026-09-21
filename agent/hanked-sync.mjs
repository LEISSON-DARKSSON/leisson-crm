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
const RSS = process.env.HANKED_RSS_URL || 'https://riigihanked.riik.ee/rhr/api/public/v1/rss';
const VOTI = 'rss';
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

export function syncFromXml(db, xml, { today = new Date().toISOString().slice(0, 10) } = {}) {
  migrateHanked(db);

  if (typeof xml !== 'string' || !RSS_KUJU.test(xml)) {
    const viga = new Error('RHR ei andnud RSS-i: ' + kirjeldaKeha(xml));
    logiSync(db, { rows: 0, ok: 0, note: viga.message });
    throw viga;
  }

  const loend = {};
  const read = parseRss(xml, loend);
  let uus = 0;
  let uuendatud = 0;
  let aegunud = 0;

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

    // markExpired ei ava ise tehingut (uks UPDATE), seega pesastumist ei teki -
    // kontrollitud lib/hanked.mjs-ist, mitte eeldatud.
    aegunud = markExpired(db, today);
    db.prepare(SYNC_SQL).run(VOTI, read.length, 1, loendiTekst(loend));
    db.exec('COMMIT');
  } catch (e) {
    if (meieTehing) {
      // Tagasikeeramine ja jalje jatmine ei tohi kumbki algset viga varjata.
      try { db.exec('ROLLBACK'); } catch { /* tehing voib olla juba ise katkenud */ }
      try { logiSync(db, { rows: read.length, ok: 0, note: lyhike(e) }); } catch { /* baas kinni */ }
    }
    throw e;
  }

  return { uus, uuendatud, aegunud, kokku: read.length };
}

async function main() {
  const db = open();
  try {
    migrateHanked(db);
    teata({ progress: 'laen RSS-i' });

    let xml;
    try {
      const res = await fetch(RSS, {
        signal: AbortSignal.timeout(AEGUMINE),
        headers: { accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.1' },
      });
      // Mitte-200 keha EI lahe parserisse: RHR-i 502 on HTML ja parser teeks
      // sellest vaikse "0 uut" jooksu.
      if (!res.ok) throw new Error('RHR vastas ' + res.status + ' ' + (res.statusText || ''));
      xml = await res.text();
    } catch (e) {
      // Timeout, DNS, TLS, 500 - koik uhe nahtava sonumi alla.
      throw new Error('RSS-i ei saanud: ' + lyhike(e));
    }

    const r = syncFromXml(db, xml);
    teata({ progress: r.uus + ' uut · ' + r.uuendatud + ' uuendatud · ' + r.aegunud + ' aegunud',
      rows: r.kokku });
    teata({ done: true, rows: r.kokku, uus: r.uus, uuendatud: r.uuendatud, aegunud: r.aegunud });
  } catch (e) {
    try { logiSync(db, { ok: 0, note: lyhike(e) }); } catch { /* baas kinni - viga laheb ikka valja */ }
    teata({ error: lyhike(e) });
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

// Otsekaivituse valve. `import.meta.url === 'file://' + process.argv[1]` on
// Windowsis katki: draivitaht, kurakaldkriipsud ja URL-kodeering (see tee SISALDAB
// tuhikut - "Leisson Creative" -> "Leisson%20Creative"). pathToFileURL teeb tapselt
// sama teisenduse, mida Node ise mooduli URL-i jaoks kasutab.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
