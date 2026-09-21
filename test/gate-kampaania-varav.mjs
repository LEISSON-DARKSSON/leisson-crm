// Värav: kinnitatud kampaania ei tohi sõltuda SEND_LISTS-ist, ja seadistus
// peab .env-ist kohale jõudma ka siis, kui kutsuja ei laadi .env-i protsessi
// keskkonda (Task Scheduler, win\*.cmd, spawnitud worker).
//
// Miks see test olemas on (21.09.2026): 14 kinnitatud kampaaniat, 133 ootel
// rida, aga SEND_LISTS vaikeväärtus oli 'parnu,parnu2' ja seda ei olnud
// kuskil seatud. runCampaignOnce kukutas iga muus listis (parnu3, parnu4,
// parnu8, parnu9, plaan) saaja kohe JÄÄDAVALT `blocked`-iks — 95 kirja 133-st
// oleks hääletult surnud, ilma et ükski olemasolev test oleks seda näinud.
import assert from 'node:assert/strict';
import {open} from '../lib/db.mjs';
import {migrateSales} from '../lib/salesdb.mjs';
import {migrateOutbound,consumeDispatchAuthorization} from '../lib/outbound.mjs';
import {prepareCampaign,approveCampaign,campaignView,runCampaignOnce,migrateCampaigns} from '../lib/campaign.mjs';
import {limits,sendGate} from '../lib/sendgate.mjs';

// --- 1. Seadistuse allikate järjekord: protsess > .env > vaikeväärtus -------
assert.deepEqual(limits({proc:{},file:{}}).lists,['parnu','parnu2'],'vaikeväärtus');
assert.deepEqual(limits({proc:{},file:{SEND_LISTS:'parnu9, plaan '}}).lists,['parnu9','plaan'],
  '.env-i väärtus jõuab kohale ka siis, kui protsessi env on tühi');
assert.deepEqual(limits({proc:{SEND_LISTS:'kant'},file:{SEND_LISTS:'plaan'}}).lists,['kant'],
  'protsessi env võidab .env faili');
assert.equal(limits({proc:{SEND_PER_DAY:''},file:{SEND_PER_DAY:'12'}}).perDay,12,
  'tühi protsessi väärtus ei varjuta .env faili');

// --- 2. Värav ise ----------------------------------------------------------
const now=new Date(2026,8,21,10,0);            // esmaspäev, tööajal
const accounts=[{id:'gert',user:'gert@leisson.eu'}];
const L={perDay:40,perRun:5,perHour:8,minGapMin:7,hourFrom:9,hourTo:17,lists:['parnu']};
const options={accountId:'gert',accounts,composeText:b=>b+'\n\nGert Leisson · gert@leisson.eu',
  composeHtml:b=>'<p>'+b+'</p>',now};
const lisaFirma=(db,id,nimi,email,listid)=>db.prepare(
  "INSERT INTO companies(id,name,email,status,subject,body,need_evidence,listid,sales_state,updated) VALUES(?,?,?,'ootel','Teie veeb','Tere! Üks kontrollitud leid.','Konkreetne vajaduse küsimus',?,'research',?)"
).run(id,nimi,email,listid,now.toISOString());
const makeDb=()=>{
  const db=open({dbPath:':memory:'});migrateSales(db);migrateOutbound(db);migrateCampaigns(db);
  lisaFirma(db,'x','Firma X','info@firm-x.example','parnu9');   // VÄLJASPOOL SEND_LISTS-i
  return db;
};
const send=async e=>{consumeDispatchAuthorization(e.authorization);
  return {from:'gert@leisson.eu',accepted:[e.to],rejected:[],messageId:e.messageId};};

{ // sendGate: tühi loend = kõik listid; nimetatud loend piirab endiselt
  const db=makeDb();
  assert.equal(sendGate(db,{now,L}).labib,0,'SEND_LISTS piirab ikka sihtide valikut');
  assert.equal(sendGate(db,{now,L:{...L,lists:[]}}).labib,1,'tühi loend = piiranguta');
  db.close();
}
{ // Kinnitatud kampaania läheb välja ka listist, mida SEND_LISTS ei nimeta
  const db=makeDb();
  const p=prepareCampaign(db,['x'],options);
  approveCampaign(db,p.campaign.id,p.campaign.snapshot_hash,{now});
  const r=await runCampaignOnce(db,p.campaign.id,{...options,limits:L,send});
  assert.equal(r.status,'accepted','kinnitatud ümbrik ei sõltu SEND_LISTS-ist');
  assert.equal(campaignView(db,p.campaign.id).items[0].status,'accepted');
  db.close();
}
{ // ...aga ülejäänud värav kehtib muutumatult: summutusnimekiri blokeerib
  const db=makeDb();
  const p=prepareCampaign(db,['x'],options);
  approveCampaign(db,p.campaign.id,p.campaign.snapshot_hash,{now});
  db.prepare("INSERT INTO suppressions(addr,domain,ts,reason) VALUES('info@firm-x.example',NULL,?,'loobus')")
    .run(now.toISOString());
  const r=await runCampaignOnce(db,p.campaign.id,{...options,limits:L,send});
  assert.equal(r.status,'blocked','summutusnimekirja ei kirjuta ükski kampaania üle');
  db.close();
}
{ // ...ja tempo/tööaeg kehtib: väljaspool tööaega ei saadeta
  const db=makeDb();
  const p=prepareCampaign(db,['x'],options);
  approveCampaign(db,p.campaign.id,p.campaign.snapshot_hash,{now});
  const oo=new Date(2026,8,21,22,0);
  const r=await runCampaignOnce(db,p.campaign.id,{...options,now:oo,limits:L,send});
  assert.equal(r.status,'waiting');
  assert.equal(campaignView(db,p.campaign.id).items[0].status,'pending','tööajapiir ei blokeeri rida jäädavalt');
  db.close();
}
console.log('PASS kampaania värav: .env varulugemine, listist sõltumatu kinnitatud ümbrik, summutus ja tempo puutumata');
