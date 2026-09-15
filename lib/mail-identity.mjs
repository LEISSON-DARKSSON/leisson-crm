export function requireCurrentMessage(db, accId, uid, uidValidity) {
  const row = db.prepare("SELECT * FROM messages WHERE account=? AND mailbox='INBOX' AND uid=?").get(accId, uid);
  if (!row || row.identity_status !== 'current' || !row.source_id || String(row.uidvalidity) !== String(uidValidity)) {
    throw new Error('Kirja püsiv identiteet vajab sünkroonimist või ülevaatust');
  }
  return row;
}

// source_id hashes account + real folder + UIDVALIDITY + UID. Legacy rows carry
// their explicit account until a trusted sync can give them a canonical source.
export function messageSelectionId(row) {
  return row.source_id ? 'source:'+row.source_id
    : 'legacy:'+encodeURIComponent(JSON.stringify([row.account,row.mailbox,Number(row.uid)]));
}

export function resolveMessageSelection(db,id) {
  if(typeof id!=='string'||id.length>2048)throw new Error('invalid_message_selection');
  let matches,canonical=null;
  const hasRecords=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mail_records'").get());
  if(id.startsWith('source:')) {
    if(!hasRecords)throw new Error('message_source_missing');
    canonical=db.prepare('SELECT * FROM mail_records WHERE source_id=?').get(id.slice(7));
    if(!canonical)throw new Error('message_source_missing');
    matches=db.prepare('SELECT * FROM messages WHERE account=? AND mailbox=? AND uid=?').all(canonical.account,canonical.mailbox,canonical.uid);
  } else if(id.startsWith('legacy:')) {
    let identity;try{identity=JSON.parse(decodeURIComponent(id.slice(7)));}catch{throw new Error('invalid_message_selection');}
    if(!Array.isArray(identity)||identity.length!==3||typeof identity[0]!=='string'||typeof identity[1]!=='string'||!Number.isSafeInteger(identity[2])||identity[2]<1)throw new Error('invalid_message_selection');
    matches=db.prepare('SELECT * FROM messages WHERE account=? AND mailbox=? AND uid=?').all(...identity);
  } else {
    // Backward compatibility for existing reviewed jobs: unambiguous rows only.
    const split=id.lastIndexOf(':');
    if(split<1||!/^\d+$/.test(id.slice(split+1)))throw new Error('invalid_message_selection');
    matches=db.prepare('SELECT * FROM messages WHERE mailbox=? AND uid=?').all(id.slice(0,split),Number(id.slice(split+1)));
  }
  if(matches.length!==1)throw new Error(matches.length?'message_identity_ambiguous':'message_missing');
  const row=matches[0];
  if(row.identity_status==='conflict')throw new Error('message_identity_ambiguous');
  if(hasRecords) {
    const candidates=db.prepare('SELECT * FROM mail_records WHERE mailbox=? AND uid=?').all(row.mailbox,row.uid);
    if(candidates.length>1||candidates.some(r=>r.identity_status==='conflict'))throw new Error('message_identity_ambiguous');
    if(candidates.length===1) {
      const source=candidates[0];
      if(row.account!==source.account||row.source_id!==source.source_id||String(row.uidvalidity)!==String(source.uidvalidity))throw new Error('message_source_changed');
    }
  }
  if(canonical&&(canonical.identity_status==='conflict'||row.source_id!==canonical.source_id||String(row.uidvalidity)!==String(canonical.uidvalidity)))throw new Error('message_source_changed');
  return {...row,_selection_id:id};
}
