// One bounded, deterministic campaign dispatch. No scheduler is installed by this file.
// Usage: CRM_CAMPAIGN_SEND_ENABLED=1 node agent/campaign-worker.mjs <approved-campaign-id>
import {open} from '../lib/db.mjs';
import {loadEnv} from '../lib/env.mjs';
import {migrateOutbound} from '../lib/outbound.mjs';
import {migrateCampaigns,nextApprovedCampaign,runCampaignOnce,pruneAlreadySentItems} from '../lib/campaign.mjs';
import {syncInbox,composeText,composeHtml,sendMail} from '../lib/mail.mjs';
import {resolveEnv} from '../lib/sendgate.mjs';
import {reconcileSalesReplies} from '../lib/sales-safety.mjs';

const requested=process.argv[2];
if(requested!=='--sweep' && !/^[0-9a-f-]{36}$/i.test(String(requested||'')))
  throw new Error('Kampaania ID või --sweep puudub');
// Tapilukk. Protsessi env voidab, siis .env fail. .env-i lugemine on siin
// TAHTLIK: Task Scheduleri ulesanne ei saa keskkonnamuutujat kaasa anda ilma
// wrapper-skriptita, ja uks nahtav rida .env-is on auditeeritavam kui .cmd,
// mille sisu keegi ei vaata. Valja lulitamiseks: CRM_CAMPAIGN_SEND_ENABLED=0.
if(resolveEnv('CRM_CAMPAIGN_SEND_ENABLED','0')!=='1')throw new Error('Kampaania saatja on välja lülitatud');
const cfg=loadEnv();
if(!cfg.defaultAccount)throw new Error('Ainult gert@leisson.eu saatjakonto on lubatud');
const db=open();
try{
  migrateOutbound(db);migrateCampaigns(db);
  // Enne valikut: kelle kiri on juba väljas (kampaaniaväliselt või mõnest
  // teisest kampaaniast), see rida blokeeritakse kohe — sweep ei tohi
  // kunagi proovida määratud läbikukkumisega rida, sest see valiks
  // nextApprovedCampaign'is sama ummistavat kampaaniat uuesti (vt
  // lib/campaign.mjs pruneAlreadySentItems ja 20.09.2026 ummiku märkmed).
  pruneAlreadySentItems(db);
  const id=requested==='--sweep'?nextApprovedCampaign(db):requested;
  if(!id)console.log(JSON.stringify({status:'empty',reason:'Ühtegi kinnitatud ja ootel kampaaniat ei ole'}));
  else {
    // IMAP must succeed before the sales decision. BODY.PEEK leaves mail unread.
    const sync=await syncInbox(db,cfg.defaultAccount,{limit:null,bodies:true});
    if(!sync.complete || sync.bodyCount!==sync.seen)
      throw new Error('Postkasti täielik kirjasisu ei ole kontrollitud; automaatne saatmine peatatud');
    reconcileSalesReplies(db,{apply:true});
    const result=await runCampaignOnce(db,id,{accountId:cfg.defaultAccount,accounts:cfg.accounts,
      composeText,composeHtml,send:sendMail});
    console.log(JSON.stringify(result));
    if(result.status==='unknown'||result.status==='blocked')process.exitCode=2;
  }
}finally{db.close();}
