import {ownerSalesPause,OWNER_SALES_PAUSE_REASON} from './owner-sales-pause.mjs';
// Kulmkirja saatmise varav. UKS reeglistik, mida kasutavad nii kasitsi saatmine
// kui automaatne saatja - nagu lib/gates.mjs massitoo ja konduktori jaoks.
//
// Kolm asja, mida see varav kaitseb:
//   1. SEADUS. ESS paragrahv 103^1 lubab arikliendile pakkumist saata, aga kiri peab olema
//      aratuntav ja kandma toimivat loobumisviisi. Eraisiku aadressile (gmail,
//      hotmail jms) kulmkirja EI SAADETA automaatselt - see laheb kasitsi rida.
//   2. DOMEENI MAINE. gert@leisson.eu EI OLE uhekordne saatmisdomeen - see on
//      Gerti paris toopostkast. Kui ta musta nimekirja laheb, ei kao mitte ainult
//      kulmkirjad, vaid ka pakkumised, arved ja vastused klientidele. Seepaast on
//      piir, aga piir peab olema MOODETUD, mitte kartusest valitud.
//
//      Mis on tegelik lagi (14.09.2026 avaldatud andmed, 2 mln kirja pohjal):
//        - turvaline vahemik on 50-100 kirja paevas UHE postkasti kohta;
//        - ule 150/paevas -> rikkeprotsent 43% korgem;
//        - PUHANGUS saatmine (palju kirju luhikese akna sees) tostab
//          rampsiks margistamist 26% vorra, ka siis kui paevakogus on vaike;
//        - parim kuju on 12-18 kirja tunnis 4-6 tunni jooksul tooajal.
//      leisson.eu autentimine on korras: SPF -all, DKIM (zone), DMARC p=none.
//
//      Seega: paevalimiit 40 (turvalise vahemiku alumine ots, sest kulmsaatmise
//      ajalugu on luhike), TUNNILIMIIT 8 puhangu vastu, ja vahe kirjade vahel.
//   3. TOTT. Kiri lubab "Olen T 15.09 teie kandis". Kui see paev on juba mooda,
//      ei saadeta seda kirja - katkine lubadus on halvem kui saatmata kiri.

export const VABAPOSTI = /@(gmail|hotmail|outlook|live|yahoo|mail\.ee|hot\.ee|icloud|proton(mail)?|me)\./i;

export function limits() {
  return {
    perDay: Number(process.env.SEND_PER_DAY || 40),      // kirju paevas kokku
    perRun: Number(process.env.SEND_PER_RUN || 5),       // kirju uhe jooksuga
    perHour: Number(process.env.SEND_PER_HOUR || 8),     // PUHANGUVARAV: kirju tunnis
    minGapMin: Number(process.env.SEND_GAP_MIN || 7),    // minutit kahe kirja vahel
    hourFrom: Number(process.env.SEND_HOUR_FROM || 9),   // tooaeg algus (kohalik)
    hourTo: Number(process.env.SEND_HOUR_TO || 17),      // tooaeg lopp
    lists: String(process.env.SEND_LISTS || 'parnu,parnu2').split(','),
  };
}

const ET = ['P', 'E', 'T', 'K', 'N', 'R', 'L'];

// Kirjas lubatud paev ("Olen T 15.09 teie kandis") - kas see on veel ees?
export function lubatudPaevMoodas(body, now = new Date()) {
  const m = /Olen\s+[ETKNRLP]\s+(\d{2})\.(\d{2})\s+teie kandis/.exec(body || '');
  if (!m) return false;
  const d = new Date(now.getFullYear(), Number(m[2]) - 1, Number(m[1]), 23, 59, 59);
  return d < now;
}

export function tooajal(now = new Date(), L = limits()) {
  const p = now.getDay();
  if (p === 0 || p === 6) return { ok: false, miks: 'nädalavahetus' };
  const h = now.getHours();
  if (h < L.hourFrom || h >= L.hourTo) return { ok: false, miks: `väljaspool tööaega (${L.hourFrom}–${L.hourTo})` };
  return { ok: true };
}

export function saadetudTana(db, now = new Date()) {
  const d = now.toISOString().slice(0, 10);
  return db.prepare("SELECT COUNT(*) n FROM activity WHERE kind='sent' AND substr(ts,1,10)=?").get(d).n;
}

/**
 * Mitu kirja on viimase 60 minuti sees valja laeinud.
 * PUHANGUVARAV: 14.09 hommikul laks 36 kirja kahe tunni sees. Paevalimiit uksi
 * seda ei takista - see on eraldi mooduv asi ja eraldi risk (+26% rampsiks
 * margistamist), seega ka eraldi piir.
 */
export function saadetudTunnis(db, now = new Date()) {
  const piir = new Date(now.getTime() - 60 * 60000).toISOString();
  return db.prepare("SELECT COUNT(*) n FROM activity WHERE kind='sent' AND ts > ?").get(piir).n;
}

export function viimatiSaadetud(db) {
  const r = db.prepare("SELECT ts FROM activity WHERE kind='sent' ORDER BY ts DESC LIMIT 1").get();
  return r ? new Date(r.ts) : null;
}

/** Kes tohib jargmisena kirja saada. Tagastab jarjekorra ja pohjendused. */
export function sendGate(db, { now = new Date(), L = limits() } = {}) {
  const aeg = tooajal(now, L);
  const tana = saadetudTana(db, now);
  const tunnis = saadetudTunnis(db, now);
  const viimati = viimatiSaadetud(db);
  const vahe = viimati ? (now - viimati) / 60000 : Infinity;

  // Loobumine kehtib kogu DOMEENI kohta, mitte ainult vastanud inimese kohta:
  // kirjutasime info@firma.ee-le, loobumise saatis kolleeg marketing@firma.ee.
  // Aadressipohine summutus oleks lasknud jargmise kirja ikka info@-le minna.
  const sum = db.prepare('SELECT addr, domain FROM suppressions').all();
  const summutatud = new Set(sum.map((x) => String(x.addr || '').toLowerCase()).filter(Boolean));
  const summutatudDom = new Set(
    sum.map((x) => String(x.domain || '').toLowerCase()).filter(Boolean),
  );

  const kohad = '?,'.repeat(L.lists.length).slice(0, -1);
  const read = db.prepare(
    `SELECT id, name, email, subject, body, listid, priority, meet_day, status
       FROM companies
      WHERE status='ootel' AND listid IN (${kohad})
      ORDER BY CASE priority WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END, name`,
  ).all(...L.lists);

  const miks = {};
  const lisa = (k) => { miks[k] = (miks[k] || 0) + 1; };
  const pass = [];
  for (const c of read) {
    if(ownerSalesPause(db,{address:c.email,companyId:c.id})){lisa(OWNER_SALES_PAUSE_REASON);continue;}
    if (!c.email) { lisa('e-posti ei ole'); continue; }
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(c.email)) { lisa('vigane aadress'); continue; }
    const ep = c.email.toLowerCase();
    if (summutatud.has(ep) || summutatudDom.has(ep.split('@')[1])) { lisa('summutusnimekirjas'); continue; }
    if (VABAPOSTI.test(c.email)) { lisa('eraisiku vabapost — käsitsi'); continue; }
    if (!c.subject || !c.body) { lisa('kiri ei ole valmis'); continue; }
    if (lubatudPaevMoodas(c.body, now)) { lisa('kirjas lubatud päev on möödas'); continue; }
    pass.push(c);
  }

  const eelarveJaab = Math.max(0, L.perDay - tana);
  const tunniRuum = Math.max(0, L.perHour - tunnis);
  // Kolm piiri korraga: paev, tund ja vahe. Koige kitsam neist otsustab.
  const lubatudNyyd = aeg.ok && vahe >= L.minGapMin
    ? Math.min(L.perRun, eelarveJaab, tunniRuum)
    : 0;

  return {
    kandidaate: read.length,
    labib: pass.length,
    miks,
    tanaSaadetud: tana,
    paevaLimiit: L.perDay,
    tunnisSaadetud: tunnis,
    tunniLimiit: L.perHour,
    eelarveJaab,
    minutitViimasest: Number.isFinite(vahe) ? Math.round(vahe) : null,
    tooajal: aeg,
    saadanNyyd: lubatudNyyd,
    eligibleIds: pass.map(c=>c.id),
    jarjekord: pass.slice(0, lubatudNyyd),
    ootel: pass.slice(lubatudNyyd),
    limits: L,
  };
}

// Loobumisviis on SEADUSEST tulenev nouе, mitte viisakus. Lisatakse iga
// automaatselt saadetud kirja lopus; kasitsi saadetud kiri saab sama rea CRM-ist.
export const LOOBUMISRIDA = [
  '',
  '—',
  'Kirjutasin teile, sest mõõtsin teie avalehe üle ja leidsin midagi konkreetset.',
  'Kui te ei soovi minult rohkem kirju, vastake ühe sõnaga „loobun" — rohkem ma ei kirjuta.',
  'LEISSON OÜ · reg 16952932 · Ülase tee 7, Püünsi küla, Viimsi vald · gert@leisson.eu',
].join('\n');

// Uks koht, kus loobumisrida kirja kulge pannakse. Kutsutakse serveri /api/send
// teest, nii et inimese klikk ja automaatne saatja saavad tapselt sama rea.
// Idempotentne: kaks korda kutsudes rida ei kordu.
export function kannabLoobumisrida(body) {
  return /kui te ei soovi minult rohkem kirju/i.test(String(body || ''));
}

export function lisaLoobumisrida(body) {
  const t = String(body || '');
  return kannabLoobumisrida(t) ? t : t.replace(/\s*$/, '') + '\n' + LOOBUMISRIDA;
}

// Loobumise tuvastus. Vana, lai muster andis kolmest leiust kaks valepositiivset:
//   - uudiskirja OMA "Click here to unsubscribe" jalus       -> ei ole loobumine
//   - reklaamitekst "eemalda taustalt objekte"               -> ei ole loobumine
// Seetottu kolm kitsendust, mis kaivad KOOS (vt onLoobumine):
//   1. ainult nende saatjate kirjad, kellele me ise oleme kirjutanud;
//   2. ainult vastuse OMA osa, tsiteeritud algkirjast ja jalusest ulalpool;
//   3. sonad, mis uksi seistes tahendavad loobumist - mitte iga "eemalda".
// MUUGI-EI EI OLE LOOBUMISAVALDUS.
// Tootmises summutas vana muster AS Papiniidu Projekti (Näidiskauplus) lause
// "Tananme pakkumise eest, aga hetkel ei soovi teenust" peale ara. See on
// PAKKUMISE tagasilukkamine, mitte ESS-i mottes kirjadest loobumine - ja
// "hetkel" tahendab otse valja oeldult "mitte praegu", mitte "mitte kunagi".
// Selline ule-summutamine maksab soojad kontaktid ilma, et keegi oleks seda
// palunud. Loobumine peab puudutama KIRJU, mitte pakkumist.
// NB JavaScripti \b ON ASCII-pohine: "a", "o", "u", "o", "s", "z" EI OLE tema jaoks
// sonatahed, seega /\barge saatke/ EI TABA teksti "palun arge saatke". See vaikne
// viga oleks jatnud PARIS loobumise tunnustamata - ja see on ainus suund, kuhu
// selles varavas eksida ei tohi. Seeparast oma sonapiir, mis tunneb eesti tahti.
const T = 'A-Za-z0-9_äöüõšžÄÖÜÕŠŽ';
const sp = (muster) => new RegExp(`(^|[^${T}])(${muster})($|[^${T}])`, 'i');
const kas = (re, t) => re.test(String(t || ''));

const MUUGI_EI = sp('(ei soovi|pole|ei ole)\\s+(seda\\s+|antud\\s+|praegu\\s+|hetkel\\s+)?(teenust|pakkumist|toodet|koostööd|huvitatud)');

export const LOOBUMISSONAD = sp([
  'loobu[n]?',
  'ei soovi (rohkem |enam )?(kirju|e-kirju|teateid|pakkumisi)',
  'ära saada', 'ärge saatke', 'ära kirjuta', 'ärge kirjutage', 'ärge saatke mulle',
  'võta mind nimekirjast', 'eemalda mind( nimekirjast)?',
  'unsubscribe', 'remove me', 'stop (emailing|contacting) me', 'do not (contact|email) me',
].join('|'));

/**
 * Kas see tekst on KIRJADEST loobumine (ja mitte pakkumise tagasilukkamine)?
 * Kaks tingimust: loobumissona on olemas JA lause ei ole muugi-ei.
 */
export function onKirjadestLoobumine(tekst) {
  const t = String(tekst || '');
  if (!kas(LOOBUMISSONAD, t)) return false;
  // Kui ainus tabamus on muugi-ei kontekstis, siis see ei ole loobumine.
  const puhas = t.replace(new RegExp(MUUGI_EI.source, 'gi'), ' ');
  return kas(LOOBUMISSONAD, puhas);
}

export { MUUGI_EI };

// Kus vastus loppeb ja tsiteeritud algkiri algab.
const TSITAAT = /^\s*(>|-{2,}\s*Original|_{5,}|From:\s|Saatja:\s|On .{5,60} wrote:|Kirjutas .{3,60}:|-{2,}\s*Edastatud)/m;

// Uudiskirja jalus kirjutab "Click here to unsubscribe (https://...)" - see on
// SAATJA enda link, mitte lugeja soov. Inimese loobumises URL-i ei ole, seega
// viskame lingiread ja "click here"-read enne tuvastust valja.
const JALUSERIDA = /^.*(https?:\/\/|click here to unsubscribe|view (this|in) browser|manage .{0,20}preferences).*$/gim;

export function vastuseOmaOsa(body) {
  const t = String(body || '').replace(/\r/g, '');
  const m = t.match(TSITAAT);
  return (m ? t.slice(0, m.index) : t).replace(JALUSERIDA, '').slice(0, 2000);
}

// Kas see sissetulev kiri on loobumine?
// saatnud = hulk DOMEENE, kuhu me oleme kirjutanud (Set, vaiketahti).
// Miks domeen, mitte aadress: kirjutasime info@retail.example.test-le, vastas
// marketing@retail.example.test ehk kolleeg. Tapse aadressi nouded oleks
// paris loobumise maha maganud - nii juhtuski tootmises.
export function onLoobumine(msg, saatnud) {
  const addr = String(msg.addr || '').toLowerCase();
  if (!addr.includes('@')) return false;
  // Uudiskiri domeenist, kuhu me pole kunagi ise kirjutanud, ei saa meist loobuda.
  if (saatnud && !saatnud.has(addr.split('@')[1])) return false;
  // Masinaadress ei kirjuta loobumist - ta kannab seda oma jaluses.
  if (/^(no-?reply|donotreply|noreply|mailer|bounce)/i.test(addr.split('@')[0])) return false;
  return onKirjadestLoobumine(`${msg.subject || ''}\n${vastuseOmaOsa(msg.body_text)}`);
}
