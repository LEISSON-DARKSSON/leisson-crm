// URL-i lugemine UHE kohaga, et aegumine oleks ka pariselt aegumine.
//
// MIKS SEE FAIL OLEMAS ON. Molemad agendid (hanked-sync, hanked-history) tegid
// `fetch(url, { signal: AbortSignal.timeout(N) })` ja siis eraldi `await res.text()`.
// See muster nagi valja turvaline ja ei olnud: ulesande 13 mootmisel jai
// hanked-history allalaadimine Windowsis (Node 25.6.1) rippuma ULE 9 MINUTI,
// kuigi AEGUMINE oli 5 minutit. Pohjus on selles, et `fetch` lahendus tuleb juba
// PAISTE peale - keha (21 MB) loetakse alles `res.text()`-is, ja seisma jaanud
// keha lugemist signaal seal enam usaldusvaarselt katki ei tee.
//
// Tagajarg oleks olnud vaikne: kuine Task Scheduleri jooks rippuks igavesti,
// hoiaks `hanke_runs` rida 'käib' seisus ja JARGMINE kuu jooks teataks
// "kaib juba - jai vahele". Ehk ajalugu ei uueneks enam kunagi ja miski ei
// laheks punaseks. Sama muster mis koik teised selle projekti vead.
//
// Kaitse on KOLMEKIHILINE, sest me ei usalda enam uhtegi neist uksi:
//   1. AbortController + setTimeout - normaalne tee, katkestab uhenduse;
//   2. keha loetakse TUKKIDE kaupa ja seiskumist valvatakse eraldi taimeriga
//      (bait ei tule > seisuAeg) - see puuab kinni ka aeglase lekke;
//   3. Promise.race kova taimeriga - kui kumbki ulemine ei toimi, LUBADUS
//      lahendub ikka ja protsess saab valjuda veateatega, mitte rippuda.
// Taimereid EI unref'ita ja see on TEADLIK. Esimene versioon unref'is nad ja
// see LOHKUS kihi 3 ara: kui fetch ei lahene kunagi, ei ole protsessis uhtegi
// ref'itud kaepidet, Node valjub vaikselt koodiga 13 ja kova taimer ei joua
// kunagi visata - tapselt see vaikne lopp, mille eest ta pidi kaitsma.
// Koik taimerid puhastatakse `finally`-s, seega nad ei hoia midagi elus kauem
// kui toiming ise; varav kontrollib seda (getActiveResourcesInfo).

const lyhike = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 200);

export class VorguViga extends Error {
  constructor(sonum, { kood = null, aegus = false } = {}) {
    super(sonum);
    this.name = 'VorguViga';
    this.kood = kood;
    this.aegus = aegus;
  }
}

// Binaarse keha vaikimisi lagi. ZIP tuleb VOORAST ALLIKAST ja `content-length`
// voib valetada voi puududa - ilma lae ta soob serveri malu ara. Paris hanke
// alusdokumentide zip on megabaitides (moodetud TAI 314159: 3,1 MB pakitult).
export const BAIDID_MAX = 256 * 1024 * 1024;

/**
 * Laeb URL-i tekstina. Aegumine katab PAISE JA KEHA, mitte ainult paise.
 * @param {string} url
 * @param {{aegumine?: number, seisuAeg?: number, silt?: string, headers?: object, fetchFn?: Function}} v
 * @returns {Promise<string>}
 */
export async function laeTekst(url, v = {}) { return laeVoog(url, v, 'tekst'); }

/**
 * Laeb URL-i BAITIDENA (zip). Sama kolmekihiline kaitse mis laeTekst - teist
 * allalaadimise teed EI OLE ja gate-hanked.mjs Z11 valvab seda: toore `fetch`-iga
 * tuleks agenti tagasi oma aegumine, oma veateade ja oma sulgemata keha.
 * @returns {Promise<Buffer>}
 */
export async function laeBaidid(url, v = {}) { return laeVoog(url, v, 'baidid'); }

async function laeVoog(url, {
  aegumine = 60000,
  seisuAeg = null,           // vaikimisi pool aegumisest: seisev voog avastatakse varem
  silt = '',
  headers = {},
  fetchFn = fetch,
  maxBaite = BAIDID_MAX,
} = {}, kuju = 'tekst') {
  const eesliide = silt ? silt + ': ' : '';
  const seis = seisuAeg ?? Math.max(5000, Math.floor(aegumine / 2));
  const ctrl = new AbortController();
  const taimerid = [];
  const pane = (ms, f) => { const t = setTimeout(f, ms); taimerid.push(t); return t; };

  // Kiht 1: kogu toimingu aegumine.
  pane(aegumine, () => ctrl.abort(new Error('aegus ' + Math.round(aegumine / 1000) + ' s järel')));

  // Kiht 3: kova taimer, mis lahendab LUBADUSE ka siis, kui abort ei moju.
  let kovaTaimer = null;
  const kova = new Promise((_, rej) => {
    kovaTaimer = pane(aegumine + seis, () => rej(new VorguViga(
      eesliide + 'vastus jäi rippuma ja katkestamine ei mõjunud — '
      + Math.round((aegumine + seis) / 1000) + ' s',
      { aegus: true })));
  });

  try {
    return await Promise.race([kova, (async () => {
      let res;
      try {
        res = await fetchFn(url, { signal: ctrl.signal, headers });
      } catch (e) {
        throw new VorguViga(eesliide + 'vastust ei saadud — ' + lyhike(e),
          { aegus: ctrl.signal.aborted });
      }
      if (!res.ok) {
        try { await res.body?.cancel(); } catch { /* juba kinni */ }
        throw new VorguViga(eesliide + 'RHR vastas ' + res.status + ' ' + (res.statusText || ''),
          { kood: res.status });
      }
      // Kiht 2: keha tukkide kaupa + seisuvalve. res.text() uksi ei anna meile
      // uhtegi kohta, kus mootа, KAS andmed veel liiguvad.
      if (!res.body) return kuju === 'baidid' ? Buffer.alloc(0) : '';
      const lugeja = res.body.getReader();
      const dek = kuju === 'baidid' ? null : new TextDecoder('utf-8');
      const tukid = kuju === 'baidid' ? [] : null;
      let baite = 0;
      let tekst = '';
      let seisuTaimer = pane(seis, () => ctrl.abort(
        new Error('vastus seisis ' + Math.round(seis / 1000) + ' s ilma uue baidita')));
      try {
        for (;;) {
          const { done, value } = await lugeja.read();
          if (done) break;
          clearTimeout(seisuTaimer);
          seisuTaimer = pane(seis, () => ctrl.abort(
            new Error('vastus seisis ' + Math.round(seis / 1000) + ' s ilma uue baidita')));
          if (kuju === 'baidid') {
            baite += value.byteLength;
            // MAHULAGI ON KIHT 4 ja ta on siin, mitte lopus: `content-length` voib
            // puududa voi valetada, seega ainus aus koht on voo lugemine ise.
            if (baite > maxBaite) {
              throw new VorguViga(eesliide + 'vastuse maht ületas lae '
                + Math.round(maxBaite / 1048576) + ' MB', { kood: null });
            }
            tukid.push(Buffer.from(value));
          } else {
            tekst += dek.decode(value, { stream: true });
          }
        }
      } catch (e) {
        if (e instanceof VorguViga) throw e;
        throw new VorguViga(eesliide + 'keha lugemine katkes — ' + lyhike(e),
          { aegus: ctrl.signal.aborted });
      } finally {
        clearTimeout(seisuTaimer);
        try { lugeja.releaseLock(); } catch { /* voog juba kinni */ }
      }
      return kuju === 'baidid' ? Buffer.concat(tukid) : tekst + dek.decode();
    })()]);
  } finally {
    clearTimeout(kovaTaimer);
    for (const t of taimerid) clearTimeout(t);
    // Kui kova taimer voitis, jaab uhendus lahti - sulgeme ta igaks juhuks.
    if (!ctrl.signal.aborted) ctrl.abort(new Error('lõpetatud'));
  }
}
