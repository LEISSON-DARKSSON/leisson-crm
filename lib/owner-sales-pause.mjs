// Owner-requested sales exclusions are distinct from recipient opt-outs.
// Actual contacts live only in the local CRM database, never in source code.
export const OWNER_SALES_PAUSE_REASON = 'Omaniku määratud müügipaus';
const normalize = value => String(value || '').trim().toLowerCase();
const hasTable = db => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='owner_sales_pauses'").get());

export function migrateOwnerSalesPauses(db) {
  db.exec("CREATE TABLE IF NOT EXISTS owner_sales_pauses(address TEXT PRIMARY KEY,company_id TEXT,reason TEXT NOT NULL,paused_at TEXT NOT NULL,resumed_at TEXT,by_owner TEXT NOT NULL DEFAULT 'user:local-crm')");
}

export function ownerSalesPause(db, {address,companyId} = {}) {
  if(!hasTable(db))return null; // Read-only gates must not migrate or write.
  const row=db.prepare('SELECT * FROM owner_sales_pauses WHERE resumed_at IS NULL AND (address=? OR (company_id IS NOT NULL AND company_id=?)) LIMIT 1')
    .get(normalize(address),companyId || null);
  return row ? {...row,kind:'owner_request',legalOptOut:false} : null;
}

// Trusted local owner operation. No model/MCP tool exposes this function.
export function pauseOwnerSales(db, {address,companyId,reason=OWNER_SALES_PAUSE_REASON,now=new Date()} = {}) {
  const addr=normalize(address);
  if(!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(addr))throw new Error('invalid_owner_pause_address');
  if(!String(reason).trim())throw new Error('owner_pause_reason_required');
  const companies=companyId
    ? db.prepare('SELECT id FROM companies WHERE id=?').all(companyId)
    : db.prepare('SELECT id FROM companies WHERE lower(trim(email))=?').all(addr);
  if(companyId&&companies.length!==1)throw new Error('owner_pause_company_missing');
  if(!companyId&&companies.length>1)throw new Error('owner_pause_company_ambiguous');
  const linked=companies[0]?.id || null;
  migrateOwnerSalesPauses(db);
  db.prepare("INSERT INTO owner_sales_pauses(address,company_id,reason,paused_at,resumed_at,by_owner) VALUES(?,?,?,?,NULL,'user:local-crm') ON CONFLICT(address) DO UPDATE SET company_id=COALESCE(excluded.company_id,owner_sales_pauses.company_id),reason=excluded.reason,paused_at=CASE WHEN owner_sales_pauses.resumed_at IS NULL THEN owner_sales_pauses.paused_at ELSE excluded.paused_at END,resumed_at=NULL")
    .run(addr,linked,String(reason).trim(),now.toISOString());
  return ownerSalesPause(db,{address:addr});
}

export function resumeOwnerSales(db, {address,now=new Date()} = {}) {
  if(!hasTable(db))return {resumed:false};
  const changes=db.prepare('UPDATE owner_sales_pauses SET resumed_at=? WHERE address=? AND resumed_at IS NULL')
    .run(now.toISOString(),normalize(address)).changes;
  return {resumed:changes===1}; // Does not remove any legal opt-out or alter reply intent.
}
