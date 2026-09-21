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

/* ------------------------------------------- 10. VERDIKT tuleb baasist, mitte punktidest */
{
  // ALLTOOVOTT EI OLE punktidest tagasi arvutatav (vt lib/hanked.mjs score):
  // 40-punktine alltoovotu-hange naeks punktide jargi valja nagu 'KAALU'. Seega
  // kannab baas verdikti ise ja vaade naitab TEDA, mitte oma oletust.
  const nyyd = T('2026-09-21T17:00:00Z');

  const allt = L.riviks({ ref: 'V-1', state: 'uus', score: 40, verdict: 'ALLTÖÖVÕTT' }, nyyd);
  assert.equal(allt.verdict, 'ALLTÖÖVÕTT', 'verdikt peab reale jõudma');
  assert.equal(allt.otsus.verdict, 'ALLTÖÖVÕTT');
  assert.equal(allt.otsus.klass, 'allt', 'alltöövõtul on OMA klass, mitte punktide oma');
  assert.notEqual(allt.otsus.klass, L.skooriKlass(40),
    'kui verdikti klass tuleb punktidest, on ALLTÖÖVÕTT nähtamatu');
  assert.ok(allt.otsus.tekst.includes('ALLTÖÖVÕTT'), 'otsusveerg peab verdikti välja ütlema');
  assert.ok(allt.otsus.tekst.includes('40'), 'punktid jäävad verdikti kõrvale nähtavaks');

  for (const [v, k] of [['PAKU', 'top'], ['KAALU', 'kaalu'], ['JÄTA', 'jata'], ['ALLTÖÖVÕTT', 'allt']]) {
    assert.equal(L.verdiktiKlass(v), k, 'verdikti klass: ' + v);
  }
  // Tundmatu verdikt (server lisas uue) EI TOHI ara kaduda - naidatakse toorelt.
  const uus = L.riviks({ ref: 'V-2', state: 'uus', score: 70, verdict: 'OOTAME' }, nyyd);
  assert.equal(L.verdiktiKlass('OOTAME'), '', 'tundmatu verdikt ei saa klassi');
  assert.ok(uus.otsus.tekst.includes('OOTAME'), 'tundmatu verdikt jääb nähtavaks');
  assert.equal(uus.otsus.klass, L.skooriKlass(70), 'tundmatu verdikt kukub tagasi punktiklassile');

  // Verdiktita rida (kasitsi import, ulesande 6 eForms-tee, vana baas) naitab arvu.
  const ilma = L.riviks({ ref: 'V-3', state: 'uus', score: 72 }, nyyd);
  assert.equal(ilma.verdict, null, 'verdiktita rida ei tohi verdikti välja mõelda');
  assert.equal(ilma.otsus.tekst, '72', 'verdiktita real on ainult punktid');
  assert.equal(ilma.otsus.klass, 'top');
  const tyhi = L.riviks({ ref: 'V-4', state: 'uus' }, nyyd);
  assert.equal(tyhi.otsus.tekst, '—', 'ilma punktide ja verdiktita jääb kriips');
  assert.ok(!tyhi.otsus.tekst.includes('undefined'));

  console.log('PASS hanked UI: verdikt tuleb baasist ja ALLTÖÖVÕTT on eristatav');
}

/* --------------------------------------------- 11. käsunupu seis PUHTA andmena */
{
  // Nupu loogika (keelatud / kaib / peata / mida staatusrida naitab) on puhas
  // funktsioon, mitte DOM: nii on ta siin paris vaidetega kaetud ja brauserivarav
  // toestab ainult, et see joudis ka ekraanile.
  const t = { script: 'agent/hanked-sync.mjs', label: 'Sünkroon', valmis: true };

  const vaba = L.nupuSeis('sync', t, []);
  assert.equal(vaba.keelatud, false, 'vaba käsk on vajutatav');
  assert.equal(vaba.tekst, 'Sünkroon');
  assert.equal(vaba.pohjus, null);
  assert.equal(vaba.peata, false, 'ilma jooksuta ei ole midagi peatada');
  assert.equal(vaba.seis, null);
  assert.equal(vaba.lopp, null, 'ilma ühegi jooksuta ei ole lõpprida');

  // valmis:false = skripti EI OLE kettal (agent/hanked-history.mjs, hanked-docs.mjs).
  // Nupp peab olema keelatud JA seletatud, mitte spawnima puuduvat faili.
  const puudub = L.nupuSeis('history', { script: 'agent/hanked-history.mjs', label: 'Lae ajalugu', valmis: false }, []);
  assert.equal(puudub.keelatud, true, 'valmimata käsu nupp peab olema keelatud');
  assert.ok(/ei ole veel valmis/.test(puudub.pohjus), 'keeld peab olema seletatud: ' + puudub.pohjus);
  assert.ok(puudub.pohjus.includes('agent/hanked-history.mjs'), 'põhjus nimetab puuduva skripti');

  // Kaib: nupp keelatud, tekst muutub, "Peata" AINULT oma jooksu peal.
  const oma = { id: 7, cmd: 'sync', state: 'käib', progress: '12 uut · 3 uuendatud', oma: true, logTail: null };
  const voeras = { ...oma, id: 8, oma: false };
  const k1 = L.nupuSeis('sync', t, [oma]);
  assert.equal(k1.keelatud, true, 'käiva jooksu ajal on nupp keelatud');
  assert.equal(k1.tekst, 'Sünkroon …');
  assert.ok(/käib juba/.test(k1.pohjus));
  assert.equal(k1.peata, true, 'oma jooksu saab peatada');
  assert.equal(k1.seis, '12 uut · 3 uuendatud', 'progress läheb otse staatusreale');
  const k2 = L.nupuSeis('sync', t, [voeras]);
  assert.equal(k2.peata, false, 'võõra serveri-instantsi jooksu EI SAA tappa — nuppu ei tohi lubada');
  assert.equal(L.nupuSeis('sync', t, [{ ...oma, oma: undefined }]).peata, false,
    'teadmata omanik loetakse võõraks');

  // progress on NULL varavajooksul (gate ei truki JSON-progressiridu). Siis tuleb
  // naidata logi viimast SISUKAT rida, mitte igavest "kaivitub".
  const gate = { id: 9, cmd: 'gate', state: 'käib', progress: null, oma: true,
    logTail: 'PASS hanked: skoor ja põhjendus\nPASS hanked: sünk on idempotentne\n' };
  assert.equal(L.nupuSeis('gate', { label: 'Värav', valmis: true }, [gate]).seis,
    'PASS hanked: sünk on idempotentne', 'progressita jooks näitab logi viimast rida');
  assert.equal(L.nupuSeis('gate', { label: 'Värav', valmis: true },
    [{ ...gate, logTail: '{"progress":"laen RSS-i"}\n' }]).seis, 'käivitub',
    'JSON-rida ei ole inimesele mõeldud rida');
  assert.equal(L.nupuSeis('gate', { label: 'Värav', valmis: true }, [{ ...gate, logTail: null }]).seis,
    'käivitub', 'ilma logita on aus vastus "käivitub"');
  assert.equal(L.nupuSeis('gate', { label: 'Värav', valmis: true }, [{ ...gate, logTail: '   \n\n' }]).seis,
    'käivitub', 'tühjad read ei ole sisukas rida');

  // Lopprida: viimane LOPPENUD jooks, mitte suvaline rida.
  const jooksud = [
    { id: 12, cmd: 'sync', state: 'käib', progress: null, oma: true },
    { id: 11, cmd: 'sync', state: 'viga', rows: 0, finished: '2026-09-21T10:00:00Z', error: 'RSS-i ei saanud: RHR vastas 502' },
    { id: 10, cmd: 'sync', state: 'tehtud', rows: 6, finished: '2026-09-21T09:00:00Z', error: null },
  ];
  const s = L.nupuSeis('sync', t, jooksud);
  assert.equal(s.kaib.id, 12);
  assert.equal(s.lopp.id, 11, 'lõpprida tuleb viimasest lõppenud jooksust');
  assert.equal(s.lopp.viga, true, 'veaga jooks on punane');
  assert.ok(s.lopp.tulemus.includes('RHR vastas 502'), 'lõpprida ütleb päris vea: ' + s.lopp.tulemus);
  const tehtud = L.nupuSeis('sync', t, jooksud.slice(2));
  assert.equal(tehtud.lopp.viga, false);
  assert.equal(tehtud.lopp.rows, 6, 'ridade arv jääb nähtavaks');
  assert.ok(/korras/.test(tehtud.lopp.tulemus));
  // Teise kasu jooks ei tohi siia segada.
  assert.equal(L.nupuSeis('gate', { label: 'Värav', valmis: true }, jooksud).kaib, null,
    'teise käsu jooks ei tohi seda nuppu kinni panna');

  // KASK, MIS VAJAB VALITUD HANGET. agent/hanked-docs.mjs kaib UHE hanke kohta
  // (--ref=<viitenumber>) ja ilma selleta vaijub kohe veaga "Puudub --ref=...".
  // Enne parandust saatis nupp ainult { cmd } ja oli seega TOOTAV, KLIKITAV JA
  // ALATI KUKKUV - detailpaneel utles "vajuta Lae dokumendid" ja iga vajutus
  // andis veateate. Sama klass mis valmis:false: nupp lubas seda, mida ei saa.
  const dt = { script: 'agent/hanked-docs.mjs', label: 'Lae dokumendid', valmis: true };
  const ilmaValikuta = L.nupuSeis('docs', dt, []);
  assert.equal(ilmaValikuta.keelatud, true, 'hanget valimata peab "Lae dokumendid" olema keelatud');
  assert.equal(ilmaValikuta.ref, null, 'valikuta ei ole refi, mida kaasa anda');
  assert.ok(/vali kõigepealt/i.test(ilmaValikuta.pohjus),
    'keeld peab ütlema, MIDA teha: ' + ilmaValikuta.pohjus);
  const valikuga = L.nupuSeis('docs', dt, [], '314159');
  assert.equal(valikuga.keelatud, false, 'valitud hankega on nupp vajutatav');
  assert.equal(valikuga.ref, '314159', 'valitud viitenumber läheb käsule kaasa');
  assert.ok(valikuga.tekst.includes('314159'), 'nupp ütleb, MILLISE hanke kohta ta käib: ' + valikuga.tekst);
  assert.equal(L.nupuSeis('docs', dt, [], '   ').keelatud, true, 'tühikutest valik ei ole valik');
  // Refi EI nouavad kasud ei tohi sellest valvest muutuda.
  assert.equal(L.nupuSeis('sync', t, [], '314159').ref, null, 'sünk ei võta refi kaasa');
  assert.equal(L.nupuSeis('sync', t, []).keelatud, false, 'valikuta sünk jääb vajutatavaks');

  // ...ja views.js peab selle ka TEGELIKULT kaasa andma. Ilma selle vaiteta
  // labiks nupuSeis roheliselt ja paring saadaks ikka paljast { cmd }.
  assert.match(views, /api\('\/api\/hanked\/run',\s*ref\s*\?\s*\{\s*cmd,\s*args:\s*\{\s*ref\s*\}\s*\}/,
    'kaivita peab refi nõudva käsu puhul saatma args.ref');
  assert.match(views, /L\.nupuSeis\(cmd,\s*t,\s*hankedData\.runs,\s*hankedData\.valitud\)/,
    'käsuriba peab teadma, milline hange on valitud');

  console.log('PASS hanked UI: nupu seis, keeld, "Peata" ainult oma jooksul, progressita staatusrida'
    + ' ja "Lae dokumendid" ainult valitud hankega');
}

/* ------------------------------------------- 12. pollimise leping ja 409 keha */
{
  // poll() EI TOHI kutsuda renderHanked()-i: see teeks iga kahe sekundi tagant
  // uue /api/hanked paringu (kogu nimekiri) ja kustutaks detailpaneeli.
  const i = views.indexOf('async function poll(');
  assert.ok(i > 0, 'pollimisahel peab olema oma funktsioon');
  let sygavus = 0;
  let lopp = views.indexOf('{', i);
  for (let j = lopp; j < views.length; j++) {
    if (views[j] === '{') sygavus++;
    else if (views[j] === '}') { sygavus--; if (!sygavus) { lopp = j; break; } }
  }
  const keha = views.slice(i, lopp);
  assert.match(keha, /\/api\/hanked\/runs/, 'poll peab küsima AINULT jooksude otspunkti');
  assert.doesNotMatch(keha, /api\('\/api\/hanked'/, 'poll ei tohi kogu nimekirja uuesti laadida');
  for (const rida of keha.split('\n')) {
    if (!/renderHanked\(/.test(rida)) continue;
    assert.match(rida, /lopetas/,
      'renderHanked tohib pollimises käia AINULT jooksu lõppemise peal: ' + rida.trim());
  }
  // ...ja ta peab seal ka OLEMA: ilma selleta jääb tabel jooksu järel vanaks
  // (sünk lisas kuus hanget ja neid ei ole kusagil näha).
  const taislaadimised = keha.split('\n').filter((rida) => /renderHanked\(/.test(rida));
  assert.equal(taislaadimised.length, 1,
    'poll peab jooksu lõppemise peal tegema TÄPSELT ühe täislaadimise, on ' + taislaadimised.length);
  assert.match(keha, /lopetas/, 'lõppenud jooks peab tooma uued read (üks renderHanked)');
  assert.match(keha, /catch/, 'pollimine ilma veakäsitluseta on igavene spinner');

  // Uks ahel, mitte mitu: clearTimeout uksi ei aita, kui kaks poll()-i on lennus.
  assert.match(views, /function alustaPoll\b/, 'pollimise käivitamine peab käima ühest kohast');
  assert.match(views, /function peataPoll\b/, 'pollimise peatamine peab käima ühest kohast');
  assert.match(views, /pollKaib/, 'ahelal peab olema lipp, et teine käivitus ei laoks pollimisi kohakuti');
  assert.match(keha, /pollPolv/, 'lennus olev päring ei tohi surnud ahelat ellu äratada');

  // Vaatelt lahkumine peatab pollimise - muidu koputab leht serverit taustal.
  const r = views.slice(views.indexOf('window.CRMViews'));
  assert.match(r, /peataPoll\(\)/, 'vaate vahetus peab pollimise peatama');
  assert.match(r, /v !== 'hanked'/, 'peatumine peab käima siis, kui avatakse MUU vaade');

  // 409 keha ({error, runId}) peab api()-st labi tulema - muidu ei saa vaade
  // oelda, KUMB jooks juba kaib.
  assert.match(app, /err\.status\s*=\s*r\.status/, 'api() peab vea staatuse edasi andma');
  assert.match(app, /err\.keha\s*=\s*data/, 'api() peab vea KEHA edasi andma (409 runId)');
  assert.doesNotMatch(app, /throw new Error\(data\.error \|\| \('HTTP ' \+ r\.status\)\)/,
    'vana api() viskas ainult sõnumi ja runId kadus');
  assert.match(views, /runId/, 'vaade peab 409 runId-d kasutama');

  console.log('PASS hanked UI: pollimine on üks ahel, lõpeb vaatelt lahkudes ja 409 keha jõuab kliendini');
}

/* --------------------------------------- 13. detailpaneel ja märk load()-ist */
{
  assert.match(views, /'\/api\/hanked\/detail'/, 'detailpaneel peab küsima detaili otspunkti');
  assert.match(views, /'\/api\/hanked\/note'/, 'märkus peab salvestuma');
  assert.match(views, /addEventListener\('blur'/, 'märkus salvestub fookuse kaotusel');
  assert.match(views, /riigihanked\.riik\.ee\/rhr-web\/#\/procurement\//, 'RHR-i link puudub');
  assert.match(views, /rhr_id/, 'link peab tulema rhr_id väljast');
  assert.match(views, /Sarnased lepingud/, 'sarnaste lepingute plokk puudub');
  assert.match(views, /d\.sarnased|hankedData\.detail\.sarnased/,
    'ülesanne 13: plokk peab tulema detaili vastusest, mitte eraldi päringust');
  // Detaili EI TOHI kusida iga pollimise peale - vastus laheb vahemallu.
  assert.match(views, /hankedData\.detail/, 'detail peab olema mudelis, mitte iga joonistuse peale päritav');

  // MARK: number peab olema sakil ENNE esimest sakiklikki. load() ei tohi selleks
  // uut rasket paringut teha - loendur tuleb /api/state vastuses.
  assert.match(app, /hankedKiireid/, 'app.js peab märgi lugema /api/state vastusest');
  assert.match(app, /function mark\(/, 'märgi kirjutamine peab olema ÜHES kohas');
  assert.match(app, /mark\('hankedBadge'/, 'renderStats peab märgi kirjutama');
  assert.doesNotMatch(app, /api\('\/api\/hanked'\)/, 'load() ei tohi hangete nimekirja pärida');
  assert.match(views, /CRM\.mark\(/, 'views.js peab kasutama SAMA märgikirjutajat, mitte oma koopiat');

  console.log('PASS hanked UI: detailpaneeli leping ja sakimärk tulevad load()-ist');
}

/* ------------------------------- 14. sarnased lepingud (ülesanne 13) */
{
  // Plokk kannab OTSUST, seega ta peab ütlema ka selle, MILLEL otsus põhineb.
  // Paljas mediaan ilma aluseta on halvem kui mitte midagi: kahel lepingul
  // põhinev arv näeb välja täpselt nagu kahekümnel põhinev.
  assert.match(views, /sarnasedPlokk|hankedSarnased/, 'sarnaste lepingute plokil peab olema ehitaja');
  assert.match(views, /medianAmount/, 'mediaanhind peab vaatesse jõudma');
  assert.match(views, /medianTenders/, 'mediaanne pakkujate arv peab vaatesse jõudma');
  assert.match(views, /\.n\b/, 'mediaani alus (mitu lepingut) peab vaatesse jõudma');
  assert.match(views, /valjaJai/, 'väljajäänud lepingud peavad olema öeldud, mitte vaikitud');
  assert.match(views, /CPV-d ei ole/, 'segmendi-varutee peab olema NÄHTAVALT märgitud');
  assert.match(views, /piisav/, 'alla läve jääv alus peab vaates eristuma');

  // RHR-i tekst (võitja nimi, pealkiri) käib el()-i kaudu. innerHTML-i ei ole
  // selles failis ÜHTEGI ja see plokk ei tohi olla esimene.
  assert.doesNotMatch(views, /innerHTML|insertAdjacentHTML|outerHTML/,
    'RHR-ist tulev tekst ei tohi minna lehele HTML-ina');

  console.log('PASS hanked UI: sarnaste lepingute plokk kannab alust, varuteed ja väljajäetut');
}

/* ------------------------- 15. alusdokumentide leiud jõuavad ka EKRAANILE */
{
  // Ehitaja oli olemas (dokumendiPlokk) ja server saatis `dokumendid` kaasa, aga
  // valiHange EI PANNUD teda vahemallu - dokumendiPlokk sai igavesti `undefined`
  // ja paneel vaitis ka parast kordalainud jooksu, et "dokumente ei ole veel
  // kordagi kusitud". Kogu ulesande 14 toendiplokk (rollid, kaibenoue,
  // kvaliteedikaal koos LAUSE ja FAILINIMEGA) oli ekraanil kattesaamatu. Kolm
  // vaidet, sest uhe kadumine on tapselt see, mis juhtus:
  assert.match(views, /dokumendiPlokk\(/, 'alusdokumentide plokil peab olema ehitaja');
  assert.match(views, /dokumendid:\s*d\.dokumendid/,
    'detaili vastuse `dokumendid` peab jõudma vahemällu, muidu plokk ei näe kunagi midagi');
  assert.match(views, /dokumendiPlokk\(d\.dokumendid\)/,
    'joonistus peab võtma dokumendid vahemälust');
  // Toend ise: leid ilma lauseta ja failita on paljas arv, mida silmaga
  // kontrollida ei saa - ja vale arv annab -25 punkti ning verdikti ALLTOOVOTT.
  assert.match(views, /lause|tõend/i, 'iga leid peab kandma lauset, millest ta tuli');
  assert.match(views, /fail/i, 'iga leid peab ütlema, MILLISEST failist lause tuli');
  assert.match(views, /kontrolli/, 'ebakindel leid peab jääma NÄHTAVAKS, mitte kaduma');
  assert.match(views, /tekstita|tekstiks ei saanud/,
    'tekstiks mitte saadud fail peab olema loendatud, mitte vaikitud');

  console.log('PASS hanked UI: alusdokumentide leiud jõuavad vahemällu ja kannavad tõendit');
}
