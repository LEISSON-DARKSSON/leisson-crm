// LEISSON CREATIVE sonamark. UKS koht kogu maja jaoks.
//
// Miks eraldi fail: sama lukk oli kirjutatud kaks korda - arve pais (lib/doc.mjs)
// ja e-posti allkiri (lib/signature.mjs). Kaks koopiat triivivad lahku ja
// esimene marka, et alarida on kahes kohas erinev, on klient.
//
// Lukk on kolm osa ja need EI muutu pinna kaupa:
//   1. LEISSON   - raske, valge/tint, tihedalt
//   2. CREATIVE  - kerge, harvendatud, vaiksem toon; LEISSONi kulge ILMA tuhikuta
//   3. alarida   - mono, suurtahed, lai tahevahe, vaiksem toon
//
// Alarida EI KANNA enam registrikoodi. Arvel on registrikood ikka olemas -
// muuja plokis, kus RPS 7 seda nouab. Lukk on bränd, mitte oigusrekvisiit.

export const LOGO = {
  a: 'LEISSON',
  b: 'CREATIVE',
  sub: 'AI-Augmented Workflows and Design Systems',
};

// Trukipind (arve, pakkumine): klassipohine, sest seal on paris CSS.
// Tuhikut a ja b vahel EI OLE - lukk on tihe.
export const logoPrint = () =>
  `<div class="logo"><span class="a">${LOGO.a}</span><span class="b">${LOGO.b}</span>`
  + `<span class="sub">${LOGO.sub}</span></div>`;

// E-posti pind: Outlook ei toeta klasse ega rgba-d, seega inline ja hex.
// Parameetrid tulevad Orbiti tokenitest, mitte siit.
// sub = '' jätab alarea välja (kliendikirjad: ainult sõnamärk, 23.09.2026 otsus).
export const logoEmail = ({ display, mono, ink, ink3, size = 26, subSize = 11, sub = LOGO.sub }) =>
  `<span style="font-family:${display};font-weight:800;font-size:${size}px;line-height:1;`
  + `letter-spacing:0.04em;color:${ink};text-transform:uppercase;">${LOGO.a}</span>`
  + `<span style="font-family:${display};font-weight:400;font-size:${size}px;line-height:1;`
  + `letter-spacing:0.10em;color:${ink3};text-transform:uppercase;">${LOGO.b}</span>`
  + (sub ? `<div style="font-family:${mono};font-size:${subSize}px;line-height:1.45;`
  + `letter-spacing:0.16em;text-transform:uppercase;color:${ink3};padding-top:7px;">${sub}</div>` : '');
