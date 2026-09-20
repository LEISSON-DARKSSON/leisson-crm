// public/campaigns.html regression gate — added 20.09.2026 after the mass-confirmation UX rework.
// Serves fixtures + a stub campaign store, never opens the real CRM SQLite or mailbox.
// Verifies: group-chip filtering, the 20-item selection cap warns instead of erroring, the
// "prepare all visible" action chunks >20 candidates into several ≤20 campaigns, the queue lets
// Gert step through them, a recipient already pending in another unapproved/approved campaign
// is hidden from the candidate list entirely (not just rejected server-side after the fact —
// see lib/campaign.mjs 20.09.2026 deadlock writeup), and — the one thing that must never
// regress — every campaign still requires its own explicit "Kinnitan..." checkbox tick before
// Approve is enabled, and nothing but the campaign endpoints is ever called (no accidental
// /api/send from the UI).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');

const companies=[];
for(let i=0;i<25;i++)companies.push({id:'a'+i,name:'Firma A'+i,email:'a'+i+'@example.test',priority:'A',listid:'parnu',
  status:'ootel',subject:'Teie veeb',body:'Tere!',need_evidence:'Avalik kontakt'});
companies.push({id:'b0',name:'Firma B0',email:'b0@example.test',priority:'B',listid:'parnu2',status:'ootel',subject:'s',body:'b',need_evidence:''});
companies.push({id:'c0',name:'Firma C0',email:'c0@example.test',priority:'C',listid:'parnu3',status:'ootel',subject:'s',body:'b',need_evidence:'x'});
companies.push({id:'p0',name:'Firma Plaan',email:'p0@example.test',priority:null,listid:'plaan',status:'ootel',subject:'s',body:'b',need_evidence:'x'});
const byId=Object.fromEntries(companies.map(c=>[c.id,c]));

const campaigns=new Map();let counter=0;
const writes=[];
function makeCampaign(companyIds){
 if(!companyIds.length||companyIds.length>20||new Set(companyIds).size!==companyIds.length)
  return {error:'Vali 1–20 eri ettevõtet'};
 const id='c'+(++counter);
 const items=companyIds.map((cid,position)=>({position,status:'pending',companyId:cid,snapshot:{
  to:byId[cid].email,sender:'gert@leisson.eu',subject:byId[cid].subject,
  text:'Tere! ...\n\nGert Leisson · gert@leisson.eu',html:'<p>Tere!</p>'}}));
 const campaign={id,status:'prepared',snapshot_hash:'hash-'+id,created:'2026-09-20T12:00:00Z'};
 campaigns.set(id,{campaign,items});
 return {campaign,items};
}
// Kes on PRAEGU pending mõnes kinnitamata/kinnitatud kampaanias — sama
// arvutus, mida lib/campaign.mjs queuedCompanyIds(db) teeb päris baasis.
function currentlyQueuedIds(){
 const ids=new Set();
 for(const {campaign,items} of campaigns.values())
  if(campaign.status==='prepared'||campaign.status==='approved')
   for(const it of items) if(it.status==='pending') ids.add(it.companyId);
 return [...ids];
}
const json=(res,data)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));};
const files={'/campaigns.html':'campaigns.html','/app.css':'app.css'};
async function readBody(req){let raw='';for await(const chunk of req)raw+=chunk;return raw?JSON.parse(raw):{}}
const server=createServer(async(req,res)=>{
 if(req.url==='/api/state')return json(res,{csrfToken:'fixture-csrf',companies});
 if(req.url==='/api/campaigns')return json(res,{campaigns:[...campaigns.values()].map(v=>({id:v.campaign.id,created:v.campaign.created,status:v.campaign.status})),queuedCompanyIds:currentlyQueuedIds()});
 if(req.method==='POST'){
  writes.push(req.url);
  const body=await readBody(req);
  if(req.url==='/api/campaign/prepare'){
   const result=makeCampaign(body.companyIds||[]);
   if(result.error){res.writeHead(400);return res.end(JSON.stringify(result))}
   return json(res,result);
  }
  if(req.url==='/api/campaign/view'){
   const c=campaigns.get(body.id);if(!c){res.writeHead(404);return res.end('{}')}
   return json(res,c);
  }
  if(req.url==='/api/campaign/approve'){
   const c=campaigns.get(body.id);
   if(!c||c.campaign.status!=='prepared'||c.campaign.snapshot_hash!==body.hash){res.writeHead(400);return res.end(JSON.stringify({error:'räsi ei klapi'}))}
   c.campaign.status='approved';c.campaign.approved_by='local-crm-operator';
   return json(res,c);
  }
  if(req.url==='/api/campaign/stop'){
   const c=campaigns.get(body.id);if(c)c.campaign.status='stopped';
   return json(res,{ok:true});
  }
  if(req.url==='/api/campaign/evidence'){
   return json(res,{accepted:0,humanReplies:0,contactsWithRecordedNeed:0,postSendPayments:0,replyIntents:{},causality:'',recommendations:[]});
  }
  res.writeHead(400);return res.end('Unexpected mutation: '+req.url);
 }
 try{
  const file=files[req.url]?new URL('../public/'+files[req.url],import.meta.url):null;
  if(!file)throw new Error('missing');
  res.writeHead(200,{'content-type':req.url.endsWith('.css')?'text/css':'text/html'});
  res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch().catch(()=>chromium.launch({channel:'chrome'}));
try {
 const context=await browser.newContext({viewport:{width:1280,height:1000}});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage(), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/campaigns.html');
 await page.locator('#candidates .cand').first().waitFor();
 assert.equal(await page.locator('#candidates .cand').count(),28,'all ootel candidates with email/subject/body listed');

 await page.getByRole('button',{name:/Prioriteet A \(25\)/}).click();
 assert.equal(await page.locator('#candidates .cand').count(),25,'group chip filters the list');

 await page.locator('#selectNext20').click();
 assert.equal((await page.locator('#selCount').textContent()).trim(),'20 valitud (max 20)');
 assert.equal(await page.locator('#prepare').isDisabled(),false);

 await page.locator('#selectAll').click();
 assert(((await page.locator('#selCount').textContent())||'').startsWith('25 valitud'));
 assert(((await page.locator('#selCount').textContent())||'').includes('Koosta kõik nähtavad automaatselt'),'over-cap hint points at the batching action');
 assert.equal(await page.locator('#prepare').isDisabled(),true,'prepare stays disabled above 20 so the server error is never hit');
 await page.locator('#prepareAll').click();
 await page.locator('#queueNav').waitFor({state:'visible'});
 assert.equal((await page.locator('#queueNav').textContent()).trim(),'Automaatselt koostatud kampaania 1 / 2','25 candidates split into a 20 + 5 queue');
 assert.equal(await page.locator('#letters article').count(),20);
 assert.equal(await page.locator('#approve').isDisabled(),true,'approve is gated even right after prepare');

 await page.locator('#checked').check();
 assert.equal(await page.locator('#approve').isDisabled(),false,'approve only enables after the explicit confirmation checkbox');
 await page.locator('#approve').click();
 await page.getByText('Kampaania kinnitatud').waitFor();

 await page.locator('#nextQueue').click();
 await page.getByText('Automaatselt koostatud kampaania 2 / 2').waitFor();
 assert.equal(await page.locator('#letters article').count(),5,'second batch holds the remaining 5');
 assert.equal(await page.locator('#checked').isChecked(),false,'confirmation checkbox resets for the next campaign');
 assert.equal(await page.locator('#approve').isDisabled(),true,'second campaign needs its own explicit confirmation too');
 assert.equal(await page.locator('#nextQueue').isHidden(),true,'no further campaign after the last one');

 // Ummiku regressioon (vt lib/campaign.mjs 20.09.2026): kõik 25 Prioriteet A
 // firmat on nüüd pending mõnes kinnitamata/kinnitatud kampaanias (üks
 // kinnitatud, teine endiselt kinnitamata) — värske laadimine ei tohi neid
 // enam valikusse pakkuda üldse, muidu saaks Gert sama saaja teise
 // kampaaniasse panna ja lukustada sweep'i.
 await page.reload();
 await page.locator('#candidates .cand').first().waitFor();
 assert.equal(await page.locator('#candidates .cand').count(),3,'all 25 already-queued recipients are hidden, only b0/c0/p0 remain selectable');
 assert.equal(await page.locator('#candidates').getByText('Firma A',{exact:false}).count(),0,'no queued Firma A* row leaks into the candidate list');
 assert(((await page.locator('#eligibleCount').textContent())||'').includes('25 peidetud'),'the hidden count is surfaced, not silent');

 const allowed=new Set(['/api/campaign/prepare','/api/campaign/view','/api/campaign/approve','/api/campaign/evidence','/api/campaign/stop']);
 assert(writes.every(w=>allowed.has(w)),'only campaign endpoints were ever called: '+JSON.stringify(writes));
 assert(!writes.includes('/api/send'),'the mass-confirmation UI never calls the raw send endpoint');
 assert.deepEqual(errors,[]);
 console.log('PASS campaign-ui: group filter, 20-cap warning, auto-batching into a queue, already-queued recipients hidden on reload, per-campaign confirmation gate preserved.');
 await context.close();
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
