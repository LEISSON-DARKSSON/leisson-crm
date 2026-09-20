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
//
// Veateated on labivalt uhes stiilis: "Suurtaht kirjeldus: konkreetne vaartus" ja
// NEUTRAALSED - viide() teenindab ka inimese teed (setState, setNote), kus ei ole mingit
// RHR-i kirjet, mida suudistada.
function viide(ref) {
  if (ref !== null && ref !== undefined && typeof ref !== 'string' && !Number.isFinite(ref)) {
    throw new Error('Vigane viitenumber: ' + typeof ref);
  }
  const s = String(ref ?? '').trim();
  if (!s) throw new Error('Viitenumbrita hange');
  return s;
}

export function upsertHange(db, h) {
  const ref = viide(h.ref);
  const vaartused = FIELDS.map((f) => puhas(h[f]));
  return proovi(db, (q) => {
    if (!q.sel.get(ref)) {
      // Uuel hankel peab pealkiri olema; olemasoleval hoiab tuhi vaartus vana alles (COALESCE).
      // Kontrollime normaliseeritud vaartust, et ka '   ' loeks puuduvaks.
      if (vaartused[FIELDS.indexOf('title')] == null) throw new Error('Pealkirjata hange: ' + ref);
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
// Normaliseerija on SAMA mis avastusvaljadel (puhas): oma trim() jattis nahtamatu
// nullpikkusega tuhiku paris markusena alles, samal ajal kui upsert tegi sellest NULL-i.
// Tuupivalve on siin selleks, et mitte-string ei annaks toorest ingliskeelset TypeError-it.
export function setNote(db, ref, note) {
  if (note !== null && note !== undefined && typeof note !== 'string') {
    throw new Error('Vigane märkus: ' + typeof note);
  }
  const r0 = viide(ref);
  const r = db.prepare("UPDATE hanked SET note = ?, updated = datetime('now') WHERE ref = ?")
    .run(puhas(note), r0);
  if (!r.changes) throw new Error('Hanget ei leitud: ' + r0);
  return { ok: true };
}

// Aegub ainult see, mida inimene ei ole veel puutunud: seisust 'uus' edasi liikunud
// hange kannab inimese otsust ja masin ei tohi seda ule kirjutada.
// NULLIF(deadline,'') on sama reegel mis listHanked-is: tuhi tahtaeg = "ei tea",
// mitte "ammu mooda" - ilma selleta aeguks tahtajata hange kohe.
//
// Kuupaevi vorreldakse date()-ga, MITTE stringidena. RHR naitab tahtaega ka eesti kujul
// ('13.10.2026') ja stringivordluses on see vaiksem kui '2026-09-21' ('1' < '2') - elus
// hange aegus kohe ja kadus vaatest. date() annab tundmatu kuju peal NULL-i, seega
// arusaamatu tahtaeg JAAB nahtavaks: pigem naita liiga palju kui kaota hange.
//
// today on valvatud: '21.09.2026' aegutas varem ridu valesti ja null tegi vaikselt
// mitte midagi. Vaikne eksimus on siin halvem kui viga.
//
// date() uksi EI PIISA: SQLite tolgendab paljast arvu Juliuse paevana, seega
// date('2026') = '-4707-11-22' ja date('45000') = '0121-08-17' - molemad on "moodas"
// ja rida aegus vaikselt ara. parseRss normaliseerib tahtaja alati ISO-kujusse voi
// jatab NULL-iks, aga markExpired on ka toore SQL-i, kasitsi impordi ja ulesande 6
// eForms-parseri tee. Seega valvame KUJU siin, kus kahju tekib: GLOB nouab
// aaaa-kk-pp algust ja lopu-* lubab edasi kellaaega ('2026-09-20 17:00').
export function markExpired(db, today = new Date().toISOString().slice(0, 10)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('Vigane kuupäev: ' + today);
  return db.prepare(`UPDATE hanked SET state = 'aegunud', updated = datetime('now')
      WHERE state = 'uus'
        AND deadline GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
        AND date(NULLIF(deadline,'')) IS NOT NULL AND date(deadline) < date(?)`)
    .run(today).changes;
}

// ---------------------------------------------------------------------------
// ULESANNE 3: RSS-i lugeja ja nisifilter.
// ---------------------------------------------------------------------------

// Kolm sona-varav. FIT = meie nisid, EXCL = valdkonnad, kus me ei tegutse
// (ehitus, kinnisvara, trukis), SMALLWEB = vaikese veebilehe tunnused.
// Ilma `g`-liputa - `g` hoiaks lastIndexi ja iga teine .test() annaks vale vastuse.
//
// PAARISFAIL: riigihanked/rhr_tools/rhr_watch.py hoiab SAMA mustrit Pythonis.
// See fail on .gitignore'is, seega neid kahte hoitakse kasitsi kooskolas ja nad EI TOHI
// lahku triivida: vahe naeb valja nagu "meie CRM leiab vahem hangeid kui vana valvur"
// ja seda on iga kord otsast peale keeruline valja selgitada. Ingliskeelsed harud
// (\bweb\b, user experience, design system, accessibility) olid korra vaikselt kaduma
// laanud - RHR-is on ingliskeelne pealkiri tavaline. Tapitahetaluvus
// (disainis[üu]steem, protot[üu][üu]p jne) on MEIE laiendus Pythoni mustri peale ja
// peab alles jaama; kui see Pythonisse tagasi kantakse, kandke ka sealt siia.
export const FIT = /veebi(leh|keskkon|portaal|sait|lahend|arendus)|koduleh|\bweb\b|\bportaal|kasutajakogemus|user experience|kasutajaliides|\bux\b|\bui\b|teenusedisain|disainis[üu]steem|design system|kasutajauuring|kasutatavus|protot[üu][üu]p|ligipääsetavus|accessibility|wcag|tehisaru|tehisintellekt|\bai\b|keelemudel|vestlusrobot|juturobot|chatbot|visuaalne identiteet|\bcvi\b|br[äa]ndi|kujundust[öo][öo]|graafiline disain|digiturundus|sotsiaalmeedia|e-teenus|iseteenindus|rakenduse arendus|mobiilirakendus|digilahendus|digitaalse eneseabi|e-kursus|veebikoolitus/i;
export const EXCL = /ehitus|projekteeri|planeering|kinnisvara|keskkonnam[õo]ju|arhitekt|[üu]histransport|bussipeat|puude|j[õo]uluvalg|sisekujundus|tr[üu]kis|meene|litsents|videovalve/i;
export const SMALLWEB = /veebileh|koduleh|veebilahendus|veebisait|veebikeskkon|veebilehtede|kodulehe/i;

// Kolm mustrit kaivad KOLME ERI tekstil ja see on moodetud otsus, mitte lohakus:
//
// FIT: pealkiri + kirjeldus. RHR-i pealkiri on sageli asutuse sisenimi ("OsKus uhtse
//   infosusteemi ja analuusikeskkonna loomine") ja paris too on kirjelduses
//   ("veebirakenduste loomiseks ... sh prototuupimine"). Ainult pealkirja vaadates
//   jai 310983 vahele - see on paris kaotatud hange, mitte teoreetiline risk.
// EXCL: AINULT pealkiri. Moodetud: kirjeldusele laiendamine ei leidnud uhtegi uut
//   valjajatmist, aga iga teine IT-hange mainib kirjelduses hoonet voi projekteerimist -
//   see oleks tapnud hangeid, mis on meie omad.
// SMALLWEB: AINULT pealkiri. Muidu klassifitseeriks iga kirjelduses mainitud "veebileht"
//   suure infosusteemi "vaikeseks veebilehaks" ja skoor (ulesanne 4) eksiks hinnas.
//
// Teine argument on vabatahtlik: uheargumendiline kutse peab edasi tootama.
export function segmentOf(title, kirjeldus = '') {
  if (!title || EXCL.test(title)) return null;
  if (!FIT.test(title + ' ' + (kirjeldus || ''))) return null;
  return SMALLWEB.test(title) ? 'väike veebileht' : 'nišš';
}

// RHR-i kirjelduse esimene vali on hanke liik, aga ainult SIIS, kui kirjeldus on
// uldse semikooloniga liigendatud. Ilma selle loeteluta sai `nature` vaartuseks kogu
// kirjelduse ('Ainult uks osa ilma semikooloniteta') ja see laks nii baasi.
// Tundmatu vaartus -> NULL ("ei tea"), mitte praht; kirjet ennast see valja ei viska.
// Vorreldakse vaikeste tahtedega ja tagastatakse kanooniline kuju, et ka 'ehitustööd'
// jaaks valjajatmisreeglis kinni.
const LIIGID = new Map([
  ['teenused', 'Teenused'], ['asjad', 'Asjad'], ['ehitustööd', 'Ehitustööd'],
  ['sotsiaalteenused', 'Sotsiaalteenused'], ['eriteenused', 'Eriteenused'],
]);

// Liigid, mida me ei tee.
const VALJA_LIIGID = new Set(['ehitustööd', 'asjad']);

// HTML-olemid dekodeeritakse UHE kaiguga. Kaks kaiku ("koigepealt &lt;, siis &amp;")
// teeksid kirjest '&amp;lt;' vaartuse '<', kuigi paris vaartus on '&lt;'.
const OLEMID = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function olemid(s) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (kogu, keha) => {
    if (keha[0] === '#') {
      const kood = keha[1] === 'x' || keha[1] === 'X'
        ? parseInt(keha.slice(2), 16)
        : parseInt(keha.slice(1), 10);
      if (!Number.isFinite(kood) || kood < 1 || kood > 0x10ffff) return kogu;
      return String.fromCodePoint(kood);
    }
    const v = OLEMID[keha.toLowerCase()];
    return v === undefined ? kogu : v;
  });
}

// Uhe silditi sisu: CDATA maha, olemid lahti, reavahetused uheks tuhikuks.
// RHR-i kirjeldus on mitmerealine ja tuhikutega polsterdatud.
//
// TEADLIK KORVALEKALDE XML-ist: olemid dekodeeritakse ka CDATA SEES, kuigi CDATA sisu
// on XML-i mottes literaal. Pohjus on moodetud, mitte teoreetiline: RHR TOPELT-escape'ib
// ja kirjutab CDATA sisse '&amp;' ja '&quot;'. XML-korrektne lugeja jataks need alles ja
// pealkirjale ilmuks 'Veebilehe &quot;Kodu&quot;' - kohe lehele, sest pealkiri laheb otse
// baasi ja sealt vaatesse. Kui keegi kunagi leiab kirje, kus CDATA sisu PEAKSIDKI olema
// literaalsed olemid, siis see test on punane OIGE parast - see ei ole viga parandada,
// vaid kompromiss, mille hind on siis muutunud.
function tagi(plokk, nimi) {
  const m = plokk.match(new RegExp('<' + nimi + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + nimi + '\\s*>', 'i'));
  if (!m) return null;
  const s = olemid(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/\s+/g, ' ').trim();
  return s || null;
}

// Pealkiri on kujul "314159 - Pealkiri". Eraldaja (sidekriips voi mottekriips) on
// NOUTUD, mitte vabatahtlik - see on teadlik otsus:
//   - ilma selleta loeks "2026. aasta veebilehe hange" aastaarvu 2026 viitenumbriks ja
//     paneks baasi rea, mida RHR-is ei ole (ja mille ref pohjal ei leia enam midagi);
//   - hind on see, et eraldajata kirje jaab vaikselt vahele. Moodetud paris feedil:
//     711 kirjest kukkus selle mustri taha 0, seega rangus ei maksa praegu midagi.
// Kui RHR kujundust muudab, laheb loendus ulesandes 5 (hanke_sync) nulli - see on
// koht, kus muutus valja paistab.
const VIIDE_JA_PEALKIRI = /^(\d{3,})\s*[-‐‑‒–—―−]\s*([\s\S]+)$/;

// RHR annab tahtaja eesti kujul. ISO on ANSUS: markExpired vordleb date()-ga ja
// eestikeelne kuju jaaks seal NULL-iks (parimal juhul) voi aegutaks vale rea.
const TAHTAEG = /Tähtaeg:\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i;

function isoTahtaeg(kirjeldus) {
  const m = kirjeldus && kirjeldus.match(TAHTAEG);
  if (!m) return null;
  const [, p, k, a] = m;
  if (+k < 1 || +k > 12 || +p < 1 || +p > 31) return null;
  return a + '-' + String(+k).padStart(2, '0') + '-' + String(+p).padStart(2, '0');
}

// pubDate on RFC 822 ('Wed, 10 Sep 2026 07:00:04 GMT'). Date.parse tunneb seda;
// tundmatu kuju annab NaN ja me jatame valja NULL-iks, mitte ei arva midagi.
function isoPaev(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

function kirje(plokk) {
  const toorPealkiri = tagi(plokk, 'title');
  const m = toorPealkiri && toorPealkiri.match(VIIDE_JA_PEALKIRI);
  if (!m) return null; // viitenumbrita kirje ei ole hange (kanali pealkiri, teade)
  const [, ref, title] = m;

  const kirjeldus = tagi(plokk, 'description');
  const osad = (kirjeldus || '').split(';').map((x) => x.trim());
  const nature = LIIGID.get((osad[0] || '').toLowerCase()) || null;
  if (nature && VALJA_LIIGID.has(nature.toLowerCase())) return null;

  const segment = segmentOf(title, kirjeldus);
  if (!segment) return null;

  const link = tagi(plokk, 'link') || '';
  const rhr = link.match(/procurement\/(\d+)/);

  return {
    ref,
    rhr_id: rhr ? rhr[1] : null,
    buyer: tagi(plokk, 'dc:creator'),
    title,
    nature,
    menetlus: osad[1] || null,
    deadline: isoTahtaeg(kirjeldus),
    published: isoPaev(tagi(plokk, 'pubDate')),
    segment,
    est: null,
    cpv: null,
  };
}

// Sama viitenumber tuleb feedis mitu korda: RHR avaldab MUUTMISTEATE just siis, kui
// midagi muutus (tahtaeg, pealkiri). Feed on uuemast vanemani, seega ilma selle
// valveta andis parseRss molemad read, upsertHange tootles neid jarjekorras ja
// VANEM teade voitis - ehk tahtaja muudatus kadus vaikselt ara.
// Reegel: uusim `published` voidab; vordse (voi puuduva) korral jaab kehtima feedis
// eespool olev, sest RHR-i oma jarjestus on parim, mis meil siis on.
const uuem = (a, b) => (a.published || '') > (b.published || '');

// parseRss on VALINE sisend: RHR voib anda vigase XML-i, HTML-i veatehe voi tuhja keha.
// Uks katkine kirje ei tohi kogu sunkimisjooksu maha votta, seega iga kirje on omas
// try-plokis ja mitte-string sisend annab tuhja massiivi, mitte erindi.
export function parseRss(xml) {
  if (typeof xml !== 'string' || !xml) return [];
  const read = [];
  const koht = new Map(); // ref -> indeks read-massiivis
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi)) {
    try {
      const rida = kirje(m[1]);
      if (!rida) continue;
      const i = koht.get(rida.ref);
      if (i === undefined) {
        koht.set(rida.ref, read.length);
        read.push(rida);
      } else if (uuem(rida, read[i])) {
        // Sama koht massiivis - feedi jarjestus ei tohi dubli parast umber minna.
        read[i] = rida;
      }
    } catch { /* katkine kirje jaab vahele, ulejaanud jooks laheb edasi */ }
  }
  return read;
}
