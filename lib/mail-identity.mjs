export function requireCurrentMessage(db, accId, uid, uidValidity) {
  const row = db.prepare("SELECT * FROM messages WHERE account=? AND mailbox='INBOX' AND uid=?").get(accId, uid);
  if (!row || row.identity_status !== 'current' || !row.source_id || String(row.uidvalidity) !== String(uidValidity)) {
    throw new Error('Kirja püsiv identiteet vajab sünkroonimist või ülevaatust');
  }
  return row;
}
