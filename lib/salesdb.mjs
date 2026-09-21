import {CRM_MAIL_SOURCE_ACCOUNT} from './mail-source-scope.mjs';
import {migrateOwnerSalesPauses,ownerSalesPause} from './owner-sales-pause.mjs';
import {serviceById,serviceSnapshot,CATALOG_VERSION,SELLER} from '@leisson/shared/service-catalog';
import {latestHumanReply,latestMessageText,replyDecision,suppressionReason} from './sales-safety.mjs';
// Muugimootori tabelid: pakkumised, arved, numbriseeriad, kirjagrupid, summutusnimekiri.
// Eraldi failis, et CRM-i ja agendikihi skeemid jaaksid puutumata. Migratsioon on LISAV.
//
// Numbriseeria on siin ainus koht, kus number kasvab. Ilma auguta: number
// valjastatakse tehinguga ja seda ei tagastata kunagi tagasi.

export const OFFER_STATES = ['mustand', 'saadetud', 'kinnitatud', 'aegunud', 'tagasi_lukatud'];
export const INVOICE_STATES = ['mustand', 'saadetud', 'tasutud', 'osaliselt_tasutud', 'ule_tahtaja', 'tuhistatud'];

export function migrateSales(db) {
  migrateOwnerSalesPauses(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS counters (
      key TEXT NOT NULL,
      year INTEGER NOT NULL,
      next INTEGER NOT NULL,
      PRIMARY KEY (key, year)
    );
    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      company_id TEXT NOT NULL,
      offer_id TEXT,
      title TEXT NOT NULL,
      price INTEGER NOT NULL,
      hours INTEGER,
      lead TEXT,
      includes TEXT,
      finding TEXT,
      issued TEXT NOT NULL,
      valid_until TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'mustand',
      sent TEXT, accepted TEXT, closed TEXT,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      company_id TEXT NOT NULL,
      offer_id INTEGER,
      issued TEXT NOT NULL,
      due TEXT NOT NULL,
      total INTEGER NOT NULL,
      prepaid INTEGER NOT NULL DEFAULT 0,
      payable INTEGER NOT NULL,
      reference TEXT,
      state TEXT NOT NULL DEFAULT 'mustand',
      sent TEXT, paid_at TEXT,
      reminder_step INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      detail TEXT,
      qty REAL NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT 'tk',
      unit_price INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS message_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rule TEXT,
      created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS suppressions (
      addr TEXT PRIMARY KEY,
      domain TEXT,
      reason TEXT,
      ts TEXT NOT NULL,
      by TEXT NOT NULL DEFAULT 'inimene'
    );
    CREATE TABLE IF NOT EXISTS stages (
      company_id TEXT NOT NULL,
      step INTEGER NOT NULL,
      entered TEXT NOT NULL,
      gate_passed INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      PRIMARY KEY (company_id, step)
    );
    CREATE INDEX IF NOT EXISTS idx_inv_company ON invoices(company_id, state);
    CREATE INDEX IF NOT EXISTS idx_off_company ON offers(company_id, state);
    CREATE INDEX IF NOT EXISTS idx_lines_inv ON invoice_lines(invoice_id);
  `);
  const cols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  if (!cols.includes('group_id')) db.exec('ALTER TABLE messages ADD COLUMN group_id INTEGER');
  if (!cols.includes('deleted')) db.exec('ALTER TABLE messages ADD COLUMN deleted TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_msg_group ON messages(group_id)');
  migrateVabaOstja(db);
  const add=(table,col,type)=>{if(!db.prepare('PRAGMA table_info('+table+')').all().some(x=>x.name===col))db.exec('ALTER TABLE '+table+' ADD COLUMN '+col+' '+type);};
  for(const table of ['offers','invoices']) { add(table,'catalog_version','TEXT'); add(table,'service_snapshot','TEXT'); add(table,'deposit_percent','INTEGER'); }
  add('invoices','invoice_kind',"TEXT NOT NULL DEFAULT 'legacy'");
  db.exec('CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY AUTOINCREMENT,invoice_id INTEGER NOT NULL,amount REAL NOT NULL CHECK(amount>0),reference TEXT NOT NULL UNIQUE,received_at TEXT NOT NULL,confirmed_by TEXT NOT NULL,recorded_at TEXT NOT NULL,FOREIGN KEY(invoice_id) REFERENCES invoices(id))');
}

// --- vaba ostja --------------------------------------------------------------
// Algne skeem noudis company_id-d: arvet sai teha AINULT muugitorus olevale
// ettevottele. Uhekordne too, edasimuuja voi sober ei ole muugitoru kirje ja
// nende parast ei tohi torru tekkida valekirjet, mis rikub statistikat.
// Seetottu: company_id muutub valikuliseks ja dokument kannab ise ostja valju.
//
// SQLite ei oska NOT NULL piirangut ara votta - tabel tuleb umber ehitada.
// Jargitakse SQLite dokumentatsiooni turvalist korda: FK VALJAS enne tehingut,
// uus tabel, andmed ule, vana maha, umber nimetada, FK kontroll, alles siis sisse.
function migrateVabaOstja(db) {
  const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c);
  if (has('invoices', 'buyer_name') && has('offers', 'buyer_name')) return;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    if (!has('offers', 'buyer_name')) {
      db.exec(`
        CREATE TABLE offers_uus (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          number TEXT NOT NULL UNIQUE,
          company_id TEXT,
          buyer_name TEXT, buyer_reg TEXT, buyer_addr TEXT, buyer_email TEXT,
          offer_id TEXT,
          title TEXT NOT NULL,
          price INTEGER NOT NULL,
          hours INTEGER, lead TEXT, includes TEXT, finding TEXT,
          issued TEXT NOT NULL,
          valid_until TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'mustand',
          sent TEXT, accepted TEXT, closed TEXT,
          FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
        );
        INSERT INTO offers_uus (id,number,company_id,offer_id,title,price,hours,lead,includes,finding,
                                issued,valid_until,state,sent,accepted,closed)
          SELECT id,number,company_id,offer_id,title,price,hours,lead,includes,finding,
                 issued,valid_until,state,sent,accepted,closed FROM offers;
        DROP TABLE offers;
        ALTER TABLE offers_uus RENAME TO offers;
        CREATE INDEX IF NOT EXISTS idx_off_company ON offers(company_id, state);
      `);
    }
    if (!has('invoices', 'buyer_name')) {
      db.exec(`
        CREATE TABLE invoices_uus (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          number TEXT NOT NULL UNIQUE,
          company_id TEXT,
          buyer_name TEXT, buyer_reg TEXT, buyer_addr TEXT, buyer_email TEXT,
          offer_id INTEGER,
          issued TEXT NOT NULL,
          due TEXT NOT NULL,
          total INTEGER NOT NULL,
          prepaid INTEGER NOT NULL DEFAULT 0,
          payable INTEGER NOT NULL,
          reference TEXT,
          state TEXT NOT NULL DEFAULT 'mustand',
          sent TEXT, paid_at TEXT,
          reminder_step INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
        );
        INSERT INTO invoices_uus (id,number,company_id,offer_id,issued,due,total,prepaid,payable,
                                  reference,state,sent,paid_at,reminder_step)
          SELECT id,number,company_id,offer_id,issued,due,total,prepaid,payable,
                 reference,state,sent,paid_at,reminder_step FROM invoices;
        DROP TABLE invoices;
        ALTER TABLE invoices_uus RENAME TO invoices;
        CREATE INDEX IF NOT EXISTS idx_inv_company ON invoices(company_id, state);
      `);
    }
    const vead = db.prepare('PRAGMA foreign_key_check').all();
    if (vead.length) throw new Error('vota tagasi: FK kontroll leidis ' + vead.length + ' viga');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

// --- numbriseeria ------------------------------------------------------------
// Kaks paralleelset seeriat: 'arve' -> 2026-014, 'pakkumine' -> 2026-P-021.
// Number valjastatakse UHE tehinguga; kaks korraga kutsujat ei saa sama numbrit.
const PREFIX = { arve: '', pakkumine: 'P-' };

export function nextNumber(db, key, now = new Date()) {
  if (!(key in PREFIX)) throw new Error('tundmatu numbriseeria: ' + key);
  const year = now.getFullYear();
  db.exec('BEGIN IMMEDIATE');
  try {
    const cur = db.prepare('SELECT next FROM counters WHERE key=? AND year=?').get(key, year);
    const n = cur ? cur.next : 1;
    if (cur) db.prepare('UPDATE counters SET next=? WHERE key=? AND year=?').run(n + 1, key, year);
    else db.prepare('INSERT INTO counters (key,year,next) VALUES (?,?,?)').run(key, year, 2);
    db.exec('COMMIT');
    return `${year}-${PREFIX[key]}${String(n).padStart(3, '0')}`;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const iso = (d) => d.toISOString().slice(0, 10);
const plusDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// Ostja: kas muugitoru kirje VOI vabad valjad. Ilma nimeta ja hinnata
// dokumenti ei tehta - see oleks tuhi number seerias.
function ostja(db, { company_id, buyer, title, price }) {
  if (company_id) {
    const c = db.prepare('SELECT * FROM companies WHERE id=?').get(company_id);
    if (!c) throw new Error('tundmatu ettevote: ' + company_id);
    return {
      company_id, buyer: {name:c.name,reg:c.regcode,addr:c.loc,email:c.email},
      title: title || c.offer || 'Tookirjeldus',
      price: Number(price) || c.price,
      finding: c.finding || null,
      url: c.url || null,
    };
  }
  const nimi = String(buyer?.name || '').trim();
  if (!nimi) throw new Error('vaba ostja vajab nime');
  const summa = Math.round(Number(price) || 0);
  if (!summa) throw new Error('vaba ostja vajab hinda');
  return {
    company_id: null,
    buyer: {
      name: nimi,
      reg: String(buyer?.reg || '').trim() || null,
      addr: String(buyer?.addr || '').trim() || null,
      email: String(buyer?.email || '').trim() || null,
    },
    title: String(title || '').trim() || 'Tookirjeldus',
    price: summa,
    finding: null,
    url: null,
  };
}

// --- pakkumine ---------------------------------------------------------------
export function createOffer(db, { company_id, buyer, title, price, serviceId, validDays=14, now=new Date() }={}) {
  const service=serviceId ? serviceById(serviceId):null;
  if(serviceId && (!service || service.status!=='active')) throw new Error('Teenus ei ole praegu müüdav');
  if(service && price!==undefined && Number(price)!==service.price) throw new Error('Valitud paketi hind erineb kataloogist');
  const o=ostja(db,{company_id,buyer,title:service?.name.et || title,price:service?.price ?? price});
  if(!Number.isFinite(o.price) || o.price<=0) throw new Error('Pakkumine vajab positiivset hinda');
  if(o.company_id) {const existing=db.prepare("SELECT id,number FROM offers WHERE company_id=? AND state IN ('mustand','saadetud')").get(o.company_id);if(existing)return {...existing,existing:true};}
  const snapshot=service?serviceSnapshot(service.id):{catalogVersion:CATALOG_VERSION,seller:SELLER,service:null};
  const number=nextNumber(db,'pakkumine',now);
  const r=db.prepare("INSERT INTO offers(number,company_id,buyer_name,buyer_reg,buyer_addr,buyer_email,offer_id,title,price,hours,lead,includes,finding,issued,valid_until,state,catalog_version,service_snapshot,deposit_percent) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'mustand',?,?,?)")
    .run(number,o.company_id,o.buyer.name??null,o.buyer.reg??null,o.buyer.addr??null,o.buyer.email??null,service?.id??null,o.title,o.price,service?.hours??null,service?.lead.et??null,service?.includes.et??null,o.finding,iso(now),iso(plusDays(now,validDays)),CATALOG_VERSION,JSON.stringify(snapshot),service?.depositPercent??50);
  return {id:Number(r.lastInsertRowid),number};
}

// --- arve --------------------------------------------------------------------
export function createInvoice(db, {company_id,buyer,title,price,offer_id=null,kind='full',prepaidPct,dueDays=14,now=new Date()}={}) {
  if(!['full','deposit','balance'].includes(kind)) throw new Error('Tundmatu arve liik');
  const offer=offer_id ? db.prepare('SELECT * FROM offers WHERE id=?').get(offer_id) :
    (company_id ? db.prepare("SELECT * FROM offers WHERE company_id=? AND state='kinnitatud' ORDER BY id DESC").get(company_id):null);
  if(offer_id && !offer) throw new Error('Pakkumist ei leitud');
  if(offer && company_id && offer.company_id!==company_id) throw new Error('Pakkumine kuulub teisele ostjale');
  if (offer && buyer) for (const [key,column] of Object.entries({name:'buyer_name',reg:'buyer_reg',addr:'buyer_addr',email:'buyer_email'})) {
    if (buyer[key] !== undefined && String(buyer[key]??'').trim().toLowerCase() !== String(offer[column]??'').trim().toLowerCase()) throw new Error('Pakkumine kuulub teisele ostjale');
  }
  const o=offer ? {company_id:offer.company_id,buyer:{name:offer.buyer_name,reg:offer.buyer_reg,addr:offer.buyer_addr,email:offer.buyer_email},price:offer.price,title:offer.title}
    : ostja(db,{company_id,buyer,title,price});
  const contractTotal=offer?.price ?? o.price;
  if(!Number.isFinite(contractTotal) || contractTotal<=0) throw new Error('Arve vajab positiivset summat');
  if(kind!=='full' && !offer) throw new Error('Ettemaksu- ja lõpparve vajab kinnitatud pakkumist');
  if(kind!=='full' && offer.state!=='kinnitatud') throw new Error('Pakkumine peab olema kinnitatud');
  if(offer) {
    const rows=db.prepare("SELECT id,number,invoice_kind,total,prepaid,payable FROM invoices WHERE offer_id=? AND state<>'tuhistatud'").all(offer.id);
    const existing=rows.find(r=>r.invoice_kind===kind);
    if(existing)return {...existing,existing:true};
    if(rows.some(r=>r.invoice_kind==='full') || (kind==='full' && rows.length))throw new Error('Pakkumisel on juba arve; kontrolli olemasolevat dokumenti');
    if(kind==='deposit' && rows.some(r=>r.invoice_kind==='balance')) throw new Error('Lõpparve järel uut ettemaksuarvet ei koostata');
    if(kind==='balance' && rows.some(r=>r.invoice_kind==='deposit' && paymentTotal(db,r.id)<money(r.payable))) throw new Error('Ettemaksuarve peab olema täielikult tasutud või eraldi tühistatud');
  }
  const pct=Number(offer?.deposit_percent ?? prepaidPct ?? 50);
  if(!Number.isFinite(pct)||pct<0||pct>100)throw new Error('Ettemaksuprotsent on vigane');
  const received=offer ? offerPaymentTotal(db,offer.id):0;
  const total=kind==='deposit'?money(contractTotal*pct/100):contractTotal;
  const prepaid=kind==='balance'?received:0, payable=money(total-prepaid);
  if(payable<=0)throw new Error('Tasumisele kuuluv summa peab olema positiivne');
  const number=nextNumber(db,'arve',now), reference=number.replace(/\D/g,'');
  const r=db.prepare("INSERT INTO invoices(number,company_id,buyer_name,buyer_reg,buyer_addr,buyer_email,offer_id,issued,due,total,prepaid,payable,reference,state,invoice_kind,catalog_version,service_snapshot,deposit_percent) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'mustand',?,?,?,?)")
    .run(number,o.company_id,o.buyer.name??null,o.buyer.reg??null,o.buyer.addr??null,o.buyer.email??null,offer?.id??null,iso(now),iso(plusDays(now,dueDays)),total,prepaid,payable,reference,kind,offer?.catalog_version??CATALOG_VERSION,offer?.service_snapshot??JSON.stringify({seller:SELLER}),pct);
  const id=Number(r.lastInsertRowid), description=(kind==='deposit'?'Ettemaks: ':'')+(offer?.title||o.title||'Töö');
  db.prepare('INSERT INTO invoice_lines(invoice_id,description,detail,qty,unit,unit_price,amount) VALUES(?,?,?,1,?,?,?)')
    .run(id,description,offer?'Aluseks pakkumine nr '+offer.number:null,'tk',total,total);
  if(prepaid>0)db.prepare('INSERT INTO invoice_lines(invoice_id,description,detail,qty,unit,unit_price,amount) VALUES(?,?,?,1,?,?,?)')
    .run(id,'Tõendatud laekumised','Pakkumisega seotud maksete registri järgi','tk',-prepaid,-prepaid);
  return {id,number,total,prepaid,payable,kind};
}

// --- kustutamine -------------------------------------------------------------
// Pakkumine EI OLE raamatupidamisdokument - selle voib alati ara visata.
// Arve on. Seetottu: arvet saab kustutada ainult siis, kui teda ei ole
// KUNAGI valja saadetud. Valja lainud arvet ei kustutata, vaid tuhistatakse -
// nii jaab number seeriasse alles ja RPS-i jargne pidev numeratsioon pusib.
export function deleteDoc(db, kind, id) {
  const nr = Number(id);
  if (kind === 'pakkumine') {
    const o = db.prepare('SELECT number FROM offers WHERE id=?').get(nr);
    if (!o) throw new Error('pakkumist ei leitud');
    if (db.prepare('SELECT 1 FROM invoices WHERE offer_id=?').get(nr)) throw new Error('Arvega seotud pakkumist ei kustutata: ostja, hinna ja laekumiste seos peab säilima');
    db.prepare('DELETE FROM offers WHERE id=?').run(nr);
    return { ok: true, number: o.number, kind };
  }
  if (kind === 'arve') {
    const i = db.prepare('SELECT number, state, sent FROM invoices WHERE id=?').get(nr);
    if (!i) throw new Error('arvet ei leitud');
    if (db.prepare('SELECT 1 FROM payments WHERE invoice_id=?').get(nr)) throw new Error('Laekumisega arvet ei kustutata; parandus vajab eraldi raamatupidamistoimingut');
    if (i.sent) {
      throw new Error(`Arve ${i.number} on valja saadetud ${i.sent.slice(0, 10)} - seda ei kustutata. `
        + 'Vali seisuks "tuhistatud": number jaab seeriasse alles ja numeratsioon ei saa auku.');
    }
    db.prepare('DELETE FROM invoice_lines WHERE invoice_id=?').run(nr);
    db.prepare('DELETE FROM invoices WHERE id=?').run(nr);
    return { ok: true, number: i.number, kind };
  }
  throw new Error('tundmatu dokumendiliik: ' + kind);
}

export function docList(db) {
  // LEFT JOIN: vaba ostja dokumendil ei ole muugitoru kirjet ja ta ei tohi
  // sellepärast nimekirjast kaduda.
  const offers = db.prepare(`SELECT o.id, o.number, o.state, o.price AS total, o.issued, o.valid_until AS due,
                                    COALESCE(c.name, o.buyer_name, '—') AS company,
                                    o.company_id, 'pakkumine' AS kind, o.sent
                               FROM offers o LEFT JOIN companies c ON c.id=o.company_id`).all();
  const invoices = db.prepare(`SELECT i.id, i.number, i.state, i.payable AS total, i.issued, i.due,
                                      COALESCE(c.name, i.buyer_name, '—') AS company,
                                      i.company_id, 'arve' AS kind, i.sent
                                 FROM invoices i LEFT JOIN companies c ON c.id=i.company_id`).all();
  return [...invoices, ...offers].sort((a, b) => (b.issued + b.number).localeCompare(a.issued + a.number));
}

export function markOverdue(db, now = new Date()) {
  const today = iso(now);
  return db.prepare("UPDATE invoices SET state='ule_tahtaja' WHERE state='saadetud' AND due < ?").run(today).changes;
}

const money = n => Math.round(Number(n)*100)/100;
function paymentTotal(db, invoiceId) { return money(db.prepare('SELECT COALESCE(SUM(amount),0) n FROM payments WHERE invoice_id=?').get(invoiceId).n); }
function offerPaymentTotal(db, offerId) { return money(db.prepare('SELECT COALESCE(SUM(p.amount),0) n FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.offer_id=?').get(offerId).n); }

export function recordPayment(db,{invoice_id,amount,reference,received_at=new Date().toISOString(),confirmed_by='user:local-crm'}={}) {
  const paid=money(amount);
  if(!Number.isFinite(paid) || paid<=0 || !String(reference||'').trim() || !Number.isFinite(Date.parse(received_at))) throw new Error('Laekumine vajab summat, makseviidet ja kuupäeva');
  db.exec('BEGIN IMMEDIATE');
  try {
    const inv=db.prepare('SELECT * FROM invoices WHERE id=?').get(Number(invoice_id));
    if(!inv || inv.state==='tuhistatud') throw new Error('Arve puudub või on tühistatud');
    const old=db.prepare('SELECT * FROM payments WHERE reference=?').get(reference.trim());
    if(old) {
      if(old.invoice_id!==Number(invoice_id) || old.amount!==paid) throw new Error('Makseviide on juba kasutatud teise laekumise jaoks');
      db.exec('COMMIT'); return {...old,existing:true};
    }
    const existing=paymentTotal(db,inv.id);
    if(money(existing+paid)>inv.payable) throw new Error('Laekumine ületab arve tasumata summat');
    if (inv.offer_id) {
      const offer=db.prepare('SELECT price FROM offers WHERE id=?').get(inv.offer_id);
      if (!offer) throw new Error('Arve pakkumise seos vajab ülevaatust');
      if (money(offerPaymentTotal(db,inv.offer_id)+paid)>money(offer.price)) throw new Error('Laekumine ületab pakkumise kogusummat');
    }
    const r=db.prepare('INSERT INTO payments(invoice_id,amount,reference,received_at,confirmed_by,recorded_at) VALUES(?,?,?,?,?,?)')
      .run(inv.id,paid,reference.trim(),received_at,confirmed_by,new Date().toISOString());
    const total=money(existing+paid), settled=total===money(inv.payable);
    db.prepare('UPDATE invoices SET state=?,paid_at=? WHERE id=?').run(settled?'tasutud':'osaliselt_tasutud',settled?received_at:null,inv.id);
    db.exec('COMMIT'); return {id:Number(r.lastInsertRowid),invoice_id:inv.id,amount:paid,paid:total,remaining:money(inv.payable-total)};
  } catch(e){db.exec('ROLLBACK');throw e;}
}

export function revenueSummary(db, {now=new Date(),maxAgeDays=21,ownAddresses=[]}={}) {
  const payments=db.prepare('SELECT COUNT(*) n,COALESCE(SUM(amount),0) amount FROM payments').get();
  const own=new Set(['gert@leisson.eu',...String(process.env.CRM_SELF_EMAILS||'').split(','),...ownAddresses].map(a=>String(a).trim().toLowerCase()));
  const isOwn=address=>own.has(address) || address.endsWith('@leisson.eu');
  const businessCategories=new Set(['paring','vastus_pakkumisele','kohtumine','klienditoo']);
  const awaiting=db.prepare("SELECT * FROM messages WHERE direction='in' AND reply_intent='positive' AND replied=0 AND archived=0 AND deleted IS NULL AND julianday(ts)>=julianday(?)")
    .all(new Date(+now-maxAgeDays*86400000).toISOString()).filter(m=>{
    if(m.account!==CRM_MAIL_SOURCE_ACCOUNT || ownerSalesPause(db,{address:m.addr,companyId:m.company_id}))return false;
    if(m.classified!==1 || !businessCategories.has(m.category) || isOwn(String(m.addr||'').trim().toLowerCase())) return false;
    const text=latestMessageText(m.body_text);
    if(/(?:^|\[|\s)(?:self[- ]?test|testkiri|proovikiri|vormitest|testpäring|testipäring|proovipäring)(?:\]|\s|:|$)/i.test(m.subject||'')
      || /^(?:this is (?:a )?(?:form )?test|see on (?:vormi? )?test)/i.test(text)) return false;
    const formAddresses=[...text.matchAll(/^(?:e-post|e-?mail|email)\s*:\s*([^\s<>]+@[^\s<>]+)/gim)].map(match=>match[1].toLowerCase());
    if(formAddresses.some(isOwn)) return false;
    if(!replyDecision(m,{now,maxAgeDays}).allowed || suppressionReason(db,m.addr)) return false;
    if(m.company_id) {
      const latest=latestHumanReply(db,m.company_id);
      if(!latest || latest.account!==m.account || latest.mailbox!==m.mailbox || latest.uid!==m.uid) return false;
    }
    return true;
  });
  return {
    paymentCount:payments.n,received:payments.amount,
    qualified:db.prepare("SELECT id,email FROM companies WHERE sales_state='qualified'").all().filter(c=>!ownerSalesPause(db,{address:c.email,companyId:c.id})).length,
    awaitingReply:awaiting.length,
    awaitingReplyLabel:'Vastamist vajavad kirjad',
    awaitingReplyDefinition:{maxAgeDays,classifiedBusinessMessages:true,confirmedBuyers:false},
    openOffers:db.prepare("SELECT COUNT(*) n FROM offers WHERE state IN ('mustand','saadetud','kinnitatud')").get().n,
    deliveries:db.prepare("SELECT COUNT(*) n FROM companies WHERE sales_state='in_delivery'").get().n,
    provenance:'confirmed_payment_ledger',
  };
}
