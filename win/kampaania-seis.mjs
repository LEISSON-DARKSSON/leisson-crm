// Read-only ülevaade: kinnitatud kampaaniad + saatmisvärava seis.
import { open } from '../lib/db.mjs';
import { migrateCampaigns, pruneAlreadySentItems } from '../lib/campaign.mjs';
import { migrateOutbound } from '../lib/outbound.mjs';
import { sendGate, limits, tooajal } from '../lib/sendgate.mjs';

const db = open();
migrateOutbound(db); migrateCampaigns(db);
const pruned = pruneAlreadySentItems(db);
const camps = db.prepare("SELECT id,status,created,approved_at FROM sales_campaigns ORDER BY approved_at IS NULL, approved_at ASC, created ASC").all();
const L = limits();
// Kampaania dispatch ei kasuta listi-filtrit — mõõda sama väravaga.
const g = sendGate(db, { L: { ...L, lists: [] } });
const gSaatja = sendGate(db);
const eligible = new Set(g.eligibleIds);
const rows = camps.map(c => {
  const items = db.prepare("SELECT i.status, i.company_id, co.listid, co.status cstatus, co.name FROM sales_campaign_items i LEFT JOIN companies co ON co.id=i.company_id WHERE i.campaign_id=? ORDER BY i.position").all(c.id);
  const counts = {}; for (const i of items) counts[i.status] = (counts[i.status]||0)+1;
  const pend = items.filter(i => i.status === 'pending');
  const lists = {}; for (const i of pend) lists[i.listid||'(null)'] = (lists[i.listid||'(null)']||0)+1;
  return { id: c.id.slice(0,8), status: c.status, approved_at: c.approved_at,
    n: items.length, counts, pendingLists: lists,
    labibVarava: pend.filter(i => eligible.has(i.company_id)).length,
    kukubValja: pend.filter(i => !eligible.has(i.company_id)).length };
});
const allPending = db.prepare("SELECT co.listid, COUNT(*) n FROM sales_campaign_items i JOIN sales_campaigns c ON c.id=i.campaign_id LEFT JOIN companies co ON co.id=i.company_id WHERE i.status='pending' AND c.status='approved' GROUP BY co.listid ORDER BY n DESC").all();
console.log(JSON.stringify({
  now: new Date().toISOString(),
  prunedNow: Array.isArray(pruned) ? pruned.length : pruned,
  campaigns: rows,
  pendingByList: allPending,
  limits: L,
  unikaalseidOotelSaajaid: db.prepare("SELECT COUNT(DISTINCT i.company_id) n FROM sales_campaign_items i JOIN sales_campaigns c ON c.id=i.campaign_id WHERE i.status='pending' AND c.status='approved'").get().n,
  kampaaniaVarav: { kandidaate: g.kandidaate, labib: g.labib, miks: g.miks, tanaSaadetud: g.tanaSaadetud,
          tunnisSaadetud: g.tunnisSaadetud, minutitViimasest: g.minutitViimasest,
          tooajal: g.tooajal, saadanNyyd: g.saadanNyyd },
  saatjaVarav: { labib: gSaatja.labib, listid: L.lists },
}, null, 2));
db.close();
