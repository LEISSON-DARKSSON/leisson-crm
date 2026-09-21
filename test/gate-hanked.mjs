// Riigihangete andmekihi varav: tabelid, upsert, valvad sisendid ja jarjestus.
// Baas laheb OS-i tmp-kausta - monteeritud kettal SQLite lukustust ei toetata.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrateHanked, upsertHange, listHanked, setState, setNote, markExpired, HANKE_STATES,
  segmentOf, parseRss, FIT, score } from '../lib/hanked.mjs';
import { leiaVaravad, VALJAJATED } from '../tools/varav.mjs';

function testDb() {
  const dir = mkdtempSync(join(tmpdir(), 'hanked-'));
  const db = new DatabaseSync(join(dir, 'test.sqlite'));
  db.exec('PRAGMA foreign_keys = ON');
  migrateHanked(db);
  return db;
}

{
  const db = testDb();
  upsertHange(db, { ref: '314159', rhr_id: '10682825', buyer: 'Tervise Arengu Instituut',
    buyer_reg: '70006292', title: 'Eneseabiprogramm', menetlus: 'Avatud hankemenetlus',
    est: 85000, cpv: '72230000', deadline: '2026-10-13', published: '2026-09-10', segment: 'nišš' });
  const rows = listHanked(db, {});
  assert.equal(rows.length, 1, 'uks upsert annab uhe rea');
  assert.equal(rows[0].state, 'uus', 'uus hange algab seisus uus');
  assert.equal(rows[0].note, null, 'uuel hankel ei ole markust');
  assert.equal(rows[0].title, 'Eneseabiprogramm', 'pealkiri salvestub');
  db.close();
  console.log('PASS hanked: upsert ja vaikeseis');
}

// P1: viitenumbrita kirje ei tohi baasi jouda (NULL-ref tekitaks iga kord uue rea).
{
  const db = testDb();
  assert.throws(() => upsertHange(db, { ref: null, title: 'Vigane kirje' }),
    /Viitenumbrita hange/, 'NULL-viitenumbriga hange peab viskama eestikeelse vea');
  assert.throws(() => upsertHange(db, { ref: '', title: 'Vigane kirje' }),
    /Viitenumbrita hange/, 'tuhja viitenumbriga hange peab viskama eestikeelse vea');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanked').get().c, 0,
    'viitenumbrita kirje ei tohi baasi jouda');
  db.close();
  console.log('PASS hanked: viitenumbrita kirje luuakse valve taha');
}

// P2: tuhi string ei tohi head andmed ule kirjutada (RSS annab puuduva valja tuhjana).
{
  const db = testDb();
  upsertHange(db, { ref: 'x', title: 'Vana pealkiri', deadline: '2026-12-01', buyer: 'Vana ostja' });
  const seis = upsertHange(db, { ref: 'x', title: '', deadline: '', buyer: undefined });
  assert.equal(seis, 'uuendatud', 'olemasolev hange annab uuendatud');
  const rida = db.prepare('SELECT * FROM hanked WHERE ref = ?').get('x');
  assert.equal(rida.title, 'Vana pealkiri', 'tuhi pealkiri ei tohi vana ule kirjutada');
  assert.equal(rida.deadline, '2026-12-01', 'tuhi tahtaeg ei tohi vana ule kirjutada');
  assert.equal(rida.buyer, 'Vana ostja', 'undefined ei tohi vana ostjat ule kirjutada');
  db.close();
  console.log('PASS hanked: tuhi string ei kirjuta head andmed ule');
}

// P3: puuduv pealkiri annab eestikeelse vea, mis utleb MILLINE kirje on katki.
{
  const db = testDb();
  assert.throws(() => upsertHange(db, { ref: 'kat-01' }),
    /Pealkirjata hange: kat-01/, 'pealkirjata uus hange peab nimetama viitenumbri eesti keeles');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanked').get().c, 0,
    'pealkirjata kirje ei tohi baasi jouda');
  db.close();
  console.log('PASS hanked: pealkirjata kirje annab eestikeelse vea');
}

// P4: seisuveerg on joustatud - nimekirjavaline seis ei lahe baasi.
{
  const db = testDb();
  upsertHange(db, { ref: 's-01', title: 'Seisu test' });
  assert.throws(() => db.exec("UPDATE hanked SET state = 'banaan' WHERE ref = 's-01'"),
    /CHECK|constraint/i, 'nimekirjavaline seis peab andma CHECK-vea');
  for (const seis of HANKE_STATES) {
    db.exec("UPDATE hanked SET state = '" + seis + "' WHERE ref = 's-01'");
    assert.equal(db.prepare('SELECT state FROM hanked WHERE ref = ?').get('s-01').state, seis,
      'HANKE_STATES vaartus ' + seis + ' peab olema CHECK-i poolt lubatud');
  }
  db.close();
  console.log('PASS hanked: seisuveerg on joustatud');
}

// P5: tuhi tahtaeg ei hupa etteotsa ja vordsete tahtaegade jarjestus on determineeritud.
{
  const db = testDb();
  db.exec("INSERT INTO hanked (ref,title,deadline) VALUES ('tyhi','Tuhja tahtajaga','')");
  db.exec("INSERT INTO hanked (ref,title,deadline) VALUES ('null','Ilma tahtajata',NULL)");
  upsertHange(db, { ref: 'a', title: 'Esimene', deadline: '2026-10-01' });
  upsertHange(db, { ref: 'c', title: 'Sama tahtaeg C', deadline: '2026-11-01' });
  upsertHange(db, { ref: 'b', title: 'Sama tahtaeg B', deadline: '2026-11-01' });
  const jarjestus = listHanked(db, {}).map((r) => r.ref);
  assert.deepEqual(jarjestus, ['a', 'b', 'c', 'null', 'tyhi'],
    'tuhi ja puuduv tahtaeg lahevad loppu, vordsed tahtajad jarjestuvad viitenumbri jargi');
  db.close();
  console.log('PASS hanked: tahtaja jarjestus');
}

// P6: identsed lepingureal NULL-idega ei tohi dubleeruda (SQLite UNIQUE ei loe NULL-e vordseks).
{
  const db = testDb();
  const sql = "INSERT OR IGNORE INTO hanke_lepingud (ref,date,winner_reg,amount) VALUES (NULL,'2026-01-01',NULL,NULL)";
  db.exec(sql);
  db.exec(sql);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanke_lepingud').get().c, 1,
    'kaks identset NULL-lepingut annavad uhe rea');
  const sql2 = "INSERT OR IGNORE INTO hanke_lepingud (ref,date,winner_reg,amount) VALUES ('r1','2026-01-01','10000000',5000)";
  db.exec(sql2);
  db.exec(sql2);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanke_lepingud').get().c, 2,
    'teine, erinev leping lisandub aga ei dubleeru');
  db.close();
  console.log('PASS hanked: lepingute dubleerimise kaitse');
}

// P7: ettevalmistatud laused on vahemalus baasi kohta - kaks baasi ei tohi segamini minna.
{
  const a = testDb();
  const b = testDb();
  upsertHange(a, { ref: 'a-1', title: 'A baasi hange' });
  upsertHange(b, { ref: 'b-1', title: 'B baasi hange' });
  assert.equal(upsertHange(a, { ref: 'a-1', title: 'A baasi hange' }), 'uuendatud',
    'sama baasi kordusupsert annab uuendatud');
  assert.equal(upsertHange(b, { ref: 'a-1', title: 'A ka B baasi' }), 'uus',
    'teine baas on soltumatu - sama viitenumber on seal uus');
  assert.deepEqual(a.prepare('SELECT ref FROM hanked ORDER BY ref').all().map((r) => r.ref), ['a-1'],
    'A baasi sisu ei lekki');
  assert.deepEqual(b.prepare('SELECT ref FROM hanked ORDER BY ref').all().map((r) => r.ref), ['a-1', 'b-1'],
    'B baasi sisu ei lekki');
  a.close();
  b.close();

  // Laused valmistatakse baasi kohta uks kord, mitte igas kutses uuesti.
  const c = testDb();
  const paris = c.prepare.bind(c);
  let kordi = 0;
  c.prepare = (sql) => { kordi += 1; return paris(sql); };
  for (let i = 0; i < 5; i += 1) upsertHange(c, { ref: 'p-' + i, title: 'Jooksu test ' + i });
  for (let i = 0; i < 5; i += 1) upsertHange(c, { ref: 'p-' + i, title: 'Jooksu test ' + i });
  assert.ok(kordi <= 3, 'kumme upsertit tohib valmistada ulimalt 3 lauset, valmistas ' + kordi);
  assert.equal(c.prepare('SELECT COUNT(*) AS c FROM hanked').get().c, 5, 'kordusupsert ei tekita uusi ridu');
  c.close();
  console.log('PASS hanked: lausete vahemalu on baasipohine');
}

// U1: ainult tuhikutest koosnev vali on sama mis puuduv - RSS ja HTML annavad ' ' voi '\n  '.
{
  const db = testDb();
  upsertHange(db, { ref: 'u1', title: 'Vana pealkiri', buyer: 'Vana ostja', deadline: '2026-12-01' });
  upsertHange(db, { ref: 'u1', title: '   ', buyer: '  ', deadline: '\n  ' });
  const rida = db.prepare('SELECT * FROM hanked WHERE ref = ?').get('u1');
  assert.equal(rida.title, 'Vana pealkiri', 'tuhikutest pealkiri ei tohi vana ule kirjutada');
  assert.equal(rida.buyer, 'Vana ostja', 'tuhikutest ostja ei tohi vana ule kirjutada');
  assert.equal(rida.deadline, '2026-12-01', 'reavahetusest tahtaeg ei tohi vana ule kirjutada');
  assert.throws(() => upsertHange(db, { ref: 'u1-uus', title: '   ' }),
    /Pealkirjata hange: u1-uus/, 'tuhikutest pealkirjaga uus hange peab andma eestikeelse vea');
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM hanked WHERE ref = 'u1-uus'").get().c, 0,
    'tuhikutest pealkirjaga kirje ei tohi baasi jouda');
  db.close();
  console.log('PASS hanked: tuhikutest vali ei havita andmeid');
}

// U2: numbriline viitenumber seotakse REAL-ina ('12345.0') ja lohuks uhe hanke kaheks reaks.
{
  const db = testDb();
  assert.equal(upsertHange(db, { ref: 12345, title: 'Numbriline viide' }), 'uus',
    'numbriline viitenumber loob rea');
  assert.equal(upsertHange(db, { ref: '12345', title: 'Sama hange stringina' }), 'uuendatud',
    'sama viitenumber stringina on sama hange');
  const read = db.prepare('SELECT ref, title FROM hanked').all();
  assert.equal(read.length, 1, 'numbriline ja stringiviide ei tohi anda kahte rida');
  assert.equal(read[0].ref, '12345', 'viitenumber salvestub stringina, ilma 12345.0 kujuta');
  assert.equal(read[0].title, 'Sama hange stringina', 'teine kutse uuendas sama rida');
  assert.equal(upsertHange(db, { ref: 0, title: 'Null on paris viitenumber' }), 'uus',
    'viitenumber 0 on lubatud');
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM hanked WHERE ref = '0'").get().c, 1,
    'viitenumber 0 salvestub kujul 0');
  assert.equal(upsertHange(db, { ref: '  12345  ', title: 'Tuhikutega viide' }), 'uuendatud',
    'tuhikutega viitenumber on sama hange');
  db.close();
  console.log('PASS hanked: viitenumber sunnitakse stringiks');
}

// U3: vahemalu peab ule elama close() + open() - taustajooks avab baasi tsukliliselt.
{
  const db = testDb();
  upsertHange(db, { ref: 'u3', title: 'Enne sulgemist' });
  db.close();
  db.open();
  assert.equal(upsertHange(db, { ref: 'u3', title: 'Parast avamist' }), 'uuendatud',
    'vahemalu peab taastuma parast close() + open()');
  assert.equal(db.prepare('SELECT title FROM hanked WHERE ref = ?').get('u3').title, 'Parast avamist',
    'uuendus joudis parast taasavamist baasi');
  db.close();
  console.log('PASS hanked: vahemalu taastub parast baasi taasavamist');
}

// P8: varav on ahelas - muidu ei jookse teda keegi. Ahel ei ole enam kasitsi
// hoitav string package.json-is, vaid tuletatakse kettalt (tools/varav.mjs), nii et
// kontrollime avastamist ja seda, et keegi ei ole seda varavat valjajatete hulka lisanud.
{
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['hanked:gate'], 'node test/gate-hanked.mjs',
    'package.json vajab skripti hanked:gate');
  assert.equal(pkg.scripts['test:offline'], 'node tools/varav.mjs',
    'test:offline peab kaima labi varavajooksja, mitte kasitsi hoitava stringi');

  assert.ok(!VALJAJATED.has('gate-hanked.mjs'),
    'gate-hanked.mjs ei tohi olla varavajooksja valjajatete nimekirjas');
  assert.ok(leiaVaravad().varavad.includes('gate-hanked.mjs'),
    'varavajooksja peab gate-hanked.mjs ahelas avastama');
  console.log('PASS hanked: varavajooksja avastab selle varava ja ta ei ole valjas');
}

// Migratsioon on lisav ja kordusjooks on ohutu.
{
  const db = testDb();
  migrateHanked(db);
  migrateHanked(db);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok',
    'kordusmigratsioon jatab baasi terveks');
  db.close();
  console.log('PASS hanked: migratsioon on kordusjooksukindel');
}

// ---------------------------------------------------------------------------
// ULESANNE 2: seis, markus ja aegumine.
// ---------------------------------------------------------------------------

// S1: sunk ei tohi inimese valju (state, note) ule kirjutada - see on kogu vaate invariant.
{
  const db = testDb();
  upsertHange(db, { ref: 's1', title: 'Vana pealkiri', deadline: '2026-10-01', buyer: 'Vana ostja' });
  setState(db, 's1', 'valmistun');
  setNote(db, 's1', 'Küsi majutuse kohta');
  const seis = upsertHange(db, { ref: 's1', title: 'Uus pealkiri', deadline: '2026-11-15' });
  assert.equal(seis, 'uuendatud', 'olemasolev hange annab uuendatud');
  const rida = db.prepare('SELECT * FROM hanked WHERE ref = ?').get('s1');
  assert.equal(rida.state, 'valmistun', 'sunk ei tohi inimese seisu ule kirjutada');
  assert.equal(rida.note, 'Küsi majutuse kohta', 'sunk ei tohi inimese markust ule kirjutada');
  assert.equal(rida.title, 'Uus pealkiri', 'avastusvali pealkiri uueneb sunkimisel');
  assert.equal(rida.deadline, '2026-11-15', 'avastusvali tahtaeg uueneb sunkimisel');
  db.close();
  console.log('PASS hanked: sunk ei puutu inimese valju');
}

// S2: aegumine puudutab ainult seisu 'uus' - masin ei tohi inimese otsust ule kirjutada.
{
  const db = testDb();
  upsertHange(db, { ref: 'aeg-uus', title: 'Moodunud tahtaeg', deadline: '2026-09-01' });
  upsertHange(db, { ref: 'aeg-esit', title: 'Moodunud, aga esitatud', deadline: '2026-09-01' });
  setState(db, 'aeg-esit', 'esitatud');
  assert.equal(markExpired(db, '2026-09-20'), 1, 'aeguda tohib tapselt uks hange');
  assert.equal(db.prepare('SELECT state FROM hanked WHERE ref = ?').get('aeg-uus').state, 'aegunud',
    'seisus uus olev moodunud hange aegub');
  assert.equal(db.prepare('SELECT state FROM hanked WHERE ref = ?').get('aeg-esit').state, 'esitatud',
    'esitatud hange ei tohi aeguda');
  assert.equal(markExpired(db, '2026-09-20'), 0, 'teine jooks ei leia enam midagi');
  db.close();
  console.log('PASS hanked: aegumine puudutab ainult seisu uus');
}

// S3: tulevikutahtaeg, tuhi tahtaeg ja puuduv tahtaeg ei tohi aeguda.
// Tuhi string peab kaituma nagu listHanked-is (NULLIF), muidu aegub tahtajata hange kohe.
{
  const db = testDb();
  upsertHange(db, { ref: 'tulev', title: 'Tahtaeg tulevikus', deadline: '2026-12-01' });
  db.exec("INSERT INTO hanked (ref,title,deadline) VALUES ('tyhi','Tuhja tahtajaga','')");
  db.exec("INSERT INTO hanked (ref,title,deadline) VALUES ('puudub','Ilma tahtajata',NULL)");
  assert.equal(markExpired(db, '2026-09-20'), 0, 'midagi ei tohi aeguda');
  for (const ref of ['tulev', 'tyhi', 'puudub']) {
    assert.equal(db.prepare('SELECT state FROM hanked WHERE ref = ?').get(ref).state, 'uus',
      ref + ' peab jaama seisu uus');
  }
  db.close();
  console.log('PASS hanked: tuhi ja tulevikutahtaeg ei aegu');
}

// S4: tundmatu seis ja olematu hange annavad eestikeelse vea, mitte vaikse ebaonnestumise.
{
  const db = testDb();
  upsertHange(db, { ref: 's4', title: 'Vigade test' });
  assert.throws(() => setState(db, 's4', 'banaan'), /Tundmatu seis: banaan/,
    'nimekirjavaline seis peab andma eestikeelse vea');
  assert.equal(db.prepare('SELECT state FROM hanked WHERE ref = ?').get('s4').state, 'uus',
    'ebaonnestunud setState ei tohi rida muuta');
  assert.throws(() => setState(db, 'puudub-01', 'vaatan'), /Hanget ei leitud: puudub-01/,
    'olematu hange peab setState-is viskama');
  assert.throws(() => setNote(db, 'puudub-01', 'Markus'), /Hanget ei leitud: puudub-01/,
    'olematu hange peab setNote-is viskama');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanked').get().c, 1,
    'ebaonnestunud kutse ei tohi uut rida luua');
  db.close();
  console.log('PASS hanked: tundmatu seis ja olematu hange annavad vea');
}

// S5: tuhjendamine annab NULL-i, mitte tuhja stringi - muidu ei saa "on markus" enam kusida.
{
  const db = testDb();
  upsertHange(db, { ref: 's5', title: 'Markuse test' });
  setNote(db, 's5', '  Helista neljapaeval  ');
  assert.equal(db.prepare('SELECT note FROM hanked WHERE ref = ?').get('s5').note, 'Helista neljapaeval',
    'markus salvestub trimmituna');
  setNote(db, 's5', '   ');
  assert.equal(db.prepare('SELECT note FROM hanked WHERE ref = ?').get('s5').note, null,
    'tuhikutest markus tuhjendab valja NULL-iks');
  setNote(db, 's5', 'Uuesti');
  setNote(db, 's5', null);
  assert.equal(db.prepare('SELECT note FROM hanked WHERE ref = ?').get('s5').note, null,
    'null tuhjendab markuse');
  db.close();
  console.log('PASS hanked: markuse tuhjendamine annab NULL-i');
}

// S6: numbriline viitenumber peab leidma sama rea ka seisu-, markuse- ja aegumisteel.
{
  const db = testDb();
  upsertHange(db, { ref: 12345, title: 'Numbriline viide', deadline: '2026-09-01' });
  setState(db, 12345, 'vaatan');
  setNote(db, 12345, 'Numbriline markus');
  const rida = db.prepare('SELECT * FROM hanked WHERE ref = ?').get('12345');
  assert.equal(rida.state, 'vaatan', 'numbriline ref leiab rea setState-is');
  assert.equal(rida.note, 'Numbriline markus', 'numbriline ref leiab rea setNote-is');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanked').get().c, 1,
    'numbriline ref ei tohi teist rida tekitada');
  setState(db, '  12345  ', 'uus');
  assert.equal(markExpired(db, '2026-09-20'), 1, 'numbriliselt loodud rida aegub tavaparaselt');
  db.close();
  console.log('PASS hanked: numbriline viitenumber toimib koigil kolmel teel');
}

// C1: nullpikkusega tuhik ja BOM naevad valja nagu paris vaartus, aga on formaadimargid -
// enne trimmi eemaldamata kirjutaksid nad head andmed ule ja paaseksid pealkirjavalvest labi.
{
  const db = testDb();
  upsertHange(db, { ref: 'c1', title: 'Vana pealkiri', buyer: 'Vana ostja', deadline: '2026-12-01' });
  upsertHange(db, { ref: 'c1', title: '​', buyer: '﻿ ‍', deadline: '​ ' });
  const rida = db.prepare('SELECT * FROM hanked WHERE ref = ?').get('c1');
  assert.equal(rida.title, 'Vana pealkiri', 'nullpikkusega tuhik ei tohi pealkirja ule kirjutada');
  assert.equal(rida.buyer, 'Vana ostja', 'BOM ei tohi ostjat ule kirjutada');
  assert.equal(rida.deadline, '2026-12-01', 'nullpikkusega tuhik ei tohi tahtaega ule kirjutada');
  assert.throws(() => upsertHange(db, { ref: 'c1-uus', title: '​' }),
    /Pealkirjata hange: c1-uus/, 'nullpikkusega tuhikust pealkiri ei tohi valvest labi paaseda');
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM hanked WHERE ref = 'c1-uus'").get().c, 0,
    'nullpikkusega pealkirjaga kirje ei tohi baasi jouda');
  upsertHange(db, { ref: 'c1', title: '﻿Puhas pealkiri​' });
  assert.equal(db.prepare('SELECT title FROM hanked WHERE ref = ?').get('c1').title, 'Puhas pealkiri',
    'paris vaartus sailib, formaadimargid koritakse maha');
  db.close();
  console.log('PASS hanked: nullpikkusega tuhik ei havita andmeid');
}

// C2: vale tuupi viitenumber (false, {}, NaN) laheks String()-ist labi rampsreana.
{
  const db = testDb();
  for (const vigane of [false, {}, NaN, true, []]) {
    assert.throws(() => upsertHange(db, { ref: vigane, title: 'Ramps' }),
      /Vigane viitenumber/, 'vale tuupi viitenumber peab andma eestikeelse vea');
  }
  assert.throws(() => setState(db, {}, 'vaatan'), /Vigane viitenumber: object/,
    'setState peab vale tuupi viitenumbri tagasi lukkama');
  assert.throws(() => setNote(db, NaN, 'Markus'), /Vigane viitenumber: number/,
    'setNote peab vale tuupi viitenumbri tagasi lukkama');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanked').get().c, 0,
    'vale tuupi viitenumbriga kirje ei tohi baasi jouda');
  // NULL ja undefined jaavad endise, tapsema sonumi juurde.
  assert.throws(() => upsertHange(db, { ref: null, title: 'Ramps' }), /Viitenumbrita hange/,
    'NULL-viitenumber annab endiselt eraldi, tapsema sonumi');
  db.close();
  console.log('PASS hanked: vale tuupi viitenumber ei paase valvest labi');
}

// C3a: vahemalu korduskatse peab tootama ka INSERT-harus, mitte ainult UPDATE-harus.
{
  const db = testDb();
  upsertHange(db, { ref: 'c3a-vana', title: 'Enne sulgemist' });
  db.close();
  db.open();
  assert.equal(upsertHange(db, { ref: 'c3a-uus', title: 'Parast avamist' }), 'uus',
    'uue rea lisamine peab tootama ka parast close() + open()');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanked').get().c, 2,
    'molemad read on baasis');
  db.close();
  console.log('PASS hanked: korduskatse tootab ka INSERT-harus');
}

// C3b: proovi() teeb TAPSELT uhe korduskatse - pusiv finalized-viga peab kutsujani joudma,
// mitte lopmatusse tsuklisse jaama ega vaikselt alla neelatud saama.
{
  const db = testDb();
  const parisPrepare = db.prepare.bind(db);
  const katki = () => { throw new Error('statement has been finalized'); };
  let kordi = 0;
  db.prepare = () => { kordi += 1; return { get: katki, run: katki, all: katki }; };
  assert.throws(() => upsertHange(db, { ref: 'c3b', title: 'Pusiv rike' }),
    /finalized/, 'pusiv finalized-viga peab joudma kutsujani muutmata');
  assert.equal(kordi, 6, 'vahemalu ehitatakse uuesti tapselt uks kord (3 + 3 lauset)');
  db.prepare = parisPrepare;
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanked').get().c, 0, 'rida ei joudnud baasi');
  db.close();
  console.log('PASS hanked: pusiv finalized-viga jouab kutsujani');
}

// ---------------------------------------------------------------------------
// ULEVAATUSE PARANDUSED R1-R4.
// ---------------------------------------------------------------------------

// R1: kuupaevi ei tohi vorrelda leksikaalselt. Eesti kujus tahtaeg '13.10.2026' on
// stringina VAIKSEM kui '2026-09-21' ('1' < '2') ja aegus kohe - elus hange kadus
// vaatest. date() annab tundmatu kuju peal NULL-i, seega arusaamatu tahtaeg JAAB
// nahtavaks: ohutus liigub oiges suunas (pigem naita liiga palju kui kaota hange).
{
  const db = testDb();
  const kujud = {
    'eesti': '13.10.2026',
    'vana-eesti': '01.01.2020',
    'sonaline': 'peagi',
    'kellaajaga': '2026-12-01 11:00',
    'iso-eile': '2026-09-20',
  };
  for (const [ref, deadline] of Object.entries(kujud)) {
    upsertHange(db, { ref, title: 'Tahtaja kuju ' + ref, deadline });
  }
  assert.equal(markExpired(db, '2026-09-21'), 1, 'aeguda tohib ainult ISO-kujuline moodunud tahtaeg');
  assert.equal(db.prepare('SELECT state FROM hanked WHERE ref = ?').get('iso-eile').state, 'aegunud',
    'ISO-kujuline eilne tahtaeg aegub');
  for (const ref of ['eesti', 'vana-eesti', 'sonaline', 'kellaajaga']) {
    assert.equal(db.prepare('SELECT state FROM hanked WHERE ref = ?').get(ref).state, 'uus',
      ref + ': arusaamatu voi tulevane tahtaeg peab jaama nahtavaks');
  }
  // Moodunud ISO-kuupaev kellaajaga on ikkagi moodunud - date() normaliseerib, ei loobu.
  upsertHange(db, { ref: 'iso-eile-kell', title: 'Eile kella viieni', deadline: '2026-09-20 17:00' });
  assert.equal(markExpired(db, '2026-09-21'), 1, 'moodunud ISO-kuupaev kellaajaga aegub');
  db.close();
  console.log('PASS hanked: aegumine vordleb kuupaevi, mitte stringe');
}

// R1b: today on valvatud. Enne seda aegutas markExpired(db,'21.09.2026') uhe rea VALESTI
// ja markExpired(db,null) tegi vaikselt mitte midagi - molemad on halvemad kui viga.
{
  const db = testDb();
  upsertHange(db, { ref: 'r1b', title: 'Valve test', deadline: '2020-01-01' });
  for (const vale of ['21.09.2026', '2026-9-1', '', null, 42, 'eile', '2026-09-21T00:00:00Z']) {
    assert.throws(() => markExpired(db, vale), /Vigane kuupäev/,
      'vigane today peab viskama, mitte vaikselt eksima: ' + String(vale));
  }
  assert.equal(db.prepare('SELECT state FROM hanked WHERE ref = ?').get('r1b').state, 'uus',
    'vigane today ei tohi ridu muuta');
  // Vaikevaartus (undefined) tuleb tanasest kuupaevast ja peab labi minema.
  assert.equal(markExpired(db), 1, 'vaikimisi today aegutab moodunud tahtaja');
  db.close();
  console.log('PASS hanked: vigane today viskab');
}

// R1c: tanane tahtaeg EI aegu - pakkumist saab veel esitada.
{
  const db = testDb();
  upsertHange(db, { ref: 'tana', title: 'Tahtaeg tana', deadline: '2026-09-21' });
  assert.equal(markExpired(db, '2026-09-21'), 0, 'tanane tahtaeg ei aegu');
  assert.equal(db.prepare('SELECT state FROM hanked WHERE ref = ?').get('tana').state, 'uus',
    'tanane hange jaab nahtavaks');
  db.close();
  console.log('PASS hanked: tanane tahtaeg ei aegu');
}

// R2: setNote ei tohi olla teine normaliseerija. Enne parandust salvestas
// setNote(db,'p1','​') uhemargilise nullpikkusega tuhiku PARIS markusena,
// samal ajal kui upsertHange normaliseeris sama sisendi NULL-iks.
{
  const db = testDb();
  upsertHange(db, { ref: 'p1', title: 'Normaliseerija test' });
  const note = () => db.prepare('SELECT note FROM hanked WHERE ref = ?').get('p1').note;
  for (const tyhi of ['​', '﻿  ', '   ', '‍‌', '\n  ', '']) {
    setNote(db, 'p1', 'Paris markus');
    assert.equal(note(), 'Paris markus', 'eeldus: paris markus salvestus');
    setNote(db, 'p1', tyhi);
    assert.equal(note(), null, 'tuhi sisend peab andma NULL-i, mitte nahtamatut margi: ' + JSON.stringify(tyhi));
  }
  setNote(db, 'p1', '  tekst  ');
  assert.equal(note(), 'tekst', 'markus trimmitakse');
  setNote(db, 'p1', '﻿  Puhas märkus​');
  assert.equal(note(), 'Puhas märkus', 'formaadimargid koritakse maha, sisu jaab');
  // Sama sisend kaitub upsertHange avastusvaljal TAPSELT samamoodi.
  upsertHange(db, { ref: 'p1', buyer: '﻿  Puhas ostja​', title: 'Normaliseerija test' });
  assert.equal(db.prepare('SELECT buyer FROM hanked WHERE ref = ?').get('p1').buyer, 'Puhas ostja',
    'setNote ja upsertHange peavad kasutama sama normaliseerijat');
  db.close();
  console.log('PASS hanked: setNote kasutab sama normaliseerijat mis upsert');
}

// R3: mitte-string markus andis toore ingliskeelse TypeError-i ("note?.trim is not a function").
{
  const db = testDb();
  upsertHange(db, { ref: 'r3', title: 'Tuubivalve test' });
  for (const vigane of [42, {}, [], true]) {
    assert.throws(() => setNote(db, 'r3', vigane), /Vigane märkus/,
      'mitte-string markus peab andma eestikeelse vea: ' + JSON.stringify(vigane));
  }
  assert.equal(db.prepare('SELECT note FROM hanked WHERE ref = ?').get('r3').note, null,
    'vigane markus ei tohi baasi jouda');
  setNote(db, 'r3', null);
  setNote(db, 'r3', undefined);
  assert.equal(db.prepare('SELECT note FROM hanked WHERE ref = ?').get('r3').note, null,
    'null ja undefined on lubatud tuhjendajad');
  db.close();
  console.log('PASS hanked: mitte-string markus annab eestikeelse vea');
}

// R4: inimese tee (klikk) ei tohi suudistada RHR-i ja koik veateated on uhes stiilis.
{
  const db = testDb();
  upsertHange(db, { ref: 'r4', title: 'Sonastuse test' });
  const sonum = (f) => {
    try { f(); } catch (e) { return e.message; }
    throw new Error('pidi viskama, aga ei visanud');
  };
  // Inimese teel ei ole RHR-i kirjet, mida suudistada.
  for (const f of [() => setState(db, {}, 'vaatan'), () => setNote(db, {}, 'x'),
                   () => setState(db, 'puudub', 'vaatan'), () => setNote(db, 'r4', 42)]) {
    assert.ok(!/RHR/.test(sonum(f)), 'inimese tee veateade ei tohi nimetada RHR-i: ' + sonum(f));
  }
  // Uks stiil: iga veateade algab suurtahega.
  const koik = [
    () => upsertHange(db, { ref: null, title: 'x' }),
    () => upsertHange(db, { ref: {}, title: 'x' }),
    () => upsertHange(db, { ref: 'uus-r4' }),
    () => setState(db, 'r4', 'banaan'),
    () => setState(db, 'puudub', 'vaatan'),
    () => setNote(db, 'puudub', 'x'),
    () => setNote(db, 'r4', 42),
    () => markExpired(db, 'eile'),
  ];
  for (const f of koik) {
    assert.match(sonum(f), /^[A-ZÄÖÜÕ]/, 'veateade peab algama suurtahega: ' + sonum(f));
  }
  db.close();
  console.log('PASS hanked: veateated on uhes stiilis ja neutraalsed');
}

// ---------------------------------------------------------------------------
// ULESANNE 3: RSS-i lugeja ja nisifilter.
// ---------------------------------------------------------------------------

// Fikstuur on failis sees - varav ei tohi sattuda vorgust. Kirjed:
// a) sobiv teenus, b) ehitustood (liigi jargi valja), b2) asjad (liigi jargi valja),
// c) vaike veebileht, d) FIT tabab aga EXCL voidab, e) tahtajata,
// f) CDATA + HTML-olemid, g) viitenumbrita.
const RSS_FIKSTUUR = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>Riigihangete register</title>
<item>
  <title>314159 - Digitaalse eneseabiprogrammi „Aitab“ arendus- ja hooldustööd</title>
  <link>https://riigihanked.riik.ee/rhr-web/#/procurement/10682825/notices</link>
  <description>Teenused; Avatud hankemenetlus; Programmi arendus; Tähtaeg: 13.10.2026 11:00</description>
  <pubDate>Wed, 10 Sep 2026 07:00:04 GMT</pubDate>
  <dc:creator>Tervise Arengu Instituut</dc:creator>
</item>
<item>
  <title>222222 - Brändiraamatu ja visuaalse keele loomine</title>
  <link>https://riigihanked.riik.ee/rhr-web/#/procurement/10000002/notices</link>
  <description>Ehitustööd; Avatud hankemenetlus; Muu; Tähtaeg: 01.11.2026 10:00</description>
  <pubDate>Thu, 11 Sep 2026 06:00:00 GMT</pubDate>
  <dc:creator>Mingi Vald</dc:creator>
</item>
<item>
  <title>223344 - Mobiilirakenduse arendus</title>
  <link>https://riigihanked.riik.ee/rhr-web/#/procurement/10000003/notices</link>
  <description>Asjad; Lihthange; Muu; Tähtaeg: 02.11.2026 10:00</description>
  <pubDate>Thu, 11 Sep 2026 06:10:00 GMT</pubDate>
  <dc:creator>Teine Vald</dc:creator>
</item>
<item>
  <title>333333 - Valla kodulehe uuendamine</title>
  <link>https://riigihanked.riik.ee/rhr-web/#/procurement/10000004/notices</link>
  <description>Teenused; Väikehange; Veebiarendus;
     Tähtaeg: 05.09.2026 12:00</description>
  <pubDate>Fri, 12 Sep 2026 05:00:00 GMT</pubDate>
  <dc:creator>Tartu &apos;Linnavalitsus&apos;</dc:creator>
</item>
<item>
  <title>444444 - Koolimaja ehitusaegse kasutajakogemuse uuring</title>
  <link>https://riigihanked.riik.ee/rhr-web/#/procurement/10000005/notices</link>
  <description>Teenused; Avatud hankemenetlus; Uuring; Tähtaeg: 10.11.2026 09:00</description>
  <pubDate>Sat, 13 Sep 2026 05:00:00 GMT</pubDate>
  <dc:creator>Kolmas Vald</dc:creator>
</item>
<item>
  <title>555555 - Kasutajaliidese prototüüpimise teenus</title>
  <link>https://riigihanked.riik.ee/rhr-web/#/procurement/10000006/notices</link>
  <description>Eriteenused; Toetuse saaja ost; Disain</description>
  <pubDate>Sun, 14 Sep 2026 05:00:00 GMT</pubDate>
  <dc:creator>Neljas Vald</dc:creator>
</item>
<item>
  <title><![CDATA[666666 - Veebilehe &quot;Kodu&quot; &amp; e-teenuste arendus &#8222;Uus&#8220;]]></title>
  <link><![CDATA[https://riigihanked.riik.ee/rhr-web/#/procurement/10000007/notices]]></link>
  <description>Teenused; Lihthange; Arendus &amp; hooldus; Tähtaeg: 20.12.2026 16:00</description>
  <pubDate>Mon, 15 Sep 2026 05:00:00 GMT</pubDate>
  <dc:creator>Kohila &amp; Co O&#xDC;</dc:creator>
</item>
<item>
  <title>777777 - Tehisaru vestlusroboti arendus</title>
  <link>https://riigihanked.riik.ee/rhr-web/#/procurement/10000008/notices</link>
  <description>Sotsiaalteenused; Lihthange; Tehisaru; Tähtaeg: 1.11.2026 09:00</description>
  <pubDate>Tue, 16 Sep 2026 05:00:00 GMT</pubDate>
  <dc:creator>Politsei- ja Piirivalveamet</dc:creator>
</item>
<item>
  <title>Teade ilma viitenumbrita veebilehe arenduse kohta</title>
  <link>https://riigihanked.riik.ee/rhr-web/#/procurement/10000009/notices</link>
  <description>Teenused; Lihthange; Muu; Tähtaeg: 03.11.2026 09:00</description>
  <pubDate>Wed, 17 Sep 2026 05:00:00 GMT</pubDate>
  <dc:creator>Viies Vald</dc:creator>
</item>
</channel>
</rss>`;

// F1: filter - liik ja nissifilter votavad oiged kirjed valja, oiged jaavad.
{
  const read = parseRss(RSS_FIKSTUUR);
  assert.deepEqual(read.map((r) => r.ref), ['314159', '333333', '555555', '666666', '777777'],
    'labi peavad saama tapselt need viis viitenumbrit');
  const refs = new Set(read.map((r) => r.ref));
  assert.ok(!refs.has('222222'), 'ehitustoode kirje peab valja jaama ka siis, kui pealkiri sobib');
  assert.ok(!refs.has('223344'), 'asjade kirje peab valja jaama ka siis, kui pealkiri sobib');
  assert.ok(!refs.has('444444'), 'EXCL-i tabav kirje peab valja jaama');
  const a = read[0];
  assert.equal(a.title, 'Digitaalse eneseabiprogrammi „Aitab“ arendus- ja hooldustööd',
    'pealkirjast koritakse viitenumber ja mottekriips maha');
  assert.equal(a.rhr_id, '10682825', 'rhr_id tuleb lingist');
  assert.equal(a.buyer, 'Tervise Arengu Instituut', 'ostja tuleb dc:creator-ist');
  assert.equal(a.nature, 'Teenused', 'liik on kirjelduse esimene vali');
  assert.equal(a.menetlus, 'Avatud hankemenetlus', 'menetlus on kirjelduse teine vali');
  assert.equal(a.est, null, 'RSS ei anna maksumust');
  assert.equal(a.cpv, null, 'RSS ei anna CPV-d');
  console.log('PASS hanked: RSS-i filter jatab alles ainult nissi teenused');
}

// F2: tahtaeg ja ilmumisaeg on ISO-kujul - eestikeelne kuju lohuks markExpired-i.
{
  const read = parseRss(RSS_FIKSTUUR);
  const kaart = Object.fromEntries(read.map((r) => [r.ref, r]));
  assert.equal(kaart['314159'].deadline, '2026-10-13', 'tahtaeg normaliseeritakse ISO-kujusse');
  assert.equal(kaart['333333'].deadline, '2026-09-05', 'mitmerealine kirjeldus ei sega tahtaega');
  assert.equal(kaart['777777'].deadline, '2026-11-01', 'uhekohaline paev polsterdatakse nulliga');
  assert.equal(kaart['555555'].deadline, null, 'tahtajata kirje annab NULL-i, mitte tuhja stringi');
  assert.equal(kaart['314159'].published, '2026-09-10', 'pubDate normaliseeritakse ISO-kujusse');
  assert.equal(kaart['777777'].published, '2026-09-16', 'pubDate normaliseeritakse ISO-kujusse');
  for (const r of read) {
    assert.ok(r.deadline === null || /^\d{4}-\d{2}-\d{2}$/.test(r.deadline),
      'iga tahtaeg on kas NULL voi ISO: ' + r.ref + ' = ' + JSON.stringify(r.deadline));
    assert.ok(r.published === null || /^\d{4}-\d{2}-\d{2}$/.test(r.published),
      'iga ilmumisaeg on kas NULL voi ISO: ' + r.ref + ' = ' + JSON.stringify(r.published));
  }
  console.log('PASS hanked: RSS-i kuupaevad on ISO-kujul');
}

// F3: segmentOf kolm haru ja EXCL voidab FIT-i.
{
  assert.equal(segmentOf('Tehisaru vestlusroboti arendus'), 'nišš', 'FIT ilma SMALLWEB-ita on niss');
  assert.equal(segmentOf('Valla kodulehe uuendamine'), 'väike veebileht', 'koduleht on vaike veebileht');
  assert.equal(segmentOf('Veebilehe arendus'), 'väike veebileht', 'veebileht on vaike veebileht');
  assert.equal(segmentOf('Bussipeatuste hooldus'), null, 'FIT-i mittetabav pealkiri ei ole segment');
  assert.equal(segmentOf('Koolimaja ehitusaegse kasutajakogemuse uuring'), null,
    'EXCL peab FIT-i voitma');
  assert.equal(segmentOf('Veebilehe sisekujunduse pildipank'), null,
    'EXCL peab SMALLWEB-i voitma');
  for (const tyhi of [null, undefined, '']) {
    assert.equal(segmentOf(tyhi), null, 'tuhi pealkiri ei ole segment: ' + JSON.stringify(tyhi));
  }
  console.log('PASS hanked: segmentOf kolm haru ja EXCL voidab FIT-i');
}

// F4: HTML-olemid dekodeeritakse ja CDATA ei jata prahti pealkirja.
{
  const kaart = Object.fromEntries(parseRss(RSS_FIKSTUUR).map((r) => [r.ref, r]));
  const f = kaart['666666'];
  assert.equal(f.title, 'Veebilehe "Kodu" & e-teenuste arendus „Uus“',
    'CDATA koritakse maha ja olemid dekodeeritakse');
  assert.ok(!/CDATA|&amp;|&quot;|&#/.test(f.title), 'pealkirja ei tohi jaada CDATA- ega olemipraht');
  assert.equal(f.buyer, 'Kohila & Co OÜ', 'kuueteistkumnendolem dekodeeritakse ka ostja nimes');
  assert.equal(f.rhr_id, '10000007', 'CDATA-sse pakitud link annab ikka rhr_id');
  assert.equal(f.menetlus, 'Lihthange', 'olemiga kirjeldus jaguneb ikka valjadeks');
  assert.equal(kaart['333333'].buyer, "Tartu 'Linnavalitsus'", '&apos; dekodeeritakse');
  assert.equal(f.segment, 'väike veebileht', 'dekodeeritud pealkiri lahebki segmendifiltrisse');
  console.log('PASS hanked: CDATA ja HTML-olemid on lahendatud');
}

// F5: parser on valine sisend - ramps ei tohi kogu sunki maha votta.
{
  for (const ramps of ['', null, undefined, 42, {}, [], true, NaN,
    '<rss><item><title>katki', '<<<>>>', '{"json":true}', '<item></item>',
    '<item><title>314159 - Veebilehe arendus</title>']) {
    const r = parseRss(ramps);
    assert.ok(Array.isArray(r), 'parseRss peab alati andma massiivi: ' + JSON.stringify(ramps));
    assert.equal(r.length, 0, 'ramps-sisend annab tuhja massiivi: ' + JSON.stringify(ramps));
  }
  console.log('PASS hanked: ramps-sisend annab tuhja massiivi');
}

// F6: integratsioon - RSS-i tulemus laheb otse upsertHange-i ja markExpired kaitub oigesti.
// See test seob ulesanded 2 ja 3: kui tahtaeg ei oleks ISO-kujul, jaaks aegumine tegemata.
{
  const db = testDb();
  const read = parseRss(RSS_FIKSTUUR);
  assert.equal(read.length, 5, 'eeldus: fikstuurist tuleb viis rida');
  for (const h of read) assert.equal(upsertHange(db, h), 'uus', 'iga RSS-i rida laheb baasi: ' + h.ref);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanked').get().c, 5, 'viis rida baasis');
  const seg = db.prepare('SELECT segment FROM hanked WHERE ref = ?').get('333333').segment;
  assert.equal(seg, 'väike veebileht', 'segment salvestub');
  // 333333 tahtaeg oli 05.09.2026 - moodas. Ulejaanud on tulevikus voi tahtajata.
  assert.equal(markExpired(db, '2026-09-21'), 1, 'tapselt uks RSS-ist tulnud hange aegub');
  assert.equal(db.prepare('SELECT state FROM hanked WHERE ref = ?').get('333333').state, 'aegunud',
    'moodunud tahtajaga RSS-i hange aegub');
  for (const ref of ['314159', '555555', '666666', '777777']) {
    assert.equal(db.prepare('SELECT state FROM hanked WHERE ref = ?').get(ref).state, 'uus',
      ref + ': tulevane voi tahtajata hange jaab nahtavaks');
  }
  // Kordussunk ei tohi ridu dubleerida ega inimese seisu ule kirjutada.
  for (const h of read) upsertHange(db, h);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM hanked').get().c, 5, 'kordussunk ei dubleeri');
  assert.equal(db.prepare('SELECT state FROM hanked WHERE ref = ?').get('333333').state, 'aegunud',
    'kordussunk ei tohi aegunud seisu tagasi keerata');
  db.close();
  console.log('PASS hanked: RSS-i tulemus laheb baasi ja aegub oigesti');
}

// F7 (ULEVAATUSE LAHTINE PUNKT): paljas aastaarv '2026' on SQLite-le Juliuse paev,
// seega date('2026') EI ole NULL ja rida aegus vaikselt ara. Parser ei tooda sellist
// vaartust kunagi, aga markExpired on ka toore SQL-i ja ulesande 6 eForms-parseri tee -
// seega valvame kujundi baasi pool (GLOB), mitte ainult parseri pool.
{
  const db = testDb();
  const read = parseRss(RSS_FIKSTUUR);
  for (const h of read) {
    assert.ok(h.deadline === null || /^\d{4}-\d{2}-\d{2}$/.test(h.deadline),
      'parser ei tooda paljast aastaarvu ega muud kuju: ' + JSON.stringify(h.deadline));
  }
  // Toores SQL moodab parserist - GLOB peab teda kinni pidama.
  for (const [ref, deadline] of Object.entries({
    aasta: '2026', number: '45000', kuu: '2026-09', juliuse: '2440588',
  })) {
    db.exec(`INSERT INTO hanked (ref,title,deadline) VALUES ('${ref}','Toores SQL','${deadline}')`);
  }
  upsertHange(db, { ref: 'iso-moodas', title: 'ISO moodas', deadline: '2020-01-01' });
  assert.equal(markExpired(db, '2026-09-21'), 1, 'aeguda tohib ainult ISO-kujuline tahtaeg');
  for (const ref of ['aasta', 'number', 'kuu', 'juliuse']) {
    assert.equal(db.prepare('SELECT state FROM hanked WHERE ref = ?').get(ref).state, 'uus',
      ref + ': mitte-ISO tahtaeg peab jaama nahtavaks, mitte vaikselt aeguma');
  }
  assert.equal(db.prepare('SELECT state FROM hanked WHERE ref = ?').get('iso-moodas').state, 'aegunud',
    'ISO-kujuline moodunud tahtaeg aegub endiselt');
  db.close();
  console.log('PASS hanked: paljas aastaarv ei aegu vaikselt');
}

// ---------------------------------------------------------------------------
// KORDUSULEVAATUS: S1-S5. Paarisvalvur riigihanked/rhr_tools/rhr_watch.py andis
// samal feedil 6 leidu, meie 3 - vahe oli ainult selles, et tema otsib FIT-i
// pealkiri+kirjeldus pealt.
// ---------------------------------------------------------------------------

const rssKirje = ({
  title, desc = '', pub = 'Mon, 01 Sep 2026 05:00:00 GMT',
  link = 'https://riigihanked.riik.ee/rhr-web/#/procurement/10000099/notices',
  creator = 'Test Vald',
}) => `<item><title>${title}</title><link>${link}</link>` +
  `<description>${desc}</description><pubDate>${pub}</pubDate><dc:creator>${creator}</dc:creator></item>`;

const rssFeed = (...kirjed) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
${kirjed.join('\n')}
</channel></rss>`;

// K1 (S1): FIT peab vaatama ka kirjeldust. 310983 "OsKus uhtse infosusteemi ja
// analuusikeskkonna loomine" ei sisalda pealkirjas UHTEGI FIT-i sona, aga kirjelduses
// on "veebirakenduste ... loomiseks voi edasiarenduseks ... sh prototuupimine".
{
  const oskusKirjeldus = 'Teenused; Avatud hankemenetlus; ' +
    'veebirakenduste loomiseks või edasiarenduseks, sh prototüüpimine; Tähtaeg: 24.09.2026 11:00';

  // a) pealkiri ilma FIT-sonata + kirjeldus FIT-sonaga = niss
  assert.equal(segmentOf('OsKus ühtse infosüsteemi ja analüüsikeskkonna loomine', oskusKirjeldus),
    'nišš', 'FIT peab tabama ka kirjelduse kaudu');

  // b) EXCL JAAB AINULT PEALKIRJALE - pealkirjas ehitus tahendab, et see ei ole meie too
  assert.equal(segmentOf('Koolimaja ehituse infosüsteemi loomine', oskusKirjeldus), null,
    'pealkirja EXCL peab voitma ka siis, kui kirjeldus sobib');

  // c) SMALLWEB JAAB AINULT PEALKIRJALE - muidu oleks iga suur infosusteem "vaike veebileht"
  assert.equal(segmentOf('Ühtse analüüsikeskkonna loomine', 'Teenused; tellija veebilehe haldus ja arendus'),
    'nišš', 'kirjelduses olev veebileht ei tohi suurt susteemi vaikeseks kodulehaks teha');

  // EXCL kirjelduses EI tohi head hanget tappa (moodetud: laiendamine ei muuda tulemust,
  // aga lisab riski - iga teine IT-hange mainib kirjelduses hoonet voi projekteerimist).
  assert.equal(segmentOf('Veebilehe arendus', 'Teenused; hoone ehitus ja sisekujundus'),
    'väike veebileht', 'kirjelduse EXCL ei tohi pealkirja jargi sobivat hanget valja visata');

  // Uheargumendiline kutse peab edasi tootama (olemasolevad kutsujad ja testid).
  assert.equal(segmentOf('Tehisaru vestlusroboti arendus'), 'nišš', 'uks argument peab edasi toimima');
  assert.equal(segmentOf('Bussipeatuste hooldus'), null, 'uks argument: FIT-i mittetabav on ikka null');
  assert.equal(segmentOf('Ühtse infosüsteemi loomine', null), null,
    'NULL-kirjeldus ei tohi tekitada vale tabamust');

  // Sama tee parseRss-i kaudu: kutsuja PEAB kirjelduse kaasa andma.
  const read = parseRss(rssFeed(rssKirje({
    title: '310983 - OsKus ühtse infosüsteemi ja analüüsikeskkonna loomine',
    desc: oskusKirjeldus,
    link: 'https://riigihanked.riik.ee/rhr-web/#/procurement/10310983/notices',
  })));
  assert.equal(read.length, 1, 'parseRss peab kirjelduse segmentOf-ile kaasa andma');
  assert.equal(read[0].ref, '310983', 'oige viitenumber');
  assert.equal(read[0].segment, 'nišš', 'kirjelduse kaudu leitud hange on niss');
  assert.equal(read[0].deadline, '2026-09-24', 'tahtaeg tuleb ikka ISO-kujul');
  console.log('PASS hanked: FIT vaatab ka kirjeldust, EXCL ja SMALLWEB ainult pealkirja');
}

// K2 (S2): neli ingliskeelset FIT-haru olid vaikselt kaduma laanud (41 vs 45 haru).
// Tanasel feedil annavad nad 0 lisatabamust, aga seletamatu kitsendus toestatud
// reegli suhtes on triiv - ingliskeelne pealkiri RHR-is ei ole haruldus.
{
  for (const [tekst, miks] of [
    ['Web development services for the ministry', '\\bweb\\b'],
    ['User experience research for public services', 'user experience'],
    ['Design system implementation', 'design system'],
    ['Accessibility audit of the portal', 'accessibility'],
  ]) {
    assert.ok(FIT.test(tekst), 'taastatud FIT-haru peab tabama (' + miks + '): ' + tekst);
  }
  // Sonapiir peab pusima - "webinar" ei ole "web".
  assert.ok(!FIT.test('Webinaride korraldamise teenus'), '\\bweb\\b ei tohi tabada sona sees');
  // Tapitahetaluvus peab ALLES jaama - meie oma laiendus Pythoni mustri peale.
  for (const tekst of ['Disainisüsteemi loomine', 'Disainisusteemi loomine',
    'Ligipääsetavuse audit', 'Prototüüpimise teenus', 'Prototuupimise teenus',
    'Brändiraamat', 'Brandiraamat', 'Kujundustöö', 'Kujundustoo']) {
    assert.ok(FIT.test(tekst), 'tapitahetaluvus peab sailima: ' + tekst);
  }
  console.log('PASS hanked: neli ingliskeelset FIT-haru on tagasi, tapitahetaluvus alles');
}

// K3 (S3): muutmisteade. RHR avaldab sama ref-i uuesti just siis, kui midagi muutus
// (tahtaeg, pealkiri), ja feed on UUEMAST VANEMANI. Enne parandust andis parseRss
// molemad read ja upsertHange tootles neid jarjekorras -> VANEM teade voitis.
{
  const uuem = rssKirje({
    title: '310983 - OsKus ühtse infosüsteemi loomine (muudetud)',
    desc: 'Teenused; Avatud hankemenetlus; veebirakenduste arendus ja prototüüpimine; Tähtaeg: 24.09.2026 11:00',
    pub: 'Mon, 25 Aug 2026 06:00:00 GMT',
  });
  const vanem = rssKirje({
    title: '310983 - OsKus ühtse infosüsteemi loomine',
    desc: 'Teenused; Avatud hankemenetlus; veebirakenduste arendus ja prototüüpimine; Tähtaeg: 10.09.2026 11:00',
    pub: 'Sun, 24 Aug 2026 06:00:00 GMT',
  });

  const a = parseRss(rssFeed(uuem, vanem));
  assert.equal(a.length, 1, 'sama viitenumber peab andma TAPSELT uhe kirje');
  assert.equal(a[0].deadline, '2026-09-24', 'uuem tahtaeg peab voitma (uuem eespool)');
  assert.equal(a[0].published, '2026-08-25', 'uuema teate ilmumisaeg jaab alles');
  assert.equal(a[0].title, 'OsKus ühtse infosüsteemi loomine (muudetud)', 'uuem pealkiri voidab');

  // Ka vastupidises jarjekorras peab voitma UUEM, mitte "viimane feedis".
  const b = parseRss(rssFeed(vanem, uuem));
  assert.equal(b.length, 1, 'vastupidine jarjekord annab ikka uhe kirje');
  assert.equal(b[0].deadline, '2026-09-24', 'uuem voidab ka siis, kui ta on feedis tagapool');

  // Vordse pubDate korral voidab feedis eespool olev (RHR-i oma jarjestus).
  const sama1 = rssKirje({ title: '311111 - Veebilehe arendus A', pub: 'Mon, 25 Aug 2026 06:00:00 GMT',
    desc: 'Teenused; Lihthange; Muu; Tähtaeg: 01.11.2026 10:00' });
  const sama2 = rssKirje({ title: '311111 - Veebilehe arendus B', pub: 'Mon, 25 Aug 2026 06:00:00 GMT',
    desc: 'Teenused; Lihthange; Muu; Tähtaeg: 02.11.2026 10:00' });
  const c = parseRss(rssFeed(sama1, sama2));
  assert.equal(c.length, 1, 'vordne pubDate annab uhe kirje');
  assert.equal(c[0].title, 'Veebilehe arendus A', 'vordse korral voidab feedis eespool olev');

  // Jarjestus peab jaama feedi omaks, mitte umber jarjestuma.
  const muu = rssKirje({ title: '312222 - Kasutajaliidese uuendus', pub: 'Tue, 26 Aug 2026 06:00:00 GMT',
    desc: 'Teenused; Lihthange; Muu; Tähtaeg: 03.11.2026 10:00' });
  const d = parseRss(rssFeed(uuem, muu, vanem));
  assert.deepEqual(d.map((r) => r.ref), ['310983', '312222'],
    'dubli eemaldamine ei tohi ulejaanud jarjestust muuta');

  // Ja LOPUKS see, mis paris elus katki oli: baasi peab joudma uuem tahtaeg.
  const db = testDb();
  for (const h of parseRss(rssFeed(uuem, vanem))) upsertHange(db, h);
  assert.equal(db.prepare('SELECT deadline FROM hanked WHERE ref = ?').get('310983').deadline,
    '2026-09-24', 'baasi peab jouma UUEM tahtaeg, mitte vanem');
  db.close();
  console.log('PASS hanked: muutmisteade ei kirjuta uuemat vanaga ule');
}

// K3b (S3b): puuduv voi parseerimatu pubDate. Esimene parandus luges puuduva kuupaeva
// tuhjaks stringiks -> iga paris kuupaevaga VANEM teade voitis uuema, millel kuupaeva
// polnud. RHR-i pubDate on paris elus valja kukkunud, nii et see ei ole teoreetiline.
{
  const ilmaKuupaevata = '<item><title>313000 - Veebilehe uuendus (muudetud)</title>' +
    '<description>Teenused; Lihthange; Muu; Tähtaeg: 01.12.2026 10:00</description>' +
    '<dc:creator>Test Vald</dc:creator></item>';
  const vanemKuupaevaga = rssKirje({
    title: '313000 - Veebilehe uuendus',
    desc: 'Teenused; Lihthange; Muu; Tähtaeg: 01.10.2026 10:00',
    pub: 'Sun, 24 Aug 2026 06:00:00 GMT',
  });

  const a = parseRss(rssFeed(ilmaKuupaevata, vanemKuupaevaga));
  assert.equal(a.length, 1, 'kuupaevata dubli annab ikka uhe kirje');
  assert.equal(a[0].deadline, '2026-12-01',
    'kuupaevata UUSIM teade (feedis eespool) peab voitma kuupaevaga vanema');
  assert.equal(a[0].title, 'Veebilehe uuendus (muudetud)', 'uuema teate pealkiri jaab alles');

  // Sama lugu parseerimatu pubDate-ga: isoPaev annab null, mitte kuupaeva.
  const praht = rssKirje({
    title: '313001 - Kasutajaliidese uuendus (muudetud)',
    desc: 'Teenused; Lihthange; Muu; Tähtaeg: 01.12.2026 10:00',
    pub: 'eile',
  });
  const vanem2 = rssKirje({
    title: '313001 - Kasutajaliidese uuendus',
    desc: 'Teenused; Lihthange; Muu; Tähtaeg: 01.10.2026 10:00',
    pub: 'Sun, 24 Aug 2026 06:00:00 GMT',
  });
  const b = parseRss(rssFeed(praht, vanem2));
  assert.equal(b[0].deadline, '2026-12-01',
    'parseerimatu pubDate ei tohi uuemat teadet vanema alla matta');

  // Kui MOLEMAL puudub, jaab kehtima feedi jarjestus - nagu kommentaar lubab.
  const kumbki1 = '<item><title>313002 - Veebilehe hooldus A</title>' +
    '<description>Teenused; Lihthange; Muu; Tähtaeg: 01.12.2026 10:00</description></item>';
  const kumbki2 = '<item><title>313002 - Veebilehe hooldus B</title>' +
    '<description>Teenused; Lihthange; Muu; Tähtaeg: 02.12.2026 10:00</description></item>';
  const c = parseRss(rssFeed(kumbki1, kumbki2));
  assert.equal(c.length, 1, 'kuupaevata paar annab uhe kirje');
  assert.equal(c[0].title, 'Veebilehe hooldus A', 'kuupaevade puudumisel voidab feedi jarjestus');
  console.log('PASS hanked: kuupaevata teade ei kao vanema alla');
}

// K3c: surrogaadid olemidekoodris. &#xD800; on paaritu UTF-16 pool, mitte mark -
// String.fromCodePoint annaks U+FFFD otse pealkirja ja sealt baasi.
{
  const kirje = rssKirje({
    title: '313003 - Veebilehe &#xD800; uuendus',
    desc: 'Teenused; Lihthange; Muu; Tähtaeg: 01.12.2026 10:00',
  });
  const r = parseRss(rssFeed(kirje));
  assert.equal(r.length, 1, 'surrogaadiolem ei tohi kirjet maha votta');
  assert.ok(!r[0].title.includes('\ufffd'), 'asendusmark ei tohi pealkirja jouda');
  assert.ok(r[0].title.includes('&#xD800;'), 'kahtlane olem jaab dekodeerimata alles');

  // Paris olemid ja paris koodipunktid peavad endiselt tootama.
  const ok = rssKirje({
    title: '313004 - Veebilehe &quot;Kodu&quot; &#8211; uuendus &#x2013; II etapp',
    desc: 'Teenused; Lihthange; Muu; Tähtaeg: 01.12.2026 10:00',
  });
  assert.equal(parseRss(rssFeed(ok))[0].title,
    'Veebilehe "Kodu" \u2013 uuendus \u2013 II etapp', 'paris olemid dekodeeritakse endiselt');
  console.log('PASS hanked: surrogaadiolem ei riku pealkirja');
}

// K4 (S4): nature vottis semikoolonita kirjelduse TERVIKUNA ('Ainult uks osa').
{
  const read = parseRss(rssFeed(
    rssKirje({ title: '320001 - Veebilehe arendus', desc: 'Ainult uks osa ilma semikooloniteta' }),
    rssKirje({ title: '320002 - Kasutajaliidese arendus', desc: 'Teenused; Lihthange; Muu' }),
    rssKirje({ title: '320003 - Mobiilirakenduse arendus', desc: 'ehitustööd; Lihthange; Muu' }),
    rssKirje({ title: '320004 - Veebilehe arendus', desc: 'Sotsiaalteenused; Lihthange; Muu' }),
  ));
  const kaart = Object.fromEntries(read.map((r) => [r.ref, r]));
  assert.equal(kaart['320001'].nature, null, 'tundmatu liik peab andma NULL-i, mitte kogu kirjeldust');
  assert.equal(kaart['320001'].menetlus, null, 'semikoolonita kirjeldus ei anna menetlust');
  assert.ok(kaart['320001'], 'tundmatu liik EI tohi kirjet valja visata');
  assert.equal(kaart['320002'].nature, 'Teenused', 'teadaolev liik jaab alles');
  assert.equal(kaart['320003'], undefined, 'valjajatmine peab tootama ka vaikeste tahtedega');
  assert.equal(kaart['320004'].nature, 'Sotsiaalteenused', 'sotsiaalteenused laheb labi');
  console.log('PASS hanked: nature on piiratud teadaoleva loeteluga');
}

// K5 (S5): eraldaja pealkirjas on NOUTUD - see on teadlik otsus, mitte unustus.
// Ilma selleta loeks "2026. aasta veebilehe hange" aastaarvu viitenumbriks.
{
  assert.equal(parseRss(rssFeed(rssKirje({
    title: '314159 Veebilehe arendus', desc: 'Teenused; Lihthange; Muu',
  }))).length, 0, 'ilma eraldajata pealkiri ei anna kirjet');
  const read = parseRss(rssFeed(rssKirje({
    title: '314159 - Veebilehe arendus', desc: 'Teenused; Lihthange; Muu',
  })));
  assert.equal(read.length, 1, 'eraldajaga pealkiri annab kirje');
  assert.equal(read[0].ref, '314159', 'viitenumber tuleb pealkirja algusest');
  assert.equal(parseRss(rssFeed(rssKirje({
    title: '2026. aasta veebilehe hange', desc: 'Teenused; Lihthange; Muu',
  }))).length, 0, 'aastaarv ilma eraldajata ei tohi viitenumbriks saada');

  // Paarisfail peab olema koodis NIMETATUD - ta on gitignore'is ja kasitsi hoitav,
  // seega ainus koht, kus jargmine lugeja sellest teada saab, on see kommentaar.
  const lahtekood = readFileSync(new URL('../lib/hanked.mjs', import.meta.url), 'utf8');
  assert.ok(lahtekood.includes('rhr_watch.py'),
    'FIT-i juures peab olema viide paarisfailile rhr_watch.py');
  assert.ok(/CDATA/.test(lahtekood) && /topelt/i.test(lahtekood),
    'tagi() juures peab olema selgitus, miks olemeid dekodeeritakse ka CDATA sees');
  console.log('PASS hanked: eraldaja on noutud ja otsused on koodis kirjas');
}

// ---------------------------------------------------------------------------
// ULESANNE 4: sobivuse skoor ja pohjendus.
// score() on PUHAS: ei baasi, ei vorku, ei mudelit. Seega ei ole siin uhtegi testDb().
// ---------------------------------------------------------------------------

// S1: teostusplaani kolm juhtumit (rida ~314).
{
  const r = score({ title: 'Veebilehe arendus', segment: 'väike veebileht', est: 45000,
    menetlus: 'Lihthange', crit: ['price', 'quality'], deadline: '2026-12-01' },
    { today: '2026-10-01', ajalugu: null });
  assert.equal(r.points, 80, '40 + 10 + 15 + 10 + 5');
  assert.equal(r.verdict, 'PAKU');
  assert.ok(r.why.some((x) => x.includes('+15')), 'pohjendus sisaldab maksumuse rida');

  const s = score({ title: 'Infosüsteemi arendus', segment: 'nišš', est: 4000000,
    menetlus: 'Avatud hankemenetlus', crit: ['price'], deadline: '2026-12-01',
    rollid: 3 }, { today: '2026-10-01', ajalugu: { medianTenders: 11 } });
  assert.equal(s.verdict, 'ALLTÖÖVÕTT', 'kolm rolli sunnib alltoovottu');
  assert.ok(s.points < 35, 'alltoovotu hange ei tohi ka punktides ules joosta');

  const a = score({ title: 'UX audit', segment: 'nišš', est: 30000, menetlus: 'Väikehange',
    crit: ['quality'], deadline: '2026-10-02' }, { today: '2026-10-01', ajalugu: null });
  const b = score({ title: 'UX audit', segment: 'nišš', est: 30000, menetlus: 'Väikehange',
    crit: ['quality'], deadline: '2026-11-02' }, { today: '2026-10-01', ajalugu: null });
  assert.equal(b.points - a.points, 15, 'alla kolme paeva tahtaeg maksab 15 punkti');

  // Iga rida on inimloetav ja iseseisev: "+15 · maksumus 57 000 €".
  for (const rida of [...r.why, ...s.why, ...a.why]) {
    assert.match(rida, /^[+-]?\d+ · \S/, 'pohjenduse rida peab olema kujul "+15 · tekst": ' + rida);
  }
  console.log('PASS hanked: skoor ja põhjendus');
}

// S2 (otsus 1): tundmatu segment EI saa nisipunkte. score() on eksporditud ja teda
// kutsutakse ka valjastpoolt RSS-ahelat (kasitsi import, ulesande 6 eForms-tee),
// seega +40 pimesi jagamine tahendaks, et score_why valetab inimesele naha.
{
  const tundmatu = score({ segment: null, est: 40000 }, { today: '2026-10-01' });
  assert.ok(!tundmatu.why.some((x) => x.startsWith('+40')), 'tundmatu segment ei tohi anda nisipunkte');
  assert.equal(tundmatu.points, 15, 'jarele jaab ainult maksumus');
  assert.ok(tundmatu.why.some((x) => /tundmatu segment/.test(x)),
    'tundmatu segment peab pohjenduses NAHTAV olema, mitte vaikselt puuduma');

  const praht = score({ segment: 'muu suvaline' }, { today: '2026-10-01' });
  assert.equal(praht.points, 0, 'suvaline segmendisilt ei ole niss');
  assert.equal(praht.verdict, 'JÄTA');

  assert.equal(score({ segment: 'nišš' }, { today: '2026-10-01' }).points, 40);
  assert.equal(score({ segment: 'väike veebileht' }, { today: '2026-10-01' }).points, 50,
    'vaike veebileht saab 40 + 10');
  console.log('PASS hanked: tundmatu segment ei saa nisipunkte');
}

// S3 (otsus 2): maksumuse vahemik 140 001 - 1 000 000 on TEADLIK auk, mitte unustus.
// Selles vahemikus ei ole hange meie suurusjark ega ka veel "uksi ei kata" -
// punktitabel ei utle midagi ja meie ei arva ka.
{
  const p = (est) => score({ segment: 'nišš', est }, { today: '2026-10-01' }).points - 40;
  assert.equal(p(50000), 15, 'piir 50 000 kuulub veel alumisse vahemikku');
  assert.equal(p(50001), 10);
  assert.equal(p(140000), 10, 'piir 140 000 kuulub veel keskmisse vahemikku');
  assert.equal(p(140001), 0, 'keskmine vahemik on teadlik auk');
  assert.equal(p(1000000), 0, 'tapselt miljon ei ole veel karistus');
  assert.equal(p(1000001), -10);
  assert.equal(p(0), 15, 'null eurot on maksumus, mitte puuduv vali');

  const augus = score({ segment: 'nišš', est: 500000 }, { today: '2026-10-01' });
  assert.ok(!augus.why.some((x) => /maksumus/.test(x)), 'augus ei teki maksumuse rida');
  console.log('PASS hanked: maksumuse keskmine vahemik on teadlik auk');
}

// S4 (otsus 3): alltoovotu pohjus peab nimetama PARIS pohjuse. Plaani naidiskood
// kusis 'rollid >= 3 ? ... : ...' ja null-rollide korral langes see kaibe harru
// juhuslikult oigesti - aga kahe pohjuse korral oleks teine vaikselt kadunud.
{
  const kaive = score({ segment: 'nišš', kaiveNoue: 200000 }, { today: '2026-10-01' });
  assert.equal(kaive.verdict, 'ALLTÖÖVÕTT');
  const kr = kaive.why.find((x) => x.startsWith('-25'));
  assert.ok(/käibenõue 200 000 €/.test(kr), 'kaibest tulnud alltoovott peab raakima kaibest: ' + kr);
  assert.ok(!/rolli/.test(kr), 'kaibest tulnud alltoovott ei tohi raakida rollidest: ' + kr);

  const molemad = score({ segment: 'nišš', rollid: 4, kaiveNoue: 60000 }, { today: '2026-10-01' });
  const mr = molemad.why.find((x) => x.startsWith('-25'));
  assert.ok(/4 rolli/.test(mr) && /käibenõue/.test(mr), 'molemad pohjused peavad kirjas olema: ' + mr);
  assert.equal(molemad.points, 15, '-25 rakendub UKS kord, ka kahe pohjuse korral');

  assert.equal(score({ segment: 'nišš', rollid: 2, kaiveNoue: 50000 }, { today: '2026-10-01' }).verdict,
    'KAALU', 'piirid on >= 3 rolli ja > 50 000 kaivet - kumbki ei ole siin uletatud');

  // docs voidab h ule - MOLEMAS suunas.
  assert.equal(score({ segment: 'nišš', rollid: 1 }, { today: '2026-10-01', docs: { rollid: 5 } }).verdict,
    'ALLTÖÖVÕTT', 'docs tostab rollid ules');
  assert.equal(score({ segment: 'nišš', rollid: 5 }, { today: '2026-10-01', docs: { rollid: 1 } }).verdict,
    'KAALU', 'docs vottab rollid maha');

  // ALLTOOVOTT on ulimuslik ka siis, kui punkte on PAKU jagu.
  const tugev = score({ segment: 'väike veebileht', est: 45000, crit: ['quality'], rollid: 3 },
    { today: '2026-10-01', docs: { qualityWeight: 60 } });
  assert.equal(tugev.points, 60, '50 + 15 + 20 - 25');
  assert.equal(tugev.verdict, 'ALLTÖÖVÕTT', 'alltoovott voidab ka 60 punkti');
  console.log('PASS hanked: alltöövõtu põhjus nimetab päris põhjuse');
}

// S5 (otsus 4): vigane tahtaeg ei tohi VAIKSELT karistuse ara jatta. Date.parse annab
// katkise kuupaeva peal NaN ja 'NaN < 3' on false - ehk -15 oleks markamatult kadunud.
{
  const katki = score({ segment: 'nišš', deadline: '13.10.2026' }, { today: '2026-10-01' });
  assert.equal(katki.points, 40, 'loetamatu tahtaeg ei muuda punkte');
  assert.ok(katki.why.some((x) => /tähtaeg loetamatu/.test(x)),
    'loetamatu tahtaeg peab olema NAHTAV rida, mitte vaikus');

  assert.ok(score({ segment: 'nišš', deadline: '2026-02-31' }, { today: '2026-10-01' })
    .why.some((x) => /loetamatu/.test(x)), '31. veebruar ei ole kuupaev');

  const puudub = score({ segment: 'nišš', deadline: null }, { today: '2026-10-01' });
  assert.ok(!puudub.why.some((x) => /tähta/.test(x)), 'PUUDUV tahtaeg ei tekita ridagi');
  assert.equal(puudub.points, 40);

  // markExpired lubab kellaajaga kuju ('2026-09-20 17:00') - score peab sama lugema.
  assert.equal(score({ segment: 'nišš', deadline: '2026-10-02 17:00' }, { today: '2026-10-01' }).points,
    25, 'kellaajaga tahtaeg loetakse ara');
  assert.equal(score({ segment: 'nišš', deadline: '2026-10-04' }, { today: '2026-10-01' }).points,
    40, 'kolm paeva on piir - siin karistust ei ole');
  assert.equal(score({ segment: 'nišš', deadline: '2026-10-03' }, { today: '2026-10-01' }).points,
    25, 'kaks paeva on alla piiri');

  const moodas = score({ segment: 'nišš', deadline: '2026-09-27' }, { today: '2026-10-01' });
  assert.equal(moodas.points, 25);
  assert.ok(moodas.why.some((x) => /möödas/.test(x)),
    'moodunud tahtaeg utleb seda otse, mitte "tahtajani -4 paeva"');

  // today on MEIE oma vali, mitte RHR-i oma - vaikne eksimus on siin halvem kui viga.
  assert.throws(() => score({ segment: 'nišš' }, { today: '01.10.2026' }), /Vigane kuupäev/);
  assert.throws(() => score({ segment: 'nišš' }, { today: null }), /Vigane kuupäev/);
  assert.throws(() => score({ segment: 'nišš' }, { today: '2026-02-31' }), /Vigane kuupäev/);
  console.log('PASS hanked: vigane tähtaeg ei kao vaikselt');
}

// S6 (otsus 5): arvuvormindus on UKS reegel kogu pohjenduses - '57 000 €', mitte '57000'.
{
  const r = score({ segment: 'nišš', est: 57000, kaiveNoue: 1250000 }, { today: '2026-10-01' });
  assert.ok(r.why.some((x) => x.startsWith('+10 · maksumus 57 000 €')),
    'maksumus vormindatakse tuhandeeraldajaga: ' + JSON.stringify(r.why));
  assert.ok(r.why.some((x) => /käibenõue 1 250 000 €/.test(x)), 'sama reegel kehtib kaibenoudele');
  for (const rida of r.why) {
    assert.ok(!/\d{4,}/.test(rida), 'uhtegi vormindamata arvu ei tohi pohjenduses olla: ' + rida);
  }
  // Murdosa umardatakse, mitte ei lekita '57000.4 €'.
  assert.ok(score({ segment: 'nišš', est: 57000.4 }, { today: '2026-10-01' })
    .why.some((x) => x.includes('57 000 €')), 'murdosa umardatakse taisarvuks');
  console.log('PASS hanked: arvuvormindus on ühtne');
}

// S7 (otsus 6): maksumust valideeritakse nagu viide() mujal failis - puuduv vali on
// "ei tea" (vaikus), katkine vali on NAHTAV rida.
{
  assert.equal(score({ segment: 'nišš', est: '45000' }, { today: '2026-10-01' }).points, 55,
    'arvuna kirjutatud string loetakse ara');
  assert.equal(score({ segment: 'nišš', est: '45 000' }, { today: '2026-10-01' }).points, 55,
    'tuhikutega string loetakse ara');

  for (const vigane of [-5000, 'kokkuleppel', NaN, true, {}]) {
    const r = score({ segment: 'nišš', est: vigane }, { today: '2026-10-01' });
    assert.equal(r.points, 40, 'katkine maksumus ei anna ega vota punkte: ' + String(vigane));
    assert.ok(r.why.some((x) => /maksumus teadmata/.test(x)),
      'katkine maksumus peab olema NAHTAV: ' + String(vigane));
  }
  for (const puuduv of [null, undefined, '']) {
    const r = score({ segment: 'nišš', est: puuduv }, { today: '2026-10-01' });
    assert.ok(!r.why.some((x) => /maksumus/.test(x)), 'PUUDUV maksumus ei tekita ridagi');
  }
  assert.throws(() => score(null, { today: '2026-10-01' }), /Vigane hange/);
  assert.throws(() => score('314159', { today: '2026-10-01' }), /Vigane hange/);
  console.log('PASS hanked: maksumust valideeritakse nagu viide()');
}

// S8 (otsus 7): punktid VOIVAD jaada negatiivseks ja me ei loika neid nulli -
// negatiivne skoor jarjestab halvimad hanked nimekirja lopus oiges jarjekorras.
{
  const r = score({ segment: null, est: 4000000, rollid: 6, deadline: '2026-10-02' },
    { today: '2026-10-01', ajalugu: { medianTenders: 12 } });
  assert.equal(r.points, -60, '0 - 10 - 25 - 10 - 15');
  assert.equal(r.verdict, 'ALLTÖÖVÕTT');

  const ilma = score({ segment: null, est: 4000000, deadline: '2026-10-02' },
    { today: '2026-10-01', ajalugu: { medianTenders: 12 } });
  assert.equal(ilma.points, -35);
  assert.equal(ilma.verdict, 'JÄTA');
  console.log('PASS hanked: skoor võib olla negatiivne');
}

// S9: ulejaanud punktitabel - kvaliteedikriteerium, kerge menetlus, CPV ajalugu,
// verdikti piirid.
{
  const k = (crit, docs) => score({ segment: 'nišš', crit }, { today: '2026-10-01', docs });
  assert.equal(k(['quality']).points, 50, 'kvaliteedikriteerium ilma kaaluta annab +10');
  assert.equal(k(['quality'], { qualityWeight: 50 }).points, 60, 'kaal 50 % annab +20');
  assert.equal(k(['quality'], { qualityWeight: 49 }).points, 50);
  assert.equal(k(['quality'], { qualityWeight: 0 }).points, 50, 'kaal 0 on teada, mitte puuduv');
  assert.ok(k(['quality'], { qualityWeight: 0 }).why.some((x) => /0 %/.test(x)),
    'teadaolev kaal 0 peab pohjenduses naha olema');
  assert.equal(k('quality').points, 50, 'crit voib olla ka uksik string');
  assert.equal(k(['Quality']).points, 50, 'suurtaht ei tohi kriteeriumi peita');
  assert.equal(k(['price']).points, 40);
  assert.equal(k(null).points, 40);

  for (const m of ['Lihthange', 'lihthange', 'Väikehange', 'Vaikehange', 'Liht hange']) {
    assert.equal(score({ segment: 'nišš', menetlus: m }, { today: '2026-10-01' }).points, 45,
      'kerge menetlus annab +5: ' + m);
  }
  assert.equal(score({ segment: 'nišš', menetlus: 'Avatud hankemenetlus' }, { today: '2026-10-01' }).points,
    40, 'avatud hankemenetlus ei ole kerge menetlus');

  const aj = (medianTenders) => score({ segment: 'nišš' }, { today: '2026-10-01', ajalugu: { medianTenders } }).points;
  assert.equal(aj(8), 30, 'kaheksa pakkujat on rahvarohke');
  assert.equal(aj(7), 40, 'seitse jaab kahe reegli vahele');
  assert.equal(aj(4), 40);
  assert.equal(aj(3), 45, 'kolm voi vahem on meie vaikne hange');

  // Verdikti piirid.
  assert.equal(score({ segment: 'nišš', crit: ['quality'] }, { today: '2026-10-01', docs: { qualityWeight: 60 } }).verdict,
    'PAKU', '60 punkti on juba PAKU');
  assert.equal(score({ segment: 'nišš', est: 45000 }, { today: '2026-10-01' }).verdict, 'KAALU', '55 on KAALU');
  assert.equal(score({ segment: 'nišš' }, { today: '2026-10-01' }).verdict, 'KAALU', '40 on KAALU');
  assert.equal(aj(8), 30);
  assert.equal(score({ segment: 'nišš' }, { today: '2026-10-01', ajalugu: { medianTenders: 8 } }).verdict,
    'JÄTA', '30 on juba JATA');
  console.log('PASS hanked: kvaliteet, menetlus, ajalugu ja verdikti piirid');
}

// S10: score on PUHAS - sama sisend annab sama valjundi, sisendit ei muudeta,
// baasi ega vorku ei puututa. See ei ole kosmeetika: ulesandes 5 kutsub sunkimine
// score-i tsuklis ja tulemus laheb baasi veergu score_why.
{
  const h = { title: 'UX audit', segment: 'nišš', est: 45000, crit: ['quality'],
    menetlus: 'Lihthange', deadline: '2026-12-01' };
  const koopia = JSON.parse(JSON.stringify(h));
  const valikud = { today: '2026-10-01', ajalugu: { medianTenders: 5 }, docs: { qualityWeight: 60 } };
  const a = score(h, valikud);
  const b = score(h, valikud);
  assert.deepEqual(a, b, 'sama sisend peab andma sama valjundi');
  assert.deepEqual(h, koopia, 'score ei tohi sisendit muuta');

  // Ilma valikuteta kutse peab tootama (today vaikimisi tanane).
  const c = score(h);
  assert.ok(Number.isFinite(c.points) && typeof c.verdict === 'string' && Array.isArray(c.why),
    'uheargumendiline kutse peab tootama');

  const lahtekood = readFileSync(new URL('../lib/hanked.mjs', import.meta.url), 'utf8');
  const keha = lahtekood.slice(lahtekood.indexOf('export function score('));
  assert.ok(keha.length > 100, 'score peab olema failis olemas');
  assert.ok(!/\bfetch\s*\(|db\.prepare|db\.exec/.test(keha),
    'score keha ei tohi puutuda baasi ega vorku');
  console.log('PASS hanked: score on puhas funktsioon');
}
