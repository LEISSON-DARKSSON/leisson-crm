// EELFILTER — deterministlik triaaz ENNE mudelikutset.
//
// Selged automaatteated tuvastatakse enne mudelit; kahtlased juhud jäävad ülevaatuseks.
//
// REEGEL: eelfilter tohib otsustada AINULT siis, kui ta on kindel. Iga
// kahtlane kiri laheb mudelile. Vale "ramps" maksab rohkem kui mudelikutse:
// see on kaotatud klient.
import { isMachine } from './gates.mjs';

// Raha-tunnus teemareas. Tahtsam olla liiga lai kui liiga kitsas.
export const RAHA = /(arve|invoice|makse|payment|maksetähtaeg|meeldetuletus|reminder|võlg|tasumata|unpaid|overdue|krediit|tellimus|order|leping|contract|maksekorraldus|receipt|kviitung)/i;

// Automaatvastus - kirja enda teemarida utleb selle valja.
// "Auto" üksi võib tähendada autoteenust. Nõuame tervet automaatvastuse
// sõna või koolonit ("Auto: Re: ...").
export const AUTOVASTUS = new RegExp(
  '^(\\s*(re|vs|fwd|edasi):\\s*)*('
  + 'auto(maat)?vastus|autoreply|auto-?response|autoresponder'
  + '|auto\\s*:'                                  // "Auto: Re: ..." - eesti postkastide tava
  + '|out of (the )?office|ooo\\s*:'
  + '|puhkusel|ei ole kontoris|kontorist väljas|olen puhkusel'
  + '|delivery status|mail delivery|undelivered|delivery has failed'
  + ')', 'i');

// Uudiskirja tunnus kirja PAISES, mitte sisus: List-Unsubscribe on
// RFC 2369 jargi just selle jaoks.
export const UUDISKIRJA_PAIS = /(list-unsubscribe|list-id|precedence:\s*bulk)/i;

/**
 * Deterministlik otsus VOI null (= kusi mudelilt).
 * @param {object} m               kiri: addr, subject, body_text, headers
 * @param {Set<string>} saatnud    domeenid, kuhu OLEME ise kirjutanud
 * @returns {{category: string, kindlus: number, miks: string}|null}
 */
export function eelfilter(m, saatnud = new Set()) {
  const addr = String(m.addr || '').toLowerCase();
  const subject = String(m.subject || '');
  if (!addr.includes('@')) return null;

  // RAHA EI LAHE KUNAGI EELFILTRIST LABI.
  // Arved ja maksemeeldetuletused võivad tulla masinaadressilt.
  // Selles harus ei liigitata neid automaatselt uudiskirjaks.
  if (RAHA.test(subject)) return null;

  const domeen = addr.split('@')[1];
  const meieOma = saatnud.has(domeen);

  // 1. Automaatvastus MEIE kirjale - see ei ole vastus, aga ei ole ka ramps.
  if (AUTOVASTUS.test(subject)) {
    return { category: 'ramps', kindlus: 0.95, miks: 'automaatvastus teemarea järgi' };
  }

  // 2. Masinaadress domeenist, kuhu me pole kirjutanud -> uudiskiri.
  //    Kui OLEME kirjutanud, siis votab mudeli - vastus voib tulla
  //    ka info@ voi noreply-kujulisest postkastist.
  if (isMachine(addr) && !meieOma) {
    return { category: 'uudiskiri', kindlus: 0.9, miks: 'masinaadress, kuhu me pole kirjutanud' };
  }

  // 3. RFC 2369 loobumispais - see ON definitsiooni jargi masspostitus.
  if (m.headers && UUDISKIRJA_PAIS.test(String(m.headers)) && !meieOma) {
    return { category: 'uudiskiri', kindlus: 0.9, miks: 'List-Unsubscribe päis' };
  }

  return null;   // kusi mudelilt
}

/** Mitu kirja jaaks mudelist valja. Aruande jaoks. */
export function saast(kirjad, saatnud, uhikuhind) {
  const n = kirjad.filter((m) => eelfilter(m, saatnud)).length;
  return { kirju: n, usd: Math.round(n * uhikuhind * 100) / 100 };
}
