// An owner-approved campaign is an immutable list of complete outgoing messages.
// A model may propose copy, but cannot approve or dispatch this list.
import {randomUUID} from 'node:crypto';
import {previewOutbound,envelopeHash,dispatchOutbound,SALES_SENDER} from './outbound.mjs';
import {lisaLoobumisrida,sendGate} from './sendgate.mjs';
import {latestHumanReply,effectiveReplyIntent} from './sales-safety.mjs';

export function migrateCampaigns(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS sales_campaigns(
    id TEXT PRIMARY KEY, status TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
    created TEXT NOT NULL, approved_at TEXT, approved_by TEXT, stopped_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sales_campaign_items(
    id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, position INTEGER NOT NULL,
    company_id TEXT NOT NULL, snapshot TEXT NOT NULL, content_hash TEXT NOT NULL,
    source_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    claimed_at TEXT, outbound_id TEXT, error TEXT,
    UNIQUE(campaign_id,position), UNIQUE(campaign_id,company_id),
    FOREIGN KEY(campaign_id) REFERENCES sales_campaigns(id)
  );
  CREATE INDEX IF NOT EXISTS idx_campaign_queue ON sales_campaign_items(campaign_id,status,position)`);
}

function exact(preview) {
  return {kind:'sales',companyId:preview.companyId,accountId:preview.accountId,
    to:preview.to,subject:preview.subject,body:preview.body,sender:preview.sender,
    text:preview.text,html:preview.html};
}
const manifestHash=items=>envelopeHash(items.map(item=>({
  position:item.position,companyId:item.companyId??item.company_id,
  snapshot:item.snapshot,contentHash:item.contentHash??item.content_hash,
  sourceHash:item.sourceHash??item.source_hash
})));

export function prepareCampaign(db, companyIds, {accountId,accounts,composeText,composeHtml,now=new Date()}={}) {
  migrateCampaigns(db);
  if (!Array.isArray(companyIds) || !companyIds.length || companyIds.length>20 ||
      new Set(companyIds).size!==companyIds.length ||
      companyIds.some(id=>typeof id!=='string'||!id.trim())) throw new Error('Vali 1–20 eri ettevõtet');
  const campaignId=randomUUID(), items=[];
  // No campaign can be approved with a partially validated recipient list.
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [position,companyId] of companyIds.entries()) {
      const c=db.prepare('SELECT id,email,subject,body FROM companies WHERE id=?').get(companyId);
      if(!c)throw new Error('Ettevõtet ei leitud: '+companyId);
      const p=previewOutbound(db,{kind:'sales',companyId,accountId,to:c.email,
        subject:c.subject,body:lisaLoobumisrida(c.body)},{accountId,accounts,composeText,composeHtml,now});
      const sourceHash=db.prepare('SELECT source_hash FROM outbound_previews WHERE id=?').get(p.approvalId).source_hash;
      const snapshot=exact(p);
      items.push({id:randomUUID(),position,companyId,snapshot,contentHash:envelopeHash(snapshot),sourceHash});
    }
    const snapshotHash=manifestHash(items);
    const duplicate=db.prepare("SELECT id FROM sales_campaigns WHERE snapshot_hash=? AND status IN ('prepared','approved') LIMIT 1").get(snapshotHash);
    if(duplicate){db.exec('ROLLBACK');return campaignView(db,duplicate.id);}
    // Kaks eri kampaaniat sama saajaga (mõlemad kinnitamata või kinnitatud)
    // lukustavad sweep'i igaveseks: esimene saadab, teise rida ei läbi enam
    // kunagi saatmisväravat ega vabasta seda kampaaniat, ja kuna
    // nextApprovedCampaign valib alati varaseima veel-pending kampaania
    // uuesti, jääb terve järjekord sinna seisma (avastatud 20.09.2026, kui
    // 10 kinnitatud kampaaniat kattusid 18 firma võrra ja oleks pärast
    // esimest kirja kogu automaatsaatja lukustanud). Täpselt sama
    // manifestiga taaskäivitus on juba eespool käsitletud (tagastab sama
    // kampaania); see püüab kinni ainult PÄRISOSALISE kattumise.
    const placeholders=companyIds.map(()=>'?').join(',');
    const overlap=db.prepare(
      `SELECT DISTINCT i.company_id, c.name FROM sales_campaign_items i
         JOIN sales_campaigns s ON s.id = i.campaign_id
         LEFT JOIN companies c ON c.id = i.company_id
        WHERE s.status IN ('prepared','approved') AND i.status = 'pending'
          AND i.company_id IN (${placeholders})`
    ).all(...companyIds);
    // Ei rollback'i siin käsitsi: väline catch(error){db.exec('ROLLBACK');...}
    // teeb seda juba üks kord selle throw pärast — topelt ROLLBACK samal
    // transaktsioonil annab "cannot rollback - no transaction is active".
    if(overlap.length)throw new Error(
      'Juba mõnes pooleliolevas kampaanias ootel: '+overlap.map(d=>d.name||d.company_id).join(', '));
    db.prepare("INSERT INTO sales_campaigns(id,status,snapshot_hash,created) VALUES(?,'prepared',?,?)")
      .run(campaignId,snapshotHash,now.toISOString());
    const insert=db.prepare('INSERT INTO sales_campaign_items(id,campaign_id,position,company_id,snapshot,content_hash,source_hash) VALUES(?,?,?,?,?,?,?)');
    for(const item of items)insert.run(item.id,campaignId,item.position,item.companyId,JSON.stringify(item.snapshot),item.contentHash,item.sourceHash);
    db.exec('COMMIT');
    return campaignView(db,campaignId);
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function campaignView(db,id) {
  const campaign=db.prepare('SELECT * FROM sales_campaigns WHERE id=?').get(id);
  if(!campaign)throw new Error('Kampaaniat ei leitud');
  const items=db.prepare('SELECT id,position,company_id,snapshot,content_hash,source_hash,status,error,outbound_id FROM sales_campaign_items WHERE campaign_id=? ORDER BY position').all(id)
    .map(row=>({...row,snapshot:JSON.parse(row.snapshot)}));
  return {campaign,items};
}

// Read-only strategy evidence. A payment after a message is correlated, not
// attributed to it; the recommendation is never an approval or a price change.
export function campaignEvidence(db,id) {
  const {campaign,items}=campaignView(db,id);
  const intents={},recommendations=[];
  let accepted=0,replies=0,confirmedNeeds=0,postSendPayments=0;
  for(const item of items){
    const c=db.prepare('SELECT need_evidence FROM companies WHERE id=?').get(item.company_id);
    if(String(c?.need_evidence||'').trim())confirmedNeeds++;
    if(item.status!=='accepted')continue;
    accepted++;
    const outbound=db.prepare('SELECT accepted_at FROM outbound_messages WHERE id=?').get(item.outbound_id);
    const sentAt=Date.parse(outbound?.accepted_at);
    const latest=latestHumanReply(db,item.company_id);
    if(latest && Number.isFinite(sentAt) && Date.parse(latest.ts)>sentAt){
      const intent=effectiveReplyIntent(latest);intents[intent]=(intents[intent]||0)+1;replies++;
    }
    const payments=db.prepare('SELECT p.amount,p.received_at FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.company_id=?').all(item.company_id);
    for(const payment of payments)if(Number.isFinite(sentAt)&&Date.parse(payment.received_at)>=sentAt)
      postSendPayments+=Number(payment.amount)||0;
  }
  if(!accepted)recommendations.push('Enne strateegia hindamist on vaja tegelikke saadetisi.');
  else {
    if((intents.declined||0)+(intents.not_now||0)+(intents.has_provider||0))
      recommendations.push('Uues versioonis täpsusta sihtrühma ja vajaduse sobivust; ära muuda kinnitatud kampaaniat.');
    if(!replies)recommendations.push('Kontrolli enne uue versiooni koostamist vastuste ajavahemikku ja postkasti täielikkust.');
    if((intents.positive||0)&&!postSendPayments)
      recommendations.push('Täpsusta väljendatud vajadus ja piiratud pakkumine enne hinnamuutust.');
  }
  return {campaignId:id,campaignStatus:campaign.status,accepted,humanReplies:replies,replyIntents:intents,
    contactsWithRecordedNeed:confirmedNeeds,postSendPayments,causality:'Makse ajaline järgnevus ei tõenda, et kampaania põhjustas müügi.',
    recommendations,activeCampaignChanged:false,newVersionRequiresApproval:true};
}

export function approveCampaign(db,id,hash,{now=new Date()}={}) {
  // Loopback + CSRF identify a local CRM session, not Gert personally.
  const actor='local-crm-operator';
  db.exec('BEGIN IMMEDIATE');
  try{
    const view=campaignView(db,id);
    if(view.campaign.status!=='prepared')throw new Error('Kampaania pole kinnitamiseks valmis');
    if(hash!==view.campaign.snapshot_hash)throw new Error('Saajate või täpse sisu räsi ei vasta eelvaatele');
    if(manifestHash(view.items)!==hash)throw new Error('Kampaania saajate loend on muutunud');
    for(const item of view.items)if(envelopeHash(item.snapshot)!==item.content_hash)throw new Error('Kampaania kirja sisu on muutunud');
    db.prepare("UPDATE sales_campaigns SET status='approved',approved_at=?,approved_by=? WHERE id=? AND status='prepared'")
      .run(now.toISOString(),actor,id);
    db.exec('COMMIT');
    return campaignView(db,id);
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function stopCampaign(db,id,{now=new Date()}={}) {
  const result=db.prepare("UPDATE sales_campaigns SET status='stopped',stopped_at=? WHERE id=? AND status IN ('prepared','approved')").run(now.toISOString(),id);
  return {stopped:result.changes===1};
}

export function nextApprovedCampaign(db) {
  return db.prepare(`SELECT c.id FROM sales_campaigns c
    JOIN sales_campaign_items i ON i.campaign_id=c.id
    WHERE c.status='approved' AND i.status='pending'
    ORDER BY c.approved_at,i.position LIMIT 1`).get()?.id || null;
}

export async function runCampaignOnce(db,id,{accountId,accounts,composeText,composeHtml,send,now=new Date(),limits}={}) {
  const gate=sendGate(db,{now,L:limits});
  if(!gate.saadanNyyd)return {status:'waiting',reason:gate.tooajal.ok?'Saatmislimiit või vahe':'Väljaspool tööaega'};
  const view=campaignView(db,id);
  if(view.campaign.status!=='approved')return {status:'waiting',reason:'Kampaania ei ole kinnitatud'};
  if(manifestHash(view.items)!==view.campaign.snapshot_hash)
    return {status:'blocked',reason:'Kinnitatud saajate loend on muutunud'};
  const next=view.items.find(i=>i.status==='pending');
  if(!next)return {status:'empty'};
  const snapshot=next.snapshot;
  if(snapshot.sender!==SALES_SENDER || envelopeHash(snapshot)!==next.content_hash)
    return block(db,next.id,'Kinnitatud kiri on muutunud');
  // sendGate valib saajaid ainult status='ootel' firmade seast, seega KÕIK
  // väljajäämise põhjused siin on püsivad selle konkreetse rea jaoks (juba
  // saadetud/edenenud mujalt, summutatud, vigane aadress, lubatud päev
  // möödas) — mitte "proovi hiljem uuesti". "waiting" ilma staatust
  // muutmata jättis rea igavesti 'pending' esikohale ja takistas SEDA
  // kampaaniat kunagi enam edasi liikumast (nextApprovedCampaign valib
  // alati sama, ummikus kampaania uuesti). Blokeeri kohe, nagu iga teine
  // püsiv tõrge.
  if(!gate.eligibleIds.includes(next.company_id))
    return block(db,next.id,'Saaja ei läbi enam saatmisväravat (staatus muutunud, summutatud või aadress kõlbmatu)');
  if(!accounts?.some(a=>a.id===snapshot.accountId&&String(a.user).toLowerCase()===SALES_SENDER))
    return block(db,next.id,'Saatjakonto ei ole gert@leisson.eu');
  // A claim is durable before touching SMTP. After process death it remains
  // claimed for manual inspection, never silently retried.
  db.exec('BEGIN IMMEDIATE');
  try{
    if(db.prepare("SELECT 1 FROM sales_campaign_items WHERE status='claimed' LIMIT 1").get()){
      db.exec('ROLLBACK');return {status:'waiting',reason:'Teine töötaja saadab juba kirja'};
    }
    const result=db.prepare("UPDATE sales_campaign_items SET status='claimed',claimed_at=? WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM sales_campaigns WHERE id=? AND status='approved')")
      .run(now.toISOString(),next.id,id);
    if(result.changes!==1){db.exec('ROLLBACK');return {status:'waiting',reason:'Teine töötaja võttis kirja'};}
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  try{
    const fresh=previewOutbound(db,{kind:'sales',companyId:next.company_id,accountId:snapshot.accountId,
      to:snapshot.to,subject:snapshot.subject,body:snapshot.body},
      {accountId,accounts,composeText,composeHtml,now});
    const sourceHash=db.prepare('SELECT source_hash FROM outbound_previews WHERE id=?').get(fresh.approvalId).source_hash;
    if(envelopeHash(exact(fresh))!==next.content_hash || sourceHash!==next.source_hash)
      return block(db,next.id,'Kirja sisu, allkiri või kliendi seis on muutunud; vaja uut kampaaniat');
    if(db.prepare('SELECT status FROM sales_campaigns WHERE id=?').get(id)?.status!=='approved')
      return block(db,next.id,'Kampaania peatati enne saatmist');
    const result=await dispatchOutbound(db,fresh.approvalId,{companyId:next.company_id,
      accountId:snapshot.accountId,to:snapshot.to,subject:snapshot.subject,body:snapshot.body},
      send,{now,accounts,approvalActor:'local-crm-approved-campaign'});
    db.prepare("UPDATE sales_campaign_items SET status='accepted',outbound_id=? WHERE id=?").run(result.outboundId,next.id);
    db.prepare("UPDATE companies SET status=CASE WHEN status='ootel' THEN 'kiri' ELSE status END,updated=? WHERE id=?")
      .run(now.toISOString(),next.company_id);
    db.prepare("INSERT INTO activity(company_id,ts,kind,note) VALUES(?,?,'sent',?)")
      .run(next.company_id,now.toISOString(),`${SALES_SENDER} → ${snapshot.to} — ${snapshot.subject}`);
    return {status:'accepted',companyId:next.company_id,outboundId:result.outboundId};
  }catch(error){
    // A failed preflight is safe to review; an uncertain SMTP result is never retried.
    const unknown=Boolean(db.prepare("SELECT 1 FROM outbound_messages WHERE company_id=? AND state='unknown' AND created>=?")
      .get(next.company_id,now.toISOString()));
    db.prepare('UPDATE sales_campaign_items SET status=?,error=? WHERE id=?')
      .run(unknown?'unknown':'blocked',String(error.message).slice(0,300),next.id);
    return {status:unknown?'unknown':'blocked',reason:error.message};
  }
}

function block(db,id,reason){
  db.prepare("UPDATE sales_campaign_items SET status='blocked',error=? WHERE id=?").run(reason,id);
  return {status:'blocked',reason};
}
