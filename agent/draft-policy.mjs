import {assertMailSource} from '../lib/mail-source-scope.mjs';
import {ownerSalesPause,OWNER_SALES_PAUSE_REASON} from '../lib/owner-sales-pause.mjs';
import {replyDecision,latestHumanReply,suppressionReason,BLOCKED_INTENTS} from '../lib/sales-safety.mjs';
export function companyContext(db,companyId) {
 return companyId?db.prepare('SELECT id,name,email,next_step,status,sales_state,need_evidence FROM companies WHERE id=?').get(companyId)??null:null;
}
export function draftDecision(db,message,{now=new Date()}={}) {
 if(message&&ownerSalesPause(db,{address:message.addr,companyId:message.company_id}))return {allowed:false,reason:OWNER_SALES_PAUSE_REASON,intent:message.reply_intent||'unknown'};
 try{assertMailSource(message);}catch(e){return {allowed:false,reason:e.message,intent:message?.reply_intent||'unknown'};}
 const decision=replyDecision(message,{now});if(!decision.allowed)return decision;
 const blocked=suppressionReason(db,message.addr);if(blocked)return {allowed:false,reason:'recipient_suppressed',intent:decision.intent};
 if(message.company_id) {
  const company=companyContext(db,message.company_id);
  if(company&&BLOCKED_INTENTS.has(company.sales_state))return {allowed:false,reason:'company_sales_paused',intent:decision.intent};
  const latest=latestHumanReply(db,message.company_id);
  if(latest&&(latest.account!==message.account||latest.mailbox!==message.mailbox||latest.uid!==message.uid))
   return {allowed:false,reason:'newer_human_reply_exists',intent:decision.intent};
 }
 return decision;
}
