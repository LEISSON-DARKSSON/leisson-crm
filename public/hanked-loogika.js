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

  /* OTSUSEVEERG. Skoori KLASS üksi ei kõlba: lib/hanked.mjs score() annab ka
   * verdikti ja ALLTÖÖVÕTT on seal ÜLIMUSLIK — 40-punktine alltöövõtu-hange
   * ei ole "KAALU". Seepärast kannab baas verdikti nüüd ise (veerg `verdict`)
   * ja siin näidatakse TEDA, mitte punktidest tehtud oletust.
   *
   * Verdiktita rida (käsitsi import, ülesande 6 eForms-tee, vana baas) langeb
   * tagasi punktiklassile; TUNDMATU verdikt (server lisas uue) jääb toorelt
   * nähtavaks, sest vaikne kadu on halvem kui tundmatu sõna. */
  const VERDIKTI_KLASS = { 'PAKU': 'top', 'KAALU': 'kaalu', 'JÄTA': 'jata', 'ALLTÖÖVÕTT': 'allt' };
  function verdiktiKlass(v) {
    return (typeof v === 'string' && VERDIKTI_KLASS[v.trim().toUpperCase()]) || '';
  }
  function otsus(verdict, score) {
    const v = typeof verdict === 'string' ? verdict.trim() : '';
    const arv = typeof score === 'number' && Number.isFinite(score) ? String(score) : '—';
    if (!v) return { verdict: null, tekst: arv, klass: skooriKlass(score) };
    return { verdict: v, tekst: v + ' · ' + arv, klass: verdiktiKlass(v) || skooriKlass(score) };
  }

  /* KÄSUNUPU SEIS (ülesanne 10) PUHTA andmena: mida nupp ütleb, kas ta on
   * keelatud ja MIKS, mida staatusrida näitab ja kas „Peata" saab üldse midagi
   * teha. See on loogika, mitte DOM — seega on ta siin ja test/gate-hanked-ui.mjs
   * katab ta päris väidetega; views.js ainult joonistab tulemuse.
   *
   * Kolm asja, mis siin valesti lähevad ja mida vaade ise ei näeks:
   *   valmis:false — agent/hanked-history.mjs ja agent/hanked-docs.mjs EI OLE
   *     veel olemas. Nupp peab olema keelatud ja seletatud, mitte spawnima
   *     puuduvat faili ja saama vastuseks 400;
   *   oma:false    — jooks kuulub EELMISELE serveri-instantsile. Tema pid võib
   *     vahepeal ringlusse minna, seega server keeldub teda tapmast (vt
   *     lib/hanked-runs.mjs stopRun). Nupp ei tohi lubada seda, mida ta ei saa;
   *   progress:null — väravajooks ei trüki JSON-progressiridu. Igavene
   *     „käivitub" oleks vale: näitame logi viimast SISUKAT rida. */
  function logiRida(saba) {
    if (typeof saba !== 'string') return null;
    const read = saba.split('\n').map((r) => r.trim())
      .filter((r) => r && r[0] !== '{');           // JSON-rida on masinale, mitte inimesele
    return read.length ? read[read.length - 1].slice(0, 160) : null;
  }
  function jooksuSeis(r) {
    if (r && typeof r.progress === 'string' && r.progress.trim()) return r.progress.trim();
    return logiRida(r && r.logTail) || 'käivitub';
  }
  function lopuRida(r) {
    const viga = r.state !== 'tehtud';
    return {
      id: r.id, state: r.state, finished: r.finished || null,
      rows: Number.isFinite(Number(r.rows)) ? Number(r.rows) : 0,
      viga,
      tulemus: viga ? tekst(r.error, r.state) : 'korras',
    };
  }
  function nupuSeis(cmd, t, runs) {
    const label = tekst(t && t.label, cmd);
    const valmis = !(t && t.valmis === false);
    const read = Array.isArray(runs) ? runs : [];
    const kaib = read.find((r) => r && r.cmd === cmd && r.state === 'käib') || null;
    const viimane = read.find((r) => r && r.cmd === cmd && r.state !== 'käib') || null;
    return {
      cmd, label, valmis, kaib,
      tekst: kaib ? label + ' …' : label,
      keelatud: !valmis || Boolean(kaib),
      pohjus: !valmis
        ? label + ' ei ole veel valmis: skript puudub (' + tekst(t && t.script, 'tundmatu fail') + ')'
        : kaib ? label + ' käib juba' : null,
      seis: kaib ? jooksuSeis(kaib) : null,
      peata: Boolean(kaib && kaib.oma === true),
      lopp: viimane ? lopuRida(viimane) : null,
    };
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
      verdict: tekst(h && h.verdict, null),
      otsus: otsus(h && h.verdict, score),
      docs: Number.isFinite(Number(h && h.docs_count)) ? Number(h.docs_count) || 0 : 0,
      kiire: onKiire(h, nyyd),
    };
  }

  const API = { KIIRE_PAEVI, paevi, onKiire, kiireloomulised, aktiivsed, filtreeri, riviks,
    tahtajaSilt, kuupaev, tekst, skooriKlass, verdiktiKlass, otsus, nupuSeis, jooksuSeis, logiRida };
  if (typeof window !== 'undefined') window.HankedLoogika = API;
})();
