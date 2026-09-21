/* Leisson CRM — riigihangete vaate PUHAS loogika. Sõltuvusteta, DOM-ita.
 *
 * MIKS ERALDI FAIL. views.js ehitab DOM-i ja teda ei saa Node'is testida ilma
 * brauserita. Kõik, mis siin sees on — tähtajani jäänud päevad, seisufilter,
 * kiireloomuliste loendur ja rea vormindus — on puhas: sama sisend annab alati
 * sama väljundi, kella ja ajavööndita. test/gate-hanked-ui.mjs käivitab TÄPSELT
 * selle faili node:vm-is ja kontrollib piirijuhtumeid päris väidetega.
 *
 * Klassikaline skript (mitte ESM), sest index.html laeb ta <script src>-iga ja
 * views.js on samuti klassikaline IIFE — moodul laaduks hiljem ja window.HankedLoogika
 * oleks views.js-i jaoks tühi.
 */
(() => {
  // Tähtaeg → UTC-kesköö millisekundites. SAMA reegel mis lib/hanked.mjs paev():
  // Date.parse üksi ei kõlba, sest '2026-09-24 17:00' loetaks KOHALIKUS ajas ja
  // '2026-02-31' oleks Date'i jaoks 1. märts, kuigi RHR-is on ta viga.
  const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;
  function paevUTC(v) {
    const m = typeof v === 'string' ? v.match(ISO) : null;
    if (!m) return null;
    const [a, k, p] = [+m[1], +m[2], +m[3]];
    const t = Date.UTC(a, k - 1, p);
    const d = new Date(t);
    if (d.getUTCFullYear() !== a || d.getUTCMonth() !== k - 1 || d.getUTCDate() !== p) return null;
    return t;
  }

  /* Tähtajani jäänud KALENDRIpäevad, või null, kui tähtaeg on puudu või loetamatu.
   *
   * AJAVÖÖNDIVIGA, mida see parandab: Date.parse('2026-09-24') on UTC-kesköö,
   * Date.now() on kohalik hetk. Eestis (UTC+2/+3) annab
   * Math.round((Date.parse(d) - Date.now()) / 86400000) õhtul ÜHE VÕRRA vale
   * vastuse — 21. septembri õhtul tuleb 24. septembrini "2 päeva", mitte 3, ja
   * 29. september mahub valesti 7 päeva sisse ehk kiireloomuliste hulka.
   *
   * Lahendus: mõlemad otsad on KALENDRIPÄEVAD. Tänane päev võetakse kohaliku
   * kalendri järgi (getFullYear/getMonth/getDate) ja teisendatakse UTC-keskööks,
   * nagu tähtaegki. Vahe on siis alati täisarv ja kellaaeg teda ei liiguta.
   */
  function paevi(deadline, nyyd = new Date()) {
    const t = paevUTC(deadline);
    if (t === null) return null;
    const n = nyyd instanceof Date ? nyyd : new Date(nyyd);
    if (Number.isNaN(n.getTime())) return null;
    const tana = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
    return (t - tana) / 86400000;
  }

  // Kiireloomuline = tähtajani kuni NII palju päevi. Möödunud tähtaeg EI ole
  // kiireloomuline, vaid möödas — vt onKiire.
  const KIIRE_PAEVI = 7;

  // Kiireloomuline on AINULT puutumata hange (seis 'uus'), mille tähtaeg on
  // täna või kuni seitsme päeva pärast. Möödunud tähtaeg jääb välja ka siis, kui
  // markExpired ei ole veel jooksnud — vastasel juhul paisutaks vana praht märki.
  function onKiire(h, nyyd) {
    if (!h || h.state !== 'uus') return false;
    const p = paevi(h.deadline, nyyd);
    return p !== null && p >= 0 && p <= KIIRE_PAEVI;
  }
  function kiireloomulised(hanked, nyyd) {
    return (hanked || []).filter((h) => onKiire(h, nyyd));
  }

  /* Seisufilter. `lopuseisud` tuleb SERVERILT (GET /api/hanked → lopuseisud) —
   * siin ei ole ühtegi käsitsi kirjutatud seisunime. Kui server lisab uue
   * lõppseisu, kaob ta aktiivsete alt ilma seda faili puutumata.
   *
   * Tundmatu või puuduv lopuseisud (vana server) EI TOHI ridu vaikselt peita:
   * siis on "aktiivsed" sama mis "kõik". Liiga palju näidata on parem kui kaotada.
   */
  function aktiivsed(states, lopuseisud) {
    const lopp = Array.isArray(lopuseisud) ? lopuseisud : [];
    return (states || []).filter((s) => !lopp.includes(s));
  }
  function filtreeri(hanked, filter, lopuseisud) {
    const read = hanked || [];
    const seis = (filter && filter.seis) || 'aktiivsed';
    if (seis === 'kõik') return read.slice();
    if (seis === 'aktiivsed') {
      const lopp = Array.isArray(lopuseisud) ? lopuseisud : [];
      return read.filter((h) => !lopp.includes(h.state));
    }
    return read.filter((h) => h.state === seis);
  }

  // Kõik tekstiväljad käivad siit läbi: RHR-ist tulev väärtus võib olla null,
  // number või objekt. Väljundiks on ALATI string — lehele ei tohi jõuda
  // 'undefined' ega 'null'. Lühendamist siin ei tehta (see on CSS-i töö).
  function tekst(v, asendus) {
    if (v === null || v === undefined) return asendus;
    const s = String(v).trim();
    return s === '' ? asendus : s;
  }
  function kuupaev(v) {
    const m = typeof v === 'string' ? v.match(ISO) : null;
    return m ? m[3] + '.' + m[2] + '.' + m[1] : '—';
  }
  function tahtajaSilt(p) {
    if (p === null) return { text: '—', klass: 'muted' };
    if (p < 0) return { text: -p + ' p tagasi', klass: 'muted' };
    if (p === 0) return { text: 'täna', klass: 'kiire' };
    return { text: p + ' p', klass: p <= KIIRE_PAEVI ? 'kiire' : '' };
  }
  // Skoori KLASS, mitte otsusesõna. Lõpliku otsuse (sh ALLTÖÖVÕTT) annab
  // lib/hanked.mjs score() ja teda EI SAA punktidest tagasi arvutada —
  // 80-punktine alltöövõtu-hange näeks siin välja nagu 'PAKU'. Seetõttu näitab
  // tabel arvu ja detailvaade (ülesanne 10) põhjendusridu.
  function skooriKlass(score) {
    if (typeof score !== 'number' || !Number.isFinite(score)) return '';
    return score >= 60 ? 'top' : score >= 35 ? 'kaalu' : 'jata';
  }

  // Üks baasirida → üks tabelirida PUHTA andmena. Ainult tekst ja arvud; DOM-i
  // ehitab views.js el()-iga, mis kirjutab textContent-i.
  function riviks(h, nyyd) {
    const p = paevi(h && h.deadline, nyyd);
    const score = typeof (h && h.score) === 'number' && Number.isFinite(h.score) ? h.score : null;
    const est = typeof (h && h.est) === 'number' && Number.isFinite(h.est) ? h.est : null;
    return {
      ref: tekst(h && h.ref, '—'),
      state: tekst(h && h.state, 'uus'),
      paevi: p,
      kuupaev: kuupaev(h && h.deadline),
      tahtaeg: tahtajaSilt(p),
      buyer: tekst(h && h.buyer, 'hankija teadmata'),
      title: tekst(h && h.title, 'nimetuseta'),
      menetlus: tekst(h && h.menetlus, '—'),
      est,
      score,
      skooriKlass: skooriKlass(score),
      docs: Number.isFinite(Number(h && h.docs_count)) ? Number(h.docs_count) || 0 : 0,
      kiire: onKiire(h, nyyd),
    };
  }

  const API = { KIIRE_PAEVI, paevi, onKiire, kiireloomulised, aktiivsed, filtreeri, riviks, tahtajaSilt, kuupaev, tekst, skooriKlass };
  if (typeof window !== 'undefined') window.HankedLoogika = API;
})();
