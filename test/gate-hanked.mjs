// Riigihangete andmekihi varav: tabelid, upsert, valvad sisendid ja jarjestus.
// Baas laheb OS-i tmp-kausta - monteeritud kettal SQLite lukustust ei toetata.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrateHanked, upsertHange, listHanked, HANKE_STATES } from '../lib/hanked.mjs';

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
    /viitenumbrita/, 'NULL-viitenumbriga hange peab viskama eestikeelse vea');
  assert.throws(() => upsertHange(db, { ref: '', title: 'Vigane kirje' }),
    /viitenumbrita/, 'tuhja viitenumbriga hange peab viskama eestikeelse vea');
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
    /kat-01 ilma pealkirjata/, 'pealkirjata uus hange peab nimetama viitenumbri eesti keeles');
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
    /u1-uus ilma pealkirjata/, 'tuhikutest pealkirjaga uus hange peab andma eestikeelse vea');
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
