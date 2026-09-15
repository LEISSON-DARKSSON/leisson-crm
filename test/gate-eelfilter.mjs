// Varav: eelfilter saastab raha, AGA ei tohi kunagi visata ara midagi,
// mis voib olla klient voi raha.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eelfilter, AUTOVASTUS, RAHA } from '../lib/eelfilter.mjs';
import {open} from '../lib/db.mjs';
import {migrateAgent} from '../lib/agentdb.mjs';
import {migrateSales} from '../lib/salesdb.mjs';
import {planConductor} from '../agent/conductor.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (n, c, m = '') => { if (c) { pass++; console.log('  ok  ', n, m ? ` ${m}` : ''); } else { fail++; console.log('  FAIL', n, m ? ` ${m}` : ''); } };
const S = new Set(['klient.ee']);
const f = (m) => eelfilter(m, S);

console.log('\nEELFILTER (tasuta triaaz enne mudelit)');

// --- saast ---
ok('masinaadress võõrast domeenist läheb tasuta', f({ addr: 'noreply@uudised.ee', subject: 'Uudiskiri' })?.category === 'uudiskiri');
ok('automaatvastus läheb tasuta', f({ addr: 'x@a.ee', subject: 'Auto: Automaatvastus' })?.category === 'ramps');
ok('ingliskeelne out-of-office läheb tasuta', f({ addr: 'x@a.ee', subject: 'Vs: Out of office' })?.category === 'ramps');
ok('List-Unsubscribe päis läheb tasuta',
  f({ addr: 'n@x.com', subject: 'Weekly', headers: 'List-Unsubscribe: <mailto:x>' })?.category === 'uudiskiri');

// --- RAHA ei lahe KUNAGI labi ---
// Sünteetilised arve- ja maksemeeldetuletused säilivad sõltumata saatja kujust.
{
  const rahakirjad = [
    '[Näidisveebi arveldus] Meeldetuletus Testettevõte OÜ tasumata arve',
    'Invoice #123 overdue',
    'Teie tellimus on teel',
    'Maksetähtaeg läheneb',
    'Payment receipt',
    'Leping pikeneb automaatselt',
  ];
  ok('ükski raha-kiri ei lähe eelfiltrist läbi',
    rahakirjad.every((s) => f({ addr: 'no-reply@billing.example.test', subject: s }) === null),
    'need TULEVADKI masinaadressilt — see on nende normaalne kuju');
  ok('raha-muster on olemas ja lai', RAHA.test('arve') && RAHA.test('invoice') && RAHA.test('meeldetuletus'));
}

// --- klient ei lahe KUNAGI labi ---
ok('päris vastus meie kliendilt läheb mudelile', f({ addr: 'katre@klient.ee', subject: 'Re: pakkumine' }) === null);
ok('masinaadress MEIE kliendi domeenist läheb mudelile',
  f({ addr: 'noreply@klient.ee', subject: 'Re: teie kiri' }) === null,
  'vastus võib tulla ka info@ või noreply-kujulisest postkastist');
ok('päring läheb mudelile', f({ addr: 'm@firma.ee', subject: 'Küsimus hinna kohta' }) === null);
ok('tundmatu aadress ilma tunnuseta läheb mudelile', f({ addr: 'keegi@vorgus.ee', subject: 'Tere' }) === null);
ok('vigane aadress ei lõhu midagi', f({ addr: '', subject: 'x' }) === null && f({}) === null);

// --- konduktor kasutab seda ENNE mudelit ---
{
  const c = readFileSync(join(ROOT, 'agent', 'conductor.mjs'), 'utf8');
  ok('konduktor impordib eelfiltri', /from '\.\.\/lib\/eelfilter\.mjs'/.test(c));
  const fixture=open({dbPath:':memory:'});migrateAgent(fixture);migrateSales(fixture);
  fixture.prepare("INSERT INTO messages(mailbox,uid,ts,addr,subject,body_text) VALUES('INBOX',1,?,'noreply@example.test','Uudiskiri','Weekly news')").run(new Date().toISOString());
  const plan=planConductor(fixture);
  ok('eelfilter eemaldab automaatkirja enne mudelitöö planeerimist',plan.prefilter.length===1&&plan.jobs.length===0);
  ok('eelfiltri planeerimine ei muuda kirja',fixture.prepare('SELECT classified FROM messages').get().classified===0);
  fixture.close();
  ok('konduktor ei kirjuta oma reeglikoopiat', !/isMachine\(/.test(c) || /eelfilter/.test(c));
}

// --- automaatvastuse muster ei ole liiga lai ---
ok('"Automaatika uudised" EI ole automaatvastus', !AUTOVASTUS.test('Automaatika uudised'));
ok('"Re: Auto müük" EI ole automaatvastus', !AUTOVASTUS.test('Re: Auto müük'),
  'muidu kaob iga autokaubandusega seotud kiri');
ok('"Test Auto pakkumine" EI ole automaatvastus', !AUTOVASTUS.test('Test Auto pakkumine'),
  'sünteetiline autoteenuse pakkumine');
ok('"Autoteenindus Pärnus" EI ole automaatvastus', !AUTOVASTUS.test('Autoteenindus Pärnus'));
ok('päris automaatvastused tabatakse ikka',
  ['Auto: Re: x', 'Automaatvastus/Autoreply', 'Vs: Out of office', 'Olen puhkusel kuni 20.09']
    .every((x) => AUTOVASTUS.test(x)));

console.log(`\n  ${pass} labitud, ${fail} labi kukkunud\n`);
if (fail) process.exit(1);
