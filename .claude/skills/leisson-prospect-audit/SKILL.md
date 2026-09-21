---
name: leisson-prospect-audit
description: "Kui Gert palub leida mingist piirkonnast või segmendist sihtettevõtteid ja need müügiks läbi töötada: leia, mõõda nende lehed päris brauseriga, kontrolli kontaktid ja käibed, koosta artifact."
---

# Sihtettevõtete leidmine ja mõõdetud läbitöötamine

Eesmärk: nimekiri, kus IGA rida kannab ühte ettevõtte enda lehelt mõõdetud fakti, ühte hinda
leisson.eu avalikust hinnakirjast ja ühte kontaktiteed, mis on võetud nende enda lehelt.
Mitte ükski tähelepanek ega e-posti aadress ei tohi olla oletatud. Kontrollimatu rida
märgitakse kontrollimatuks, mitte ei täideta üldsõnaga.

## 1. Sihtmärkide leidmine (allikad, mis töötavad)

- `https://firmaotsing.ee/en/edetabel/maakond/<maakond>` — käibe edetabel, lehekülgede kaupa (`?page=2`).
- Maakonna arenduskeskuse tunnustuskonkursi nominendid (nt `parnumaa.ee/parnumaa-tegijad/…`) — need on
  keskmise suurusega KOHALIKUD ettevõtted, kelle veebiotsus tehakse kohapeal. Parim allikas.
- Filter: jäta välja rahvusvahelised grupid, kelle turundus on mujal (Scanfil, Metsä, Ruukki tüüp).

Võta 1,5× rohkem kandidaate kui lõpuks vaja — mõõtmine sõelub ise.

## 2. Domeenide kontroll

Enne mõõtmist kontrolli curl'iga, kas domeen elab ja kas pealkiri vastab ettevõttele.
See püüab kinni valed domeenid (`kuursaal.ee` on Haapsalu, `seikluspark.ee` on Otepää).

```bash
curl -sS -o /tmp/p.html -w "%{http_code}|%{size_download}|%{url_effective}" -L --max-time 20 \
  -A "Mozilla/5.0 (compatible; LeissonAudit/1.0)" "https://$d/"
grep -io '<title[^>]*>[^<]*' /tmp/p.html | head -1
```

## 3. Mõõtmine — Playwright cloud-konteineris

**KOHUSTUSLIK kahe seadega, muidu iga navigatsioon annab `net::ERR_CONNECTION_RESET`:**

```js
import { chromium } from 'playwright';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--ssl-version-max=tls1.2'],
  proxy: { server: 'http://127.0.0.1:36919' }   // = $HTTPS_PROXY
});
```

Põhjus: Chromiumi TLS 1.3 ClientHello (~1800 B, post-kvant võti) katkeb egress-puhverserveris.
`--disable-features=PostQuantumKyber,UseMLKEM` EI aita — ainult TLS 1.2 lagi.
curl töötab, sest loeb `HTTPS_PROXY` env-i.

Bash-tööriista timeout on 2 min → pikk jooks `nohup node audit.mjs > log 2> err &`, siis `sleep` + `tail`.
Paralleelsus 3–4 konteksti; rohkem koormab puhverserverit ja tekitab katkestusi.

Mõõda igalt lehelt:

| Näitaja | Kuidas |
|---|---|
| Ligipääsetavus | `@axe-core/playwright`, `withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])` — loenda eraldi critical+serious REEGLID ja rikkuvad SÕLMED |
| Lehe kaal | `performance.getEntriesByType('resource')` `transferSize` summa + navigatsiooni `transferSize` |
| Pildimaht | samad kirjed, kus `initiatorType === 'img'` |
| CLS | `PerformanceObserver({type:'layout-shift', buffered:true})`, ainult `!hadRecentInput` |
| Pikad ülesanded | `PerformanceObserver({type:'longtask'})` kestuste summa |
| Kolmandad osapooled | ressursid, mille host ei lõpe lehe hostiga; loenda arv JA kaal |
| Suurimad failid | `transferSize` järgi sorteeritud 2 esimest — failinimi müüb (`test.png 1911 kB`) |
| SEO/schema | title pikkus, meta description pikkus, `html lang`, `link[rel=alternate][hreflang]` arv, canonical, JSON-LD `@type`-de nimekiri |
| Ligipääsetavuse pisiasjad | `document.images` ilma `alt`-atribuudita, H1-de arv |
| Mobiil | vaateaken 390×844, `scrollWidth - clientWidth` |

Ooda `load` + 2,5–4 s + üks kerimine, enne kui mõõdad (lazy pildid ja CLS vajavad seda).

## 4. Kontaktid — ainult nende enda lehelt

Eraldi jooks: võta avalehelt `a[href^="mailto:"]` ja `a[href^="tel:"]`; kui tühi, leia link, mille
tekst või href sisaldab `kontakt|contact`, mine sinna ja korda. Filtreeri välja `sentry|wixpress|example`.
Kui e-posti ei leia, kirjuta reale „e-posti ei leitud — minna kohale / helistada“. **Mitte tuletada.**

## 5. Käibed ja aadressid — avalikud registrid ilma võtmeta

```bash
# reg_code + legal_address (maakonna kontroll!) — prefiksipõhine, diakriitikud loevad
curl -sS "https://ariregister.rik.ee/est/api/autocomplete?q=<nimi|kood>" -H 'Accept: application/json'

# käive: "Turnover (<aasta>) €X" prognoos
curl -sS -L "https://www.inforegister.ee/en/<regcode>-X/"
```

Inforegistri töötajate arvu regex on ebausaldusväärne — ära kasuta.
Äriregistri `legal_address` annab täpse tänava ja numbri; ÄRA täida majanumbrit peast.
Kui aadressi ei õnnestu kinnitada, kirjuta „täpne aadress kontrollimata“.

## 6. Pakkumise valik

Hinnad tulevad `site/lib/pricing.ts`-ist, mitte peast. Seosta leid pakkumisega:

| Mõõdetud leid | Pakkumine |
|---|---|
| Puudub meta/lang/canonical/JSON-LD, ainult üks keel, kerge leht | AI-nähtavuse audit 990 € |
| CLS > 0,1, alt-tekstita pildid, palju axe-rikkumisi, avalik sektor | UX + ligipääsetavus 1450 € |
| Leht > 4 MB, pildid > 2 MB, LCP kõrge, palju kolmandaid osapooli | Next.js kiirussprint 1900 € |
| Vana disainikiht, mitu brändi, komponendikaos | Tokenite migratsioon 2900 € / disainisüsteem alates 6000 € |

Avalikule sektorile on WCAG 2.1 AA õigusnõue — see on eraldi argument, mitte soovitus.

## 7. Marsruut

Klasterda sihtmärgid registrijärgse aadressi järgi tänava ja valla kaupa ning pane ühe tööpäeva peale.
Üks tööstustänav võib anda viis kohtumist ühel jalutuskäigul.

## 8. Tarne

Artifact `capabilities: {db:{}}`, olekupillid kollektsioonis `pipeline/<slug>` (ootel → kiri saadetud →
kohtumine → pakkumine → võidetud / ei sobi), et seis püsiks üle avamiste.
Artifactis peab olema eraldi **aus märkus**: LCP ja TTFB on pilvest läbi puhverserveri mõõdetud ja
ei ole lõplikud Core Web Vitals; mõõtmiskohast sõltumatu ja kliendi ees kaitstav on lehe kaal,
pildimaht, CLS, axe-rikkumiste arv, puuduvad meta/schema-andmed ja alt-tekstita pildid.
Lisaks eraldi sektsioon nendest, kes VÄLJA jäid, ja põhjusest — puhas leht tähendab, et müüa pole midagi.

## 9. Mälu

Kirjuta projektimällu fail `project_<piirkond>_outreach.md`: artifacti URL, metoodika, tugevaimad
leiud tabelina, puhtad lehed, järgmised sammud. Lisa MEMORY.md indeksisse.