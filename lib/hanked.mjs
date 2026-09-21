// Riigihangete radari andmekiht: hanked, lepingud, sunkimislogi ja jooksud.
// Migratsioon on LISAV (salesdb mustri jargi) - olemasolevaid tabeleid ei puutu.
//
// Reegel: avastusvaljad (RHR-ist tulev info) uuenevad sunkimisel,
// inimese omad (state, note) EI uuene kunagi ule.

// Seisud ja nende LIIK uhes kohas. Vaade peab teadma, millised seisud on LOPPSEISUD
// ("aktiivsed"-filter peidab nad), ja see teadmine ei tohi elada kliendis kasitsi
// kirjutatud loendina: HANKE_STATES-i uus seis jaaks seal vaikselt "aktiivseks" ja
// filter valetaks ilma uhegi punase testita.
//
// Klassifikatsioon on SEEGA ALLIKAS ja HANKE_STATES tuleneb temast - uut seisu EI SAA
// lisada teda liigitamata, sest seisu ei ole enne olemas, kui tal on liik.
//   'toos' = hange on veel meie laual;
//   'lopp' = otsus on tehtud voi vott ara (voidetud, kaotatud, jatsin, aegunud).
// 'voidetud' on samuti LOPP: hanke radari to-o on sellega tehtud, edasi laheb ta
// projektiks - aktiivsete nimekirjas hoiaks ta ainult ruumi.
export const SEISU_LIIK = Object.freeze({
  uus: 'töös',
  vaatan: 'töös',
  valmistun: 'töös',
  esitatud: 'töös',
  voidetud: 'lõpp',
  kaotatud: 'lõpp',
  jatsin: 'lõpp',
  aegunud: 'lõpp',
});

export const HANKE_STATES = Object.keys(SEISU_LIIK);
export const LOPUSEISUD = HANKE_STATES.filter((s) => SEISU_LIIK[s] === 'lõpp');

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
      score INTEGER, score_why TEXT, verdict TEXT,
      state TEXT NOT NULL DEFAULT 'uus'
        CHECK (state IN (${HANKE_STATES.map((s) => `'${s}'`).join(',')})),
      note TEXT,
      docs_dir TEXT, docs_count INTEGER NOT NULL DEFAULT 0,
      seen TEXT NOT NULL DEFAULT (datetime('now')),
      seen_last TEXT,
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
  // Lisav migratsioon juba olemasolevale baasile (sama muster mis lib/db.mjs-is):
  // CREATE TABLE IF NOT EXISTS ei lisa uut veergu vanale tabelile.
  lisaVeerg(db, 'hanked', 'seen_last', 'TEXT');
  // VERDIKT BAASI. score() arvutab PAKU/KAALU/JÄTA/ALLTÖÖVÕTT, aga sünk viskas
  // verdikti ära ja alles jäi ainult arv. ALLTÖÖVÕTT on score-is ÜLIMUSLIK
  // (40-punktine alltöövõtu-hange ei ole "KAALU"), seega teda EI SAA punktidest
  // tagasi arvutada ja vaade ei saanud teda KUNAGI näidata. Veerg on lisatud
  // samamoodi nagu seen_last: CREATE TABLE ei lisa veergu vanale tabelile.
  lisaVeerg(db, 'hanked', 'verdict', 'TEXT');
  // ULESANNE 7: pid UKSI EI TOESTA, et jooks on meie oma. Parast serveri
  // taaskaivitust on pid-id ringlusse laanud: alive(pid) voib oelda "elab", kuigi
  // see on hoopis moni muu protsess (spinner ei kaoks kunagi) ja kill(pid) tapaks
  // voora protsessi. boot_id on serveri kaivitusel genereeritud juhuslik id -
  // teise instantsi jooks on ALATI orb, olenemata pid-ist.
  lisaVeerg(db, 'hanke_runs', 'boot_id', 'TEXT');
  lukustaJooksud(db);
}

// Kaivitaja lukk on OSALINE UNIKAALINDEKS, mitte kaks lauset. "SELECT ... WHERE
// state='käib'" ja siis INSERT on kaks lauset: kaks paringut voivad MOLEMAD
// kontrollist labi saada ja tekitada kaks paralleelset jooksu - tapselt see, mida
// lukk pidi ara hoidma. Indeks on aatomne: teine INSERT kukub ka siis, kui
// kontroll vahele jatta.
//
// Vana baas voib juba kanda kahte paralleelset 'käib' rida (need tekkisid enne
// lukku). CREATE UNIQUE INDEX kukuks siis ja server ei kaivituks enam ULDSE -
// seega sulgeme dublikaadid ENNE indeksit ja jatame alles UUSIMA. See UPDATE
// jookseb TAPSELT UKS KORD (indeksi olemasolu on lipp): iga migrateHanked kutse
// on ka lapsprotsessis, ja tuhigi UPDATE votab kirjutusluku.
function lukustaJooksud(db) {
  const on = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='index' AND name='idx_runs_kaib'").get();
  if (on) return;
  db.exec(`UPDATE hanke_runs SET state = 'katkestatud', finished = datetime('now'),
      error = COALESCE(error, 'Server taaskäivitati — paralleelne jooks suleti luku lisamisel')
    WHERE state = 'käib'
      AND id NOT IN (SELECT MAX(id) FROM hanke_runs WHERE state = 'käib' GROUP BY cmd)`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_kaib ON hanke_runs(cmd) WHERE state = 'käib'");
}

// ALTER TABLE ei tunne IF NOT EXISTS-i, seega kusime veerud ule.
function lisaVeerg(db, tabel, veerg, kuju) {
  const veerud = db.prepare(`PRAGMA table_info(${tabel})`).all().map((c) => c.name);
  if (!veerud.includes(veerg)) db.exec(`ALTER TABLE ${tabel} ADD COLUMN ${veerg} ${kuju}`);
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

// `updated` TAHENDAB "midagi muutus", mitte "sunk nagi teda viimati". Iga 15 min jooks
// kirjutas varem updated-i IGALE reale ka siis, kui mitte uksi vali ei muutunud - vaade
// (ulesanne 11/13) jarjestaks selle jargi ja kogu nimekiri "muutuks" iga jooksuga, ehk
// paris muutus (nihkunud tahtaeg) upuks mura sisse. Sunkimisaeg laheb seega OMA veergu
// (seen_last) ja updated liigub ainult paris muutuse peale.
//
// CASE-plokk vordleb UUT vaartust VANAGA. SQLite hindab UHE UPDATE-i koik paremad
// pooled originaalrea pealt, seega `f` on siin veel vana vaartus. `IS NOT` on
// NULL-kindel (`!=` annaks NULL-i korral NULL-i ja rida ei loeks muutunuks), ja
// veeruga vorreldes rakendub veeru afiinsus, ehk '85000' ja 85000 ei ole "muutus".
const MUUTUS = FIELDS.map((f) => `COALESCE(?, ${f}) IS NOT ${f}`).join(' OR ');

// Ettevalmistatud laused on kallid - hoiame neid baasi kohta vahemalus.
// WeakMap: kui baas suletakse ja unustatakse, laheb ka vahemalu prugiks.
const CACHE = new WeakMap();

function laused(db) {
  let c = CACHE.get(db);
  if (!c) {
    c = {
      sel: db.prepare('SELECT ref FROM hanked WHERE ref = ?'),
      ins: db.prepare(`INSERT INTO hanked (ref,${FIELDS.join(',')},seen_last)
              VALUES (?,${FIELDS.map(() => '?').join(',')},datetime('now'))`),
      upd: db.prepare(`UPDATE hanked SET ${FIELDS.map((f) => f + ' = COALESCE(?, ' + f + ')').join(', ')},
              seen_last = datetime('now'),
              updated = CASE WHEN ${MUUTUS} THEN datetime('now') ELSE updated END
              WHERE ref = ?`),
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
//
// ULESANNE 8: iga siit lahkuv erind kannab NUMBRILIST e.code-i (400 = vigane sisend,
// 404 = ei leitud). Marsruut (lib/routes2.mjs) laseb SELLISE veateate kliendile edasi
// ja muudab koik ulejaanud - node:sqlite "SQLITE_ERROR: ... UPDATE hanked SET ...",
// ENOENT koos failiteega - uldiseks 500-ks. Ilma koodita ei saaks marsruut meie
// eestikeelset teadet toore baasiveast eristada ja peaks valima kahe halva vahel:
// lekitada koik voi neelata koik.
function viga(sonum, code = 400) {
  const e = new Error(sonum);
  e.code = code;
  return e;
}

function viide(ref) {
  if (ref !== null && ref !== undefined && typeof ref !== 'string' && !Number.isFinite(ref)) {
    throw viga('Vigane viitenumber: ' + typeof ref);
  }
  const s = String(ref ?? '').trim();
  if (!s) throw viga('Viitenumbrita hange');
  return s;
}

export function upsertHange(db, h) {
  const ref = viide(h.ref);
  const vaartused = FIELDS.map((f) => puhas(h[f]));
  return proovi(db, (q) => {
    if (!q.sel.get(ref)) {
      // Uuel hankel peab pealkiri olema; olemasoleval hoiab tuhi vaartus vana alles (COALESCE).
      // Kontrollime normaliseeritud vaartust, et ka '   ' loeks puuduvaks.
      if (vaartused[FIELDS.indexOf('title')] == null) throw viga('Pealkirjata hange: ' + ref);
      q.ins.run(ref, ...vaartused);
      return 'uus';
    }
    // Avastusvaljad uuenevad, inimese omad (state, note) EI uuene kunagi.
    // Vaartused lahevad KAKS korda: uks kord SET-i, teine kord muutuse vordlusesse.
    q.upd.run(...vaartused, ...vaartused, ref);
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
  if (!HANKE_STATES.includes(state)) throw viga('Tundmatu seis: ' + String(state).slice(0, 40));
  const r0 = viide(ref);
  const r = db.prepare("UPDATE hanked SET state = ?, updated = datetime('now') WHERE ref = ?").run(state, r0);
  if (!r.changes) throw viga('Hanget ei leitud: ' + r0, 404);
  return { ok: true };
}

// Tuhi markus on NULL, mitte '' - muidu ei saa enam kusida "millistel hangetel on markus".
// Normaliseerija on SAMA mis avastusvaljadel (puhas): oma trim() jattis nahtamatu
// nullpikkusega tuhiku paris markusena alles, samal ajal kui upsert tegi sellest NULL-i.
// Tuupivalve on siin selleks, et mitte-string ei annaks toorest ingliskeelset TypeError-it.
export function setNote(db, ref, note) {
  if (note !== null && note !== undefined && typeof note !== 'string') {
    throw viga('Vigane märkus: ' + typeof note);
  }
  const r0 = viide(ref);
  const r = db.prepare("UPDATE hanked SET note = ?, updated = datetime('now') WHERE ref = ?")
    .run(puhas(note), r0);
  if (!r.changes) throw viga('Hanget ei leitud: ' + r0, 404);
  return { ok: true };
}

// ULESANNE 8/13: uhe hanke detailvaade.
//
// MIKS SEE ON JUBA SIIN. Plaani ulesanne 8 impordib hangeDetail-i, mille pidi tegema
// alles ulesanne 13. Olematu nimeline eksport viskab ESM-is juba MOODULI LAADIMISEL
// ("does not provide an export named") - server ei kaivituks uldse, mitte ei annaks
// katkist marsruuti. Valikud olid: (a) jatta detailmarsruut ulesande 13-ni valja voi
// (b) teha siia minimaalne hangeDetail. Valitud on (b), sest ulesanne 10 (detailpaneel)
// tuleb ENNE ulesannet 13 ja vajab seda otspunkti juba siis.
//
// Kuju on TEADLIKULT vaike: { hange, why }. Ulesanne 13 lisab `sarnased` ja ulesanne 14
// `failid`. Tuhja `failid: []` praegu tagastada oleks vale - see utleks vaatele
// "dokumente ei ole", kuigi oige vastus on "me ei ole neid veel kordagi kusinud".
export function hangeDetail(db, ref) {
  const r0 = viide(ref);
  const hange = db.prepare('SELECT * FROM hanked WHERE ref = ?').get(r0);
  if (!hange) throw viga('Hanget ei leitud: ' + r0, 404);
  return { hange, why: pohjendus(hange.score_why) };
}

// score_why on JSON-massiiv (agent/hanked-sync.mjs kirjutab JSON.stringify(s.why)),
// AGA ta on NULL igal real, mida sunk ei ole veel puutunud: kasitsi import, ulesande 6
// eForms-tee ja toores SQL jatavad ta tuhjaks. JSON.parse(null) EI VISKA - ta annab
// null-i, ja vaade teeks selle peal .map()-i ehk detailpaneel jaaks tuhjaks ilma
// uhegi veata. Sama kehtib katkise JSON-i ja "JSON, aga mitte massiiv" kohta.
// Seega: pohjendus on ALATI stringimassiiv, vajadusel tuhi.
export function pohjendus(scoreWhy) {
  if (typeof scoreWhy !== 'string' || !scoreWhy) return [];
  let v;
  try { v = JSON.parse(scoreWhy); } catch { return []; }
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw viga('Vigane kuupäev: ' + today);
  return db.prepare(`UPDATE hanked SET state = 'aegunud', updated = datetime('now')
      WHERE state = 'uus'
        AND deadline GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
        AND date(NULLIF(deadline,'')) IS NOT NULL AND date(deadline) < date(?)`)
    .run(today).changes;
}

// KIIRELOOMULISTE LOENDUR (sakimärk).
//
// MIKS SIIN JA MITTE server.mjs-is. Sama numbrit arvutab ka klient
// (public/hanked-loogika.js onKiire): sakimärk peab olema õige juba load()-i
// peale, ehk ENNE kui riigihangete vaadet on kordagi avatud, ja vaade uuendab
// teda hiljem ise. Kaks eri arvutust sama numbri jaoks triiviksid lahku, seega
// on reegel kirjas ühe lausena siin ja test/gate-hanked.mjs jooksutab MÕLEMAD
// teostused samade ridade peal ja nõuab sama vastust.
//
// Reegel: seis 'uus' JA tähtajani 0..KIIRE_PAEVI kalendripäeva.
export const KIIRE_PAEVI = 7;

// SQL-i valve on sama range kui kliendi oma:
//   GLOB       — kuju on TÄPSELT aaaa-kk-pp või aaaa-kk-pp + eraldaja + kellaaeg.
//                Eraldaja on NÕUTUD (sama mis kliendi ISO-muster): ilma selleta
//                loeks SQLite '2026-09-2400:00' vaikselt 24. septembriks ja
//                klient viskaks ta välja — kaks eri arvu sama rea kohta;
//   date() =   — date('2026-02-31') annab '2026-03-03', ehk SQLite parandab
//                olematu päeva vaikselt ära. Võrdlus algusega viskab ta välja,
//                nagu kliendi paevUTC() teeb.
// Kuupäeva võrreldakse date()-ga, mitte stringina: '13.10.2026' oleks stringina
// väiksem kui '2026-09-21'.
export function kiireidLoend(db, today = new Date().toISOString().slice(0, 10)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw viga('Vigane kuupäev: ' + today);
  return db.prepare(`SELECT COUNT(*) AS n FROM hanked
      WHERE state = 'uus'
        AND (deadline GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
             OR deadline GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ]*')
        AND date(deadline) IS NOT NULL
        AND date(deadline) = substr(deadline, 1, 10)
        AND date(deadline) >= date(?)
        AND date(deadline) <= date(?, '+${KIIRE_PAEVI} days')`).get(today, today).n;
}

// ---------------------------------------------------------------------------
// ULESANNE 3: RSS-i lugeja ja nisifilter.
// ---------------------------------------------------------------------------

// Kolm sona-varav. FIT = meie nisid, EXCL = valdkonnad, kus me ei tegutse
// (ehitus, kinnisvara, trukis), SMALLWEB = vaikese veebilehe tunnused.
// Ilma `g`-liputa - `g` hoiaks lastIndexi ja iga teine .test() annaks vale vastuse.
//
// PAARISFAIL: riigihanked/rhr_tools/rhr_watch.py hoiab SAMA mustrit Pythonis.
// See fail on .gitignore'is, seega neid kahte EI SAA CI-s automaatselt vorrelda ja nad
// EI TOHI lahku triivida: vahe naeb valja nagu "meie CRM leiab vahem hangeid kui vana
// valvur" ja seda on iga kord otsast peale keeruline valja selgitada.
// KASITSI VORDLEMINE ON LABI: test/gate-pariteet.mjs lukustab segmentOf-i valjundi
// mustrite lahtekoodist tuletatud paaride peal (ootusfail test/fixtures/segment-ootus.json)
// ja nouab, et IGA ulemise taseme haru oleks kaetud - uus haru ilma ootusfaili
// uuendamiseta laheb punaseks. Tahtlik muudatus: npm run pariteet:uuenda. Ingliskeelsed harud
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

// Eksporditud, sest ulesande 6 eForms-lugeja (lib/eforms.mjs) vajab TAPSELT sama
// dekodeerijat. Teine koopia triiviks vaikselt lahku (uks pool oskaks numbriolemeid,
// teine mitte) ja sama nimi annaks kahes vaates eri kuju.
export function olemid(s) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (kogu, keha) => {
    if (keha[0] === '#') {
      const kood = keha[1] === 'x' || keha[1] === 'X'
        ? parseInt(keha.slice(2), 16)
        : parseInt(keha.slice(1), 10);
      // Surrogaadivahemik on UTF-16 sisemine tehnika, mitte margid: String.fromCodePoint(0xd800)
      // annab paarita surrogaadi, mis jouaks baasi kujul U+FFFD. Jata olem puutumata.
      if (!Number.isFinite(kood) || kood < 1 || kood > 0x10ffff) return kogu;
      if (kood >= 0xd800 && kood <= 0xdfff) return kogu;
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

function kirje(plokk, loend) {
  const toorPealkiri = tagi(plokk, 'title');
  const m = toorPealkiri && toorPealkiri.match(VIIDE_JA_PEALKIRI);
  if (!m) { if (loend) loend.loetamatuid++; return null; } // viitenumbrita kirje ei ole hange
  const [, ref, title] = m;

  const kirjeldus = tagi(plokk, 'description');
  const osad = (kirjeldus || '').split(';').map((x) => x.trim());
  const nature = LIIGID.get((osad[0] || '').toLowerCase()) || null;
  if (nature && VALJA_LIIGID.has(nature.toLowerCase())) { if (loend) loend.valjaspool++; return null; }

  const segment = segmentOf(title, kirjeldus);
  if (!segment) { if (loend) loend.valjaspool++; return null; }

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
//
// Teadmata ilmumisaeg EI OLE argument. Varasem `(a.published || '') > (b.published || '')`
// luges puuduva kuupaeva tuhjaks stringiks, mis on vaiksem koigist paris kuupaevadest:
// kui uusim teade tuli ilma pubDate-ta (voi parseerimatu pubDate-ga), voitis iga tagapool
// olev vanem teade - tapselt see viga, mille see valve pidi arastama.
const uuem = (a, b) => Boolean(a.published && b.published) && a.published > b.published;

// parseRss on VALINE sisend: RHR voib anda vigase XML-i, HTML-i veatehe voi tuhja keha.
// Uks katkine kirje ei tohi kogu sunkimisjooksu maha votta, seega iga kirje on omas
// try-plokis ja mitte-string sisend annab tuhja massiivi, mitte erindi.
//
// ULESANNE 5: VABATAHTLIK loendur. parseRss viskab mahakukkunud kirjed vaikselt ara
// ja ilma loenduseta naeb inimene sunkimislogis ainult numbrit "5" - ta ei tea, kas
// feedis oli 700 kirjet voi RHR muutis kujundust ja alles jai kaks. Tagastusvormi
// MUUTMATA jatmine on teadlik: parseRss-i kutsub ka ulesande 2 upsert-ahel ja
// varav mitmes kohas; massiivist objektiks minek oleks kolm korda suurem
// blast-radius kui uks vabatahtlik valjundparameeter.
// Loendurid on ammendavad: kirjeid === nisis + dublikaate + valjaspool + loetamatuid.
export function parseRss(xml, loend = null) {
  if (loend) Object.assign(loend, { kirjeid: 0, nisis: 0, dublikaate: 0, valjaspool: 0, loetamatuid: 0 });
  if (typeof xml !== 'string' || !xml) return [];
  const read = [];
  const koht = new Map(); // ref -> indeks read-massiivis
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi)) {
    if (loend) loend.kirjeid++;
    try {
      const rida = kirje(m[1], loend);
      if (!rida) continue;
      const i = koht.get(rida.ref);
      if (i === undefined) {
        koht.set(rida.ref, read.length);
        read.push(rida);
      } else {
        if (loend) loend.dublikaate++;
        // Sama koht massiivis - feedi jarjestus ei tohi dubli parast umber minna.
        if (uuem(rida, read[i])) read[i] = rida;
      }
    } catch { if (loend) loend.loetamatuid++; /* katkine kirje jaab vahele, jooks laheb edasi */ }
  }
  if (loend) loend.nisis = read.length;
  return read;
}

// ---------------------------------------------------------------------------
// ULESANNE 4: sobivuse skoor ja pohjendus.
// ---------------------------------------------------------------------------

// Segmendid, mida segmentOf uldse toodab. Plaani naidiskood andis +40 TINGIMUSTETA -
// ka siis, kui segment oli null. RSS-ahelas ei juhtu seda kunagi (parseRss viskab
// segmendita kirje valja), aga score() on eksporditud ja teda kutsutakse ka kasitsi
// impordist ja ulesande 6 eForms-teelt. Seal tahendaks tingimusteta +40, et score_why
// utleb inimesele "nišisegment" hanke kohta, mis ei ole niss. Seega: teadaolev
// segment annab punktid, tundmatu annab NAHTAVA nullrea.
const SEGMENDID = new Set(['nišš', 'väike veebileht']);

// Kerge menetlus. Tapitahetaluvus on sama pohjusega mis FIT-mustril: RHR-i ja kasitsi
// impordi tekst tuleb ka tapitahtedeta ('Vaikehange').
const KERGE_MENETLUS = /liht\s?hange|v[äa]ike\s?hange/i;

// UKS vormindusreegel kogu pohjendusele: taisarv, tuhandeeraldaja tuhik, euromark.
// toLocaleString jaab meelega valja - ta soltub ICU olemasolust (sama kood annaks
// eri masinas eri tulemuse, ehk funktsioon ei oleks enam puhas) ja tema tuhandeeraldaja
// on murdmatu tuhik U+00A0, mis nagi baasi veerus score_why valja nagu praht.
const raha = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €';

// Arvuvaljad tulevad RSS-ist, HTML-ist ja kasitsi impordist: '45000', '45 000', '',
// undefined ja 'kokkuleppel' on koik voimalikud. Kolm eri vastust, sest neil on kolm
// eri tahendust:
//   null = valja ei ole ("ei tea")   -> pohjenduses vaikus
//   NaN  = vali on katki             -> pohjenduses nahtav nullrida
//   arv  = vali on olemas            -> punktid
// See on sama joon mis viide() tombab: "puudub" ja "katki" ei ole sama viga.
function arv(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(/[\s ]/g, '').replace(',', '.')) : v;
  return (typeof n === 'number' && Number.isFinite(n)) ? n : NaN;
}

// Kuupaev UTC-keskoo millisekundites, voi null, kui kuju ei ole ISO voi paeva ei ole
// olemas. Date.parse uksi EI PIISA kahel pohjusel:
//   1) '2026-10-02 17:00' (markExpired lubab seda kuju) tolgendatakse KOHALIKUS ajas,
//      ehk paevade vahe soltuks masina ajavoondist - puhas funktsioon ei tohi seda teha;
//   2) '2026-02-31' on Date jaoks tore kuupaev (1. marts), aga RHR-is on ta viga.
function paev(v) {
  const m = typeof v === 'string' ? v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/) : null;
  if (!m) return null;
  const [a, k, p] = [+m[1], +m[2], +m[3]];
  const t = Date.UTC(a, k - 1, p);
  const d = new Date(t);
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== k - 1 || d.getUTCDate() !== p) return null;
  return t;
}

// score on PUHAS: ei baasi, ei vorku, ei mudelit, ei kella (today tuleb argumendina).
// Sama sisend annab alati sama valjundi - see on ANSUS, sest ulesanne 5 kutsub teda
// sunkimistsuklis ja tulemus laheb baasi veergudesse score / score_why.
//
// `why` on inimesele, mitte masinale: iga rakendunud tegur on UKS rida kujul
// '+15 · maksumus 57 000 €'. Nullrida ('0 · ...') tahendab "tegurit EI rakendatud ja
// siin on pohjus" - vaikne mitterakendumine on halvem kui uks liigne rida.
//
// Punktid VOIVAD jaada negatiivseks ja me EI loika neid nulli: nimekiri jarjestatakse
// skoori jargi ja negatiivne vahemik hoiab halvimad hanked oiges jarjekorras lopus.
// Verdikti piirid (35 / 60) on nagunii positiivses otsas, seega otsust see ei muuda.
export function score(h, { today = new Date().toISOString().slice(0, 10), ajalugu = null, docs = null } = {}) {
  if (!h || typeof h !== 'object' || Array.isArray(h)) throw viga('Vigane hange: ' + typeof h);
  // today on MEIE oma vali, mitte RHR-i oma - siin on vaikne eksimus halvem kui viga.
  // Sama joon mis markExpired-is.
  const nyyd = paev(today);
  if (nyyd === null || !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw viga('Vigane kuupäev: ' + today);

  const why = [];
  const add = (p, txt) => { why.push((p > 0 ? '+' : '') + p + ' · ' + txt); return p; };
  let points = 0;

  // 1. Segment.
  if (SEGMENDID.has(h.segment)) {
    points += add(40, 'sobiv segment: ' + h.segment);
    if (h.segment === 'väike veebileht') points += add(10, 'väikese veebilehe segment');
  } else {
    points += add(0, 'tundmatu segment' + (h.segment == null ? '' : ": '" + h.segment + "'")
      + ' — nišipunkte ei anta');
  }

  // 2. Maksumus (km-ta). Vahemik 140 001 - 1 000 000 ei anna MIDAGI ja see on teadlik
  // auk, mitte unustus: seal ei ole hange enam meie suurusjark, aga ei ole ka veel
  // "uksi ei kata". Kui tabelisse kunagi lisatakse keskmine vahemik, on see ainus koht.
  const est = arv(h.est);
  if (est !== null && (!Number.isFinite(est) || est < 0)) {
    points += add(0, 'maksumus teadmata: ' + JSON.stringify(h.est) + ' — ei ole kasutatav arv');
  } else if (est !== null) {
    if (est <= 50000) points += add(15, 'maksumus ' + raha(est) + ' — meie suurusjärk');
    else if (est <= 140000) points += add(10, 'maksumus ' + raha(est));
    else if (est > 1000000) points += add(-10, 'maksumus ' + raha(est) + ' — üksi ei kata');
  }

  // 3. Kvaliteedikriteerium. crit voib olla massiiv voi uksik string.
  const crit = Array.isArray(h.crit) ? h.crit : (typeof h.crit === 'string' ? [h.crit] : []);
  if (crit.some((c) => typeof c === 'string' && c.trim().toLowerCase() === 'quality')) {
    const kaal = arv(docs && docs.qualityWeight);
    const teada = Number.isFinite(kaal);
    points += add(teada && kaal >= 50 ? 20 : 10,
      'kvaliteedikriteerium' + (teada ? ' (' + kaal + ' % hindest)' : ' (kaal teadmata)'));
  }

  // 4. Kerge menetlus.
  if (KERGE_MENETLUS.test(h.menetlus || '')) points += add(5, 'kerge menetlus: ' + puhas(h.menetlus));

  // 5. Alltoovott. docs voidab h ule - dokumentidest loetu on tapsem kui RSS-i rida.
  // Plaani naidiskood valis sonumi tingimusega 'rollid >= 3 ? rollid + " rolli" : kaive'
  // ja see oleks KAHE pohjuse korral teise vaikselt ara jatnud. Sonum ehitatakse
  // paris rakendunud varavatest, aga -25 rakendub UKS kord.
  const rollid = arv(docs && docs.rollid !== undefined ? docs.rollid : h.rollid);
  const kaive = arv(docs && docs.kaiveNoue !== undefined ? docs.kaiveNoue : h.kaiveNoue);
  const rolliVarav = Number.isFinite(rollid) && rollid >= 3;
  const kaiveVarav = Number.isFinite(kaive) && kaive > 50000;
  const allt = rolliVarav || kaiveVarav;
  if (allt) {
    const pohjused = [];
    if (rolliVarav) pohjused.push(rollid + ' rolli CV-nõuet');
    if (kaiveVarav) pohjused.push('käibenõue ' + raha(kaive));
    points += add(-25, pohjused.join(' ja ') + ' — üksi ei kvalifitseeru');
  }

  // 6. Sama CPV ajalugu: mitu pakkujat tuleb tuupiliselt kohale.
  const mediaan = arv(ajalugu && ajalugu.medianTenders);
  if (Number.isFinite(mediaan)) {
    if (mediaan >= 8) points += add(-10, 'sama CPV ajalugu: mediaan ' + mediaan + ' pakkujat');
    else if (mediaan <= 3) points += add(5, 'sama CPV ajalugu: mediaan ' + mediaan + ' pakkujat');
  }

  // 7. Tahtaeg. Date.parse annab katkise kuupaeva peal NaN ja 'NaN < 3' on false -
  // ehk -15 oleks VAIKSELT rakendamata jaanud. Puuduv tahtaeg on "ei tea" (vaikus),
  // loetamatu tahtaeg on nahtav nullrida.
  if (h.deadline !== null && h.deadline !== undefined && h.deadline !== '') {
    const tahtaeg = paev(h.deadline);
    if (tahtaeg === null) {
      points += add(0, 'tähtaeg loetamatu: ' + JSON.stringify(h.deadline)
        + ' — kiirustamise karistust ei arvestatud');
    } else {
      const paevi = Math.round((tahtaeg - nyyd) / 86400000);
      if (paevi < 0) points += add(-15, 'tähtaeg möödas ' + -paevi + ' päeva tagasi');
      else if (paevi < 3) points += add(-15, 'tähtajani ' + paevi + ' päeva');
    }
  }

  // ALLTOOVOTT on ulimuslik: ka 80-punktine hange, kus nouded sunnivad meid
  // alltoovottu, ei ole "PAKU" - see on hoopis teine muugivestlus.
  const verdict = allt ? 'ALLTÖÖVÕTT' : points >= 60 ? 'PAKU' : points >= 35 ? 'KAALU' : 'JÄTA';
  return { points, verdict, why };
}
