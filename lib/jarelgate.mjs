// JARELKIRJADE VARAV
//
// Miks see olemas on. Mootmine 14.09.2026: 42 kulmkirja -> 9 vastust (21%).
// Instantly 2026 vordlusandmed: keskmine vastuseprotsent on 3,43% ja tipptegijad
// ule 10% - ehk kirjad ise TOOTAVAD. Sama uuring utleb, et 58% vastustest tuleb
// esimesest kirjast ja 42% jarelkirjadest. Gert ei saatnud uhtegi jarelkirja,
// seega ligi pool voimalikest vastustest jai olemasolevast torust votmata.
//
// MIKS AINULT KAKS. Vordlusandmed soovitavad 4-7 puudet. See arv tuleb
// masspostitajatelt, kelle kiri on mall. Gerti kiri on iga sihtmargi kohta eraldi
// moodetud ja tema bränd on "moodetud number, mitte muugijutt". Neljas meeldetuletus
// ilma uue faktita on mura ja ESS-i mottes tulisem kui esimene kiri. Kaks puudet
// votavad ara suurema osa sellest 42%-st (uksainus jarelkiri annab koige suurema
// huppe) ilma, et kirjast saaks jalitamine.
//
// RAUDNE REEGEL: iga jarelkiri kannab UUT MOODETUD FAKTI. "Tousen kirja peale
// ules" ei ole jarelkiri - see on mura. Varav kontrollib seda (vt uusFakt).

import { VABAPOSTI, LOOBUMISSONAD } from './sendgate.mjs';
import { leiud } from './kaart.mjs';

/** Kaks puudet, tooPAEVADES esimesest kirjast. */
export const KADENTS = [
  { nr: 1, tooPaevi: 3, nimi: 'kaart' },   // annab neli moodetud kohta tasuta
  { nr: 2, tooPaevi: 9, nimi: 'sulgemine' }, // uks uus fakt + viisakas lopp
];

export const MAX_JARELKIRJU = KADENTS.length;

/** Tooapaevi kahe hetke vahel (L ja P ei loe). */
export function tooPaevi(alates, kuni) {
  const a = new Date(alates); a.setHours(0, 0, 0, 0);
  const b = new Date(kuni); b.setHours(0, 0, 0, 0);
  if (b <= a) return 0;
  let n = 0;
  const d = new Date(a);
  while (d < b) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

/** Mitmes jarelkiri on kaes, kui uldse. null = veel vara voi labi. */
export function millineJarelkiri(saadetudJarelkirju, esimeneTs, now) {
  if (saadetudJarelkirju >= MAX_JARELKIRJU) return null;
  const k = KADENTS[saadetudJarelkirju];
  return tooPaevi(esimeneTs, now) >= k.tooPaevi ? k : null;
}

/**
 * Kas see jarelkiri kannab UUT MOODETUD FAKTI?
 *
 * Esimene katse vaatas "ridu, kus on number". See oli vale: kolmas leid
 * ("ettevotte andmeid ei ole masinloetaval kujul") ei kanna uhtegi numbrit,
 * aga on taiesti uus fakt. Number ei ole uudsuse tunnus.
 *
 * Oige tunnus on MOODETUD SIGNAAL ise - "JSON-LD Organization: puudub" -
 * mille iga kiri endaga kaasa kannab. Kui see signaal on varasemas kirjas juba
 * ara oeldud, ei ole see jarelkiri, vaid meeldetuletus.
 *
 * @param {{body: string, fakt: string}|string} kiri
 * @param {string[]} varasemadKehad
 */
export function uusFakt(kiri, varasemadKehad) {
  const vana = (varasemadKehad || []).map((x) => String(x || '').toLowerCase()).join('\n');
  const keha = String(typeof kiri === 'string' ? kiri : kiri?.body || '');
  const fakt = typeof kiri === 'string' ? '' : String(kiri?.fakt || '');

  // 0. Sama kiri uuesti on ALATI "ei", ukskoik mida signaal utleb. See on
  //    turvavoo: masinloetav silt ("meta description: puudub") ei esine kirja
  //    tekstis, seega ainult signaali vordlus laseks sama kirja teist korda labi.
  const uus = keha.trim().toLowerCase();
  for (const v of varasemadKehad || []) {
    const w = String(v || '').trim().toLowerCase();
    if (w.length > 80 && (w === uus || w.includes(uus) || uus.includes(w))) return false;
  }

  // 1. Moodetud signaal on uus -> kindel jah.
  if (fakt && !vana.includes(fakt.toLowerCase())) return true;

  // 2. Signaali ei antud: kas moni sisuline loik on uus?
  const loigud = keha.split(/\n{2,}/).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 40);
  if (!loigud.length) return false;
  return loigud.some((x) => !vana.includes(x.slice(0, 60)));
}

/**
 * Kes vaarib jarelkirja. Sama poimumine, mis sendgate: summutus, vabapost,
 * vastanud - ja lisaks vaikuse vanus tooapaevades.
 * @returns {{jarjekord: Array, miks: Object}}
 */
export function jarelGate(db, { now = new Date(), mootmised = {} } = {}) {
  const sum = db.prepare('SELECT addr, domain FROM suppressions').all();
  const summutatud = new Set(sum.map((x) => String(x.addr || '').toLowerCase()).filter(Boolean));
  const summutatudDom = new Set(sum.map((x) => String(x.domain || '').toLowerCase()).filter(Boolean));

  const vastanud = new Set(
    db.prepare("SELECT DISTINCT company_id FROM messages WHERE direction='in' AND company_id IS NOT NULL")
      .all().map((r) => r.company_id),
  );

  const saadetud = db.prepare(
    `SELECT a.company_id AS id, MIN(a.ts) AS esimene, COUNT(*) AS kirju
       FROM activity a WHERE a.kind = 'sent' GROUP BY a.company_id`,
  ).all();

  const miks = {};
  const lisa = (k) => { miks[k] = (miks[k] || 0) + 1; };
  const jarjekord = [];

  for (const s of saadetud) {
    const c = db.prepare('SELECT id, name, email, status, url, body FROM companies WHERE id = ?').get(s.id);
    if (!c) { lisa('firmat ei ole torus'); continue; }
    if (vastanud.has(s.id)) { lisa('on juba vastanud'); continue; }
    if (c.status === 'ei' || c.status === 'voidetud') { lisa('seis on suletud'); continue; }
    if (!c.email) { lisa('e-posti ei ole'); continue; }
    const ep = c.email.toLowerCase();
    if (summutatud.has(ep) || summutatudDom.has(ep.split('@')[1])) { lisa('summutusnimekirjas'); continue; }
    if (VABAPOSTI.test(ep)) { lisa('eraisiku vabapost — käsitsi'); continue; }

    const tehtud = s.kirju - 1;                       // esimene 'sent' on kulmkiri
    const samm = millineJarelkiri(tehtud, s.esimene, now);
    if (!samm) {
      if (tehtud >= MAX_JARELKIRJU) lisa('kaks järelkirja juba tehtud');
      else lisa(`vaikus alles ${tooPaevi(s.esimene, now)} tööpäeva`);
      continue;
    }
    const m = mootmised[s.id];
    if (!m || !m.ok) { lisa('mõõtmist ei ole — uut fakti ei ole öelda'); continue; }
    // Kiri 1 kasutab kaks leidu, kiri 2 kolmanda. Kui leide ei jatku, ei ole
    // uut fakti oelda ja kirja EI TEHTA - kordus oleks mura.
    const vaja = samm.nimi === 'kaart' ? 1 : 3;
    const olemas = leiud(m).length;
    if (olemas < vaja) { lisa(`leide ei jätku (${olemas}, vaja ${vaja})`); continue; }

    jarjekord.push({ ...c, samm, esimene: s.esimene, m, tehtud, vaikus: tooPaevi(s.esimene, now) });
  }
  jarjekord.sort((a, b) => b.vaikus - a.vaikus);
  return { jarjekord, miks };
}

export { LOOBUMISSONAD };
