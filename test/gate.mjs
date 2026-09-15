// CRM värav: käivitab serveri vabal pordil, kontrollib API kuju, horisontaalset kerimist
// 390 px juures, konsoolivigu ja allkirja ehitust. Sama loogika mis leisson.eu tests/gates.mjs.
// Playwright tuleb repo juurest (../node_modules). Jooksuta: npm test
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { open } from '../lib/db.mjs';
import { migrateAgent } from '../lib/agentdb.mjs';
import { existsSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { ROOT } from '../lib/env.mjs';

const require = createRequire(join(ROOT, '..', 'package.json'));
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright puudub repo juures (../node_modules/playwright). UI-väravat ei saa kontrollida.');
  process.exit(1);
}

const PORT = 4300 + Math.floor(Math.random() * 90);
const fails = [];
const ok = (s) => console.log('  OK    ' + s);
const bad = (s) => { fails.push(s); console.log('  VIGA  ' + s); };

// .env peab olemas olema; kui pole, teeme ajutise (ühendusi ei tehta)
const envPath = join(ROOT, '.env');
let tempEnv = false;
if (!existsSync(envPath)) {
  writeFileSync(envPath, [
    'ACCOUNTS=gate',
    'DEFAULT_ACCOUNT=gate',
    'ACC_GATE_USER=gate@example.invalid',
    'ACC_GATE_PASS=gate',
    'ACC_GATE_NAME=Gate',
    `CRM_PORT=${PORT}`,
    'POLL_MINUTES=999',
  ].join('\n') + '\n');
  tempEnv = true;
}

// Disposable fixtures preserve the original API/layout checks without reading or changing sales data.
const fixtureDir=mkdtempSync(join(tmpdir(),'leisson-crm-ui-gate-'));
const fixtureDb=join(fixtureDir,'fixture.sqlite');
const fixture=open({dbPath:fixtureDb});
migrateAgent(fixture);
const stamp=new Date().toISOString();
const meeting=new Date(Date.UTC(new Date().getFullYear(),8,15));
while([0,6].includes(meeting.getUTCDay()))meeting.setUTCDate(meeting.getUTCDate()+1);
const meetingLabel=['P','E','T','K','N','R','L'][meeting.getUTCDay()]+' '+String(meeting.getUTCDate()).padStart(2,'0')+'.'+String(meeting.getUTCMonth()+1).padStart(2,'0');
const letter='Tere! See on eraldatud liidesekatse kiri. '+('Kontrollime kokkulepitud töömahtu ja kontaktivormi kasutatavust. '.repeat(12))+' Olen '+meetingLabel;
const insert=fixture.prepare('INSERT INTO companies(id,name,email,priority,price,offer,body,subject,status,meet_day,lang,listid,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
let number=0;
for(const [priority,count] of [['A',16],['B',12],['C',2],['P',12],['R',2]])for(let i=0;i<count;i++){
  number++;
  insert.run('fixture-'+number,'Fixture Company '+String(number).padStart(2,'0'),'fixture'+number+'@example.invalid',priority,290,'Päringuteekond korda',letter,'Fixture proposal','ootel',meetingLabel,'et',['parnu','parnu2','plaan'][number%3],stamp);
}
fixture.prepare("INSERT INTO messages(account,mailbox,uid,msgid,ts,addr,subject,company_id,unread,body_text,identity_status,source_id,category,classified,reply_intent) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .run('gert','INBOX',901,'<fixture-901@example.invalid>',stamp,'reply@example.invalid','Fixture reply','fixture-1',1,letter,'current','a'.repeat(64),'vastus_pakkumisele',1,'interested');
fixture.prepare('INSERT INTO drafts(account,uid,company_id,subject,body,status,reason,edit_notes,created,requested) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run('gert',901,'fixture-1','Re: Fixture reply',letter,'ootab_kinnitust','Kontrollitud katsepõhjendus. '.repeat(30),'Katsekeeletoimetus. '.repeat(20),stamp,stamp);
fixture.close();

const srv = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, CRM_PORT:String(PORT), CRM_DB_PATH:fixtureDb, CRM_NO_SEED:'1', CRM_NO_POLL:'1', POLL_MINUTES:'999' },
  windowsHide:true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvOut = '';
srv.stdout.on('data', (d) => { srvOut += d; });
srv.stderr.on('data', (d) => { srvOut += d; });

async function waitUp(ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/state`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server ei tõusnud: ' + srvOut.slice(-400));
}

let code = 0;
try {
  console.log('\nLEISSON CRM gate\n');
  const state = await waitUp();
  if (state.companies?.length >= 30) ok(`API annab ${state.companies.length} ettevõtet`);
  else bad('API ei anna vähemalt 30 ettevõtet');

  const withLetter = state.companies.filter((c) => c.body && c.subject).length;
  if (withLetter >= 42) ok(`${withLetter} ettevõttel on kiri ette valmistatud`);
  else bad(`ainult ${withLetter} ettevõttel on kiri (oodatud >= 42)`);

  for (const [p, n] of [['A', 16], ['B', 12], ['C', 2], ['P', 12]]) {
    const got = state.companies.filter((c) => c.priority === p && c.body).length;
    if (got >= n) ok(`${p}-prioriteet: ${got} kirja`);
    else bad(`${p}-prioriteet: ${got} kirja (oodatud >= ${n})`);
  }

  if (state.accounts?.length >= 1) ok(`${state.accounts.length} konto(t) seadistatud: ${state.accounts.map((a) => a.id).join(', ')}`);
  else bad('API ei anna ühtegi kontot');
  if (state.pollMinutes > 0) ok(`automaatkontroll iga ${state.pollMinutes} min`);
  else bad('pollMinutes puudub');

  const aNoEmail = state.companies.filter((c) => c.priority === 'A' && !c.email && !c.email_note);
  if (!aNoEmail.length) ok('igal A-sihtmärgil on kas e-post või selgitus, miks seda pole');
  else bad('A-sihtmärgid ilma kontaktita ja ilma selgituseta: ' + aNoEmail.map((c) => c.name).join(', '));

  // Kohtumispaev peab vastama PARIS kalendrile ja olema toopaev.
  // Pohjus: kasitsi kirjutatud paevatabelis olid koik uheksa paeva uhe vorra
  // nihkes ("E 15.09", kuigi 15.09.2026 on teisipaev) ja uks kant sattus
  // laupaevale. Kiri, mis kutsub valel nadalapaeval, poletab usalduse ara.
  {
    const ET = ['P', 'E', 'T', 'K', 'N', 'R', 'L']; // getDay(): 0 = pühapäev
    const aasta = new Date().getFullYear();
    const vigased = [];
    for (const c of state.companies) {
      const m = /^([ETKNRLP])\s+(\d{2})\.(\d{2})/.exec(c.meet_day || '');
      if (!m) continue;
      const d = new Date(Date.UTC(aasta, Number(m[3]) - 1, Number(m[2])));
      const oige = ET[d.getUTCDay()];
      if (oige !== m[1]) vigased.push(`${c.name}: "${c.meet_day}" on tegelikult ${oige}`);
      else if (oige === 'L' || oige === 'P') vigased.push(`${c.name}: "${c.meet_day}" on nädalavahetus`);
    }
    if (!vigased.length) ok('iga kohtumispäev vastab kalendrile ja on tööpäev');
    else bad('vale nädalapäev: ' + vigased.slice(0, 4).join(' · ') + (vigased.length > 4 ? ` (+${vigased.length - 4})` : ''));

    // Kiri ei tohi lubada muud paeva kui rida ise.
    const lahku = state.companies.filter((c) => c.meet_day && c.body && !c.body.includes(c.meet_day)
      && /Olen\s+[ETKNRLP]\s+\d{2}\.\d{2}/.test(c.body));
    if (!lahku.length) ok('kirja tekstis lubatud päev on sama mis kirje päev');
    else bad('kirjas on muu päev kui kirjel: ' + lahku.slice(0, 3).map((c) => c.name).join(', '));
  }

  const sig = await (await fetch(`http://127.0.0.1:${PORT}/api/signature`)).json();
  if (sig.html && sig.html.length > 1500 && !/rgba\(/.test(sig.html)) ok('allkiri ehitatud tokenitest, rgba lahendatud hex-iks');
  else bad('allkirja ehitus katki või sisaldab rgba-d (Outlook ei toeta)');
  if (sig.text?.includes('@')) ok('allkirjal on ka tekstiversioon');
  else bad('allkirja tekstiversioon puudub');

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    // 2650 x 1600 on Gerti paris ekraan - see on esimene mootmine, mitte jarelmoode.
    for (const [w, h, label] of [[2650, 1600, 'tööjaam'], [1440, 960, 'desktop'], [390, 844, 'mobiil']]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'et-EE' });
      const origin='http://127.0.0.1:'+PORT;
      await ctx.route('**/*',route=>{const request=route.request();if(new URL(request.url()).origin!==origin)return route.abort();if(request.method()==='POST' && new URL(request.url()).pathname!=='/api/message/body')throw new Error('UI gate attempted mutation: '+request.url());return route.continue();});
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const src = (m.location && m.location().url) || '';
        // väline ressurss (fondid) ei ole CRM-i viga — konteineris on egress kinni
        if (/fonts\.googleapis|fonts\.gstatic|favicon/.test(src + m.text())) return;
        if (src && !/127\.0\.0\.1|localhost/.test(src)) return;
        errors.push(m.text() + (src ? ' <- ' + src : ''));
      });
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
      await page.locator('#companyShortcut').click();
      await page.waitForSelector('#list .row', { timeout: 8000 });
      await page.locator('#list .row').first().click();
      await page.waitForTimeout(600);
      const m = await page.evaluate(() => {
        const d = document.documentElement;
        const foot = document.querySelector('#detail .panel-foot .btn');
        const r = foot ? foot.getBoundingClientRect() : null;
        return {
          sw: d.scrollWidth, cw: d.clientWidth,
          sh: d.scrollHeight, ch: d.clientHeight,
          panels: document.querySelectorAll('.panel').length,
          body: (document.querySelector('textarea') || {}).value?.length || 0,
          side: document.querySelectorAll('#detailSide .panel').length,
          footIn: !!r && r.bottom <= window.innerHeight + 1 && r.top >= 0,
          // Miski ei tohi akna paremast servast valja ulatuda. See tabab ka
          // vaikset viga, mida documentElement.scrollWidth ei nae, kui vanem
          // kast on overflow:hidden - sisu on siis lihtsalt ara loigatud.
          ulatub: [...document.querySelectorAll('main:not([hidden]) *')]
            .filter((n) => n.getBoundingClientRect().right > window.innerWidth + 1)
            .slice(0, 4).map((n) => n.tagName.toLowerCase() + '.' + (n.className || '')),
        };
      });
      if (m.sw <= m.cw) ok(`${label} ${w}px: horisontaalset kerimist ei ole`);
      else bad(`${label} ${w}px: scrollWidth ${m.sw} > ${m.cw}`);
      // Muugitoru ei tohi kerida KUMMASKI suunas - kerivad ainult kastid.
      // Telefonis (alla 820 px) on see vale eesmark: seal kerib leht tavaliselt.
      const lauaarvuti = w >= 1180;
      if (!lauaarvuti) ok(`${label} ${w}px: telefonivaade, püstkerimine on lubatud`);
      else if (m.sh <= m.ch + 1) ok(`${label} ${w}px: püstsuunas kerimist ei ole`);
      else bad(`${label} ${w}px: scrollHeight ${m.sh} > ${m.ch}`);
      if (m.panels >= 4) ok(`${label}: neli paneeli renderdatud`);
      else bad(`${label}: paneele ainult ${m.panels}`);
      if (m.side >= 3) ok(`${label}: parem tulp kannab leidu, pakkumist ja logi (${m.side})`);
      else bad(`${label}: paremas tulbas ainult ${m.side} paneeli`);
      if (!lauaarvuti) ok(`${label}: saatmisnupp voolus (telefon)`);
      else if (m.footIn) ok(`${label}: "Saada kiri" on jalusena ekraanil`);
      else bad(`${label}: saatmisnupp ei ole ekraanil`);
      if (!m.ulatub.length) ok(`${label}: ükski kast ei ulatu ekraanist välja`);
      else bad(`${label}: ekraanist välja ulatub ${m.ulatub.join(', ')}`);

      // postkasti vaade
      await page.click('.view-tab[data-view="inbox"]');
      await page.waitForTimeout(400);
      const inbox = await page.evaluate(() => ({
        visible: !document.getElementById('viewInbox').hidden,
        pipelineHidden: document.getElementById('viewPipeline').hidden,
        chips: document.querySelectorAll('#mailChips .chip').length,
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      if (inbox.visible && inbox.pipelineHidden) ok(`${label}: postkasti vaade avaneb`);
      else bad(`${label}: postkasti vaade ei avane`);
      if (inbox.chips >= 3) ok(`${label}: postkasti filtrid renderdatud (${inbox.chips})`);
      else bad(`${label}: postkasti filtreid ainult ${inbox.chips}`);
      if (inbox.sw <= inbox.cw) ok(`${label}: postkastis hscroll = 0`);
      else bad(`${label}: postkastis scrollWidth ${inbox.sw} > ${inbox.cw}`);

      // MUSTANDI LOETAVUS: kiri, mille sa kohe valja saadad, peab olema ekraanil
      // ENNE pohjendust. Varem lukkas agendi pikk selgitus "Pealkiri" ja "Sisu"
      // valjad ekraanist alla ja Gert ei naenud, mida ta saadab.
      {
        const avatud = await page.evaluate(() => {
          const tag = document.querySelector('#mailList .tag.draft');
          if (!tag) return false;
          tag.closest('button.row').click();
          return true;
        });
        if (!avatud) {
          ok(`${label}: mustandiga kirja ei ole postkastis — loetavuse kontroll vahele`);
        } else {
          await page.waitForTimeout(500);
          const r = await page.evaluate(() => {
            const bar = document.querySelector('#mailDetail .draftbar');
            const det = bar ? bar.querySelector('details.draft-why') : null;
            const lab = [...document.querySelectorAll('#mailDetail .panel.reply label')]
              .find((x) => /Pealkiri/i.test(x.textContent));
            const vali = lab ? lab.parentElement.querySelector('input, textarea') : null;
            const box = vali ? vali.getBoundingClientRect() : null;
            return {
              riba: !!bar,
              kokkuPandav: !!det,
              lahti: det ? det.open : null,
              ribaKorgus: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
              pealkiriTop: box ? Math.round(box.top) : null,
              pealkiriNahtav: !!box && box.top >= 0 && box.top < window.innerHeight,
              aken: window.innerHeight,
            };
          });
          if (!r.riba) bad(`${label}: mustandiriba ei renderdunud`);
          else {
            if (r.kokkuPandav) ok(`${label}: agendi selgitus on kokkupandav`);
            else bad(`${label}: agendi selgitus ei ole kokkupandav — lükkab kirja alla`);
            if (r.lahti === false) ok(`${label}: selgitus on vaikimisi kinni`);
            else bad(`${label}: selgitus on vaikimisi lahti (open=${r.lahti})`);
            // Telefonis kerib leht tavaliselt (vt ulalpool) - seal ei ole "ekraanil"
            // oige eesmark. Lauaarvutis on: seal ei tohi midagi kirja alla lukata.
            if (!lauaarvuti) ok(`${label}: telefonivaade, kirja valjad kerimise taga on lubatud`);
            else if (r.pealkiriNahtav) ok(`${label}: saadetava kirja pealkiri on ekraanil (${r.pealkiriTop}/${r.aken} px)`);
            else bad(`${label}: kirja pealkiri EI OLE ekraanil (top ${r.pealkiriTop}, aken ${r.aken})`);
            if (r.ribaKorgus <= r.aken * 0.45) ok(`${label}: mustandiriba ei võta üle 45% ekraanist (${r.ribaKorgus} px)`);
            else bad(`${label}: mustandiriba ${r.ribaKorgus} px ehk üle 45% aknast ${r.aken} px`);

            // MOODETUD 14.09.2026: vastusekast kahanes 1440x960 juures nii, et
            // tekstivali oli 26 px ja jai kleepuva jaluse taha. overflow oli
            // "visible" - sisu loigati ara ja kerida EI SAANUD. Kolm vaidet,
            // et see tagasi ei tuleks.
            const v = await page.evaluate(() => {
              const rep = document.querySelector('#mailDetail .panel.reply');
              if (!rep) return null;
              const ta = rep.querySelector('textarea');
              rep.scrollTop = rep.scrollHeight;
              return new Promise((res) => setTimeout(() => {
                const f = rep.querySelector('.panel-foot').getBoundingClientRect();
                const t = ta.getBoundingClientRect();
                res({
                  kerib: getComputedStyle(rep).overflowY,
                  mahub: rep.scrollHeight <= rep.clientHeight,
                  keritud: Math.round(rep.scrollTop),
                  valiKorgus: Math.round(t.height),
                  jalusEkraanil: f.bottom <= window.innerHeight + 1 && f.top >= 0,
                  jalusTaga: Math.round(Math.max(0, t.bottom - f.top)),
                  tahti: ta.value.length,
                });
              }, 250));
            });
            if (!v) bad(`${label}: vastusekasti ei leitud`);
            else if (!lauaarvuti) ok(`${label}: telefonivaade, vastusekasti kerimist ei kontrollita`);
            else {
              if (v.kerib === 'auto' || v.kerib === 'scroll') ok(`${label}: vastusekast kerib ise, sisu ei lõigata`);
              else bad(`${label}: vastusekasti overflow-y on "${v.kerib}" — sisu lõigatakse ära ja kerida ei saa`);
              if (v.valiKorgus >= 120) ok(`${label}: kirja tekstiväli on loetav (${v.valiKorgus} px)`);
              else bad(`${label}: kirja tekstiväli ainult ${v.valiKorgus} px — kirja ei saa lugeda`);
              if (v.jalusEkraanil) ok(`${label}: jalus jääb ka pärast kerimist ekraanile`);
              else bad(`${label}: jalus kadus pärast kerimist ekraanilt`);
              if (!v.jalusTaga) ok(`${label}: tekstiväli ei jää jaluse taha peitu`);
              else bad(`${label}: tekstiväli ulatub ${v.jalusTaga} px jaluse alla`);
              if (v.mahub || v.keritud > 0) ok(`${label}: kogu kiri on kättesaadav (keritud ${v.keritud} px)`);
              else bad(`${label}: sisu ei mahu ja kerimine ei liigu — kiri on kättesaamatu`);
            }
          }
        }
      }

      // Neli laia vaadet peavad samuti tais laiuses ja ilma kulgkerimiseta olema.
      for (const v of ['stats', 'services', 'billing', 'agents']) {
        await page.click(`.view-tab[data-view="${v}"]`);
        await page.waitForTimeout(450);
        const r = await page.evaluate((vv) => {
          const d = document.documentElement;
          const host = document.getElementById('view' + vv[0].toUpperCase() + vv.slice(1));
          const sheet = host?.querySelector('.sheet');
          return {
            sw: d.scrollWidth, cw: d.clientWidth,
            lapsi: sheet ? sheet.children.length : 0,
            laius: sheet ? Math.round(sheet.getBoundingClientRect().width) : 0,
          };
        }, v);
        if (r.sw <= r.cw) ok(`${label}: vaade ${v} — hscroll = 0`);
        else bad(`${label}: vaade ${v} — scrollWidth ${r.sw} > ${r.cw}`);
        if (r.lapsi >= 2) ok(`${label}: vaade ${v} — ${r.lapsi} plokki`);
        else bad(`${label}: vaade ${v} — ainult ${r.lapsi} plokki`);
        // Tais laius: sisu ei tohi jaada kitsasse keskmisse ribasse.
        if (w < 1200 || r.laius >= r.cw * 0.85) ok(`${label}: vaade ${v} — täislaius (${r.laius}/${r.cw})`);
        else bad(`${label}: vaade ${v} — sisu ainult ${r.laius} px ekraanist ${r.cw} px`);
      }

      await page.click('.view-tab[data-view="pipeline"]');
      await page.waitForTimeout(250);
      if (m.body > 200) ok(`${label}: kirja sisu laetud (${m.body} tm)`);
      else bad(`${label}: kirja tekstiväli tühi`);
      if (!errors.length) ok(`${label}: konsoolivigu ei ole`);
      else bad(`${label}: konsoolivead — ${errors.slice(0, 3).join(' | ')}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
} catch (e) {
  bad('värav kukkus: ' + e.message);
} finally {
  if(srv.exitCode===null){const closed=once(srv,'exit');srv.kill();await closed;}
  // Remove only this run's owned directory directly under the resolved temporary root.
  if(dirname(resolve(fixtureDir))!==resolve(tmpdir()) || !basename(fixtureDir).startsWith('leisson-crm-ui-gate-'))throw new Error('Unsafe fixture cleanup path');
  rmSync(fixtureDir,{recursive:true,force:true});
  if (tempEnv) {
    try { unlinkSync(envPath); } catch {}
  }
}

console.log(fails.length ? `\n${fails.length} viga.\n` : '\nKõik väravad rohelised.\n');
process.exit(fails.length ? 1 : 0);
