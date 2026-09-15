// Jarelkirja TEKST. Deterministlik - mudelit ei kutsuta, sest faktid on juba
// moodetud ja mall peab olema testitav.
//
// leisson-kirja-toimetaja: "Jarelkiri: alla 80 sona ja ta ei korda esimest kirja."
// Seeparast EI panda siia koiki nelja leidu: kaks tokendavad ara, et moodetud on
// paris, ja ulejaanud kaks on pohjus vastata. Koik neli korraga tahendaks, et
// vastamiseks ei ole enam uhtegi pohjust.
import { leiud } from './kaart.mjs';

const esimeneNimi = (n) => String(n || '').trim().split(/\s+/)[0] || '';

// Rollipostkastid: nende taga ei ole uhte inimest, seega ei nimetata kedagi.
const ROLL = /^(info|sales|myyk|muuk|kontakt|contact|office|kontor|mail|post|epood|shop|pood|booking|broneering|reception|vastuvott|admin|support|abi|hello|hei|tere|firma|ettevote|raamatupidamine|arve|invoice|hr|personal|piletikassa|kassa|sadam|mois|resort|hotell|hotel|spa|camping|puhkemaja)$/i;

/**
 * Eesnimi e-posti aadressist, kui seda saab AUSALT teha. "katre@firma.ee" -> Katre.
 * "info@firma.ee" -> mitte midagi. Vale nimi kirja alguses on hullem kui nimeta.
 */
export function nimiAadressist(email) {
  const l = String(email || '').split('@')[0] || '';
  if (!/^[a-zäöüõšž]{3,12}$/i.test(l)) return '';   // punktid, numbrid, kriipsud valja
  if (ROLL.test(l)) return '';
  return l.charAt(0).toUpperCase() + l.slice(1).toLowerCase();
}

const tere = (k) => `Tere${k ? ' ' + esimeneNimi(k) : ''},`;
const alla = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** Jarelkiri 1: kaks leidu tokendiks, kaart pohjuseks vastata. Uks kusimus. */
export function kaardikiri({ kontakt, m }) {
  const L = leiud(m);
  if (!L.length) return null;                       // ei ole mida oelda -> kirja ei ole
  // MOODETUD 14.09.2026 paris torus: moni leht annab AINULT UHE leiu ja vana
  // kood vottis pimesi L[1] -> "Cannot read properties of undefined". Naitame
  // nii mitut, kui on, ja sonastame arvu vastavalt.
  const nayta = L.slice(0, 2);
  const veel = L.length - nayta.length;
  const mituSona = nayta.length === 1 ? 'Üks koht' : 'Kaks kohta';
  return {
    subject: nayta.length === 1
      ? 'Üks mõõdetud koht teie lehel'
      : `Kaks mõõdetud kohta teie lehel${veel > 0 ? ` (ja veel ${veel})` : ''}`,
    body: `${tere(kontakt)}

kirjutasin mõni päev tagasi ja vastust ei tulnud – see on igati mõistlik, võõra kirjale ei pea vastama. Ma ei küsi uuesti kohtumist.

${mituSona} teie avalehelt, mõõdetuna:

${nayta.map((x) => `${x.leid}. ${x.mis}`).join('\n\n')}

${veel > 0
  ? `Samast mõõtmisest tuli veel ${veel === 1 ? 'üks koht' : `${veel} kohta`}. Panin kõik ühele A4-le koos sellega, mida igaühega teha. Kas saadan? Tasuta, tingimusteta, ka siis kui te minuga midagi ei tee.`
  : 'Parandage need ise või laske oma veebimehel teha – tulemus on sama.'}`,
    fakt: nayta[0].moot,
  };
}

/** Jarelkiri 2: viimane. Uks uus fakt ja selge lopp - vaikus tahendab "ei". */
export function sulgemiskiri({ kontakt, m }) {
  const L = leiud(m);
  // Jarelkiri 1 kasutas kahte esimest. Kui rohkem ei ole, EI OLE uut fakti ja
  // kirja ei tehta - vaikimine on parem kui kordus.
  const uus = L[2];
  if (!uus) return null;
  return {
    subject: 'Viimane kiri',
    body: `${tere(kontakt)}

see on viimane kiri – vastusest olenemata ma rohkem ei kirjuta.

Üks asi jäi eelmisest välja: ${alla(uus.leid)}. ${uus.mis}

Mõõtsin teie lehe üle enne kirjutamist ja mõõdetu jääb teie omaks ka siis, kui te minuga midagi ei tee. Kui kunagi tekib veebi kohta küsimus, vastan sellele tasuta – ka aasta pärast.

Head jätku.`,
    fakt: uus.moot,
  };
}

/** Tagastab kirja VOI null, kui uut oelda ei ole. Kutsuja peab nulli talume. */
export function koosta(samm, ctx) {
  return samm.nimi === 'kaart' ? kaardikiri(ctx) : sulgemiskiri(ctx);
}
