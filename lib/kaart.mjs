import { CSS, HEAD, BAND, esc, pv } from './doc.mjs';
import { MASINLOETAV } from './hinnakiri.mjs';

// Shared HTML observations. Business impact and visual behavior require separate evidence.
export const SELETUS = {
 desc: () => ({
  leid:'HTML-is ei tuvastatud meta description märgendit',moot:'meta description: puudub',
  mis:'See märgend võib anda otsingumootorile lehe kokkuvõtte. Tegelikku otsingutulemuse kirjeldust tuleb eraldi kontrollida.',
  teha:'Lisa lehe sisu täpselt kirjeldav kokkuvõte; otsingumootor võib kasutada ka muud teksti.'
 }),
 og: () => ({
  leid:'HTML-is ei tuvastatud Open Graph märgendeid',moot:'Open Graph: 0 märgendit',
  mis:'Jagamismärgendid aitavad kirjeldada lingi eelvaadet. Tegelikku eelvaadet tuleb kontrollida konkreetses rakenduses.',
  teha:'Kontrolli sobivaid pealkirja, kirjelduse, pildi ja URL-i märgendeid ning testi jagamisvaadet.'
 }),
 org: () => ({
  leid:'HTML-is ei tuvastatud Organization andmeid JSON-LD-vormingus',moot:'JSON-LD Organization: puudub',
  mis:'Ettevõtte andmed võivad olla lehel esitatud muul kujul. Puuduv JSON-LD ei tõenda otsingust või AI-vastustest väljajäämist.',
  teha:'Vajaduse korral lisa kliendi kinnitatud ettevõtteandmed ning valideeri need.'
 }),
 hreflang: () => ({
  leid:'Mitmekeelse lehe HTML-is ei tuvastatud hreflang-viiteid',moot:'hreflang: 0 viidet',
  mis:'Keeleviited aitavad kirjeldada keeleversioonide seost. Selle vaatlusega ei ole kontrollitud, millist versiooni otsing kasutajale näitab.',
  teha:'Kontrolli tegelikke keeleversioone ja lisa nendevahelised õiged viited.'
 }),
 pealkiri: () => ({
  leid:'HTML-is ei tuvastatud lehe pealkirja',moot:'title: puudub',
  mis:'Lehe pealkiri aitab brauseris ja otsingus sisu kirjeldada. Otsingutulemuse pealkirja ja müügimõju see vaatlus ei mõõda.',
  teha:'Lisa konkreetset lehte kirjeldav pealkiri.'
 })
};

/** Moodetust leidudeks, tahtsaim ees. */
export function leiud(m) {
  if(!m || m.ok===false)return [];
  return MASINLOETAV.filter((s) => s.katki(m)).map((s) => ({ id: s.id, ...SELETUS[s.id](m) }));
}

/**
 * Kaardi HTML. `mootja` on tekst selle kohta, MILLEGA moodeti - ilma selleta
 * on iga number lubadus, mida ei saa kontrollida.
 */
export function renderKaart({ nimi, url, m, kuupaev, mootja = 'Mõõtmisviis on dokumenteerimata; brauserikontrolli ei kinnitata' }) {
  const kõik = leiud(m);
  if (!kõik.length) return null;             // terve leht ei saa kaarti - ei ole mida oelda
  const L = kõik.slice(0, 3);                // NELI kohta, mitte koik: kaart ei ole audit
  const veel = kõik.length - L.length;

  const read = L.map((x, i) => `<tr>
    <td class="r nr">${i + 1}</td>
    <td>
      <div class="lead">${esc(x.leid)}</div>
      <div class="sub2">${esc(x.mis)}</div>
      <div class="teha"><span class="lb">Mida teha</span> ${esc(x.teha)}</div>
    </td>
    <td class="r moot">${esc(x.moot)}</td>
  </tr>`).join('');

  return `${HEAD('Nähtavuskaart – ' + nimi)}
<div class="sheet"><div class="page">
  ${BAND('NÄHTAVUSKAART', pv(kuupaev))}
  <div class="body">
    <div class="meta3">
      <div><span class="lb">Ettevõte</span><div class="vl">${esc(nimi)}</div></div>
      <div><span class="lb">Mõõdetud leht</span><div class="vl url">${esc(String(url).replace(/^https?:\/\//, ''))}</div></div>
      <div><span class="lb">Mõõdetud</span><div class="vl">${esc(pv(kuupaev))}</div></div>
    </div>

    <p class="sisse">Allolevad tähelepanekud kirjeldavad saadud HTML-i struktuuri. Iga tähelepaneku juures on kontrollitud tunnus ja võimalik järgmine tegevus. Visuaalne kasutatavus ning tegelik päringu- või jagamisteekond vajavad eraldi kontrolli.</p>

    <table>
      <thead><tr><th class="r">Nr</th><th>Leid ja mida see tähendab</th><th class="r">Mõõdetud</th></tr></thead>
      <tbody>${read}</tbody>
    </table>

    <div class="payblock">
      <span class="lb">Aus piir</span>
      Mõõtsin ainult avalehe masinloetavat kihti: ${esc(mootja)}.
      Ma EI mõõtnud lehe kiirust, ligipääsetavust, sisu kvaliteeti ega seda, kust teie
      kliendid tegelikult tulevad.${veel > 0 ? ` Samast mõõtmisest jäi välja ${veel === 1 ? 'veel üks koht' : `veel ${veel} kohta`} – see kaart näitab kuni kolm tähelepanekut.` : ''}
      Töö sobivus ja maht lepitakse kokku pärast tegeliku vajaduse ja ligipääsude kontrolli.
    </div>
  </div>
  <div class="footband">
    <b>See kaart on tasuta ja tingimusteta.</b> Siin ei ole hinnapakkumist ega kohtumiskutset –
    Järgmine tegevus sõltub kinnitatud vajadusest; siin toodud vaatlus ei kinnita müügitulemust.
    Kui tekib küsimus, vastan sellele ka siis, kui te midagi ei telli.<br>
    LEISSON OÜ · registrikood 16952932 · gert@leisson.eu · leisson.eu
  </div>
</div></div>
<style>
.sisse{margin:0;font-size:15px;line-height:1.6}
td.nr{font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:24px;width:12mm;vertical-align:top;padding-top:9px}
td.moot{font-size:12.5px;white-space:nowrap;vertical-align:top;padding-top:13px;width:42mm}
.teha{margin-top:5px;font-size:13.5px;line-height:1.5}
.teha .lb{display:inline-block;margin-right:6px}
.vl.url{font-size:14px;word-break:break-all}
</style>
</body></html>`;
}
