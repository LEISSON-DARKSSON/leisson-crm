// Riigihangete andmekihi varav: tabelid, upsert, valvad sisendid ja jarjestus.
// Baas laheb OS-i tmp-kausta - monteeritud kettal SQLite lukustust ei toetata.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrateHanked, upsertHange, listHanked, setState, setNote, markExpired, HANKE_STATES } from '../lib/hanked.mjs';

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

// P8: varav on npm-ahelas - muidu ei jookse teda keegi.
{
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['hanked:gate'], 'node test/gate-hanked.mjs',
    'package.json vajab skripti hanked:gate');
  assert.ok(pkg.scripts['test:offline'].includes('node test/gate-hanked.mjs'),
    'gate-hanked peab olema test:offline ahelas');
  console.log('PASS hanked: varav on test:offline ahelas');
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
