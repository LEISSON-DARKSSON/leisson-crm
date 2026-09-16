// One bounded, deterministic campaign dispatch. No scheduler is installed by this file.
// Usage: CRM_CAMPAIGN_SEND_ENABLED=1 node agent/campaign-worker.mjs <approved-campaign-id>
import {open} from '../lib/db.mjs';
import {loadEnv} from '../lib/env.mjs';
import {migrateOutbound} from '../lib/outbound.mjs';
import {migrateCampaigns,runCampaignOnce} from '../lib/campaign.mjs';
import {syncInbox,composeText,composeHtml,sendMail} from '../lib/mail.mjs';
import {reconcileSalesReplies} from '../lib/sales-safety.mjs';

const id=process.argv[2];
if(!/^[0-9a-f-]{36}$/i.test(String(id||'')))throw new Error('Kampaania ID puudub või on vigane');
if(process.env.CRM_CAMPAIGN_SEND_ENABLED!=='1')throw new Error('Kampaania saatja on välja lülitatud');
const cfg=loadEnv();
if(!cfg.defaultAccount)throw new Error('Ainult gert@leisson.eu saatjakonto on lubatud');
const db=open();
try{
  migrateOutbound(db);migrateCampaigns(db);
  // IMAP must succeed before the sales decision. BODY.PEEK leaves mail unread.
  await syncInbox(db,cfg.defaultAccount,{limit:150,bodies:true});
  reconcileSalesReplies(db,{apply:true});
  const result=await runCampaignOnce(db,id,{accountId:cfg.defaultAccount,accounts:cfg.accounts,
    composeText,composeHtml,send:sendMail});
  console.log(JSON.stringify(result));
  if(result.status==='unknown'||result.status==='blocked')process.exitCode=2;
}finally{db.close();}
