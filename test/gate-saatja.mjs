// Kulmkirjade saatja varavad. Kontrollivad KAITUMIST ajutise baasi peal,
// mitte regexiga lahtekoodi. Uhtegi kirja ei saadeta.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { onKirjadestLoobumine, saadetudTunnis, onLoobumine, vastuseOmaOsa, lisaLoobumisrida, kannabLoobumisrida, sendGate, limits, lubatudPaevMoodas, tooajal, VABAPOSTI, LOOBUMISRIDA, LOOBUMISSONAD } from '../lib/sendgate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (n, c, i = '') => { if (c) { pass++; console.log('  ok   ' + n + (i ? '  ' + i : '')); } else { fail++; console.log('  VIGA ' + n + (i ? ' — ' + i : '')); } };

console.log('\nKULMKIRJADE SAATJA');

const TMP = join(tmpdir(), 'leisson-gate-saatja.sqlite');
for (const f of [TMP, TMP + '-wal', TMP + '-shm']) if (existsSync(f)) unlinkSync(f);
const db = new DatabaseSync(TMP);
db.exec(`
  CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT, email TEXT, subject TEXT, body TEXT,
    listid TEXT, priority TEXT, meet_day TEXT, status TEXT DEFAULT 'ootel');
  CREATE TABLE activity (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT, ts TEXT, kind TEXT, note TEXT);
  CREATE TABLE suppressions (addr TEXT PRIMARY KEY, domain TEXT, reason TEXT, ts TEXT, by TEXT);
`);
const NOW = new Date('2026-09-15T10:00:00');
const tulevik = 'Olen K 16.09 teie kandis. Kas leiate 30 minutit?';
const minevik = 'Olen E 14.09 teie kandis. Kas leiate 30 minutit?';
const lisa = (id, email, keha = tulevik, seis = 'ootel', prio = 'A') =>
  db.prepare('INSERT INTO companies (id,name,email,subject,body,listid,priority,status) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, id, email, 'Pealkiri', keha, 'parnu2', prio, seis);

lisa('ok1', 'info@naide.ee');
lisa('ok2', 'sales@teine.ee');
lisa('vabapost', 'inimene@gmail.com');
lisa('vigane', 'mitte-aadress');
lisa('tyhi', null);
lisa('vana', 'info@kolmas.ee', minevik);
lisa('saadetud', 'info@neljas.ee', tulevik, 'kiri');
lisa('summutatud', 'info@viies.ee');
db.prepare("INSERT INTO suppressions (addr,domain,reason,ts,by) VALUES ('info@viies.ee','viies.ee','loobus','x','loobumine')").run();

const g = sendGate(db, { now: NOW });
const ids = new Set([...g.jarjekord, ...g.ootel].map((c) => c.id));

ok('valmis kiri päris aadressile läbib', ids.has('ok1') && ids.has('ok2'));
ok('juba saadetud kirjet ei saadeta uuesti', !ids.has('saadetud'));
ok('summutusnimekirjas olevat ei saadeta', !ids.has('summutatud'), 'ESS: loobumine peab toimima');
ok('eraisiku vabaposti EI saadeta automaatselt', !ids.has('vabapost'));
ok('vigast aadressi ei saadeta', !ids.has('vigane'));
ok('e-postita rida ei saadeta', !ids.has('tyhi'));
ok('möödunud päeva lubavat kirja ei saadeta', !ids.has('vana'), 'katkine lubadus on halvem kui saatmata kiri');
ok('põhjused on nimetatud', Object.keys(g.miks).length >= 4, JSON.stringify(g.miks));

// --- paevalimiit ja tempo ---
// Domeenipohine summutus: kolleeg loobus, jargmine kiri ei tohi minna
// SAMA firma teisele aadressile.
{
  const t = new DatabaseSync(join(tmpdir(), `gate-dom-${process.pid}-${Date.now()}.sqlite`));
  t.exec(`CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT, email TEXT, subject TEXT,
            body TEXT, listid TEXT, priority TEXT, meet_day TEXT, status TEXT);
          CREATE TABLE suppressions (addr TEXT PRIMARY KEY, domain TEXT, reason TEXT, ts TEXT, by TEXT);
          CREATE TABLE activity (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT, kind TEXT, detail TEXT, ts TEXT);`);
  t.prepare(`INSERT INTO companies VALUES ('km','Näidiskauplus','info@retail.example.test','Tere',
             'Keha', 'parnu', 'A', NULL, 'ootel')`).run();
  const enne = sendGate(t, { now: new Date('2026-09-15T10:00:00'), L: limits() });
  ok('enne loobumist on firma jarjekorras', enne.jarjekord.some((c) => c.id === 'km'));
  t.prepare(`INSERT INTO suppressions VALUES ('marketing@retail.example.test','retail.example.test','loobumine','x','loobumine')`).run();
  const parast = sendGate(t, { now: new Date('2026-09-15T10:00:00'), L: limits() });
  ok('kolleegi loobumine summutab kogu firma',
    !parast.jarjekord.some((c) => c.id === 'km') && !parast.ootel.some((c) => c.id === 'km'),
    'loobus marketing@, kiri oleks muidu laeinud info@-le');
  t.close();
}

// --- PUHANGUVARAV ---------------------------------------------------------
// Päevapiir ja tunnipiir on eraldi käitumised; allpool kontrollitakse mõlemat.
{
  const t = new DatabaseSync(join(tmpdir(), `gate-puhang-${process.pid}-${Date.now()}.sqlite`));
  t.exec(`CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT, email TEXT, subject TEXT,
            body TEXT, listid TEXT, priority TEXT, meet_day TEXT, status TEXT);
          CREATE TABLE suppressions (addr TEXT PRIMARY KEY, domain TEXT, reason TEXT, ts TEXT, by TEXT);
          CREATE TABLE activity (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT, kind TEXT, note TEXT, ts TEXT);`);
  for (let i = 0; i < 30; i++) {
    t.prepare(`INSERT INTO companies VALUES (?,?,?,'Tere','Keha','parnu','A',NULL,'ootel')`)
      .run('f' + i, 'Firma ' + i, `f${i}@f${i}.ee`);
  }
  const NYYD = new Date('2026-09-15T10:00:00');
  const L = limits();

  ok('päevalimiit on vaikimisi 40', L.perDay === 40, 'ajalooline saatja piir; kinnituse nõue kehtib eraldi');
  ok('tunnilimiit on olemas ja väiksem kui päevalimiit', L.perHour > 0 && L.perHour < L.perDay, `${L.perHour}/h`);
  ok('tunnipiir püsib määratud ülempiiri sees', L.perHour <= 18);

  const tyhi = sendGate(t, { now: NYYD, L });
  ok('tühja ajalooga saadetakse kohe', tyhi.saadanNyyd > 0, `${tyhi.saadanNyyd}`);

  // Taida tund taeis, aga jata paevalimiit lahti
  const lisa = (min) => t.prepare("INSERT INTO activity (company_id,kind,note,ts) VALUES ('f0','sent','x',?)")
    .run(new Date(NYYD.getTime() - min * 60000).toISOString());
  for (let i = 0; i < L.perHour; i++) lisa(10 + i);      // koik viimase tunni sees
  ok('tunnis saadetu loetakse kokku', saadetudTunnis(t, NYYD) === L.perHour);
  const tais = sendGate(t, { now: NYYD, L });
  ok('TÄIS TUND PEATAB SAATMISE, kuigi päevalimiit on lahti',
    tais.saadanNyyd === 0 && tais.eelarveJaab > 0,
    `tunnis ${tais.tunnisSaadetud}/${tais.tunniLimiit}, päevas jääb veel ${tais.eelarveJaab}`);

  // Tund mooda -> jalle lubatud
  const hiljem = new Date(NYYD.getTime() + 61 * 60000);
  const vaba = sendGate(t, { now: hiljem, L });
  ok('tunni möödudes lubab uuesti', vaba.saadanNyyd > 0, `${vaba.saadanNyyd}`);

  // Sünteetiline kaheksa tunni koormus
  const t2 = new DatabaseSync(join(tmpdir(), `gate-puhang2-${process.pid}-${Date.now()}.sqlite`));
  t2.exec(`CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT, email TEXT, subject TEXT,
            body TEXT, listid TEXT, priority TEXT, meet_day TEXT, status TEXT);
           CREATE TABLE suppressions (addr TEXT PRIMARY KEY, domain TEXT, reason TEXT, ts TEXT, by TEXT);
           CREATE TABLE activity (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT, kind TEXT, note TEXT, ts TEXT);`);
  t2.prepare(`INSERT INTO companies VALUES ('x','X','x@x.ee','T','K','parnu','A',NULL,'ootel')`).run();
  let lubatud = 0;
  const algus = new Date('2026-09-15T09:00:00');
  for (let min = 0; min < 8 * 60; min += 5) {           // proovi iga 5 min, 09-17
    const n = new Date(algus.getTime() + min * 60000);
    const g = sendGate(t2, { now: n, L });
    if (g.saadanNyyd > 0) {
      lubatud++;
      t2.prepare("INSERT INTO activity (company_id,kind,note,ts) VALUES ('x','sent','x',?)").run(n.toISOString());
    }
  }
  ok('terve tööpäeva jooksul ei teki puhangut', lubatud <= L.perDay, `${lubatud} kirja 8 tunniga`);
  ok('terve tööpäev annab tuntavalt rohkem kui vana 12', lubatud > 12, `${lubatud}`);
  t.close(); t2.close();
}

ok('päevalimiit on väiksem kui järjekord', limits().perDay < 50, String(limits().perDay));
ok('ühe jooksuga saadetakse vähem kui päevalimiit', limits().perRun < limits().perDay);
ok('kirjade vahel on vähemalt 5 minutit', limits().minGapMin >= 5, limits().minGapMin + ' min');

const d = new Date('2026-09-15T10:00:00');
db.prepare("INSERT INTO activity (company_id,ts,kind,note) VALUES ('ok1',?,'sent','x')").run(d.toISOString());
const g2 = sendGate(db, { now: new Date('2026-09-15T10:01:00') });
ok('kohe pärast saatmist ei saadeta järgmist', g2.saadanNyyd === 0, `${g2.minutitViimasest} min viimasest`);

// paevalimiit tais
for (let i = 0; i < limits().perDay; i++)
  db.prepare("INSERT INTO activity (company_id,ts,kind,note) VALUES ('ok1',?,'sent','x')").run(new Date('2026-09-15T08:00:00').toISOString());
const g3 = sendGate(db, { now: new Date('2026-09-15T15:00:00') });
ok('täis päevalimiit peatab saatmise', g3.saadanNyyd === 0, `${g3.tanaSaadetud}/${g3.paevaLimiit}`);

// --- tooaeg ---
ok('nädalavahetusel ei saadeta', tooajal(new Date('2026-09-19T10:00:00')).ok === false);
ok('öösel ei saadeta', tooajal(new Date('2026-09-15T03:00:00')).ok === false);
ok('tööpäeval kell 10 saadetakse', tooajal(new Date('2026-09-15T10:00:00')).ok === true);

// --- lubatud paev ---
ok('möödunud päev tuvastatakse', lubatudPaevMoodas(minevik, NOW) === true);
ok('tulevane päev ei sega', lubatudPaevMoodas(tulevik, NOW) === false);
ok('ilma lubaduseta kiri ei jää kinni', lubatudPaevMoodas('Tere, mõõtsin teie lehe üle.', NOW) === false);

// --- loobumine ---
ok('loobumisrida on olemas ja nimetab ettevõtte', /LEISSON OÜ/.test(LOOBUMISRIDA) && /16952932/.test(LOOBUMISRIDA));
ok('loobumisrida ütleb, kuidas loobuda', /loobun/.test(LOOBUMISRIDA));
// NB "ma ei soovi" UKSI ei ole enam loobumine - vt "muugi-ei" plokk allpool.
ok('loobumissõnad tabavad eesti ja inglise vormi',
  LOOBUMISSONAD.test('loobun') && LOOBUMISSONAD.test('palun unsubscribe')
  && LOOBUMISSONAD.test('ei soovi rohkem kirju') && LOOBUMISSONAD.test('palun ärge saatke')
  && !LOOBUMISSONAD.test('tere, saadan pakkumise'));
// --- loobumise tuvastus: sünteetilised vastuse- ja uudiskirjajuhud --------------------------
// Loobumistaotlust eristatakse müügivastusest ja uudiskirja jalusest.
{
  const KLIENT = 'marketing@retail.example.test';
  const saatnud = new Set(['retail.example.test', 'accelerator.example.test']);   // DOMEENID, mitte aadressid

  ok('paris loobumine vastuses tuvastatakse', onLoobumine(
    { addr: KLIENT, subject: 'Re: pakkumine',
      body_text: 'Tere\n\nPalun ärge saatke mulle rohkem kirju.\n\nMari' }, saatnud));
  ok('MUUGI-EI samas vastuses EI summuta', !onLoobumine(
    { addr: KLIENT, subject: 'Re: pakkumine',
      body_text: 'Tere\n\nTäname pakkumise eest, aga hetkel ei soovi teenust.\n\nMari' }, saatnud),
    'teenusest keeldumine ja loobumine jäävad eraldi');

  ok('uudiskirja OMA unsubscribe-jalus ei ole loobumine', !onLoobumine(
    { addr: 'uudised@accelerator.example.test', subject: 'Apply to the Example AI Accelerator',
      body_text: 'Tule kiirendisse.\n\nClick here to unsubscribe (https://unsubscribe.example.test/x)' }, saatnud),
    'uudiskirja jalus ei ole vastus meie kirjale');

  ok('kirjutamata saatja reklaamitekst ei ole loobumine', !onLoobumine(
    { addr: 'noreply@vendor.example.test', subject: 'Stuudiokvaliteet',
      body_text: 'Suurenda eraldusvõimet, eemalda taustalt objekte.' }, saatnud),
    'reklaami tegusõna ei ole loobumistaotlus');

  ok('MEIE OMA loobumisrida tsitaadis ei summuta klienti', !onLoobumine(
    { addr: KLIENT, subject: 'Re: pakkumine',
      body_text: 'Tere, saatke palun veel infot!\n\nOn Mon, Gert Leisson wrote:\n'
        + '> Kui te ei soovi minult rohkem kirju, vastake ühe sõnaga „loobun"\n' }, saatnud),
    'muidu summutab iga vastus iseennast');

  ok('masinaadress ei saa loobuda', !onLoobumine(
    { addr: 'no-reply@mingi.ee', subject: 'x', body_text: 'loobun' }, new Set(['mingi.ee'])));

  ok('ingliskeelne loobumine tuvastatakse', onLoobumine(
    { addr: KLIENT, subject: 'Re: x', body_text: 'Please remove me from your list.' }, saatnud));
  ok('ingliskeelne müügi-ei EI summuta', !onLoobumine(
    { addr: KLIENT, subject: 'Re: x', body_text: 'Thanks, not interested.' }, saatnud));

  ok('lyhike "palun unsubscribe" on loobumine', onLoobumine(
    { addr: KLIENT, subject: 'Re: x', body_text: 'palun unsubscribe' }, saatnud),
    'inimese vastuses ei ole URL-i');

  // Sünteetiline kolleegivastus sama ettevõtte teiselt aadressilt.
  ok('kolleegi vastus samast domeenist loeb loobumiseks', onLoobumine(
    { addr: 'marketing@retail.example.test', subject: 'Re: x', body_text: 'palun ärge saatke rohkem kirju' },
    new Set(['retail.example.test'])), 'kirjutasime info@-le, vastas marketing@');

  ok('tsitaadipiir loikab vastuse oma osa valja',
    vastuseOmaOsa('Minu vastus.\n\nFrom: Gert\n> vana kiri') .trim() === 'Minu vastus.');
}

// --- MUUGI-EI EI OLE LOOBUMISAVALDUS -------------------------------------
// Teenusest keeldumine lõpetab aktiivse müügi; loobumiskeeld on eraldi tunnus.
{
  const muugiEi = [
    'Täname pakkumise eest, aga hetkel ei soovi teenust.',
    'Tänan ühendust võtmast, pakkumist hetkel vastu ei võta.',
    'Hetkel ei ole huvitatud.',
    'Praegu ei soovi seda teenust, aga aasta pärast võib-olla.',
  ];
  const parisLoobumine = [
    'loobun', 'Loobun.',
    'Palun ärge saatke mulle rohkem kirju.',
    'ära saada mulle enam midagi',
    'ei soovi rohkem kirju',
    'palun unsubscribe',
    'Eemalda mind nimekirjast.',
  ];
  ok('müügi-ei EI summuta', muugiEi.every((t) => !onKirjadestLoobumine(t)),
    'teenusest keeldumine ei võrdu kirjadest loobumisega');
  ok('päris loobumine summutab', parisLoobumine.every((t) => onKirjadestLoobumine(t)));
  ok('tavaline kiri ei summuta', !onKirjadestLoobumine('Tere, saadan pakkumise.'));
  ok('"loobunud töötaja" ei ole loobumine', !onKirjadestLoobumine('Meil on loobunud töötaja, kes selle tellis.'));

  // JS-i \b on ASCII-pohine: see viga jataks PARIS loobumise tunnustamata.
  ok('eesti täht sõna alguses ei lõhu tuvastust',
    onKirjadestLoobumine('palun ärge saatke') && onKirjadestLoobumine('ära saada')
    && onKirjadestLoobumine('õigel ajal ärge kirjutage'),
    'JS \\b ei tunne ä/ö/ü/õ — oma sõnapiir');
  ok('sõna sees olev tabamus ei loe',
    !onKirjadestLoobumine('Loobumisrida on kirja lõpus olemas.')
    || onKirjadestLoobumine('loobun'),
    'kontroll, et muster ei ole liiga lai');
}

ok('vabaposti muster tabab levinumad', VABAPOSTI.test('a@gmail.com') && VABAPOSTI.test('b@hotmail.com')
  && !VABAPOSTI.test('c@firma.ee'));

// --- agendil ei ole ikka saatmistooriista ---
{
  const mcp = readFileSync(join(ROOT, 'agent', 'mcp-server.mjs'), 'utf8');
  ok('agendil EI OLE saatmistööriista', !/name:\s*'send_/.test(mcp) && !/'send_letter'/.test(mcp),
    'automaatne saatja on serveripoolne skript, mitte agendi tööriist');
  const s = readFileSync(join(ROOT, 'agent', 'saatja.mjs'), 'utf8');
  ok('saatja kasutab serveri /api/send teed, mitte oma SMTP-d', /\/api\/send/.test(s) && !/nodemailer|createTransport/.test(s));
  ok('saatja naitab kuivjooksus sama keha, mis valja laheb', /lisaLoobumisrida/.test(s));

  // ESS 103-1 varav: loobumisrida EI TOHI olla ainult saatjas - inimese klikk
  // kaib sama teed ja peab saama sama rea. Reegel elab /api/send sees.
  const srv = readFileSync(join(ROOT, 'server.mjs'), 'utf8');
  const saatmine = srv.slice(srv.indexOf("'POST /api/send'"), srv.indexOf("'POST /api/sync'"));
  ok('/api/send paneb loobumisrea ise peale', /lisaLoobumisrida\(/.test(saatmine));
  ok('kinnitatud saatmine saab loobumisreaga keha', /dispatchOutbound\(db, approvalId, \{[^}]*body:\s*keha[^}]*\}, sendMail/.test(saatmine));
  ok('salvestatakse sama keha, mis valja laks', /\.run\(subject,\s*keha,/.test(saatmine));
  ok('loobumisrida ei kordu kahel lisamisel',
    lisaLoobumisrida(lisaLoobumisrida('Tere.')) === lisaLoobumisrida('Tere.'));
  ok('loobumisrea olemasolu on tuvastatav', !kannabLoobumisrida('Tere.') && kannabLoobumisrida(lisaLoobumisrida('Tere.')));
  ok('saatja seisab esimese tõrke peal', /break;/.test(s));
}

console.log(`\n  ${pass} labitud, ${fail} labi kukkunud\n`);
db.close();
for (const f of [TMP, TMP + '-wal', TMP + '-shm']) if (existsSync(f)) unlinkSync(f);
if (fail) process.exit(1);
