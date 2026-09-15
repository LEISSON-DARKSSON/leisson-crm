// Muugimootori ja massitoo varavad. Need kontrollivad PARIS kaitumist -
// mitte regexiga koodi, vaid funktsioonide ja renderdatud dokumendi peal.
import { open } from '../lib/db.mjs';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { migrateSales, nextNumber, createOffer, createInvoice, deleteDoc, docList } from '../lib/salesdb.mjs';
import { migrateAgent } from '../lib/agentdb.mjs';
import { bulkGate, isMachine, TASKS } from '../lib/gates.mjs';
import { renderInvoice, renderOffer, VAT_REGISTERED } from '../lib/doc.mjs';
import { LOGO } from '../lib/logo.mjs';
import { buildSignature } from '../lib/signature.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, note = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  VIGA ' + name + (note ? ' — ' + note : '')); }
};

/* --- ajutine andmebaas, et paris CRM-i ei maariks --- */
// Ajutine baas OS-i tmp-kausta: monteeritud kettal ei tooeta SQLite lukustust.
const TMP = join(tmpdir(), 'leisson-gate-sales-'+process.pid+'-'+Date.now()+'.sqlite');
for (const f of [TMP, TMP + '-wal', TMP + '-shm']) if (existsSync(f)) unlinkSync(f);
const db = open({dbPath:TMP});
migrateAgent(db);
migrateSales(db);

console.log('\nMUUGIMOOTOR JA MASSITOO');

/* 1. numbriseeria: jarjestikune, kordumatu, ilma auguta */
{
  const got = [];
  for (let i = 0; i < 40; i++) got.push(nextNumber(db, 'arve', new Date('2026-09-13')));
  const nums = got.map((x) => Number(x.split('-')[1]));
  const gapless = nums.every((n, i) => n === i + 1);
  ok('arve number on jarjestikune ja ilma auguta', gapless, got.slice(0, 3).join(','));
  ok('arve number on kordumatu', new Set(got).size === got.length);
  const p = nextNumber(db, 'pakkumine', new Date('2026-09-13'));
  ok('pakkumisel on oma seeria (2026-P-001)', p === '2026-P-001', p);
  ok('tundmatu seeria annab vea', (() => { try { nextNumber(db, 'kviitung'); return false; } catch { return true; } })());
}

/* 2. pakkumine ja arve sünteetiliste andmetega */
db.prepare(`INSERT INTO companies (id,name,regcode,loc,email,url,priority,offer,price,finding,status)
  VALUES ('fixture-customer','Testettevõte OÜ','12345670','Näidise tee 1, Testlinn','contact@customer.example.test','https://customer.example.test',
          'A','Sünteetiline eritöö',1900,'Sünteetilise HTML-fixtuuri tähelepanek','ootel')`).run();
const off = createOffer(db, { company_id: 'fixture-customer' });
ok('pakkumine tekib toru kirjest', Boolean(off.number), JSON.stringify(off));
ok('sama ettevotte teine avatud pakkumine ei tee uut numbrit', createOffer(db, { company_id: 'fixture-customer' }).existing === true);
db.prepare("UPDATE offers SET state='kinnitatud', accepted=? WHERE id=?").run('2026-09-10T09:00:00Z', off.id);
const inv = createInvoice(db, { company_id: 'fixture-customer' });
ok('arve summa tuleb pakkumisest, mitte kasitsi', inv.total === 1900, String(inv.total));
ok('maksmata ettemaksu ei arvata tasutuks', inv.prepaid === 0 && inv.payable === 1900, JSON.stringify(inv));
ok('hinnata ettevottele pakkumist ei tehta', (() => {
  db.prepare("INSERT INTO companies (id,name,price,status) VALUES ('tyhi','Ilma hinnata',NULL,'ootel')").run();
  try { createOffer(db, { company_id: 'tyhi' }); return false; } catch { return true; }
})());

/* 3. A4 ja kaibemaks renderdatud dokumendi peal */
const invHtml = renderInvoice(db, inv.id);
const offHtml = renderOffer(db, off.id);
ok('arve on A4 portree 210x297 mm', /width:\s*210mm/.test(invHtml) && /min-height:\s*297mm/.test(invHtml) && /size:\s*A4 portrait/.test(invHtml));
ok('pakkumine on A4 portree 210x297 mm', /width:\s*210mm/.test(offHtml) && /min-height:\s*297mm/.test(offHtml));
ok('arvel on sama logo mis allkirjal', /LEISSON<\/span>\s*<span class="b">CREATIVE/.test(invHtml));
if (!VAT_REGISTERED) {
  ok('arvel EI OLE KMKR-rida', !/KMKR/i.test(invHtml));
  ok('arvel EI OLE kaibemaksurida ega "+ km"', !/\+\s*km\b/i.test(invHtml) && !/k(a|ä)ibemaksu(summa|m(a|ä)(a|ä)r)/i.test(invHtml));
  ok('arvel on valja oeldud, et kaibemaksu ei lisandu', /ei ole k(a|ä)ibemaksukohustuslane/i.test(invHtml));
}
ok('mustad pinnad, mitte hallid: tabelipais on 100% must', /thead th\{background:#000/.test(invHtml));
ok('arve valge paber, mitte hall', /\.sheet\{[^}]*background:#fff/.test(invHtml));
ok('halli tooni kasutatakse ainult mustal aluspinnal', (() => {
  const css = invHtml.slice(invHtml.indexOf('<style>'), invHtml.indexOf('</style>'));
  // ukski helehall taust ei tohi valgel paberil olla
  return !/background:\s*#(f|e|d|c|b|a|9|8|7)[0-9a-f]{5}\b/i.test(css.replace(/#fff\b/gi, '').replace(/#ffffff\b/gi, ''));
})());
ok('pakkumises on tingimused ja kehtivus valja oeldud', /kehtib/i.test(offHtml) && /Ettemaks/i.test(offHtml));

/* 3a. LUKK on uks ja sama igal pinnal */
// Sonamark oli varem kirjutatud kaks korda - arvel ja allkirjal. Kaks koopiat
// triivivad lahku ja esimene, kes marka, on klient. Nuud on ta lib/logo.mjs-is.
{
  const sig = buildSignature().html;
  ok('arvel on lukk lib/logo.mjs-ist', invHtml.includes(LOGO.a) && invHtml.includes(LOGO.b));
  ok('arvel on alarida', invHtml.includes(LOGO.sub), LOGO.sub);
  ok('pakkumisel on sama lukk ja sama alarida', offHtml.includes(LOGO.b) && offHtml.includes(LOGO.sub));
  ok('allkirjal on sama lukk ja sama alarida', sig.includes(LOGO.a) && sig.includes(LOGO.b) && sig.includes(LOGO.sub));
  // Tihe lukk: LEISSONi ja CREATIVE vahel ei ole tuhikut ega &nbsp;-d.
  ok('lukk on tihe, ilma tuhikuta', !/>\s*LEISSON\s*<\/span>\s+<span/.test(invHtml) && !/&nbsp;CREATIVE/.test(sig));
  // Alarida EI kanna enam registrikoodi; arvel on ta muuja plokis, kus RPS 7 seda nouab.
  ok('alarida ei kanna registrikoodi', !LOGO.sub.includes('16952932'));
  ok('registrikood on arvel ikka olemas (RPS 7)', /Registrikood\s*16952932/.test(invHtml));
  // Kumbki pind ei tohi lukku ise uuesti kirjutada.
  for (const f of ['lib/doc.mjs', 'lib/signature.mjs']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    ok(`${f} impordib luku, mitte ei kirjuta seda`,
      /from '\.\/logo\.mjs'/.test(src) && !new RegExp('[">]' + LOGO.b).test(src));
  }
}

/* 3b. 17 mm valge veeris kogu perimeetril */
// Must riba ei tohi ulatuda lehe servani: printer ei prindi sinna ja
// koik teadaolevad trukikojad nouavad vahemalt 10 mm. 17 mm on varuga.
for (const [nimi, html] of [['arve', invHtml], ['pakkumine', offHtml]]) {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  ok(`${nimi}: lehel on 17 mm valge veeris`, /\.sheet\{[^}]*padding:17mm/.test(css), css.slice(0, 0));
  ok(`${nimi}: sisu on omas raamis (.page)`, /class="page"/.test(html) && /\.page\{/.test(css));
  ok(`${nimi}: sisuraam on 297-2x17 = 263 mm korge`, /min-height:263mm/.test(css));
}

/* 3c. vaba ostja: dokument sellele, keda muugitorus ei ole */
{
  const enne = docList(db).length;
  const vabaOff = createOffer(db, {
    buyer: { name: 'Vaba Ostja OU', reg: '12345678', addr: 'Testi 1, Tallinn', email: 'a@b.ee' },
    title: 'Uhekordne too', price: 700,
  });
  ok('vaba ostja pakkumine tekib ilma muugitoru kirjeta', Boolean(vabaOff.number), JSON.stringify(vabaOff));
  const vabaHtml = renderOffer(db, vabaOff.id);
  ok('vaba ostja nimi on dokumendil', /Vaba Ostja OU/.test(vabaHtml));
  ok('vaba ostja registrikood on dokumendil', /12345678/.test(vabaHtml));
  ok('vaba ostja dokument on arhiivinimekirjas', docList(db).length === enne + 1
    && docList(db).some((d) => d.company === 'Vaba Ostja OU'));
  ok('nimeta vaba ostja lukatakse tagasi',
    (() => { try { createOffer(db, { buyer: { name: '' }, price: 10 }); return false; } catch { return true; } })());
  ok('hinnata vaba ostja lukatakse tagasi',
    (() => { try { createOffer(db, { buyer: { name: 'X' }, price: 0 }); return false; } catch { return true; } })());
  const vabaInv = createInvoice(db, { buyer: { name: 'Vaba Ostja OU' }, title: 'Uhekordne too', price: 700, prepaidPct: 0 });
  ok('vaba ostja arve summa tuleb sisestusest', vabaInv.total === 700 && vabaInv.payable === 700, JSON.stringify(vabaInv));
  ok('vaba ostja arvel on ostja nimi', /Vaba Ostja OU/.test(renderInvoice(db, vabaInv.id)));

  /* 3d. kustutamine: pakkumise voib alati, saadetud arvet mitte kunagi */
  ok('pakkumise saab kustutada', deleteDoc(db, 'pakkumine', vabaOff.id).ok === true);
  ok('kustutatud pakkumist ei ole enam arhiivis', !docList(db).some((d) => d.id === vabaOff.id && d.kind === 'pakkumine'));
  ok('saatmata arve saab kustutada', deleteDoc(db, 'arve', vabaInv.id).ok === true);
  ok('kustutatud arve read lahevad kaasa',
    db.prepare('SELECT COUNT(*) n FROM invoice_lines WHERE invoice_id=?').get(vabaInv.id).n === 0);
  db.prepare("UPDATE invoices SET sent=? WHERE id=?").run('2026-09-13T10:00:00Z', inv.id);
  ok('VALJA SAADETUD arvet ei kustutata',
    (() => { try { deleteDoc(db, 'arve', inv.id); return false; } catch (e) { return /tuhistatud/.test(e.message); } })());
  ok('valja saadetud arve on ikka arhiivis', docList(db).some((d) => d.kind === 'arve' && d.id === inv.id));
  ok('olematu dokumendi kustutus annab vea',
    (() => { try { deleteDoc(db, 'arve', 999999); return false; } catch { return true; } })());
  ok('tundmatu dokumendiliik lukatakse tagasi',
    (() => { try { deleteDoc(db, 'kviitung', 1); return false; } catch { return true; } })());
}

/* 4. massitoo varav: sama reeglistik mis konduktoril */
const isoDaysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const ins = db.prepare(`INSERT INTO messages (mailbox,uid,ts,addr,subject,account,category,urgency,
  classified,review,suspicious,replied,archived) VALUES (?,?,?,?,?,'gert',?,?,1,?,?,?,0)`);
ins.run('INBOX', 1, isoDaysAgo(2), 'no-reply@billing.example.test', 'Arve', 'klienditoo', 'korge', 0, 0, 0);
ins.run('INBOX', 2, isoDaysAgo(88), 'mari@customer.example.test', 'Vana tellimus', 'klienditoo', 'korge', 0, 0, 0);
ins.run('INBOX', 3, isoDaysAgo(1), 'anu@ettevote.ee', 'Paring', 'paring', 'korge', 0, 0, 0);
ins.run('INBOX', 4, isoDaysAgo(1), 'kahtlane@x.lt', 'Login', 'paring', 'korge', 0, 1, 0);
ins.run('INBOX', 5, isoDaysAgo(1), 'uudised@news.example.test', 'Weekly', 'uudiskiri', 'madal', 0, 0, 0);
ins.run('INBOX', 6, isoDaysAgo(1), 'teine@ettevote.ee', 'Kohtumine', 'kohtumine', 'keskmine', 0, 0, 0);
ins.run('INBOX', 7, isoDaysAgo(1), 'kolmas@ettevote.ee', 'Paring 2', 'paring', 'keskmine', 0, 0, 0);
ins.run('INBOX', 8, isoDaysAgo(1), 'neljas@ettevote.ee', 'Paring 3', 'paring', 'madal', 0, 0, 0);
db.prepare("UPDATE messages SET body_text='Soovin pakkumist kodulehele.',reply_intent='positive'").run();
const ids = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => 'INBOX:' + n);

const gM = bulkGate(db, 'mustand', ids);
const why = gM.why || {};
ok('varav loikab masinaadressi', gM.skip.some(m=>m.id==='INBOX:1' && /[Mm]asinaadress/.test(m.why)), JSON.stringify(why));
ok('varav loikab vanema kui 21 paeva kirja', gM.skip.some(m=>m.id==='INBOX:2' && /aegunud|21/.test(m.why)), JSON.stringify(why));
ok('varav loikab vastamatu kategooria', why['kategooria ei ole vastatav'] === 1, JSON.stringify(why));
ok('varav loikab kahtlase kirja', gM.skip.some(m=>m.id==='INBOX:4' && /ülevaatus/.test(m.why)), JSON.stringify(why));
ok('paevapiir loikab ulejaanud mustandid', gM.passN === gM.limits.maxDrafts, gM.passN + ' vs ' + gM.limits.maxDrafts);
ok('mustand kasutab tellimust ja ei esita ajaloolist API-hinda', gM.cost===0 && gM.billingMode==='chatgpt_subscription');
ok('mustand planeerib koostamise ja sõltuva toimetamise', gM.jobs === gM.passN * 2);

const gT = bulkGate(db, 'triaaz', ids);
ok('triaaz ei rakenda mustandi piiranguid', gT.passN === ids.length, gT.passN + '/' + ids.length);
// Hind tuleb lib/gates.mjs-ist, mitte siit - muidu on sama arv kahes kohas ja nad lahknevad.
ok('triaaz kasutab Luna medium mudelit olemasoleva tellimusega', gT.model==='gpt-5.6-luna / medium' && gT.billingMode==='chatgpt_subscription' && gT.cost===0);
ok('vana Haiku API hinda ei kanta uuele töötajale', TASKS.triaaz.unit===0);
ok('mudelivaba too maksab null', bulkGate(db, 'grupeeri', ids).cost === 0);
ok('kustutus nouab eraldi kinnitust', bulkGate(db, 'kustuta', ids).needsConfirm === true);
ok('tundmatu ulesanne lukatakse tagasi', Boolean(bulkGate(db, 'saada_kiri', ids).error));
ok('masin-saatja tuvastus kaib uhest kohast', isMachine('no-reply@billing.example.test') && isMachine('newsletter@x.ee') && !isMachine('anu@ettevote.ee'));
ok('massitoo ulesannete hulgas EI OLE saatmist', !Object.keys(TASKS).some((t) => /saada|send|kampaania/i.test(t)));

/* 5. UKS varavareeglistik: konduktor ei defineeri oma koopiat */
{
  const c = readFileSync(join(ROOT, 'agent', 'conductor.mjs'), 'utf8');
  ok('konduktor impordib lib/gates.mjs-ist', /from '\.\.\/lib\/gates\.mjs'/.test(c));
  ok('konduktoris ei ole oma masin-regexi koopiat', !/const MASIN\s*=/.test(c));
  ok('konduktoris ei ole oma VASTATAVAD koopiat', !/const VASTATAVAD\s*=/.test(c));
}

/* 6. agendil ei ole saatmis- ega kustutustooriista (elav tooriistanimekiri) */
const tools = await new Promise((res) => {
  const p = spawn(process.execPath, [join(ROOT, 'agent', 'mcp-server.mjs')], {
    env: { ...process.env, CRM_AGENT_MODE: 'write', CRM_DB_PATH: TMP }, stdio: ['pipe', 'pipe', 'ignore'],
  });
  let buf = '';
  p.stdout.on('data', (d) => { buf += d; });
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  setTimeout(() => {
    p.kill();
    try {
      // NB initialize vastus sisaldab samuti sona "tools" (capabilities) -
      // otsi id jargi, mitte teksti jargi. See viga puudis varav ise kinni.
      const line = buf.trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .find((m) => m && m.id === 2 && m.result && Array.isArray(m.result.tools));
      res(line.result.tools.map((t) => t.name));
    } catch { res([]); }
  }, 1200);
});
ok('MCP write-rezhiim serveerib tooriistu', tools.length === 7, tools.join(','));
const KEELATUD = ['send_letter', 'send_mail', 'send_message', 'delete_message', 'delete_messages',
  'approve_campaign', 'resume_campaign', 'set_price', 'archive_message'];
ok('agendil EI OLE saatmis- ega kustutustooriista', !tools.some((t) => KEELATUD.includes(t)),
  tools.filter((t) => KEELATUD.includes(t)).join(','));
ok('mudelil puuduvad kõik CRM-i kirjutavad tööriistad', !tools.some(t=>['group_messages','suppress_sender','save_draft','save_edit','classify_message','request_send_approval'].includes(t)));

/* 7. dokumentatsioon: iga write-tooriist on agent/README.md-s nimetatud */
{
  const readme = readFileSync(join(ROOT, 'agent', 'README.md'), 'utf8');
  const puudu = tools.filter((t) => !readme.includes(t));
  ok('iga MCP-tooriist on agent/README.md-s nimetatud', puudu.length === 0, 'puudu: ' + puudu.join(', '));
}

db.close();
for (const f of [TMP, TMP + '-wal', TMP + '-shm']) if (existsSync(f)) unlinkSync(f);

console.log(`\n  ${pass} labitud, ${fail} labi kukkunud\n`);
if (fail) process.exit(1);
