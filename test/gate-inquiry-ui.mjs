// Isolated browser UI: serves fixtures, never opens CRM SQLite or any mailbox.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { CATALOG, activeServices } from '../../packages/service-catalog/index.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const source='a'.repeat(64), writes=[];
const company={id:'fixture',name:'Fixture Company',email:'owner@example.test',priority:'A',status:'ootel',sales_state:'research',
  price:290,body:'Fixture text',subject:'Fixture subject',account:'legacy',need_evidence:'Owner asked for help',listid:'parnu'};
const message={account:'legacy',mailbox:'INBOX',uid:1,ts:'2026-09-15T10:00:00Z',addr:'site@leisson.eu',subject:'Fixture inquiry',source_id:source,
  company_id:null,has_body:true,unread:1,classified:0};
const fixture={
  csrfToken:'fixture',accounts:[{id:'gert',user:'gert@leisson.eu'},{id:'legacy',user:'leisson@leisson.eu'}],
  salesAccounts:[{id:'gert',user:'gert@leisson.eu'}],defaultAccount:'legacy',pollMinutes:30,
  counts:{ootel:1,kiri:0,kohtumine:0,pakkumine:0,voidetud:0,ei:0},statuses:['ootel','kiri','ei'],statusLabels:{ootel:'Ootel',kiri:'Kiri',ei:'Ei'},
  companies:[company],messages:[message],activity:[],drafts:[],docs:[],services:activeServices(),catalogVersion:CATALOG.version,revenue:{},
  revenueWorkbench:{available:true,mailbox:'gert@leisson.eu',generatedAt:'2026-09-15T12:00:00Z',
    summary:{businesses:3,confirmedBuyers:0,reviewOnlyDrafts:2,sent:0,scheduled:0},
    prospects:[
      {companyId:'fixture',company:'Fixture Company',crmStatus:'ootel',priority:'First research candidate',officialUrl:'https://example.test/',email:'owner@example.test',contactVerification:'Public business address',outreachPermission:'unverified',currentNeedConfirmed:false,receivedInterest:false,
        observations:[{id:'F-1',statement:'Observed link destination.',notProven:'No purchase intent proven.'}],questions:[{question:'Should this link be corrected?',nextVerification:'Confirm the need first.'}],nextAction:'Owner reviews the need question.',
        draft:{from:'gert@leisson.eu',to:'owner@example.test',subject:'Fixture question',body:'<img src=x onerror=alert(1)> Review-only body.',approved:false,scheduled:false,sendable:false}},
      {companyId:'fixture-two',company:'Second Business',crmStatus:'ootel',priority:'Second research candidate',email:'second@example.test',currentNeedConfirmed:false,receivedInterest:false,observations:[],questions:[],nextAction:'Check the need.',
        draft:{from:'gert@leisson.eu',to:'second@example.test',subject:'Second question',body:'Second review-only body.',approved:false,scheduled:false,sendable:false}},
      {companyId:'fixture-three',company:'Third Business',crmStatus:'ootel',priority:'Wait for evidence',email:'third@example.test',currentNeedConfirmed:false,receivedInterest:false,observations:[],questions:[],nextAction:'Collect current evidence.',draft:null,draftOmissionReason:'Current evidence is missing.'},
    ]},
  webInquiries:[{source_id:'leisson.eu:fixture',first_mail_source_id:source,name:'Fixture Owner',company:'Fixture Company',email:'owner@example.test',
    service_id:'inquiry-repair',catalog_version:CATALOG.version,scope:'Päringuteekond korda',status:'needs_review',message:'<img src=x onerror=alert(1)> Need a form repair.',
    first_imported_at:'2026-09-15T10:00:00Z',reply_to_mismatch:0}],
  proUXLeads:[{source_id:'proux-fixture',intent:'result_followup',email:'audit@example.test',message:'Only send the audit result.',
    audit_reference:'https://prouxaudit.com/dashboard/audits/fixture',local_status:'unreviewed',upstream_status:'new',source_created_at:'2026-09-15T09:00:00Z'}],
};
const json=(res,data)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));};
const files={'/':'index.html','/app.js':'app.js','/views.js':'views.js','/app.css':'app.css','/crm2.css':'crm2.css','/agent.css':'agent.css','/leisson.svg':'leisson.svg'};
const server=createServer(async(req,res)=>{
  if(req.url==='/api/state')return json(res,fixture);
  if(req.url==='/api/stats')return json(res,{pipeline:[{status:'ootel',eur:290,n:1}],offers:[],priority:[],categories:[],runs:[],sent:0,letters:1,classified:1,unclassified:736,confidence:0.8,highOpen:0,spentTotal:0,bodies:736,messages:737,limits:{maxDrafts:5,maxAgeDays:21},invoices:[],offersDocs:[],review:0,suspicious:0});
  if(req.method==='POST') {
    writes.push(req.url);
    if(req.url==='/api/inquiry/message')return json(res,{message:{...message,body_text:'Original fixture body',body_truncated:0}});
    if(req.url==='/api/message/body')return json(res,{text:'Original fixture body'});
    res.writeHead(400);return res.end('Unexpected mutation');
  }
  try {
    const file=req.url==='/orbit.css' ? new URL('../../packages/orbit-tokens/dist/orbit.css',import.meta.url)
      : files[req.url] ? new URL('../public/'+files[req.url],import.meta.url) : null;
    if(!file)throw new Error('missing');
    res.writeHead(200,{'content-type':req.url?.endsWith('.js')?'application/javascript':req.url?.endsWith('.css')?'text/css':'text/html'});
    res.end(await readFile(file));
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch().catch(()=>chromium.launch({channel:'chrome'}));
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort());
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);
  await page.locator('#workbenchShortcut').waitFor();
  assert.equal(await page.locator('#list [data-workbench-list]').count(),3);
  assert.equal(await page.locator('#detail [data-workbench-prospect]').count(),1);
  assert.equal(await page.locator('#detail [data-workbench-draft]').count(),1);
  assert((await page.locator('#detail').innerText()).includes('gert@leisson.eu'));
  assert((await page.locator('#detail .workbench-summary').textContent()).includes('0 kinnitatud ostjat'));
  assert.equal(await page.locator('#detail img').count(),0,'untrusted draft body rendered as text');
  assert.equal(await page.locator('#detail').getByRole('button',{name:/saada/i}).count(),0,'review-only workbench has no send action');
  assert.equal(await page.getByRole('button',{name:'Ava ettevõte CRM-is'}).count(),0,'stale company composer is not linked from a review draft');
  await page.locator('#list [data-workbench-list="fixture-two"]').click();
  assert((await page.locator('#detail').innerText()).includes('Second review-only body.'));
  assert(!(await page.locator('#detail').innerText()).includes('Fixture subject'),'workbench selection never opens the company legacy letter');
  await page.locator('#inquiryShortcut').waitFor();
  await page.locator('#inquiryShortcut').click();
  assert.equal(await page.locator('#detail [data-inquiry-source=web]').count(),1);
  assert.equal(await page.locator('#detail [data-inquiry-source=prouxaudit]').count(),1);
  await page.locator('#detail [data-inquiry-source=web] summary').click();
  assert.equal(await page.locator('#detail [data-inquiry-source=web] img').count(),0,'untrusted body rendered as text');
  assert((await page.locator('#detail').innerText()).includes('Vajab ülevaatust'));
  await page.getByRole('button',{name:'Vaata algset kirja',exact:true}).first().click();
  await page.getByRole('dialog').getByText('Original fixture body').waitFor();
  assert.deepEqual(writes,['/api/inquiry/message'],'evidence view only reads local canonical mail');
  await page.getByRole('button',{name:'Sulge',exact:true}).click();
  await page.locator('#detail [data-inquiry-source=web]').getByRole('button',{name:'Ava postkastis'}).click();
  await page.getByRole('button',{name:'Vasta kontolt gert@leisson.eu',exact:true}).waitFor();
  assert.equal(await page.locator('#viewInbox').isVisible(),true);
  assert.equal(await page.locator('#mailChips').getByRole('button',{name:/legacy|leisson/}).count(),1,'all-account inbox retained');
  await page.getByRole('tab',{name:'Müügitoru',exact:true}).click();
  await page.locator('#companyShortcut').click();
  await page.locator('#list .row').first().click();
  const selects=await page.locator('#detail select').evaluateAll(nodes=>nodes.map(n=>({id:n.id,options:[...n.options].map(o=>({value:o.value,text:o.text}))})));
  const sender=selects.find(s=>s.options.some(o=>o.text.includes('@leisson.eu')));
  assert(sender,'sales sender select exists');
  assert.deepEqual(sender.options,[{value:'gert',text:'gert@leisson.eu'}]);
  await page.locator('#inquiryShortcut').click();
  await page.locator('#detail [data-inquiry-source=prouxaudit] summary').click();
  assert((await page.locator('#detail [data-inquiry-source=prouxaudit]').innerText()).includes('Järelkirja järjekord kuulub PROUXAUDITile'));
  assert(writes.every(path=>['/api/inquiry/message','/api/message/body'].includes(path)),'no send/qualification/mutation');
  await page.getByRole('tab',{name:'Statistika',exact:true}).click();
  await page.locator('#statsBody').getByText('Kohaliku sisuga kirju: 736 / 737.',{exact:false}).waitFor();
  assert((await page.locator('#statsBody').innerText()).includes('Need ei ole kvalifitseeritud müügitoru, kinnitatud tellimused ega laekunud tulu.'));
  fixture.statuses=['ootel','kiri','kohtumine','pakkumine','voidetud','ei'];
  fixture.statusLabels={ootel:'Ootel',kiri:'Kiri saadetud',kohtumine:'Kohtumine kokku',pakkumine:'Pakkumine väljas',voidetud:'Võidetud',ei:'Ei sobi'};
  fixture.counts={ootel:44,kiri:0,kohtumine:0,pakkumine:0,voidetud:0,ei:0};
  fixture.companies=Array.from({length:44},(_,i)=>({...company,id:'mobile-'+i,name:'Mobile Fixture '+i,priority:['A','B','C','P','R'][i%5],listid:['parnu','parnu2','plaan'][i%3]}));
  for(const width of [390,820]) {
    await page.setViewportSize({width,height:844});
    await page.evaluate(()=>localStorage.setItem('leisson-crm-view','pipeline'));
    await page.reload();
    await page.locator('#companyShortcut').click();
    await page.locator('#list .row').last().waitFor({state:'attached'});
    const layout=await page.evaluate(()=>({listBottom:document.querySelector('#list').getBoundingClientRect().bottom,columnBottom:document.querySelector('#viewPipeline .col-list').getBoundingClientRect().bottom}));
    assert(layout.listBottom<=layout.columnBottom+1,'mobile list must stay inside its column, without detail overlap at '+width);
    await page.locator('#list .row').nth(10).click({timeout:5000});
    assert.equal(await page.locator('#list .row[aria-current=true]').count(),1);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
  }
  assert.deepEqual(errors,[]);
  console.log('Revenue workbench and inquiry UI: review-only drafts, local evidence, source ownership, inbox navigation and gert-only sender passed.');
  await context.close();
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
