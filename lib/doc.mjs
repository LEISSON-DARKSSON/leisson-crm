// A4 dokument: arve ja pakkumine. 210 x 297 mm portree, alati.
//
// Kujundusreeglid (Orbit):
//   - hallid pinnad on 100% must; halli tooni kasutatakse AINULT mustal aluspinnal
//   - valgel paberil on iga tahemark 100% must
//   - logo tuleb lib/logo.mjs-ist ja on sama mis kodulehel ja allkirjal
//   - kaibemaksurida EI OLE, kuni LEISSON OU ei ole kaibemaksukohustuslane

import { logoPrint } from './logo.mjs';
import {SELLER} from '../../packages/service-catalog/index.mjs';

export const MYYJA = {
  nimi: 'LEISSON OÜ',
  reg: '16952932',
  aadress: ['Ülase tee 7, Püünsi küla', 'Viimsi vald 74013, Harjumaa, Eesti'],
  tel: '+372 5880 1355',
  epost: 'leisson@leisson.eu',
  veeb: 'leisson.eu/et/prices',
  iban: 'EE521010220302185228',
  pank: 'AS SEB Pank, Tornimäe 2, 15010 Tallinn',
  swift: 'EEUHEE2X',
};

// UKS lyliti kogu maja jaoks. Registreerumisel muuda seda uht rida.
export const VAT_REGISTERED = SELLER.vatRegistered;

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const eur = (n) => new Intl.NumberFormat('et-EE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' €';
export const pv = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');

export const CSS = `
@page { size: A4 portrait; margin: 0; }
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#6B6B70;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media print{html,body{background:#fff}.noprint{display:none!important}}
.noprint{position:fixed;top:14px;right:14px;z-index:9;display:flex;gap:8px;font:600 14px/1 Barlow,Arial,sans-serif}
.noprint button{font:inherit;height:38px;padding:0 18px;border:0;background:#000;color:#fff;cursor:pointer}
.noprint a{font:inherit;height:38px;padding:0 18px;border:1px solid #000;background:#fff;color:#000;display:grid;place-items:center;text-decoration:none}
/* 17 mm valge veeris kogu A4 perimeetril: sinna ei tule uhtegi mustandit ega
   musta pinda. Trukikoda ja iga kontoriprinter mahuvad selle sisse. */
.sheet{width:210mm;min-height:297mm;margin:12mm auto;background:#fff;color:#000;
  font-family:Barlow,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.5;
  padding:17mm;display:flex}
@media print{.sheet{margin:0;width:210mm;min-height:297mm;box-shadow:none}}
.page{flex:1 1 auto;min-width:0;min-height:263mm;display:flex;flex-direction:column}
.band{background:#000;color:#fff;padding:9mm 9mm 7mm;display:flex;justify-content:space-between;align-items:flex-end;gap:10mm;flex-wrap:wrap}
.logo{font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;line-height:1;white-space:nowrap}
.logo .a{font-weight:800;font-size:34px;letter-spacing:.005em}
.logo .b{font-weight:400;font-size:34px;letter-spacing:.10em;color:rgba(255,255,255,.72)}
.logo .sub{display:block;font-family:'IBM Plex Mono',Consolas,monospace;font-size:10.5px;letter-spacing:.16em;
  text-transform:uppercase;margin-top:7px;color:rgba(255,255,255,.72);white-space:normal}
.kind{text-align:right}
.kind .t{font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:30px;letter-spacing:.05em;line-height:1}
.kind .no{font-family:'IBM Plex Mono',Consolas,monospace;font-size:17px;margin-top:6px;letter-spacing:.04em}
.body{padding:9mm 9mm 0;display:grid;gap:7mm;flex:1;align-content:start}
.meta3{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm;border-bottom:1.5px solid #000;padding-bottom:6mm}
.lb{font-family:'IBM Plex Mono',Consolas,monospace;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase}
.vl{font-size:17px;font-weight:600;margin-top:3px;font-variant-numeric:tabular-nums}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:8mm}
.party .lb{border-bottom:1.5px solid #000;padding-bottom:4px;margin-bottom:5px;display:block}
.party p{margin:0;font-size:14.5px;line-height:1.55}
table{width:100%;border-collapse:collapse;font-size:14.5px}
thead th{background:#000;color:#fff;font-family:'IBM Plex Mono',Consolas,monospace;font-size:10.5px;
  letter-spacing:.16em;text-transform:uppercase;font-weight:400;padding:9px 10px;text-align:left}
tbody td{padding:10px;border-bottom:1px solid #000;vertical-align:top}
.r{text-align:right;font-family:'IBM Plex Mono',Consolas,monospace;font-variant-numeric:tabular-nums;white-space:nowrap}
.lead{font-weight:700;font-size:15.5px}
.sub2{font-size:13.5px;line-height:1.5;margin-top:3px}
ul.inc{margin:7px 0 0;padding-left:18px;font-size:14.5px;line-height:1.6}
.payblock{border:1.5px solid #000;padding:6mm;font-size:14.5px;line-height:1.6}
.payblock .lb{display:block;margin-bottom:4px}
.totalband{background:#000;color:#fff;display:flex;justify-content:space-between;align-items:baseline;
  gap:8mm;padding:6mm 9mm;margin-top:auto}
.totalband .lb{font-size:11.5px;letter-spacing:.18em}
.amt{font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:46px;line-height:1;font-variant-numeric:tabular-nums}
.footband{background:#000;color:rgba(255,255,255,.80);padding:6mm 9mm;font-size:12.5px;line-height:1.65}
.footband b{color:#fff}
`;

export const HEAD = (title) => `<!doctype html><html lang="et"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@400;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${CSS}</style></head><body>
<div class="noprint"><a href="/">CRM</a><button onclick="print()">Prindi / PDF</button></div>`;

// Lukk tuleb lib/logo.mjs-ist. Siin teda EI kirjutata uuesti.
export const BAND = (kind, number) => `<div class="band">
  ${logoPrint()}
  <div class="kind"><div class="t">${esc(kind)}</div><div class="no">${esc(number)}</div></div>
</div>`;

const MYYJA_HTML = (roll) => `<div class="party"><span class="lb">${roll}</span><p><b>${esc(MYYJA.nimi)}</b><br>
Registrikood ${esc(MYYJA.reg)}<br>${MYYJA.aadress.map(esc).join('<br>')}<br>
${esc(MYYJA.tel)}<br>${esc(MYYJA.epost)}</p></div>`;

// Ostja tuleb kas muugitorust VOI dokumendi enda vabadelt valjadelt.
// Vabad valjad on selleks, et arvet saaks teha ka sellele, keda torus ei ole -
// uhekordne too, edasimuuja, sober. Torru ei teki selle parast valekirjet.
export function buyerOf(db, row) {
  if (!row.buyer_name && row.company_id) {
    const c = db.prepare('SELECT * FROM companies WHERE id=?').get(row.company_id);
    if (c) return { name: c.name, regcode: c.regcode, loc: c.loc, email: c.email, url: c.url };
  }
  return {
    name: row.buyer_name || 'Ostja',
    regcode: row.buyer_reg || null,
    loc: row.buyer_addr || null,
    email: row.buyer_email || null,
    url: null,
  };
}

const OSTJA_HTML = (roll, c) => {
  const read = [
    c.regcode ? 'Registrikood ' + esc(c.regcode) : null,
    c.loc ? esc(c.loc) : null,
    c.email ? esc(c.email) : null,
    c.url ? 'Objekt: ' + esc(String(c.url).replace(/^https?:\/\//, '').replace(/\/$/, '')) : null,
  ].filter(Boolean);
  return `<div class="party"><span class="lb">${roll}</span><p><b>${esc(c.name)}</b><br>${read.join('<br>')}</p></div>`;
};

const VATLINE = VAT_REGISTERED
  ? '<b>Käibemaks lisandub vastavalt seadusele.</b>'
  : '<b>LEISSON OÜ ei ole käibemaksukohustuslane, käibemaksu ei lisandu.</b> Hinnakirja number on lõppsumma.';


function vatLine(row) { const seller=JSON.parse(row.service_snapshot || '{}').seller; if(!seller)return VATLINE;return seller.vatRegistered?'Hind ja käibemaks vastavalt dokumendi tingimustele.':'LEISSON OÜ ei ole käibemaksukohustuslane. Käibemaksu ei lisandu; summa on lõpphind.'; }

export function renderInvoice(db, id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(Number(id));
  if (!inv) return null;
  const c = buyerOf(db, inv);
  const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY id').all(inv.id);
  const offer = inv.offer_id ? db.prepare('SELECT number, accepted FROM offers WHERE id=?').get(inv.offer_id) : null;

  return HEAD('Arve ' + inv.number) + `<div class="sheet"><div class="page">
${BAND('ARVE', inv.number)}
<div class="body">
  <div class="meta3">
    <div><span class="lb">Kuupäev</span><div class="vl">${pv(inv.issued)}</div></div>
    <div><span class="lb">Maksetähtaeg</span><div class="vl">${pv(inv.due)}</div></div>
    <div><span class="lb">Viitenumber</span><div class="vl">${esc(inv.reference || '—')}</div></div>
  </div>
  <div class="parties">${MYYJA_HTML('Müüja')}${OSTJA_HTML('Ostja', c)}</div>
  <table>
    <thead><tr><th>Majandusliku sisu kirjeldus</th><th class="r">Kogus</th><th class="r">Hind</th><th class="r">Summa</th></tr></thead>
    <tbody>${lines.map((l) => `<tr>
      <td><span class="lead">${esc(l.description)}</span>${l.detail ? `<div class="sub2">${esc(l.detail)}</div>` : ''}</td>
      <td class="r">${l.qty} ${esc(l.unit)}</td><td class="r">${eur(l.unit_price)}</td><td class="r"><b>${eur(l.amount)}</b></td>
    </tr>`).join('')}</tbody>
  </table>
  <div class="payblock"><span class="lb">Makse</span>
    Saaja <b>${esc(MYYJA.nimi)}</b> · IBAN <b>${esc(MYYJA.iban)}</b><br>
    ${esc(MYYJA.pank)} · SWIFT <b>${esc(MYYJA.swift)}</b><br>
    Selgitusse palun <b>arve number ${esc(inv.number)}</b>${inv.reference ? ` või viitenumber <b>${esc(inv.reference)}</b>` : ''}
  </div>
</div>
<div class="totalband"><span class="lb">Tasumisele kuulub</span><span class="amt">${eur(inv.payable)}</span></div>
<div class="footband">
  ${vatLine(inv)}<br>
  Makse küsimuste korral palun kirjuta leisson@leisson.eu.<br>
  ${offer ? `Arve aluseks on pakkumine nr ${esc(offer.number)}${offer.accepted ? ' ja selle kinnitus ' + pv(offer.accepted) : ''}. ` : ''}Allkirja ei ole vaja (RPS § 7).
</div>
</div></div></body></html>`;
}

export function renderOffer(db, id) {
  const o = db.prepare('SELECT * FROM offers WHERE id=?').get(Number(id));
  if (!o) return null;
  const c = buyerOf(db, o);
  const deposit=o.deposit_percent ?? 50;
  const terms=JSON.parse(o.service_snapshot || '{}').service;
  const limits=terms?.excludes?.et?.join('; ') || 'Eritööd lepitakse eraldi kokku.';

  return HEAD('Pakkumine ' + o.number) + `<div class="sheet"><div class="page">
${BAND('PAKKUMINE', o.number)}
<div class="body">
  <div class="meta3">
    <div><span class="lb">Kuupäev</span><div class="vl">${pv(o.issued)}</div></div>
    <div><span class="lb">Kehtib kuni</span><div class="vl">${pv(o.valid_until)}</div></div>
    <div><span class="lb">Tarneaeg</span><div class="vl">${esc(o.lead || 'kokkuleppel')}</div></div>
  </div>
  <div class="parties">${MYYJA_HTML('Pakkuja')}${OSTJA_HTML('Saaja', c)}</div>
  <table>
    <thead><tr><th>Töö</th><th class="r">Maht</th><th class="r">Hind</th></tr></thead>
    <tbody><tr>
      <td><span class="lead">${esc(o.title)}</span>
        ${o.finding ? `<div class="sub2">Lähtekoht: ${esc(o.finding)}</div>` : ''}
        ${o.includes ? `<ul class="inc">${String(o.includes).split('\n').filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </td>
      <td class="r">${o.hours ? o.hours + ' h' : '—'}</td>
      <td class="r"><b>${eur(o.price)}</b></td>
    </tr></tbody>
  </table>
  <div class="payblock"><span class="lb">Tingimused</span>
    Pakkumine kehtib <b>14 päeva</b> · Ettemaks <b>${deposit}%</b>, töö algab laekumisest · Maksetähtaeg <b>14 päeva</b><br>
    ${terms?.revisionRounds ? esc(terms.revisionRounds)+" koondatud parandusring. " : ""}Tarneaeg algab vajaliku sisendi ja ligipääsu saamisest.<br>Piirid: ${esc(limits)}<br>
    Ligipääsud kliendi süsteemidesse lõpevad üleandmise päeval.
  </div>
</div>
<div class="totalband"><span class="lb">Pakkumise summa</span><span class="amt">${eur(o.price)}</span></div>
<div class="footband">
  ${vatLine(o)}<br>
  Kinnitamiseks vasta sellele kirjale sõnaga „kinnitan" — selle peale väljastatakse ettemaksuarve.<br>
  ${esc(MYYJA.nimi)} · ${MYYJA.aadress.join(', ')} · ${esc(MYYJA.epost)} · ${esc(MYYJA.veeb)}
</div>
</div></div></body></html>`;
}
