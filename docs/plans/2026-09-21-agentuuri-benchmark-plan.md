# Agentuuri-benchmark: 17 ideed — teostusplaan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Viia leisson.eu-le 17 mõõdetud konkurentsianalüüsist tuletatud muudatust, mis tõstavad kvalifitseeritud päringute arvu kontaktivormist.

**Architecture:** Kõik onsite-muudatused toituvad ühest allikast (`site/data/service-catalog.json` → `sync-orbit` → `site/lib/pricing.ts`). Ükski hind ega tarneaeg ei kirjutata teksti. Uued pinnad on server-komponendid; ainus kliendi-JS on paketivalija hüdreerimissaar, mida kaitseb uus kimbueelarve värav. Saidiväline kiht (O1–O5) ei puuduta koodi.

**Tech Stack:** Next.js 16 App Router · TypeScript · Orbit DS (`packages/orbit-tokens`, `packages/orbit-ui`) · oma MDX-parser · Resend · GA4 (`site/components/Analytics.tsx`) · väravad `tests/*.mjs` + `.github/workflows/orbit-gates.yml`

**Disain:** `docs/plans/2026-09-21-agentuuri-benchmark-design.md` (commit 74601e6)

---

## KOHUSTUSLIK: keskkonnareeglid (loe enne esimest sammu)

1. **Ehitus, väravad ja git käivad AINULT Windowsis Desktop Commanderiga.** Linuxi VM-is kukub `lightningcss`, Chromiumil puudub `libXdamage`, VM ei saa faile kustutada ega GitHubi.
2. **Iga `npm install` / `npm ci` ette `$env:NODE_ENV=''`.** Gerti PowerShellis on `NODE_ENV` globaalselt `production` → devDependencies jäävad installimata ja `next build` kukub „Cannot find module '@tailwindcss/postcss'".
3. **Kui `next build` annab veidra „Cannot find module" vea, kuigi moodul on olemas — kustuta `.next` ja ehita uuesti** (Turbopack cache'ib eelmise ebaõnnestunud resolutsiooni).
4. **Commit-sõnumid ASCII-s.** Desktop Commanderi cmd-shell moonutab täpitähti. Kirjuta „vordlus", mitte „võrdlus".
5. **Üks `btn-fill` lehe kohta.** `tests/gates.mjs` 4e CTA-hierarhia värav on juba kord katki läinud. Kõik uued nupud on `btn-ghost` või tekstilink.
6. **Tabel peab olema `.table-scroll` sees ja `.prose-orbit` OTSENE laps**, muidu `no-hscroll@390` kukub. Eeskuju: `site/app/[lang]/prices/page.tsx` „Suuremad eritööd" sektsioon.
7. **Väljalase** alles rohelise CI järel: `git push origin origin/main:release/production`.

### Väravate käsurida (Windows, Desktop Commander, repo juur)

```
node packages/orbit-tokens/verify.mjs
node tests/portfell.mjs
node tests/claims.mjs
cd site; $env:NODE_ENV=''; npx next build
npx next start -p 3311     # eraldi protsess
node tests/gates.mjs
node tests/axe.mjs
```

---

## PARANDUS disainidokumendi vastu (leitud koodi lugemisel 2026-09-21)

Kolm eeldust olid valed — plaan kannab parandatud numbreid:

| Idee | Disainis | Tegelikult | Uus h |
|---|---|---|---|
| 10 · kataloogi kärpimine | „avalehel 15 pakkumist" | **Avalehel on juba 3** (`ServiceCards` = `fixedOffers()` = `group==='primary'`). Kärpimine puudutab `/prices` lehte, kus on 3 + 3 growth + 6 bespoke + 1 product = 13 pinda | 3 → **2** |
| 9 · sobib/ei sobi | „`fit` ja `excludes` kasutamata" | **`fit` on juba renderdatud** `ServiceCards`-is ja growth-kaartidel. Puudu on ainult `excludes` | 4 → **2** |
| 4 · võrdlustabel | „uus tabelimuster" | **Muster on olemas** — `/prices` „Suuremad eritööd" kasutab juba `.table-scroll` + `.tbl` + `<caption>` + `scope` | 4 → **3** |

**Vabanes 4 h → puhver 4 h + 4 h = 8 h.** Kogumaht 72 h tööd + 8 h puhver.

---

## Task 0: Baasjoon (KOHUSTUSLIK ENNE KÕIKE)

**Files:** loeb ainult; kirjutab `docs/plans/baseline-2026-09-21.txt`

**Step 1:** Puhas puu ja värske main.

```
git -C "C:\Users\gert\Desktop\LEISSON.CREATIVE\Leisson Creative" status --short --branch
```
Oodatud: `## main...origin/main`, tööpuu puhas.

**Step 2:** Ehita ja salvesta route-tabel.

```
cd "C:\Users\gert\Desktop\LEISSON.CREATIVE\Leisson Creative\site"; $env:NODE_ENV=''; npx next build | Tee-Object -FilePath ..\docs\plans\baseline-2026-09-21.txt
```
Oodatud: build läbib. Failis on route-tabel koos „First Load JS" veeruga.

**Step 3:** Loe failist kaks numbrit ja kirjuta need plaani kõrvale:
- `/[lang]` First Load JS = ____ kB
- `/[lang]/prices` First Load JS = ____ kB

**Step 4:** Kontrolli arhitektuurieeldust — kas React'i kliendiruntime on juba igal lehel?

```
findstr /C:"'use client'" site\components\Analytics.tsx
findstr /C:"Analytics" site\app\[lang]\layout.tsx
```
Oodatud: mõlemad leiavad vaste.

**OTSUSTUSPUNKT:** kui `Analytics` EI ole juurpaigutuses kliendikomponendina, siis **Task 12 (3b hüdreerimine) jäetakse tegemata** ja valija jääb server-only'ks (Task 11). Kirjuta otsus siia faili.

**Step 5:** Käivita kõik väravad korra läbi, et teada, mis on ENNE roheline.

```
node packages\orbit-tokens\verify.mjs; node tests\portfell.mjs; node tests\claims.mjs
```
Oodatud: kõik kolm 0-koodiga.

**Step 6: Commit**

```
git add docs/plans/baseline-2026-09-21.txt docs/plans/2026-09-21-agentuuri-benchmark-plan.md
git commit -m "docs(plans): teostusplaan + baasjoone mootmine enne agentuuri-benchmark sprinti"
```

---

# VOOR 1 — kiired võidud (9 h)

## Task 1 (idee 8): Telefon, asukoht, vastamisajad — 1 h

**Files:**
- Modify: `site/data/service-catalog.json` → `seller`
- Modify: `site/lib/pricing.ts` (eksport)
- Modify: `site/components/Footer.tsx`

**Step 1:** Lisa `seller`-plokki kolm välja. Kataloog on ainus koht, kust need tulevad — nii jõuavad nad ühe muudatusega jalusesse, kontaktilehele ja JSON-LD-sse.

```json
"phone": "+372 XXXXXXXX",
"phoneHours": { "et": "E–R 9–17", "en": "Mon–Fri 9–17" },
"locality": { "et": "Tallinn, Eesti", "en": "Tallinn, Estonia" }
```

> **Gerti sisend vajalik:** telefoninumber. Kui Gert ei taha kõnesid, JÄTA TASK TEGEMATA ja märgi plaani „loobutud" — ära pane kohatäidet.

**Step 2:** `pricing.ts`-is on `SELLER` juba eksporditud — uued väljad tulevad kaasa, koodimuudatust pole vaja. Kontrolli tüüpi:

```
cd site; npx tsc --noEmit
```

**Step 3:** Footer.tsx — LEISSON OÜ tulpa, `mailto` alla:

```tsx
<a href={'tel:' + SELLER.phone.replace(/\s/g, '')}>{SELLER.phone}</a>
<span className="dim" style={{ display: 'block', fontSize: 12.5 }}>{tr(SELLER.phoneHours, lang)} · {tr(SELLER.locality, lang)}</span>
```

**Step 4:** Ehita ja kontrolli.

```
cd site; $env:NODE_ENV=''; npx next build
node ..\tests\gates.mjs
```
Oodatud: PASS. Telefon nähtav jaluses igal lehel.

**Step 5: Commit**

```
git add site/data/service-catalog.json site/components/Footer.tsx
git commit -m "feat(site): telefon, vastamisajad ja asukoht kataloogist jalusesse"
```

---

## Task 2 (idee 7): Hinnaankur hero'sse — 2 h

**Files:** Modify `site/app/[lang]/page.tsx:20-22`

**Konkurentsitõend:** Veebimets ja Navik panevad hinna JA tähtaja kõrvuti; Websystems peidab hinna ja kaotab ostja. leisson.eu-l on mõlemad olemas, aga `dim`-klassiga väiketekstina nuppude all.

**Step 1:** Asenda praegune kaks `<p className="dim">` rida ühe nähtava tõendireaga. **Tekst, mitte nupp** — 4e värav.

```tsx
<p className="hero-anchor">
  {fixedOffers().map((o, i) => <span key={o.id}>
    {i > 0 && <span aria-hidden="true"> · </span>}
    <a href={'/' + lang + '/prices#' + o.id}>{o.name[lang]}</a>{' '}
    <b className="mono">{priceLabel(o, lang)}</b>{' '}
    <span className="dim">{o.lead[lang]}</span>
  </span>)}
</p>
<p className="dim">{et ? 'Selge töömaht · kirjalik hinnakinnitus · eesti ja inglise keel' : 'Defined scope · written price confirmation · Estonian and English'}</p>
```

**Step 2:** `site/app/globals.css` — `.hero-anchor` kasutab olemasolevaid tokeneid, mitte uusi väärtusi:

```css
.hero-anchor { margin-top: var(--orbit-space-4); font-size: 15px; line-height: 1.8; max-width: var(--orbit-space-measure); }
.hero-anchor a { text-decoration: none; border-bottom: 1px solid currentColor; }
```

**Step 3:** Ehita + väravad. **Eriti kontrolli 4e-d** — lisasime hero'sse kolm linki.

```
cd site; $env:NODE_ENV=''; npx next build; npx next start -p 3311
node ..\tests\gates.mjs
```
Oodatud: PASS. Kui 4e kukub „conflicting vocabulary" peale, on põhjus selles, et pakettide nimed loetakse CTA-kandidaatideks → mähi lingid `<span data-not-cta>` sisse ja lisa `gates.mjs` 4e filtrisse, NAGU tehti sisukorra ankrutega.

**Step 4:** Mobiil 390 px — `no-hscroll` peab olema PASS. Kolm paketti punktidega ühel real MURRAB kitsal ekraanil; kontrolli, et `.hero-anchor` murdub ridadeks, mitte ei keri.

**Step 5: Commit**

```
git add "site/app/[lang]/page.tsx" site/app/globals.css
git commit -m "feat(site): hinnaankur hero'sse - pakett, hind ja tarneaeg korvuti"
```

---

## Task 3 (idee 6): Vastuse lubadus vormi juures — 2 h

**Files:** Modify `site/lib/i18n.ts` (`dict.contact`), `site/app/[lang]/contact/ContactForm.tsx`

**Konkurentsitõend:** Veebimets lubab „Vastame tööpäeviti 2 tunni jooksul. Ei mingit spämi." Trinidad lubab „within 3 working days". Caotica, Websystems, Marketing Sharks, Veebiagentuur, Navik, Webabi — pärast saatmist ei luba midagi.

**Step 1:** `dict.contact`-i kaks uut võtit:

```ts
promise: t('Vastan ühe tööpäeva jooksul. Pakkumine tuleb kirjalikult. Uudiskirja ei ole.',
           'I reply within one business day. The proposal comes in writing. There is no newsletter.'),
okNext: t('Päring on kohal. Vastan ühe tööpäeva jooksul aadressilt gert@leisson.eu — kontrolli ka rämpsposti.',
          'Your enquiry has arrived. I reply within one business day from gert@leisson.eu — check your spam folder too.'),
```

**Step 2:** ContactForm.tsx — saatmisnupu KÕRVALE (mitte lehe algusesse):

```tsx
<p className="dim" style={{ fontSize: 13, margin: 0 }}>{tr(c.promise, lang)}</p>
```
ja õnnestumise olekus asenda `tr(c.ok, lang)` → `tr(c.okNext, lang)`.

**Step 3:** Testi päriselt läbi — täida vorm ja saada.

```
npx next start -p 3311
```
Ava `http://localhost:3311/et/contact`, saada päring, kontrolli et kinnitustekst ilmub `role="status"` plokki ja ekraanilugeja loeb selle ette.

**Step 4:** `node ..\tests\axe.mjs` — PASS.

**Step 5: Commit**

```
git add site/lib/i18n.ts "site/app/[lang]/contact/ContactForm.tsx"
git commit -m "feat(contact): vastuse lubadus nupu juures ja konkreetne kinnitustekst"
```

---

## Task 4 (idee 2): Inimene lehele — 4 h

**Files:**
- Create: `site/components/Founder.tsx`, `site/public/gert.webp`
- Modify: `site/lib/i18n.ts` (`dict.founder`), `site/app/[lang]/contact/page.tsx`, `site/app/[lang]/page.tsx`

**Konkurentsitõend:** Brand Manualil kolm partnerit fotode, CV-de, otsemeilide ja telefonidega — „ülekantav 1:1, null infrastruktuuri". Trinidadil 30+ spetsialisti nimeliselt fotoga. Websystemsil ja Webabil nimed. leisson.eu-l **ei ühtegi nime ega nägu**.

**Step 1:** Foto. Nõuded: WebP, ≤ 80 KB, ruut, min 480×480, päris foto (mitte stock — Trinidadi tugevus oli just see). Pane `site/public/gert.webp`.

**Step 2:** `dict.founder`:

```ts
founder: {
  name: t('Gert Leisson', 'Gert Leisson'),
  role: t('Asutaja ja ainus tegija', 'Founder and sole practitioner'),
  body: t('Ehitan töö ise algusest lõpuni. Sa räägid minuga, mitte projektijuhiga, ja pakkumise kirjutab sama inimene, kes koodi kirjutab.',
          'I build the work myself from start to finish. You talk to me, not a project manager, and the proposal is written by the same person who writes the code.'),
  alt: t('Gert Leisson, Leisson Creative asutaja', 'Gert Leisson, founder of Leisson Creative'),
},
```

**Step 3:** `Founder.tsx` — server-komponent, `priority={false}` (ei tohi LCP-d võtta):

```tsx
import Image from 'next/image';
import { dict, tr, type Lang } from '@/lib/i18n';
import { SELLER } from '@/lib/pricing';

export function Founder({ lang }: { lang: Lang }) {
  const f = dict.founder;
  return <aside className="founder panel">
    <Image src="/gert.webp" alt={tr(f.alt, lang)} width={96} height={96} priority={false} />
    <div>
      <p><b>{tr(f.name, lang)}</b> · <span className="dim">{tr(f.role, lang)}</span></p>
      <p>{tr(f.body, lang)}</p>
      <p className="mono"><a href="mailto:gert@leisson.eu">gert@leisson.eu</a>{SELLER.phone && <> · <a href={'tel:' + SELLER.phone.replace(/\s/g, '')}>{SELLER.phone}</a></>}</p>
    </div>
  </aside>;
}
```

**Step 4:** `globals.css`:

```css
.founder { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: var(--orbit-space-4); align-items: start; }
.founder img { border-radius: var(--orbit-radius-2); }
.founder p { max-width: var(--orbit-space-measure); }
@media (max-width: 560px) { .founder { grid-template-columns: 1fr; } }
```

**Step 5:** Paiguta kahte kohta: kontaktilehel vormi KÕRVALE/KOHALE, avalehel lõpu kontaktiribale.

**Step 6:** Ehita, mõõda, väravad.

```
cd site; $env:NODE_ENV=''; npx next build
```
**Kontrolli route-tabelist:** `/[lang]` ja `/[lang]/contact` First Load JS EI tohi kasvada (pilt ei ole JS). Võrdle Task 0 baasjoonega.

```
npx next start -p 3311; node ..\tests\gates.mjs; node ..\tests\axe.mjs
```
Oodatud: PASS, sh `no-hscroll@390` (seepärast on 560 px media query).

**Step 7: Commit**

```
git add site/components/Founder.tsx site/public/gert.webp site/lib/i18n.ts site/app/globals.css "site/app/[lang]/contact/page.tsx" "site/app/[lang]/page.tsx"
git commit -m "feat(site): asutaja plokk - nimi, nagu ja otsekontakt kontaktilehel ja avalehel"
```

---

# VOOR 2 — kataloogipind (7 h)

## Task 5: Kataloogivärav (automatiseerimine, ~20 min)

**Files:** Modify `tests/claims.mjs` (lõppu, enne kokkuvõtet)

**Miks:** ideed Task 6–8 loevad kõik `fit`, `excludes` ja `lead` välju. Praegu ei kontrolli neid ükski värav → uus pakett võib kukkuda tabelisse tühja lahtrina. „2 korda = automatiseeri": see on teine kord, kui neid välju käsitsi kontrollime.

**Step 1: Kirjuta värav**

```js
// --- kataloogivärav: iga aktiivne pakkumine kannab fit, excludes ja lead ET+EN ---
const catalog = JSON.parse(readFileSync(join(root, 'site/data/service-catalog.json'), 'utf8'));
for (const s of catalog.services.filter(x => x.status === 'active')) {
  const tag = `service-catalog:${s.id}`;
  for (const k of ['name', 'includes', 'fit', 'lead']) {
    if (!s[k]?.et?.trim() || !s[k]?.en?.trim()) fail(tag, `${k} puudub voi on tuhi (ET+EN kohustuslik)`);
  }
  if (s.group === 'primary') {
    if (!Array.isArray(s.excludes?.et) || !s.excludes.et.length) fail(tag, 'excludes.et puudub (primary pakett peab utlema, mida EI sisalda)');
    if (!Array.isArray(s.excludes?.en) || !s.excludes.en.length) fail(tag, 'excludes.en puudub');
    if ((s.excludes?.et?.length ?? 0) !== (s.excludes?.en?.length ?? 0)) fail(tag, 'excludes ET/EN pikkus erineb');
  }
}
```

**Step 2: Jooksuta — peab PASSIMA kohe** (kataloogis on väljad juba olemas):

```
node tests\claims.mjs
```
Oodatud: PASS. Kui kukub, on kataloogis päris auk — paranda kataloogi, mitte väravat.

**Step 3: Negatiivtest (KOHUSTUSLIK).** Tühjenda ajutiselt ühe primary teenuse `excludes.et`, jooksuta, veendu et värav KUKUB, taasta.

**Step 4: Commit**

```
git add tests/claims.mjs
git commit -m "test(claims): kataloogivarav - aktiivne pakkumine peab kandma fit, excludes ja lead valju"
```

---

## Task 6 (idee 10): `/prices` pinna kärpimine — 2 h

**Files:** Modify `site/app/[lang]/prices/page.tsx`

**PARANDUS:** avaleht on juba korras (3 paketti). Probleem on `/prices` lehel: 3 primary + 3 growth + 6 bespoke + 1 product = **13 konkureerivat pinda** ühel lehel. Kõik võitjad (Veebimets, Navik, Caotica, Webabi) näitavad kolme.

**Step 1:** Hoia „Veebipaketid" sektsioon MUUTMATA (see on peatee).

**Step 2:** „Nähtavus, bränd ja mõõtmine" (3 growth-kaarti) — teisenda kaartidelt üherealiseks loendiks sama `.table-scroll` tabelisse, mis juba hoiab bespoke-pakkumisi. Üks tabel, kaks `<tbody>` gruppi, üks `<caption>`. Nii kaob kolm `btn-fill` nuppu (4e värav paraneb) ja leht saab ühe selge hierarhia: **kolm kaarti → üks tabel → üks audit-plokk**.

**Step 3:** Bespoke-tabelisse lisa `lead` veerg (kataloogis olemas, praegu kuvamata) — „Tarne" veerg pärast „Algushind".

**Step 4:** Ehita, väravad, eriti 4e (nuppude arv langes) ja `no-hscroll@390` (tabel sai veeru juurde).

```
cd site; $env:NODE_ENV=''; npx next build; npx next start -p 3311
node ..\tests\gates.mjs; node ..\tests\axe.mjs
```

**Step 5: Commit**

```
git add "site/app/[lang]/prices/page.tsx"
git commit -m "refactor(prices): 13 konkureerivat pinda -> kolm kaarti, uks tabel, uks audit-plokk"
```

---

## Task 7 (idee 9): „Mida see ei sisalda" kaardile — 2 h

**Files:** Modify `site/components/ServiceCards.tsx`

**PARANDUS:** `fit` on juba renderdatud (`<p className="muted">{offer.fit[lang]}</p>`). Puudu on ainult `excludes`.

**Konkurentsitõend:** Caotica kaotab väikeostja, kes näeb SEB/Sorainen/Pärnu Sadama logosid ja järeldab „liiga suur minu jaoks". leisson.eu tootecase'id (AgroNutikas, ProUXAudit) annavad SAMA signaali. Vastumürk on öelda otse, kus pakett lõpeb.

**Step 1:** `service-terms` `<dl>` järele:

```tsx
{offer.excludes && <div className="service-excludes">
  <p className="eyebrow">{et ? 'Ei sisalda' : 'Not included'}</p>
  <ul>{offer.excludes[lang].map(x => <li key={x}>{x}</li>)}</ul>
</div>}
```

**Step 2:** `globals.css` — loend peab olema visuaalselt vaiksem kui „sisaldab":

```css
.service-excludes { margin-top: var(--orbit-space-3); }
.service-excludes ul { margin: 0; padding-left: 1.1em; color: var(--orbit-color-text-muted); font-size: 14px; }
```
(Kontrolli tokeni täpset nime `packages/orbit-tokens` väljundist — ÄRA kirjuta hex-väärtust.)

**Step 3:** Ehita + väravad. Kaardi kõrgus kasvab → kontrolli `grid-3` joondust 1024 px ja 390 px juures.

**Step 4: Commit**

```
git add site/components/ServiceCards.tsx site/app/globals.css
git commit -m "feat(prices): iga pakett utleb ka selle, mida ta EI sisalda"
```

---

## Task 8 (idee 4): Võrdlustabel 290 / 590 / 1190 — 3 h

**Files:** Create `site/components/PackageTable.tsx`; Modify `site/app/[lang]/prices/page.tsx`

**Konkurentsitõend:** Webabi tugevaim element on hinnavahemike sisuline põhjendamine („mida saad 400 € vs 4000 € eest"); Marketing Sharksil sama blogis. Tabel täidab ühtlasi `claims.mjs` GEO-struktuurinõude (min 1 tabel) ja on AI-tsiteeritavuses mõõdetult tugev vorm.

**Step 1:** Komponent renderdab AINULT `fixedOffers()` ja AINULT kataloogivälju. Read: Hind · Tarne · Parandusring · Tasumine · Sobib kui · Ei sisalda. Veerud = kolm paketti.

**Step 2:** Muster kopeeri `/prices` bespoke-tabelist: `<div className="table-scroll" tabIndex={0}><table className="tbl"><caption className="eyebrow">…`. **Peab olema `.prose-orbit` otsene laps või `.doc-hold` sees** — muidu layout-reegel ei kehti.

**Step 3:** Paiguta kohe „Veebipaketid" kaartide JÄRELE, sama sektsiooni sisse. Kaardid = skaneerimiseks, tabel = võrdlemiseks.

**Step 4:** Mõõda Playwrightiga NELJAL laiusel (1512 / 1100 / 1024 / 390), nagu layout-mälu nõuab — mitte silma järgi.

```
node ..\tests\gates.mjs
```
Oodatud: `no-hscroll@390` PASS, `document.scrollWidth === viewport` igal laiusel.

**Step 5: Commit**

```
git add site/components/PackageTable.tsx "site/app/[lang]/prices/page.tsx"
git commit -m "feat(prices): kolme paketi vordlustabel kataloogist - hind, tarne, sisu, valistused"
```

---

# VOOR 3 — suured tükid (19 h)

## Task 9 (idee 5): Enne→pärast case — 6 h

**Files:** Create `content/work/leisson-eu-parandused.mdx`; Modify `content/portfell.csv`

**Konkurentsitõend:** Trinidadi ülekantav idee — „üks põhjalik, kuupäevastatud, autoriga case formaadis väljakutse → protsess → konkreetne number; ei vaja meeskonda ega eelarvet, ainult distsipliini kirjutada numbrid, mitte omadussõnad." Velvetilt: STRUKTUUR, mitte maht.

**Sisu — kolm mõõdetud lugu repost ja CI-logidest (mitte väited):**

1. **Loetav rea pikkus vs tühi laius.** Enne: `.prose` 68ch hoidis sisu 615 px peal 1180 px konteineris → 48 % laiust tühi, 5-veeruline tabel keris 615 px kastis. Pärast: `.doc` ruudustik `minmax(190px,230px) minmax(0,1fr)`, tekst jäi 615 px peale, tabel 910 / 942 / 707 px, horisontaalne kerimine 0 neljal laiusel. Allikas: `site/app/globals.css`, mõõtmine 12.09.2026.
2. **GA4 kolm katset.** `afterInteractive` → mobiili Lighthouse 0,83. `lazyOnload` → 0,84. `worker`/Partytown → CI roheline, aga tootmises 0 võrgupäringut ja `window.dataLayer` defineerimata. Lahendus: käsitsi laadimine esimesel interaktsioonil või 15 s pärast → värav läbitud, tootmises kontrollitud. Allikas: `site/components/Analytics.tsx`, väljalase adcb5bb.
3. **Värav, mis leidis toote vea.** `gates.mjs` 4e luges sisukorra ankrud CTA-kandidaatideks → „conflicting vocabulary". See on teine tootepoolne valepositiivne leid ProUXAuditile. Allikas: `tests/gates.mjs`.

**Step 1:** Kopeeri `export const meta` struktuur `content/work/prouxaudit.mdx`-ist. **Iga `metrics` kirje NÕUAB `source.href`** — kasuta GitHubi commit-linke ja failiradu.

**Step 2:** Kirjuta ET ja EN plokid. **`claims.mjs` reeglid, mis kukutavad:** `##` pealkiri ≤ 60 tm · ET-s en dash „–", mitte em dash „—" · ET-s „…" jutumärgid, mitte "…" · `status` ≤ 28 tm · ET/EN sõnade suhe 0,6–1,6 · iga ≥3-kohaline arv või number+ühik peab olema `metrics`-is või lauses koos „allikas:".

**Step 3:** Lisa rida `content/portfell.csv`-sse. **Jäta `url`, `shot_url` ja `shot_source` TÜHJAKS** — muidu `tools/shots.mjs` kirjutab pildi igal main-push'il üle.

**Step 4:**
```
node tests\claims.mjs; node tests\portfell.mjs
```
Oodatud: mõlemad PASS.

**Step 5:** Lisa uus URL `.github/workflows/orbit-gates.yml` site-gates URL-ide hulka.

**Step 6: Commit**

```
git add content/work/leisson-eu-parandused.mdx content/portfell.csv .github/workflows/orbit-gates.yml
git commit -m "feat(work): enne-parast case kolmest moodetud parandusest - joone pikkus, GA4, varava valepositiiv"
```

---

## Task 10 (idee 3a): Paketivalija, server-baas — 6 h

**Files:** Create `site/components/PackagePicker.tsx`; Modify `site/app/[lang]/prices/page.tsx`

**Konkurentsitõend:** Navik, Veebiagentuur ja Caotica teevad hinnakalkulaatorist peamise CTA. Veebiagentuuri oma on JS-sõltuv ja kannab lähtekoodis **8 sisseehitatud veateadet** „JavaScript files … didn't fully load"; Caotica „kalkulaator" ei ole üldse kalkulaator, vaid neli artiklit. Server-baas võidab mõlemad ilma ühegi baidi JS-ita.

**Kolm küsimust (rohkem ei ole — YAGNI):**
1. `a` — Kas leht on juba olemas? (`on` / `ei`)
2. `b` — Mitu teenust on vaja selgitada? (`uks` / `mitu`)
3. `c` — Millal peab valmis olema? (`nadal` / `kuu` / `pole-kiire`)

**Tuletusreegel (puhas funktsioon, ilma if-puuta koodis):**

```ts
export function pick(a?: string, b?: string, c?: string) {
  if (!a || !b || !c) return null;                       // vastamata → vaikeolek
  if (a === 'on' && b === 'uks') return 'inquiry-repair'; // olemas leht, uks teenus → parandus 290
  if (b === 'uks') return 'landing-page';                 // uks teenus → muugileht 590
  return 'business-website';                              // mitu teenust → koduleht 1190
}
```

**Step 1: Kirjuta test ENNE komponenti** — `tests/picker.mjs`:

```js
import { strict as assert } from 'node:assert';
import { pick } from '../site/lib/picker.mjs';
assert.equal(pick(), null, 'vastamata olek ei tohi paketti pakkuda');
assert.equal(pick('on', 'uks', 'nadal'), 'inquiry-repair');
assert.equal(pick('ei', 'uks', 'kuu'), 'landing-page');
assert.equal(pick('ei', 'mitu', 'pole-kiire'), 'business-website');
assert.equal(pick('on', 'mitu', 'nadal'), 'business-website');
assert.equal(pick('on', 'uks'), null, 'osaline vastus ei tohi paketti pakkuda');
assert.equal(pick('rampstekst', 'uks', 'kuu'), 'landing-page', 'tundmatu vaartus ei tohi visata');
console.log('picker: OK');
```

**Step 2:** `node tests\picker.mjs` → **peab KUKKUMA** („Cannot find module"). See on TDD punane samm.

**Step 3:** Kirjuta `site/lib/picker.mjs` (puhas, sõltuvusteta — sama fail käib nii testis kui komponendis).

**Step 4:** `node tests\picker.mjs` → PASS.

**Step 5:** `PackagePicker.tsx` — server-komponent, olek `searchParams` sees:

```tsx
<form method="GET" action={'/' + lang + '/prices'}>
  {/* kolm <fieldset><legend> küsimust, <label><input type="radio" name="a" value="on" defaultChecked={a==='on'}/> */}
  <button className="btn btn-ghost" type="submit">{et ? 'Näita sobivat paketti' : 'Show the matching package'}</button>
</form>
{result && <PackageResult offer={serviceById(result)!} lang={lang} />}
```

**Nõuded, mida MITTE rikkuda:**
- `btn-ghost`, mitte `btn-fill` (4e värav).
- Tulemus renderdab `priceLabel`, `lead`, `includes`, `fit` kataloogist — **mitte ükski string ei ole kirjutatud**.
- Tulemuse CTA viib `/[lang]/contact?service=<id>` — `ContactForm` `initialService` prop on JUBA olemas.
- `<form>` ankurdab tulemuse juurde: `action={'/' + lang + '/prices#picker-result'}`.
- Tundmatu searchParam → vaikeolek, MITTE 500.

**Step 6:** `prices/page.tsx` võtab `searchParams` propi vastu (Next 16: `Promise<{...}>`) ja annab edasi.

**Step 7:** Ehita ja **VÕRDLE ROUTE-TABELIT Task 0 baasjoonega.** `/[lang]/prices` First Load JS **ei tohi kasvada** — server-komponent ei lisa JS-i. Kui kasvas, oled kogemata teinud kliendikomponendi.

**Step 8:** Käsitsi testi JS-ita: Chrome DevTools → Settings → Debugger → Disable JavaScript → täida vorm → peab töötama.

**Step 9:** `node ..\tests\gates.mjs; node ..\tests\axe.mjs` — PASS. Radio-gruppidel peab olema `<fieldset><legend>`, muidu axe kukub.

**Step 10: Commit**

```
git add site/lib/picker.mjs tests/picker.mjs site/components/PackagePicker.tsx "site/app/[lang]/prices/page.tsx"
git commit -m "feat(prices): paketivalija server-baas - kolm kusimust, olek URL-is, tootab ilma JS-ita"
```

---

## Task 11 (idee 3b): Valija hüdreerimine + kimbueelarve värav — 4 h

> **EELTINGIMUS:** Task 0 sammu 4 otsus oli „React'i kliendiruntime on juba igal lehel". Kui ei olnud — **JÄTA SEE TASK TEGEMATA**, valija jääb server-only'ks.

**Files:** Modify `site/components/PackagePicker.tsx`; Create `tests/bundle-budget.mjs`; Modify `.github/workflows/orbit-gates.yml`

**Step 1: Kirjuta kimbueelarve värav ENNE hüdreerimist.** See on „2 korda = automatiseeri" punkt: GA4 kukkus mobiili Lighthouse'i väraval **kolm korda järjest**, sest kimp kasvas vaikselt ja avastati käsitsi.

`tests/bundle-budget.mjs`: loeb `site/.next/build-manifest.json` + route-tabeli, võrdleb `docs/plans/bundle-baseline.json`-iga, kukub kui mõni route ületab baasjoone + 5 KB.

**Step 2:** Loo `docs/plans/bundle-baseline.json` Task 0 numbritest.

**Step 3:** Jooksuta praeguse buildi vastu → PASS.

**Step 4: Negatiivtest.** Tõsta baasjoont ajutiselt −5 KB võrra, jooksuta, veendu et KUKUB, taasta.

**Step 5:** Lisa `.github/workflows/orbit-gates.yml` site-gates sammu, kohe pärast buildi.

**Step 6:** Hüdreeri valija: `'use client'`, `useState` kolme vastuse jaoks, `onChange` → `pick()` sama fail, `history.replaceState` URL-i sünkroonis. **`<form method="GET">` jääb alles** — see on fallback, mitte dekoratsioon.

**Step 7:** Ehita, jooksuta kimbuvärav.

```
cd site; $env:NODE_ENV=''; npx next build
node ..\tests\bundle-budget.mjs
```
Oodatud: PASS (kasv < 5 KB). **Kui kukub → revert Task 11, Task 10 jääb.** See ei ole läbirääkimiste koht.

**Step 8:** Lighthouse mobiil.

```
npx lighthouse http://localhost:3311/et/prices --preset=desktop
npx lighthouse http://localhost:3311/et/prices --form-factor=mobile
```
Oodatud: desktop ≥ 0,90, mobiil perf ≥ 0,85. **Kukkumisel revert Task 11.**

**Step 9:** Testi uuesti JS-ita (peab ikka töötama) JA JS-iga (peab reageerima ilma lehe laadimiseta).

**Step 10:** GA4 sündmus `picker_completed` — kasuta OLEMASOLEVAT `trackEvent` mustrit `site/components/Analytics.tsx`-ist. **Ära lisa uut skripti ega `next/script` strategy't** — see muster on tootmises kolm korda ebaõnnestunud.

**Step 11: Commit**

```
git add site/components/PackagePicker.tsx tests/bundle-budget.mjs docs/plans/bundle-baseline.json .github/workflows/orbit-gates.yml
git commit -m "feat(prices): valija hudreerimine + CI kimbueelarve varav (baasjoon + 5 KB)"
```

---

## Task 12 (idee 1): Mikroaudit hero'sse — 3 h

**Files:** Create `site/components/AuditHandoff.tsx`; Modify `site/app/[lang]/page.tsx`

**Konkurentsitõend:** 7/10 konkurenti lubab esimese sammuna midagi tasuta — „Telli tasuta digiturunduse audit" (Marketing Sharks), „Küsi tasuta strateegiat" (Webabi), „Konsultatsioon on tasuta ja ei kohusta millekski" (Websystems), „Saa tasuta hinnapakkumine" (Veebimets). **Mitte ükski ei tarni kohe** — kõik lõpevad vormiga ja ootamisega.

**Step 1:** Komponent on `<form method="GET" action="https://prouxaudit.com/...">` — **link, mitte embed**. Kui prouxaudit.com on maas, on katki üks nupp, mitte avaleht.

```tsx
<form className="audit-handoff" method="GET" action="https://prouxaudit.com/" target="_blank" rel="noopener">
  <label htmlFor="audit-url">{et ? 'Kontrolli oma praegune leht tasuta' : 'Check your current site for free'}</label>
  <input id="audit-url" className="input" name="url" type="url" inputMode="url" placeholder="https://" required />
  <input type="hidden" name="utm_source" value="leisson.eu" />
  <input type="hidden" name="utm_medium" value="hero" />
  <button className="btn btn-ghost" type="submit">{et ? 'Ava audit' : 'Run the audit'}</button>
  <p className="dim">{et ? 'Audit on abivahend. Selle automaatne skoor ei tõenda müügitulemust ega kogu lehe ligipääsetavust.' : 'The audit is a supporting tool. Its automated score does not prove sales results or whole-site accessibility.'}</p>
</form>
```

**Step 2:** Viimane lõik EI OLE valikuline — sama lause on juba `content/pages/prices.mdx`-is ja `home.mdx`-is. Ilma selleta läheb lubadus vastuollu lehe enda tekstiga.

**Step 3:** **Kontrolli ProUXAuditi päris query-parameetri nime** enne kirjutamist (`?url=` vs midagi muud). Ära oleta.

**Step 4:** Paiguta hero'sse, hinnaankru JÄRELE. `btn-ghost`. Hero peamine tegevus jääb kontaktiks.

**Step 5:** GA4 `audit_handoff` olemasoleva `trackEvent` mustriga.

**Step 6:** Ehita + **eriti 4e värav** — hero'l on nüüd `btn-fill` (paketid) + `btn-ghost` (kontakt) + `btn-ghost` (audit) + kolm hinnaankru linki.

```
node ..\tests\gates.mjs
```
**Kui 4e kukub, on süüdlane SEE commit** — sellepärast on ta voorus 3 viimane. Revert ja aruta, kas mikroaudit läheb hoopis `/prices` lehele.

**Step 7:** `node ..\tests\axe.mjs` + `no-hscroll@390` — input + nupp peavad kitsal ekraanil murduma.

**Step 8: Commit**

```
git add site/components/AuditHandoff.tsx "site/app/[lang]/page.tsx" site/app/globals.css
git commit -m "feat(site): tasuta mikroaudit hero's - URL-vali ProUXAuditi, btn-ghost, skoori piirang kirjas"
```

---

# VOOR 4 — käsitöö ja sisu (16 h)

## Task 13 (idee 14): `apple-design` käsitööpass — 8 h

**Files:** `packages/orbit-tokens/*`, `packages/orbit-ui/orbit-ui.css`, `site/app/globals.css`

**REQUIRED SUB-SKILL:** `anthropic-skills:apple-design` JA `anthropic-skills:leisson-orbit-ds` — loe MÕLEMAD enne esimest rida.

**Skoop (ei laiene):** hero, teenusekaardid, võrdlustabel, paketivalija. **Mitte** värvipalett, mitte fondivalik, mitte uus komponent.

**Step 1:** Loe `leisson-orbit-ds` skill. **Tokenite ainus allikas on `packages/orbit-tokens`** — CSS-i ei kirjutata hex-väärtusi ega px-suurusi, mis ei ole tokenid.

**Step 2:** Loe `apple-design` skill. Rakenda ainult seal, kus on mõõdetav puudus: optiline joondus, vertikaalne rütm, fookuse olekud, liikumine (`packages/orbit-ui/spring.ts` on olemas).

**Step 3:** Enne muudatust tee ekraanipildid neljal laiusel (1512 / 1100 / 1024 / 390). Pärast samad. **Diff on tõend, mitte arvamus.**

**Step 4:**
```
node packages\orbit-tokens\verify.mjs
```
Oodatud: PASS. Kui kukub, oled kirjutanud väärtuse mööda tokenikonveierist.

**Step 5:** `node tests\gates.mjs` — sh **visuaalne snapshot värav**. See KUKUB teadlikult (disain muutus). Vaata diff üle, kinnita, uuenda baasjoon.

**Step 6:** Lighthouse + axe — kontrast ja fookusrõngad peavad olema PASS (`apple-design` pehmemad toonid võivad kontrasti langetada).

**Step 7: Commit**

```
git add packages/orbit-tokens packages/orbit-ui site/app/globals.css tests/__snapshots__
git commit -m "style(orbit): kasitoopass - hero, teenusekaardid, vordlustabel, paketivalija"
```

---

## Task 14 (idee 11): Hinnavõrdlusartikkel — 8 h

**Files:** Create `content/insights/kodulehe-hind-eestis-2026.mdx`; Modify `tests/claims.mjs`, `.github/workflows/orbit-gates.yml`

**Konkurentsitõend:** Veebimetsa „Palju maksab kodulehe tegemine 2026" sisaldab 17 Eesti tegija hinnavõrdlustabelit, nähtavat „Uuendatud: 13. september 2026" ja nimelist autorit — see on nende tugevaim orgaaniline vara. Marketing Sharksil ja Webabil sama muster. **leisson.eu-l ei ole lehte, mis sellele päringule vastaks.**

**Andmed on olemas:** `project_eesti_agentuuride_benchmark` mälufail ja `docs/plans/2026-09-21-agentuuri-benchmark-design.md` lisa A.

**Step 1: Allikavärav ENNE artiklit** (`tests/claims.mjs` laiendus, `content/insights` jaoks): iga kolmanda osapoole hinnanumber peab olema tabelirias koos allikalingi ja vaatluskuupäevaga. Negatiivtest kohustuslik.

**Step 2:** Artikli struktuur — **GEO-tõendite järgi, mitte maitse järgi** (`project_geo_ai_visibility`):
- Küsimusekujulised H2-d (tsiteeritud lehtedel 68,7 % vs 23,9 %)
- **Nummerdatud** loendid, mitte täpploendid (78,6 % vs 28,6 %; täpploend ei erista)
- Vastus esimeses 30 %-s (44 % väljavõetud tsitaatidest)
- Nähtav „Uuendatud" kuupäev
- Vähemalt üks tabel
- ET + EN samas failis, mõlemal sama struktuur

**Step 3:** Tabel = 10 agentuuri × (avalik hind · tarneaeg kirjas? · tsitaadid? · mõõdetud tulemused? · allikas + kuupäev). **Iga lahter on kontrollitav.** Ükski väide konkurendi kohta ei tohi olla hinnang — ainult see, mis on nende lehel kirjas.

**Step 4:** leisson.eu enda hinnad tabelisse **ainult `pricing.ts` kaudu** — MDX ei tohi kanda hinnanumbrit. Kui MDX seda ei võimalda, tee eraldi komponent, mis tabeli renderdab.

**Step 5:**
```
node tests\claims.mjs
```
Oodatud: PASS. Kukkumisel on põhjus alati sama: arv ilma allikata.

**Step 6:** Lisa URL `.github/workflows/orbit-gates.yml` site-gates hulka ja sitemap'i.

**Step 7:** `node ..\tests\gates.mjs` — 4f pealkirjastruktuur (üks H1, ilma tasemehüppeta) ja `no-hscroll@390` (10-realine tabel).

**Step 8: Commit**

```
git add content/insights/kodulehe-hind-eestis-2026.mdx tests/claims.mjs .github/workflows/orbit-gates.yml
git commit -m "feat(insights): kodulehe hind Eestis 2026 - 10 pakkuja avalikud hinnad allikatega"
```

---

## Task 15: Väljalase

**Step 1:** Kõik väravad rohelised lokaalselt.

**Step 2:** `git push origin main` → oota CI roheliseks (`orbit-gates.yml`: verify:tokens → shots → portfell+claims → DS sünk → tsc → gates → axe → site-gates + Lighthouse).

**Step 3:** Alles rohelise CI järel:

```
git push origin origin/main:release/production
```

**Step 4:** Tootmises kontrolli **käsitsi, mitte lokaalse buildi põhjal** (Partytowni õppetund — CI oli roheline, tootmine vaikne):
- `www.leisson.eu/et` hero: hinnaankur, mikroaudit, asutaja plokk
- `www.leisson.eu/et/prices` valija: täida ilma JS-ita ja JS-iga
- Saada päris päring vormist → kas vastuskiri ja kinnitustekst tulevad
- GA4: `audit_handoff` ja `picker_completed` jõuavad kohale

---

# VOOR 5 — saidiväline (21 h, koodi ei puuduta)

## Task 16 (O1): Registriprofiili puhastus — 6 h

1. Ariregistris „Passiivne ettevõte alates 2025" staatuse parandus.
2. 2024 tegevusaruande neli kirjaviga — kasuta `anthropic-skills:eesti-keele-toimetaja`.
3. **KMKR: EI registreeru.** Põhjendus disainidokumendi §5-s. Kontrolli enne mis tahes hinna-copy muudatust kehtiv määr ja piirmäär EMTA lehelt.

**Väljund:** `docs/plans/registri-puhastus-2026-09.md` — mis muudeti, millal, mis jäi.

## Task 17 (O2): Wikidata kirje — 3 h

LEISSON OÜ + Gert Leisson. **WD:N kriteerium 2 lubab kirje ilma tähelepanuväärsuseta.** Allikad: ariregister, leisson.eu, GitHub. **et.wikipedia artiklit EI tehta** — tähelepanuväärsus ei ole täidetud ja kustutamisarutelu jääb indeksisse.
Lisa Wikidata URI `JsonLd` `sameAs` hulka (ariregister ja GitHub on juba seal) — see on ainus koodimuudatus selles vooros.

## Task 18 (O3): LinkedIn — 4 h

Ettevõtteleht + Task 14 artikkel postitusena. LinkedIn on Semrushi mõõtmises #1 tsiteeritud domeen Google AI Mode'is.

## Task 19 (O4): Erialameedia — 5 h

Pitch = Task 14 artikkel. Kontaktid `project_revenue_strategy`-s: indrek.kald@aripaev.ee · aritehnoloogia@aritehnoloogia.ee · bestmarketing@best-marketing.ee · joonaspriit.sibul@geenius.ee · vihje@geenius.ee.
**REQUIRED SUB-SKILL:** `anthropic-skills:leisson-kirja-toimetaja`.

## Task 20 (O5): Kataloogid — 3 h

disainikeskus.ee andmebaas (Trinidad ja Velvet on mõlemad seal) + Eesti ettevõtete kataloogid. **Clutch/G2/Trustpilot EI** — ei esine üheski AI-tsitaatide top-25 nimekirjas.

---

# Mõõtmine kuu pärast

GA4: `inquiry_accepted` kuus ≥ 2× baasjoon JA `service_selected` täidetud ≥ 70 % päringutest.

Kui esimene ei liigu, aga teine liigub — kvaliteet paranes, maht mitte → järgmine sprint on saidiväline, mitte saidisisene.
Kui `audit_handoff` → `inquiry_accepted` suhe < 5 % — Task 12 revert ühe failiga.

# Kokkuvõte

| Voor | Taskid | h |
|---|---|---|
| 0 | baasjoon | 1 |
| 1 | 1–4 | 9 |
| 2 | 5–8 | 7 |
| 3 | 9–12 | 19 |
| 4 | 13–15 | 16 |
| 5 | 16–20 | 21 |
| | **kokku** | **73** |
| | puhver | 7 |

---

# PARANDUSED 2 (Task 0 mõõtmisest, 2026-09-21)

Kolm plaani eeldust osutusid valeks. Mõõtmine on `docs/plans/baseline-2026-09-21.txt` ja `docs/plans/bundle-baseline.json`.

## P2.1 — „First Load JS" veergu EI OLE OLEMAS

**Plaanis seisis:** Task 0 samm 3 ja Task 11 samm 1 loevad route-tabelist `/[lang]` ja `/[lang]/prices` First Load JS numbri.

**Tegelikult:** Next 16.3.5 Turbopack ei väljasta enam First Load JS veergu ega `app-build-manifest.json` faili. Marsruudipõhist kliendi-JS arvu ei ole võimalik buildi väljundist lugeda.

**Parandus:** kimbueelarve värav mõõdab **`site/.next/static/**/*.js` kogumahtu baitides**. Kui kliendi-JS-i lisandub, see kasvab — sama veaklass püütakse kinni, ilma marsruudi lahutuseta.

```
baasjoon   628 525 B (14 faili)
eelarve    633 645 B (baasjoon + 5 KB)
```

Task 11 sammud 1, 3, 4 ja 7 ning Task 4 samm 6 ja Task 10 samm 7 kasutavad seda arvu, mitte route-tabelit.

## P2.2 — Arhitektuurieeldus PEAB PAIKA, Task 11 tehakse

`Analytics.tsx` ja `Nav.tsx` on mõlemad `'use client'` ja mõlemad on `site/app/[lang]/layout.tsx`-is. `rootMainFiles` = **441 392 B igal lehel**. React'i kliendiruntime on juba kohal; valija hüdreerimissaar lisab ainult oma komponendi koodi.

**Otsus: Task 11 TEHAKSE.**

## P2.3 — `content/insights` on ET-ainus ja see on ÕIGE

**Plaanis seisis:** Task 14 samm 2 — „ET + EN samas failis, mõlemal sama struktuur".

**Tegelikult:** `site/app/[lang]/insights/[slug]/page.tsx` real 10 on `generateStaticParams` kõvakodeeritud `lang: 'et'` peale; read 12 ja 18 teevad `lang === 'et' ? … : null` ehk EN annab 404. Ükski `content/insights/*.mdx` ei sisalda `<Locale lang="en">` plokki — insights kasutab teist failivormi kui `content/pages` ja `content/work`.

**Parandus: artikkel kirjutatakse EESTI KEELES AINULT.** See ei ole järeleandmine:

- Ostupäring („kodulehe hind", „kodulehe tegemine") on eestikeelne.
- `project_geo_ai_visibility`: **päringu KEEL, mitte IP, otsustab, kas kohalik pakkuja vastusesse jõuab** (arXiv 2608.30052), ja balti keelte vastustes tuleb 15,0–15,5 % tsitaate brändi enda saidilt — õhuke omakeelne veeb on struktuurne eelis.
- Kõik kümme analüüsitud konkurenti kirjutavad hinnasisu ainult eesti keeles.

**Task 14 maht: 8 h → 6 h.** Vabanenud 2 h lähevad puhvrisse (7 h → 9 h).

**Lisandub Task 14 sammu 1 juurde:** `tests/claims.mjs` kontrollib praegu `content/work`, `content/docs`, `content/legal` ja `content/pages`. **`content/insights` ei ole üheski väravas** — uus allikavärav on selle kausta esimene kontroll ja peab seega ka põhistruktuuri (meta, pealkirjad, tüpograafia) katma, mitte ainult hinnaallikaid.

## P2.4 — Kosmeetiline, aga tasub teada

Build hoiatab: `Next.js ignored package-lock.json in C:\Users\gert because it is outside the current Git repository`. Sinu kodukaustas on eksinud `package-lock.json`. See ei mõjuta buildi, aga selle kustutamine vaigistab hoiatuse. Sama hoiatus soovitab `turbopack.root` seadistada `next.config.ts`-is — **ära tee seda sprindi sees**, see on eraldi muudatus oma väravajooksuga.

## Uus kokkuvõte

| Voor | Taskid | h |
|---|---|---|
| 0 | baasjoon | 1 · ✅ tehtud |
| 1 | 1–4 | 9 |
| 2 | 5–8 | 7 |
| 3 | 9–12 | 19 |
| 4 | 13–15 | 14 |
| 5 | 16–20 | 21 |
| | **kokku** | **71** |
| | puhver | 9 |

---

# PARANDUSED 3 (Task 2 käigus, 2026-09-21)

## P3.1 — Snapshot-värav EI OLE blokeerija. See on CI-värav disaini järgi.

Lokaalne `node tests/gates.mjs` annab 4 viga `ds/orbit-ds.html` peal (390-dark 5,09 % · 390-light 5,04 % · 1280-dark 2,67 % · 1280-light 2,41 %). Kontrollitud puhta puu peal — **samad protsendid, minu tööga seost ei ole.**

Põhjus on `.github/workflows/orbit-gates.yml` real 93 juba kirjas: *„main push = `--update` ja commitib; PR = võrdleb main'i baasjoonega. Nii on snapshot päris regressioonivärav, mitte **fondirenderduse loterii**."* Baasjoonpildid on CI Linuxi renderdaja omad. Windowsis lokaalselt jooksutatuna ta alati lahkneb.

**Reegel edaspidi:** `tests/gates.mjs` jookseb lokaalselt ALATI `--no-snapshot` lipuga. Snapshot-diffi loetakse CI-st, mitte Gerti masinast. **Task 13 (apple-design pass) samm 5 muutub:** diff vaadatakse üle PR-i CI-jooksust, lokaalne pildivõrdlus ei ole tõend.

## P3.2 — CTA-värav ei ole `gates.mjs` 4e. See on `tests/proux-cta.mjs`.

`gates.mjs` 4e **eemaldati 13.09.2026** ja reegel elab nüüd `tests/proux-cta.mjs`-is — ProUXAuditi mootori sõna-sõnaline port, valideeritud raporti rpt_wbvmLfQ vastu.

**Mõõdetud läved (`proux-cta.mjs` read 86, 109–111):**

```
rec_competing   : ctaVerbs > 3  VÕI  ctaTexts >= 4  VÕI  (actionVerbs >= 3 või uniqueLabels >= 4)
rec_choice_load : EI (combined <= 10 JA ctaTexts <= 3)      combined = ctaTexts + navItems
kandidaadid     : button, a, [role=button], input[type=submit|button]  ← IGA <a> loeb
```

**Avalehe hetkeseis (mõõdetud):** `/en` 5 CTA-d + 7 nav = 12 · `/et` 5 CTA-d + 8 nav = 13. Mõlemad juba üle `choice_load` läve, aga väravas diagnostilised, mitte vead.

**Sellepärast muutus Task 2:** plaanis oli hinnaankur kolme lingina pakettide juurde. See oleks lisanud EN-lehele kolm `<a>` → ctaTexts 8 → `rec_competing` vallandub. **Hinnaankur on nüüd PUHAS TEKST** — paketi nimi, hind ja tarneaeg nähtaval, ilma ühegi uue lingita. Konkurentsitõend (Veebimets, Navik: hind ja tähtaeg kõrvuti) on täidetud, CTA-arv ei liikunud.

**Reegel ülejäänud sprindile:** iga uus `<a>` või `<button>` avalehel või `/prices`-il tuleb enne lisamist `proux-cta.mjs`-iga läbi mõõta. See puudutab otseselt **Task 8** (võrdlustabel — kasuta tekstilahtreid, mitte lingitud paketinimesid), **Task 10** (valija — üks nupp, mitte üks nupp paketi kohta) ja **Task 12** (mikroaudit — see on neljas element hero's).

## P3.3 — Lokaalne väravakäsurida (asendab §„Väravate käsurida")

```
node packages\orbit-tokens\verify.mjs
node tests\portfell.mjs ; node tests\claims.mjs ; node tests\kaibemaks.mjs ; node tests\toetused.mjs
cd site ; $env:NODE_ENV='' ; npx tsc --noEmit ; npx next build ; npx next start -p 3311
node tests\gates.mjs --no-snapshot --url http://localhost:3311/et http://localhost:3311/en http://localhost:3311/et/prices
node tests\proux-cta.mjs --url http://localhost:3311/en http://localhost:3311/et
node tests\axe.mjs --url http://localhost:3311/et http://localhost:3311/et/prices
```

---

# AUTOMATISEERIMINE 1 — `tools/local-gates.mjs` (Voor 1 käigus, 2026-09-21)

**Käivitaja:** kolm korda järjest kulus aega sellele, et meelde tuletada, millised väravad lokaalselt üldse jooksevad.

| Kord | Viga | Kaotatud |
|---|---|---|
| 1 | `tests/gates.mjs` ilma `--no-snapshot` liputa → 4 „viga", mis on fondirenderduse vahe | ~20 min uurimist + valehäire kasutajale |
| 2 | `tests/axe.mjs` → `MODULE_NOT_FOUND`, sest `@axe-core/playwright` on ainult CI-s | üks jooks |
| 3 | `next start` jäi vanalt buildilt käima → EADDRINUSE; halvemal juhul oleks server vaikselt vana sisu serveerinud ja värav oleks kontrollinud valet lehte | üks jooks + peaaegu vale tõend |

**Lahendus:** `node tools/local-gates.mjs` teeb kogu ahela ühe käsuga:

```
verify:tokens → portfell → claims → kaibemaks → toetused
→ tsc → next build → kimbueelarve (docs/plans/bundle-baseline.json vastu)
→ port vabaks → next start → oota kuni vastab
→ gates.mjs --no-snapshot (7 URL-i) → proux-cta.mjs (5 EN URL-i)
→ server kinni → kokkuvõte
```

- `NODE_ENV=''` on sisse ehitatud igasse alamprotsessi — Gerti globaalse `production` lõks ei saa enam vallanduda.
- Port tapetakse **enne ja pärast** — kolmas viga ei saa korduda.
- `--fast` jätab buildi ja brauseri vahele (ainult staatilised väravad, ~5 s).
- Kokkuvõte ütleb lõpus välja, mida CI lisaks jooksutab (snapshot, axe, Lighthouse, site-sync, skills-validate) — nii ei teki illusiooni, et roheline lokaal tähendab rohelist CI-d.

**Esimene jooks: 10/10 roheline.**

*Märkus: repo juures ei ole `package.json`-i (ainult `site/` ja `crm/` omad), seega npm-skripti ei saa juurde lisada — käsk on `node tools/local-gates.mjs`.*

**Plaani mõju:** iga järgmise taski väravasamm asendub ühe reaga `node tools/local-gates.mjs`. Task 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 sammud „ehita + väravad" viitavad sellele.

---

# TÖÖKOHT 2 — worktree (21.09.2026, pärast haruvahetuse juhtumit)

## Miks kolisime

`feat/crm-riigihanked` sessioon vahetas peakataloogis haru **keset minu tööd**: Task 4 commit läks valele harule (reflog `HEAD@{1}: checkout: moving from feat/agentuuri-benchmark to feat/crm-riigihanked`). Midagi ei kadunud — `feat/crm-riigihanked` oli hargnenud täpselt minu HEAD-ist, nii et pointerite parandus oli piisav. Aga järgmine kord võib haru vahetuda keset buildi ja väravad kontrolliksid vale puu sisu.

Peakataloogis on **kuus** aktiivset worktree'd/harut. Eeldus „töökataloog on minu päralt" oli vale.

## Seadistus (töötab, 10/10 roheline)

```
C:\Users\gert\Desktop\LEISSON.CREATIVE\_worktrees\agentuuri-benchmark   ← feat/agentuuri-benchmark
C:\Users\gert\Desktop\LEISSON.CREATIVE\Leisson Creative                 ← feat/crm-riigihanked (teine sessioon)
```

- **`node_modules` juurtasemel = junction** peakataloogi omale. Testid (playwright jne) leiavad selle. Töötab.
- **`site/node_modules` = PÄRIS install, mitte junction.** Turbopack keeldub: *„Symlink [project]/node_modules is invalid, it points out of the filesystem root."* `npm install --no-audit --no-fund` `$env:NODE_ENV=''`-ga võttis **10 s**, 53 paketti. Varasem hirm pika installi ees oli alusetu.
- **Väravad jooksevad pordil 3312**, et mitte tappa teise sessiooni serverit pordil 3311: `node tools\local-gates.mjs --port 3312`.
- **Git worktree'is käib AINULT Desktop Commanderiga.** Linuxi VM ei suuda lahendada `.git`-faili, mis osutab Windowsi rajale (`fatal: not a git repository`). Failide lugemine ja muutmine VM-ist töötab normaalselt (kaust on ühendatud), ainult git mitte.

## Enne worktree eemaldamist

```
cmd /c rmdir "<worktree>\node_modules"      # junction MAHA, muidu git worktree remove järgib linki
git worktree remove <worktree>
```

## LEID — `.gitattributes` auk (parandatud, commit f96a5ce)

Värske checkout Windowsis andis **44 `.mdx` faili CRLF-lõpudega** ja `tests/claims.mjs` kukkus **14 veaga**: tabeliparser loeb veerge `|`-märgi järgi ja viimane veerg sai varjatud `\r` sufiksi (`tabeli veergude arv ei klapi: 4/3`).

`.gitattributes` lukustas juba `*.csv`, `*.mjs`, `*.json` — faili enda kommentaar kirjeldab **sama bug'i esimest poolt** („11.09 CRLF-bug, portfell.csv"). `.mdx` jäi vahele. Peakataloogi working copy oli LF ja CI on Linux, seega viga ei paistnud **kunagi** välja.

Parandus: `*.mdx text eol=lf` ja `*.md text eol=lf`. Committed blob'id olid juba LF, seega normaliseerimine ei tekitanud ühtegi sisulist muudatust — `git diff` on pärast tühi.

**Õppetund plaani jaoks:** väravad, mis jooksevad ainult CI-s (Linux), ei kaitse Windowsi arendaja vastu. `tools/local-gates.mjs` on nüüd see, mis seda vahet katab.

---

# PARANDUSED 4 (Voor 2 käigus, 2026-09-21)

## P4.1 — Task 8 (võrdlustabel) LÕIGATAKSE. Põhjus: Task 7 võttis selle töö ära.

Plaanis oli eraldi `PackageTable.tsx`: read Hind · Tarne · Parandusring · Tasumine · Sobib kui · Ei sisalda, veerud = kolm paketti.

**Pärast Task 7 kannab teenusekaart juba kõiki neid välju** (`priceLabel`, `lead`, parandusring, `paymentLabel`, `fit`, `excludes`) ja kaardid on `grid-3` sees juba kõrvuti. Eraldi tabel kordaks sama sisu kolmandat korda samal lehel.

See läheks otse vastuollu Task 6-ga, mille kogu mõte oli **13 konkureerivat pinda → kolm**. Ei ole järjekindel lõigata kuus pinda ära ja lisada seitsmes.

Kaks argumenti, mis tabeli poolt räägiksid, on juba kaetud:
- **GEO-struktuur** (`claims.mjs` nõuab ≥ 1 tabelit): `/prices` näitab mõõdetult „1 tabelit" — Task 6 ühendatud tabel.
- **Webabi/Marketing Sharksi õppetund** („mida saad 400 € vs 4000 € eest"): see oli *hinnavahemike sisuline põhjendamine*, mitte tabelivorm. Selle kannab **idee 11 hinnavõrdlusartikkel** (Voor 4), kus võrdlus on 10 pakkuja vahel — päris uus info, mitte oma kataloogi ümbertõstmine.

**Vabanenud 3 h → puhver 9 h → 12 h.**

Kui hiljem tuleb tõend, et ostja ei suuda kaartide vahel valida (nt ProUXAuditi audit või päris päring, mis seda ütleb), on õige vastus **Task 10 paketivalija**, mitte tabel. Valija vastab küsimusele „milline neist on minu oma", tabel vastab „mis vahe neil on" — ja kaardid vastavad teisele juba.

## Voor 2 lõppseis

| Task | Seis | Mõõdetud |
|---|---|---|
| 5 · kataloogivärav | ✅ `655be01` | 15 aktiivset pakkumist; negatiivtest andis 3 viga, taastamisel roheline |
| 6 · `/prices` kärpimine | ✅ `fb32dde` | pealkirju 17 → 13; `/en/prices` CTA 2 + nav 7 = 9 (muutumatu); no-hscroll@390 läbitud |
| 7 · „ei sisalda" kaardil | ✅ `fb32dde` | `excludes` oli kataloogis olemas, kuvamata |
| 8 · võrdlustabel | ❌ lõigatud | vt P4.1 |
| + | Task 4 lõpetatud: päris foto | `gert.webp` 384×384, 11 kB; `<img>` mitte `next/image` → −15 747 B |

**Voor 2 kulu: ~5 h planeeritud 7-st.**

---

# PARANDUSED 5 (Voor 3 käigus, 2026-09-21)

## P5.1 — ProUXAudit ei toeta eeltäitmist. Task 12 on LINK, mitte URL-väli.

Plaanis oli hero's `<form method="GET">` väljaga, mis saadab külastaja aadressi ProUXAuditi.

**Mõõdetud brauseris:** `prouxaudit.com/audit` vorm kannab välja `name="targetUrl"`, aga `action` on `null` (React käsitleb ise) ja leht **ei loe ühtki päringuparameetrit**. Kontrollitud neli varianti — `?targetUrl=`, `?url=`, `?target=`, `?site=` — väli jääb igal juhul tühjaks.

Väli leisson.eu-l tähendaks, et külastaja kirjutab oma aadressi **kaks korda**: ühe korra siin, teise korra seal. See on täpselt see umbtee, mille leidmiseks kogu analüüs tehti.

**Tehtud:** üherealine tekstilink hero's, `utm_source=leisson.eu&utm_medium=hero`, koos auditi piirangu lausega (sama sõnastus, mis juba `prices.mdx`-is).

**Järelduseks eraldi tööks (mitte selles sprindis, teine repo):** lisa PROUXAUDIT repos `/audit` lehele `searchParams.targetUrl` lugemine välja algväärtuseks. Umbes kümme rida, kasulik igale kampaanialingile, ja siis muutub siin ainult `href`. Skill `prouxaudit-pr` katab selle PR-i.

## P5.2 — Minu enda viga: `picker_completed` ei oleks GA4-i jõudnud

`site/components/Analytics.tsx` hoiab lubatute loendit: `trackEvent` viskab kõik loendist väljas oleva **vaikselt** ära. Task 11-s lisasin `trackEvent('picker_completed', …)`, aga ei lisanud seda loendisse — sündmus oleks kadunud ja keegi poleks märganud, sest edukriteerium mõõdetakse alles kuu pärast.

Parandatud koos `audit_handoff`-iga; loendi juurde kirjutatud kommentaar, miks see juhtus. Mõlemad sündmused **tõestatud brauseris**: klikk → `gtag('event', …)` kohal.

Klikijälgimine käib nüüd `data-track` atribuudi ja `Analytics.tsx` juba olemasoleva delegeeritud kuulari kaudu — null uut kliendikomponenti, null kimbukasvu.

## P5.3 — Väravate pime vahemik: 560–1000 px

Hero hinnarida jooksis ~800 px juures üle serva. `gates.mjs` mõõdab **390 ja 1280 px**; layout-mälu nõuab nelja laiust (1512 / 1100 / 1024 / 390), aga automaatne värav katab kaks.

Viga ise: eraldaja `·` oli `white-space: nowrap` spani **sees** ja kahe kirje vahel polnud tühikut, seega brauseril polnud kusagil murda. Parandatud flex-wrapiga — murdekoht on nüüd igal laiusel, mõõdetud `scrollWidth === clientWidth`.

**Leitud silmaga, mitte väravaga.** Kui selline viga kordub, on õige vastus lisada `gates.mjs`-i kolmas laius (~820 px) — aga see puudutab ka snapshot-baasjooni, seega on see omaette muudatus, mitte sprindi sees tehtav.

## Voor 3 lõppseis

| Task | Seis | Mõõdetud |
|---|---|---|
| 9 · enne→pärast case | ✅ `f6cd5ef` | claims 9 case study't 0 viga; portfell 15 rida |
| 10 · valija server-baas | ✅ `cd9a376` | TDD 7 testi; värav püüdis 2 a11y-viga (label[for], 44 px puutepind) |
| 11 · hüdreerimine + kimbuvärav | ✅ `1268f8f` | mõlemad teed tõestatud: curl annab serveri HTML-is tulemuse; brauseris `navigation entries = 1` |
| 12 · mikroaudit | ✅ `9354f05` | link, mitte väli (P5.1); GA4 tõestatud |

**Kliendi-JS: 633 054 B, eelarve 633 645 B — järel 591 B.** Voor 4 (`apple-design` pass + hinnaartikkel) on mõlemad CSS ja sisu, mitte JS, aga kui midagi kliendipoolset lisandub, tuleb baasjoon teadlikult tõsta ja commitis põhjendada.
