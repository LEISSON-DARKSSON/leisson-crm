// ULESANNE 9: riigihangete vaade - sakk, tabel ja filtririba.
//
// MIKS SEE VARAV EI OLE AINULT TEKSTISOBITUS. Plaani naidisvarav kusis ainult,
// kas index.html-is leidub 'data-view="hanked"' ja views.js-is 'hanked:'. See
// laheb roheliseks ka siis, kui filter peidab vale hulga ridu, tahtaja arvutus
// eksib uhe paeva voi RHR-ist tulev pealkiri jouab lehele HTML-ina. Seega on
// vaate PUHAS loogika eraldi failis (public/hanked-loogika.js) ja siin
// KAIVITATAKSE teda paris andmetega node:vm-is - sama fail, mille brauser laeb.
//
// Sellel varaval EI OLE npm-soltuvusi: ta jookseb ka Linux VM-is, kus
// crm/node_modules on Windowsi junction ja playwright kattesaamatu. Paris DOM-i
// ja paris sakivahetust toestab test/gate-hanked-vaade.mjs (brauserivarav,
// tools/varav.mjs VALJAJATED nimekirjas, sama muster mis gate-campaign-ui.mjs).
//
// Ajavoond on TEADLIKULT Europe/Tallinn: UTC-s langeb naiivne Date.parse-arvutus
// oige vastusega kokku ja piirijuhtum jaaks toestamata.
process.env.TZ = 'Europe/Tallinn';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ROOT } from '../lib/env.mjs';
import { HANKE_STATES, LOPUSEISUD, SEISU_LIIK } from '../lib/hanked.mjs';

const loe = (f) => readFileSync(join(ROOT, f), 'utf8');
const html = loe('public/index.html');
const app = loe('public/app.js');
const views = loe('public/views.js');
const css = loe('public/crm2.css');
const loogikaSrc = loe('public/hanked-loogika.js');

// Ajavoond peab paris ka kehtima - muidu laheks piirijuhtum labi tuhja.
assert.equal(new Date('2026-09-21T17:00:00Z').getHours(), 20,
  'test eeldab ajavoondit Europe/Tallinn (UTC+3); process.env.TZ ei rakendunud');

// Brauseri fail kaivitatakse siin SAMAS kujus, nagu ta lehele laeb: klassikaline
// skript, mis paneb loogika window-i kulge. Import-kuju siin ja skript-kuju
// brauseris oleksid KAKS eri faili - ja testitaks seda, mida ei saadeta.
const aken = {};
runInNewContext(loogikaSrc, { window: aken }, { filename: 'public/hanked-loogika.js' });
const L = aken.HankedLoogika;
assert.ok(L, 'public/hanked-loogika.js peab andma window.HankedLoogika');

const T = (iso) => new Date(iso);

/* ---------------------------------------------------------------- 1. seisud */
{
  // Lopuseisud tulevad SERVERILT (lib/hanked.mjs), mitte kliendi kasitsi
  // nimekirjast. Iga seis peab olema klassifitseeritud - vastasel korral saaks
  // HANKE_STATES-i lisada uue seisu, mida filter vaikselt ei tunne.
  for (const s of HANKE_STATES) {
    assert.ok(SEISU_LIIK[s] === 'töös' || SEISU_LIIK[s] === 'lõpp',
      'seis ' + s + ' on klassifitseerimata (SEISU_LIIK)');
  }
  assert.deepEqual(HANKE_STATES, Object.keys(SEISU_LIIK),
    'HANKE_STATES peab TULENEMA klassifikatsioonist, mitte elama selle korval');
  assert.deepEqual(LOPUSEISUD, HANKE_STATES.filter((s) => SEISU_LIIK[s] === 'lõpp'));
  assert.ok(LOPUSEISUD.includes('aegunud') && LOPUSEISUD.includes('kaotatud')
    && LOPUSEISUD.includes('jatsin') && LOPUSEISUD.includes('voidetud'),
    'lopuseisud peavad katma aegunud, kaotatud, jatsin ja voidetud');
  assert.ok(!LOPUSEISUD.includes('uus') && !LOPUSEISUD.includes('vaatan'));

  console.log('PASS hanked UI: iga seis on klassifitseeritud, lõppseisud tulenevad klassifikatsioonist');
}

/* --------------------------------------------------- 2. filter serveri pealt */
{
  const read = HANKE_STATES.map((state, i) => ({ ref: 'R' + i, state, deadline: null, title: 't' }));

  const aktiivsed = L.filtreeri(read, { seis: 'aktiivsed' }, LOPUSEISUD);
  assert.deepEqual(aktiivsed.map((h) => h.state).sort(),
    HANKE_STATES.filter((s) => !LOPUSEISUD.includes(s)).sort(),
    'aktiivsed = kõik seisud peale lõppseisude');

  // SEE on see test, mis kukub, kui filter viiakse tagasi kasitsi nimekirjale:
  // server kuulutab uue lopuseisu ja klient PEAB teda kuulama.
  const uusLopp = 'loobusime';
  const laiendatud = [...LOPUSEISUD, uusLopp];
  const readPlus = [...read, { ref: 'RX', state: uusLopp, deadline: null, title: 't' }];
  const a2 = L.filtreeri(readPlus, { seis: 'aktiivsed' }, laiendatud);
  assert.ok(!a2.some((h) => h.state === uusLopp),
    'filter ei kuula serveri lõppseisude nimekirja — kliendis on käsitsi kirjutatud loend');
  assert.equal(a2.length, aktiivsed.length, 'uus lõppseis ei tohi muud filtrit nihutada');

  assert.equal(L.filtreeri(read, { seis: 'kõik' }, LOPUSEISUD).length, HANKE_STATES.length);
  assert.deepEqual(L.filtreeri(read, { seis: 'aegunud' }, LOPUSEISUD).map((h) => h.state), ['aegunud']);
  // Vana server ilma lopuseisudeta: pigem NAITA koike kui peida vaikselt ridu.
  assert.equal(L.filtreeri(read, { seis: 'aktiivsed' }, undefined).length, HANKE_STATES.length,
    'lopuseisudeta vastus ei tohi ridu vaikselt kaotada');
  assert.equal(L.aktiivsed(HANKE_STATES, LOPUSEISUD).length, HANKE_STATES.length - LOPUSEISUD.length);

  console.log('PASS hanked UI: seisufilter tuleneb serveri lõppseisudest, mitte kliendi loendist');
}

/* ------------------------------------------------------- 3. PAEVI ja ajavöönd */
{
  // Kell on 21.09.2026 20:00 Tallinnas = 17:00 UTC. Naiivne
  // Math.round((Date.parse(d) - Date.now())/86400000) annab siin UHE VORRA
  // vale vastuse, sest Date.parse('2026-09-29') on UTC-kesköö.
  const ohtu = T('2026-09-21T17:00:00Z');
  const naiivne = (d) => Math.round((Date.parse(d) - ohtu.getTime()) / 86400000);

  assert.equal(L.paevi('2026-09-21', ohtu), 0, 'tänane tähtaeg = 0 päeva');
  assert.equal(L.paevi('2026-09-22', ohtu), 1);
  assert.equal(L.paevi('2026-09-23', ohtu), 2);
  assert.equal(L.paevi('2026-09-24', ohtu), 3, '24. september on 3 päeva pärast, mitte 2');
  assert.equal(naiivne('2026-09-24'), 2, 'kontroll: naiivne arvutus eksib siin ühe päeva võrra');
  assert.equal(L.paevi('2026-09-29', ohtu), 8, '29. september on 8 päeva pärast');
  assert.equal(naiivne('2026-09-29'), 7, 'kontroll: naiivne arvutus teeks 8 päevast kiireloomulise');
  assert.equal(L.paevi('2026-09-20', ohtu), -1, 'eilne tähtaeg on -1');

  // Hommik ja oo annavad SAMA vastuse: paev on kalendripaev, mitte 24 tundi.
  for (const hetk of ['2026-09-21T00:00:00Z', '2026-09-21T05:00:00Z', '2026-09-21T20:59:00Z']) {
    assert.equal(L.paevi('2026-09-24', T(hetk)), 3, 'kellaaeg ' + hetk + ' ei tohi päevade arvu muuta');
  }
  // Suve- ja talveaja vahetus (25.10.2026) ei tohi anda 0,5 paeva ega murdarvu.
  assert.equal(L.paevi('2026-10-26', T('2026-10-24T09:00:00Z')), 2, 'kellakeeramine ei tohi päeva nihutada');
  assert.ok(Number.isInteger(L.paevi('2026-10-26', T('2026-10-24T09:00:00Z'))));

  // Kellaajaga tahtaeg (markExpired lubab kuju '2026-09-24 17:00') ja praht.
  assert.equal(L.paevi('2026-09-24 17:00', ohtu), 3, 'kellaajaga tähtaeg loetakse sama päevana');
  for (const katki of [null, undefined, '', '24.09.2026', '2026-02-31', '2026', '45000', 'homme', 5]) {
    assert.equal(L.paevi(katki, ohtu), null, 'loetamatu tähtaeg ' + JSON.stringify(katki) + ' peab andma null-i');
  }

  console.log('PASS hanked UI: tähtajani jäänud päevad on ajavööndikindlad, piirid 0/3/8 lukus');
}

/* --------------------------------------------- 4. kiireloomuliste loendur ja märk */
{
  const nyyd = T('2026-09-21T17:00:00Z');
  const read = [
    { ref: 'A', state: 'uus', deadline: '2026-09-24' },        // 3 p  -> kiire
    { ref: 'B', state: 'uus', deadline: '2026-09-28' },        // 7 p  -> kiire (piir)
    { ref: 'C', state: 'uus', deadline: '2026-09-29' },        // 8 p  -> EI
    { ref: 'D', state: 'uus', deadline: '2026-09-20' },        // eile -> EI (aegunud sisuliselt)
    { ref: 'E', state: 'vaatan', deadline: '2026-09-22' },     // seis ei ole uus -> EI
    { ref: 'F', state: 'aegunud', deadline: '2026-09-22' },    // lõppseis -> EI
    { ref: 'G', state: 'uus', deadline: null },                // tähtaega ei tea -> EI
    { ref: 'H', state: 'uus', deadline: '2026-09-21' },        // täna -> kiire
  ];
  assert.deepEqual(L.kiireloomulised(read, nyyd).map((h) => h.ref), ['A', 'B', 'H'],
    'kiireloomuline = seis uus JA tähtajani 0..7 päeva');
  assert.equal(L.kiireloomulised([], nyyd).length, 0, 'tühi nimekiri ei tekita märki');
  assert.equal(L.kiireloomulised(read.filter((h) => h.state !== 'uus'), nyyd).length, 0);
  // Moodunud tahtaeg EI tohi marki paisutada ka siis, kui markExpired ei ole veel jooksnud.
  assert.equal(L.kiireloomulised([{ ref: 'X', state: 'uus', deadline: '2020-01-01' }], nyyd).length, 0,
    'möödunud tähtajaga rida ei ole kiireloomuline');

  console.log('PASS hanked UI: kiireloomuliste loendur ei loe aegunuid ega muid seise kaasa');
}

/* ------------------------------------------------- 5. rea vormindus ja VÕÕRAS tekst */
{
  const nyyd = T('2026-09-21T17:00:00Z');
  // RHR on VALINE allikas. Pealkiri, hankija ja markus tulevad sealt toorelt.
  const kuri = '<img src=x onerror="alert(1)">';
  const r = L.riviks({
    ref: 'R-1', state: 'uus', deadline: '2026-09-24', title: kuri, buyer: '<script>x</script>',
    est: 57000, menetlus: 'avatud', score: 72, docs_count: 3,
  }, nyyd);

  assert.equal(r.title, kuri, 'pealkiri peab jääma TÄPSELT samaks tekstiks');
  assert.equal(r.buyer, '<script>x</script>', 'hankija nimi jääb tekstiks');
  assert.equal(typeof r.title, 'string');
  assert.equal(r.paevi, 3);
  assert.equal(r.tahtaeg.text, '3 p');
  assert.equal(r.tahtaeg.klass, 'kiire');
  assert.equal(r.kuupaev, '24.09.2026');
  assert.equal(r.kiire, true);
  assert.equal(r.est, 57000);
  assert.equal(r.score, 72);
  assert.equal(r.skooriKlass, 'top', 'skoor 72 on kõrge');
  assert.equal(r.docs, 3);

  // Tuhjad ja puuduvad valjad ei tohi anda 'undefined'-it ega null-i lehele.
  const t = L.riviks({ ref: 'R-2', state: 'uus' }, nyyd);
  assert.equal(t.title, 'nimetuseta');
  assert.equal(t.buyer, 'hankija teadmata');
  assert.equal(t.kuupaev, '—');
  assert.equal(t.tahtaeg.text, '—');
  assert.equal(t.paevi, null);
  assert.equal(t.kiire, false);
  assert.equal(t.est, null);
  assert.equal(t.score, null);
  assert.equal(t.skooriKlass, '');
  assert.equal(t.docs, 0);
  for (const v of Object.values(t)) {
    assert.ok(typeof v !== 'string' || !v.includes('undefined'), 'reale ei tohi jõuda "undefined"');
  }

  assert.equal(L.riviks({ ref: 'R-3', state: 'uus', deadline: '2026-09-20' }, nyyd).tahtaeg.text, '1 p tagasi');
  assert.equal(L.riviks({ ref: 'R-4', state: 'uus', deadline: '2026-09-21' }, nyyd).tahtaeg.text, 'täna');
  assert.equal(L.riviks({ ref: 'R-5', state: 'uus', score: 40 }, nyyd).skooriKlass, 'kaalu');
  assert.equal(L.riviks({ ref: 'R-6', state: 'uus', score: 10 }, nyyd).skooriKlass, 'jata');

  console.log('PASS hanked UI: rida on puhas tekst, tühjad väljad kannavad eestikeelset asendust');
}

/* ----------------------------------------------------------------- 6. XSS-joon */
{
  // el() app.js-is kirjutab textContent-i ja setAttribute-i. Kui kuskil vaates
  // ilmub innerHTML, jouab RHR-i pealkiri lehele HTML-ina - see on ainus koht
  // projektis, kus voeras tekst lehele jouab.
  for (const [nimi, src] of [['app.js', app], ['views.js', views], ['hanked-loogika.js', loogikaSrc]]) {
    assert.doesNotMatch(src, /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write\b/,
      nimi + ': võõras tekst ei tohi jõuda lehele HTML-ina');
  }
  assert.match(app, /n\.textContent = v/, 'el() peab kirjutama teksti textContent-i kaudu');

  console.log('PASS hanked UI: ükski väli ei jõua lehele HTML-ina');
}

/* ------------------------------------------------------------ 7. sakk ja vaade */
{
  assert.match(html, /data-view="hanked"/, 'sakk puudub');
  assert.match(html, /role="tab"[^>]*data-view="hanked"|data-view="hanked"[^>]*role="tab"/, 'sakk ei ole role="tab"');
  assert.match(html, /data-view="hanked"[^>]*aria-selected="false"/, 'sakil puudub aria-selected');
  assert.match(html, /id="hankedBadge"/, 'sakil puudub märk');
  assert.match(html, /id="viewHanked"/, 'vaate konteiner puudub');
  assert.match(html, /id="hankedBody"/, 'vaate sisu konteiner puudub');
  assert.match(html, /src="\/hanked-loogika\.js"/, 'puhas loogika ei ole lehele laetud');
  // Loogika peab olema laetud ENNE views.js-i, muidu on window.HankedLoogika tühi.
  assert.ok(html.indexOf('hanked-loogika.js') < html.indexOf('views.js'),
    'hanked-loogika.js peab laaduma enne views.js-i');
  assert.match(app, /VIEWS\s*=\s*\[[^\]]*'hanked'/, 'VIEWS ei sisalda hanked');
  assert.match(views, /hanked:\s*renderHanked/, 'ruuter ei tunne vaadet');

  console.log('PASS hanked UI: sakk, konteiner, ruuter ja laadimisjärjekord');
}

/* -------------------------------------------- 8. vaate leping ülesandele 10 */
{
  // Ulesanne 10 ehitab NUPURIBA (#hankedRunbar) ja DETAILPANEELI (#hankedDetail)
  // selle vaate sisse. Need konteinerid ja nende taitjad on siin olemas - kui
  // nad kaovad, kukub ulesanne 10 kokku ilma uhegi punase testita.
  assert.match(views, /#hankedRunbar/, 'nupuriba konteiner puudub — ülesandel 10 ei ole kohta');
  assert.match(views, /#hankedDetail/, 'detailpaneeli konteiner puudub');
  assert.match(views, /function joonistaHanked\b/, 'joonistamine peab olema päringust lahus');
  assert.match(views, /function valiHange\b/, 'rea valik peab olema eraldi funktsioon');
  // Seisumuutus EI tohi kogu nimekirja uuesti laadida.
  assert.doesNotMatch(views, /api\('\/api\/hanked\/state'[^)]*\)[^;]*\.then\(\s*renderHanked/,
    'seisumuutus ei tohi käivitada täislaadimist');

  console.log('PASS hanked UI: nupuriba ja detailpaneeli konteinerid on ülesande 10 jaoks olemas');
}

/* --------------------------------------------- 9. tühi olek, viga, ligipääsetavus */
{
  assert.match(views, /scope: 'col'|scope:'col'/, 'tabeli päised peavad kandma scope="col"');
  assert.match(views, /'aria-label'/, 'seisu rippmenüül peab olema silt');
  assert.match(views, /sünkimist ei ole veel|sünki ei ole veel/i,
    'tühi baas peab ütlema, et sünkimist ei ole jooksutatud');
  assert.match(views, /Selle filtriga/, 'filtriga tühi tulemus peab olema eraldi lause');
  assert.match(views, /server ei vasta/, 'võrguviga peab olema eestikeelne');
  assert.match(views, /Proovi uuesti/, 'vigane vastus peab jätma vaate kasutatavaks');
  assert.match(css, /\.runbar\b/, 'crm2.css: .runbar puudub');
  assert.match(css, /\.run-row\b/, 'crm2.css: .run-row puudub');

  console.log('PASS hanked UI: tühi olek, veateade ja ligipääsetavuse nõuded on kaetud');
}
