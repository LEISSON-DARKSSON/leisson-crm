// Varav: jarelkirjad. Kaks puudet, uus fakt igas kirjas, sama kaks votit.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { tooPaevi, millineJarelkiri, uusFakt, jarelGate, KADENTS, MAX_JARELKIRJU } from '../lib/jarelgate.mjs';
import { koosta, kaardikiri, sulgemiskiri, nimiAadressist } from '../lib/jarelkiri.mjs';
import { leiud } from '../lib/kaart.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (n, c, m = '') => { if (c) { pass++; console.log('  ok  ', n, m ? ` ${m}` : ''); } else { fail++; console.log('  FAIL', n, m ? ` ${m}` : ''); } };

console.log('\nJÄRELKIRJAD');

const M = { desc: 0, og: 0, org: false, hreflang: 0, tLen: 205 };
const TERVE = { desc: 140, og: 8, org: true, hreflang: 2, tLen: 55 };

// --- tooapaevade arvestus ---
ok('E -> N on 3 tööpäeva', tooPaevi('2026-09-14', '2026-09-17') === 3);
ok('R -> E on 1 tööpäev (nädalavahetus ei loe)', tooPaevi('2026-09-11', '2026-09-14') === 1);
ok('R -> L on 0 tööpäeva', tooPaevi('2026-09-11', '2026-09-12') === 0);
ok('sama päev on 0', tooPaevi('2026-09-14', '2026-09-14') === 0);

// --- kadents ---
ok('järelkirju on täpselt kaks', MAX_JARELKIRJU === 2 && KADENTS.length === 2);
ok('esimene tuleb 3 tööpäeva pärast', millineJarelkiri(0, '2026-09-14', '2026-09-17')?.nimi === 'kaart');
ok('kahe tööpäeva pärast on veel vara', millineJarelkiri(0, '2026-09-14', '2026-09-16') === null);
ok('teine tuleb alles 9 tööpäeva pärast', millineJarelkiri(1, '2026-09-14', '2026-09-25')?.nimi === 'sulgemine');
ok('KOLMANDAT JÄRELKIRJA EI OLE', millineJarelkiri(2, '2026-09-14', '2026-12-01') === null,
  'jälitamine lõhub brändi ja tõstab kaebuseriski');

// --- uue fakti reegel ---
{
  const a = kaardikiri({ kontakt: 'Katre', m: M });
  const b = sulgemiskiri({ kontakt: 'Katre', m: M });
  ok('järelkiri 1 kannab uut fakti tühja ajaloo vastu', uusFakt(a, ['']));
  ok('sama kiri teist korda EI kanna uut fakti', !uusFakt(a, [a.body]),
    '"tõusen kirja peale üles" jääb värava taha');
  ok('järelkiri 2 ei korda järelkirja 1', uusFakt(b, [a.body]));
  ok('uudsus ei sõltu numbrist kirjas', uusFakt(b, [a.body]) && !/\d/.test(b.fakt.replace(/[^0-9]/g, '')),
    'kolmas leid on numbrita, aga täiesti uus');
  ok('järelkirjas 2 on teine leid kui järelkirjas 1', a.fakt !== b.fakt, `${a.fakt} vs ${b.fakt}`);
}

// --- kirja kuju ---
{
  const a = kaardikiri({ kontakt: 'Katre', m: M });
  const b = sulgemiskiri({ kontakt: 'Katre', m: M });
  ok('järelkiri 1 kasutab kuni kahte kontrollitud leidu', leiud(M).length===3 && !a.body.includes(leiud(M)[2].leid),
    'järgmine mustand saab kasutada seni käsitlemata tähelepanekut');
  ok('järelkiri 1 küsib täpselt ühte asja', (a.body.match(/\?/g) || []).length === 1);
  ok('järelkiri 1 ei küsi kohtumist',
    /ei küsi uuesti kohtumist/i.test(a.body)
    && !/kas leiate|kas sobiks|kas saaksime kokku|kas leiaksite .{0,20}minutit/i.test(a.body),
    'ütleb otse välja, et ei küsi');
  ok('järelkirjas EI OLE hinda', !/€|\beur\b|\d{3,}\s*eurot/i.test(a.body + b.body),
    'ta juba ei vastanud — hind teeb kirjast müügikirja');
  ok('viimane kiri ütleb, et on viimane', /viimane/i.test(b.subject) && /rohkem ei kirjuta/i.test(b.body));
  ok('kummaski ei ole manust ega linki', !/http|manus|lisatud fail/i.test(a.body + b.body));
  ok('järelkiri 1 alla 140 sõna', a.body.split(/\s+/).length < 140, String(a.body.split(/\s+/).length));
  ok('järelkiri 2 alla 140 sõna', b.body.split(/\s+/).length < 140, String(b.body.split(/\s+/).length));
  ok('eesti kirjavahemärgid: em-kriipsu ei ole', !(a.body + b.body).includes('—'));
}

// --- vahe leiuga lehed: PARIS krahh 14.09.2026 ---
// Moni leht annab ainult uhe leiu. Vana kood vottis pimesi L[1] ja kukkus
// "Cannot read properties of undefined" peale KESKEL SAATMIST.
{
  const yks = { desc: 0, og: 8, org: true, hreflang: 2, tLen: 55 };   // ainult kirjeldus puudu
  const kaks = { desc: 0, og: 0, org: true, hreflang: 2, tLen: 55 };
  ok('ühe leiuga leht ei lõhu järelkirja 1', (() => {
    const k = kaardikiri({ kontakt: '', m: yks });
    return k && /Üks mõõdetud koht/.test(k.subject) && /Üks koht teie avalehelt/.test(k.body);
  })(), 'enne kukkus TypeError-iga');
  ok('ühe leiuga lehe puhul EI OLE teist järelkirja', sulgemiskiri({ kontakt: '', m: yks }) === null);
  ok('kahe leiuga lehe puhul EI OLE teist järelkirja', sulgemiskiri({ kontakt: '', m: kaks }) === null,
    'kolmas leid puudub — kordus oleks müra');
  ok('kolme leiuga lehel on teine järelkiri olemas', sulgemiskiri({ kontakt: '', m: M }) !== null);
  ok('leiuta leht ei anna kirja', kaardikiri({ kontakt: '', m: TERVE }) === null);
  ok('koosta talub nulli', koosta({ nimi: 'sulgemine' }, { kontakt: '', m: yks }) === null);
}

// --- nimi aadressist ---
ok('eesnimi tuleb isiklikust aadressist', nimiAadressist('katre@customer.example.test') === 'Katre');
ok('rollipostkastist nime EI võeta', nimiAadressist('info@firma.ee') === ''
  && nimiAadressist('sales@spa.ee') === '' && nimiAadressist('piletikassa@tickets.example.test') === '',
  'vale nimi kirja alguses on hullem kui nimeta');
ok('punktiga aadressist nime ei arvata', nimiAadressist('andrus.test@customer.example.test') === '');

// --- varav paris andmebaasi peal ---
{
  const TMP = join(tmpdir(), `gate-jarel-${process.pid}-${Date.now()}.sqlite`);
  const t = new DatabaseSync(TMP);
  t.exec(`CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT, email TEXT, status TEXT, url TEXT, body TEXT);
          CREATE TABLE activity (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT, ts TEXT, kind TEXT, note TEXT);
          CREATE TABLE suppressions (addr TEXT PRIMARY KEY, domain TEXT, reason TEXT, ts TEXT, by TEXT);
          CREATE TABLE messages (mailbox TEXT, uid INTEGER, company_id TEXT, direction TEXT, addr TEXT);`);
  const firma = (id, email, status = 'kiri') =>
    t.prepare('INSERT INTO companies VALUES (?,?,?,?,?,?)').run(id, id, email, status, 'https://x.ee', 'vana kiri');
  const saadeti = (id, ts) =>
    t.prepare("INSERT INTO activity (company_id, ts, kind, note) VALUES (?,?,'sent','x')").run(id, ts);

  // Igal firmal OMA domeen: summutus kaib domeeni kaupa (kolleeg loobus ->
  // kogu firma vaikib), seega uhine domeen summutaks fikstuuris koik korraga.
  firma('vaikija', 'a@aaa.ee');              saadeti('vaikija', '2026-09-14T09:00:00Z');
  firma('vastaja', 'b@bbb.ee');              saadeti('vastaja', '2026-09-14T09:00:00Z');
  t.prepare("INSERT INTO messages VALUES ('INBOX',1,'vastaja','in','b@bbb.ee')").run();
  firma('summutatud', 'c@ccc.ee');           saadeti('summutatud', '2026-09-14T09:00:00Z');
  t.prepare("INSERT INTO suppressions VALUES ('kolleeg@ccc.ee','ccc.ee','loobus','x','loobumine')").run();
  firma('vabapost', 'd@gmail.com');          saadeti('vabapost', '2026-09-14T09:00:00Z');
  firma('suletud', 'e@eee.ee', 'ei');        saadeti('suletud', '2026-09-14T09:00:00Z');
  firma('terve', 'f@fff.ee');                saadeti('terve', '2026-09-14T09:00:00Z');

  const moot = { vaikija: { ...M, ok: true }, vastaja: { ...M, ok: true }, summutatud: { ...M, ok: true },
                 vabapost: { ...M, ok: true }, suletud: { ...M, ok: true }, terve: { ...TERVE, ok: true } };
  const vara = jarelGate(t, { now: new Date('2026-09-16T10:00:00Z'), mootmised: moot });
  ok('kahe tööpäeva pärast ei saadeta kellelegi', vara.jarjekord.length === 0);

  const kaes = jarelGate(t, { now: new Date('2026-09-17T10:00:00Z'), mootmised: moot });
  const id = kaes.jarjekord.map((x) => x.id);
  ok('kolme tööpäeva pärast on vaikija järjekorras', id.includes('vaikija'));
  ok('vastanule järelkirja EI saadeta', !id.includes('vastaja'), 'vastus on juba käes');
  ok('summutatule ei saadeta', !id.includes('summutatud'), 'loobus kolleeg, vaikib kogu domeen');
  ok('vabapostile ei saadeta', !id.includes('vabapost'));
  ok('suletud seisule ei saadeta', !id.includes('suletud'));
  ok('terve lehega firmale ei saadeta', !id.includes('terve'), 'uut fakti ei ole öelda');
  ok('põhjused on nimetatud', Object.keys(kaes.miks).length >= 4, JSON.stringify(kaes.miks));

  // teine jarelkiri alles 9 toopaeva parast
  t.prepare("INSERT INTO activity (company_id, ts, kind, note) VALUES ('vaikija','2026-09-17T10:00:00Z','sent','jarel1')").run();
  const teine = jarelGate(t, { now: new Date('2026-09-21T10:00:00Z'), mootmised: moot });
  ok('teist järelkirja ei saadeta liiga vara', !teine.jarjekord.some((x) => x.id === 'vaikija'));
  const teineK = jarelGate(t, { now: new Date('2026-09-25T10:00:00Z'), mootmised: moot });
  ok('teine järelkiri tuleb 9 tööpäeva pärast', teineK.jarjekord.some((x) => x.id === 'vaikija' && x.samm.nimi === 'sulgemine'));

  t.prepare("INSERT INTO activity (company_id, ts, kind, note) VALUES ('vaikija','2026-09-25T10:00:00Z','sent','jarel2')").run();
  const kolmas = jarelGate(t, { now: new Date('2026-11-01T10:00:00Z'), mootmised: moot });
  ok('KOLMANDAT EI TULE KUNAGI', !kolmas.jarjekord.some((x) => x.id === 'vaikija'));

  t.close();
  for (const f of [TMP, TMP + '-wal', TMP + '-shm']) if (existsSync(f)) unlinkSync(f);
}

// --- kaks votit kehtib ka siin ---
{
  const mcp = readFileSync(join(ROOT, 'agent', 'mcp-server.mjs'), 'utf8');
  ok('agendil ei ole järelkirja saatmise tööriista', !/jarelkiri|followup|send_follow/i.test(mcp));
  const s = readFileSync(join(ROOT, 'agent', 'jarelkiri.mjs'), 'utf8');
  ok('saatja kasutab /api/send teed, mitte oma SMTP-d', /\/api\/send/.test(s) && !/nodemailer|createTransport/.test(s));
  ok('järelkirjadel on oma, väiksem päevalimiit', /JAREL_PER_DAY/.test(s));
  ok('saatja seisab esimese tõrke peal', /break;/.test(s));
  ok('uue fakti reegel on saatjas joustatud', /uusFakt\(/.test(s));
}

console.log(`\n  ${pass} labitud, ${fail} labi kukkunud\n`);
if (fail) process.exit(1);
