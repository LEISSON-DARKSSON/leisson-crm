# leisson.eu — Eesti veebiagentuuride võrdlusanalüüs ja 17 ROI-järjestatud ideed

- **Kuupäev:** 2026-09-21
- **Seis:** disain kinnitatud, teostusplaan kirjutamata
- **Eelarve:** 76 h tööd + 4 h puhver (80 h)
- **Eesmärk (üks number):** kvalifitseeritud päringud leisson.eu kontaktivormist

## 0. Otsused, mis selle disaini raamivad

| Otsus | Valik | Tehtud |
|---|---|---|
| ROI mõõdik | Kvalifitseeritud päringud kontaktivormist | Gert, 2026-09-20 |
| Skoop | leisson.eu repo **+ saidiväline kiht** | Gert, 2026-09-21 (algselt ainult repo) |
| Konkurentide valik | 7 otsest + 3 tipptaset | Gert, 2026-09-20 |
| Ajaeelarve | 80 h (algselt 40 h) | Gert, 2026-09-21 |
| Meetod | 12-punktiline raster 10-le + täisteekond 3-le | Gert, 2026-09-20 |
| Paketivalija | Interaktiivne (progressiivne täiustus) | Gert, 2026-09-20 |
| KMKR | **Vabatahtlikult ei registreeru praegu** | soovitus, vt §5 |

Loetud enne tööd: `project_leisson_eu_redesign`, `project_leisson_layout`, `project_geo_ai_visibility`, `project_revenue_strategy`.

## 1. Analüüsitud agentuurid

**Otsesed konkurendid (7):** Veebimets · Marketing Sharks · Navik · Veebiagentuur.ee · Webabi · Caotica · Websystems
**Kvaliteedilagi (3):** Trinidad Wiseman · Velvet · Brand Manual

Täisteekond (ostja: teenust pakkuv 2–5 inimesega väikeettevõte, eelarve ebaselge) läbitud: **Veebimets, Caotica, Websystems**.

Toorraster on lisas A.

## 2. Kolm mustrit, mis kordusid

### 2.1 Võidab see, kes ütleb hinna JA tähtaja korraga

Veebimets seob iga paketi tarneajaga (290 € / 3–5 tp · 490 € / 7–14 tp · 790 € / 3–4 näd). Navik sama (100 € / 1 päev · 450 € / 4 päeva). Websystems peidab hinna menüüst välja; kui ostja `/kodulehe-hind/` leiab, näeb „60 €/h + vähemalt 100 tundi" ehk ~6000 € miinimumi — teekonnajälg märkis selle kõige tõenäolisemaks lahkumiskohaks.

**leisson.eu on selle juba võitnud** — 290 / 590 / 1190 € kindla tarnega kataloogis. Aga avalehel on see hall väiketekst nuppude all.

### 2.2 Seitse kümnest müüb esimese sammuna midagi tasuta — mitte ükski ei tarni kohe

„Telli tasuta digiturunduse audit" (Marketing Sharks) · „Küsi tasuta strateegiat" (Webabi) · „Konsultatsioon on tasuta ja ei kohusta millekski" (Websystems) · „Saa tasuta hinnapakkumine" (Veebimets). Kõik lõpevad vormiga ja ootamisega.

Leisson omab mootorit (ProUXAudit), mis annab tulemuse kohe. **Ainus struktuurne, mitte kosmeetiline eelis.**

### 2.3 Sotsiaalne tõend on Eesti turul odav ja õhuke — ja leisson.eu-l puudub täielikult

Veebiagentuur.ee: 0 tsitaati, 0 mõõdetud tulemust. Webabi: ainult initsiaalid („MK, SZ, PA"). Velvet: üks number terve case'i kohta. Trinidad: üks klienditsitaat terve saidi peale. **Latt on madal.**

leisson.eu-l on 0 kliendinime, 0 nägu, 0 telefoni — ainus kontakt `gert@leisson.eu` jaluses. Brand Manualil on kolm partnerit näo, CV, otsemeili ja telefoniga; see on 1:1 ülekantav ilma ressursita.

**Aus piirang:** kliendinimesid ei saa välja mõelda. Ükski idee allpool ei ütle „lisa arvustused". Asendus on **isik + kontrollitav töö**.

## 3. Ideed

### Onsite (55 h)

| # | Idee | h | Tõend |
|---|---|---|---|
| 1 | Tasuta kohene mikroaudit lead-magnetina (hero → ProUXAudit) | 3 | 7/10 lubab tasuta auditit, 0/10 tarnib kohe |
| 2 | Inimene lehele: nimi, nägu, otsekontakt | 4 | Brand Manual, Trinidad, Websystems, Webabi juhivad inimestega |
| 3a | Paketivalija — server-baas (`<form method="GET">`) | 6 | Navik, Veebiagentuur, Caotica teevad sellest peamise CTA |
| 3b | Paketivalija — hüdreerimine + kimbueelarve CI-värav | 4 | Veebiagentuuri kalkulaator kannab 8 sisseehitatud JS-veateadet |
| 4 | Võrdlustabel „mida saad 290/590/1190 € eest — ja mida ei saa" | 4 | Webabi ja Marketing Sharksi tugevaim element; täidab `claims.mjs` GEO-värava |
| 5 | Üks enne→pärast case mõõdetud numbritega | 6 | Trinidadi ülekantav idee; 7 tootecase'i, 0 teenusecase'i |
| 6 | Vastuse lubadus vormi nupu juures ja kinnitusel | 2 | Veebimets lubab 2 h; 6/10 ei luba midagi |
| 7 | Hinnaankur hero'sse: „Veebiparandus 290 € · 2 tööpäeva" | 2 | Veebimets + Navik muster |
| 8 | Telefon + asukoht + vastamisajad | 1 | Websystems, Navik, Caotica, Webabi — kõigil telefon |
| 9 | „Sobib / ei sobi" iga paketi kaardil | 4 | Caotica kaotab väikeostja SEB-logode peale |
| 10 | Avalehe kataloog 15 → 3 + üks „eritöö" rida | 3 | Kõik võitjad näitavad kolme |
| 11 | Hinnavõrdlusartikkel „Mida koduleht Eestis 2026 päriselt maksab — 10 pakkuja avalikud hinnad" | 8 | Veebimetsa 17-pakkuja tabel on nende tugevaim orgaaniline vara |
| 14 | `apple-design` käsitööpass (hero, kaardid, valija, tabel) | 8 | Velveti ja Trinidadi eelis ongi käsitöö |

### Saidiväline (21 h)

| # | Idee | h | Tõend |
|---|---|---|---|
| O1 | Registriprofiili puhastus — „Passiivne ettevõte alates 2025", 2024 aruande neli kirjaviga | 6 | Diligence näeb kõik enne kohtumist; parandus tasuta |
| O2 | Wikidata kirje (LEISSON OÜ + Gert Leisson) | 3 | Wikipedia/Wikidata kõige tsiteeritum domeen 12 turust 11-s; WD:N kriteerium 2 lubab |
| O3 | LinkedIn ettevõtteleht + idee 11 artikkel postitusena | 4 | LinkedIn #1 tsiteeritud domeen Google AI Mode'is |
| O4 | Erialameedia pitch (Äripäev/Äritehnoloogia, Best Marketing, Digigeenius) | 5 | 85,7 % AI-tsitaatidest osutab saitidele, mida bränd ei oma |
| O5 | Eesti kataloogid, sh disainikeskus.ee andmebaas | 3 | Trinidad ja Velvet on mõlemad seal; õhuke Eesti veeb võimendab |

### Väljas (põhjendusega)

- **Idee 12 ostupäringu maandumisleht (12 h)** — kattub 80 % ideedega 11, 4 ja 3. Järgmine sprint, kui artikkel mõõdetult liiklust toob.
- **Idee 13 automaatne vastuskiri (6 h)** — mõjub alles siis, kui päringuid tuleb. Järgmine sprint.
- Arvustused ja kliendilogod — pole ausat allikat.
- Sisenemispakett alla 290 € — lõhub hinnaankru (`project_revenue_strategy` hoiatab otse).
- et.wikipedia artikkel — tähelepanuväärsus ei ole täidetud, kustutamisarutelu jääb indeksisse.
- YouTube — tugevaim korrelatsioon (0,740), aga omaette sprint.
- Clutch Verified 499 $/a · Perplexity publisher program (404) · schema laiendamine (mõõdetult −4,6 % kuni +2,4 %) · elavvestlus · blogimaht (saidi lehtede arvu korrelatsioon ainult 0,17).

## 4. Arhitektuur

### 4.1 Üks andmeallikas

```
site/data/service-catalog.json   (RATE=50, 3 primary paketti, fit, excludes, lead, depositPercent)
        │ sync-orbit
        ▼
site/lib/pricing.ts  →  ServiceCards · PackageTable · PackagePicker · ContactForm · JSON-LD · .md vaade · llms.txt
```

**Hard rule (muutumatu):** ükski hind ega tarneaeg ei kirjutata teksti. Kõik uued pinnad renderdavad `fixedOffers()`, `priceLabel()`, `lead`, `excludes`, `fit` — väljad, mis on kataloogis juba olemas, aga praegu kasutamata. See on põhjus, miks idee 9 maksab 4 h ja mitte 12.

### 4.2 Failide kaardistus

| # | Fail | Tüüp |
|---|---|---|
| 1 | `site/components/AuditHandoff.tsx` (uus) → `page.tsx` hero | Server, `<form method="GET">` prouxaudit.com poole. Null kliendi-JS. |
| 2 | `site/components/Founder.tsx` (uus) + `site/public/gert.webp` + `dict.founder` | Server, `next/image`, `priority=false` |
| 3a | `site/components/PackagePicker.tsx` (uus) → `/[lang]/prices` | Server, olek `searchParams` sees |
| 3b | sama fail, `'use client'` saar | `history.replaceState` hoiab URL-i sünkroonis |
| 4 | `site/components/PackageTable.tsx` (uus) | Server, `.table-scroll` mähisega |
| 5 | `content/work/<slug>.mdx` + `content/portfell.csv` | `metrics[].source.href` kohustuslik |
| 6 | `site/lib/i18n.ts` (`dict.contact`) + `ContactForm.tsx` | Tekst |
| 7 | `site/app/[lang]/page.tsx` hero | Tekst + `priceLabel(fixedOffers()[0])` |
| 8 | `site/data/service-catalog.json` → `seller` | Andmed → jalus + JSON-LD automaatselt |
| 9, 10 | `site/components/ServiceCards.tsx` | `fit` + `excludes` kasutusele; filter `group === 'primary'` |
| 11 | `content/insights/<slug>.mdx` | ET+EN, iga number kannab allikalinki ja vaatluskuupäeva |
| 14 | `packages/orbit-ui`, `site/app/globals.css` | Tokenid muutuvad ainult `packages/orbit-tokens` kaudu |

### 4.3 Kolm arhitektuurilist otsust

**Valija on progressiivne täiustus, mitte puhas klient.** Baas on server-renderdatud `<form method="GET">`; sama komponent hüdreeritakse kohese reageerimise jaoks ja `history.replaceState` hoiab URL-i sünkroonis. Saadakse kolm asja korraga: kohene reageerimine, töötab ilma JS-ita, jagatav link. AI-crawlerid ei jooksuta JS-i (Vercel, miljard päringut) — nemad näevad serveri vastust.

**Eeldus, mis kontrollitakse sammus 0:** `Analytics.tsx` on juba kliendikomponent juurpaigutuses, seega React'i kliendiruntime on igal lehel olemas ja uus saar lisab ainult oma komponendi koodi. Kontroll: `npx next build` route-tabel, First Load JS rida `/[lang]/prices`, enne ja pärast. **Kui eeldus ei pea — kukume tagasi server-only peale (3a) ja 3b jääb tegemata.**

**Mikroaudit on link, mitte embed.** ProUXAudit jookseb oma domeenil. Kui prouxaudit.com on maas, on katki üks nupp, mitte avaleht.

**Case'i subjekt, kui klienti pole:** leisson.eu enda mõõdetud enne→pärast. Kolm dokumenteeritud lugu repos ja CI-logides — paigutuse parandus (615 px loetav rida vs 48 % tühja laiust; tabel 910/942/707 px; horisontaalne kerimine 0 neljal laiusel), GA4 kolm katset (afterInteractive 0,83 → lazyOnload 0,84 → Partytown tootmises vaikne → interaktsioonil-laadimine), CTA-värava valepositiivne leid. Pealkiri ei ole „meie suurepärane töö" vaid „mis läks valesti ja mis seda mõõtis".

## 5. KMKR — otsus ja põhjendus

**Soovitus: vabatahtlikult MITTE registreeruda praegu.** See läheb vastuollu `project_revenue_strategy` failiga, mis loetleb KMKR-i puudumise müügiblokeerijaks nr 1 — põhjus on toodud välja teadlikult, mitte kogemata.

Websystems kirjutab „60 € + km" ja „alates 4000 € + km". Caotica, Veebimets ja Navik on kas käibemaksuta või ebaselged. leisson.eu `vatNote()` ütleb: *„Kõik summad on eurodes ja on lõpphinnad. LEISSON OÜ ei ole käibemaksukohustuslane; käibemaksu ei lisandu."* Sihtrühmale, kes ise ei ole käibemaksukohustuslane, tähendab see, et 290 € on 290 €, samas kui konkurendi sama number on tegelikult kõrgem. **See on ainus hinnaeelis selles segmendis.**

Vabatahtlik registreerimine täna: iga avaldatud hind muudab tähendust keset sprinti, `vatNote()` lubadus läheb ümber kirjutamisele kolmes kohas, lisandub igakuine KMD-kohustus enne, kui on käivet, mille pealt sisendkäibemaksu maha arvata.

**Tee:** O1 parandab kaks tasuta asja (registristaatus, aruande keel). KMKR jääb ootele ja registreeritakse hetkel, kui esimene KM-kohustuslane äriklient seda pakkumisel küsib või käive läheneb piirile.

**Põhjendus:** *arenduskiirus* — täna null koodimuudatust, homme üks; *skaleeritavus* — kataloog kannab juba `seller.vatRegistered` lippu ja `vatNote()` lülitab kõik pinnad ühe boolean'iga, migratsioon ongi üherealiseks disainitud; *süsteemi puhtus* — hind on tuletatud ühest kohast ja selle tähendus ei tohi muutuda sprindi keskel.

**Kontrollida enne mis tahes copy-muudatust:** kehtiv käibemaksumäär ja registreerimise piirmäär EMTA lehelt. Selles dokumendis numbrit teadlikult ei ole.

## 6. Väravad

```
node packages/orbit-tokens/verify.mjs
node tests/portfell.mjs && node tests/claims.mjs
npx next build && npx next start -p 3311      # AINULT Windows Desktop Commander, $env:NODE_ENV=''
node tests/gates.mjs + tests/axe.mjs          # 13 URL-i
Lighthouse: desktop >= 0,90 · mobiil perf >= 0,85
```

### Kaks värava-riski

1. **`gates.mjs` 4e CTA-hierarhia.** Ideed 1, 3 ja 7 lisavad hero'sse pinda; värav on juba kord katki läinud (sisukorra ankrud loeti CTA-ks). **Reegel kogu sprindi jaoks: üks `btn-fill` lehe kohta.** Mikroaudit ja valija on `btn-ghost`; idee 7 on tekst, mitte nupp.
2. **`no-hscroll@390` + layout-reegel.** Idee 4 tabel peab olema `.table-scroll` sees ja `.prose-orbit` OTSENE laps — muidu `max-width` reeglid ei kehti.

### Kolm uut väravat (automatiseerimine: „2 korda = automatiseeri")

- **Kataloogivärav** (`tests/claims.mjs`): iga `status: "active"` pakkumine peab kandma mittetühja `fit`, `excludes` ja `lead` välja. Kaob veaklass „pakett kukub valijas või tabelis tühja lahtrina välja". ~20 min, voor 2 algusesse.
- **Kimbueelarve värav** (`.github/workflows/orbit-gates.yml`): loeb `next build` väljundist route'ide First Load JS ja kukub, kui `/[lang]/prices` või `/[lang]` ületab lukustatud baasjoone + 5 KB. Kaob veaklass „JS hiilis sisse, Lighthouse kukkus kaks nädalat hiljem" — see on juba kolm korda juhtunud (GA4). ~30 min, idee 3b sees.
- **Hinnaartikli allikavärav** (`tests/claims.mjs` laiendus): iga konkurendi hinnanumber artiklis peab kandma `source.href` ja vaatluskuupäeva. Kaob veaklass „võrdlus vananes vaikselt ja jäi valeks". ~20 min, idee 11 sees.

## 7. Mõõtmine

GA4-s olemas: `service_selected`, `inquiry_accepted`. Lisandub kaks sündmust sama `Analytics.tsx` interaktsioonimustriga (ilma uue skriptita): `audit_handoff` (idee 1) ja `picker_completed` (idee 3). **Need kuuluvad ideede 1 ja 3 sisse**, mitte eraldi ritta — ilma nendeta ei saa kuu pärast öelda, kas idee töötas.

**Edukriteerium kuu pärast väljalaset:** `inquiry_accepted` kuus >= 2x praegune baasjoon JA `service_selected` täidetud >= 70 % päringutest. Kui esimene ei liigu, aga teine liigub — kvaliteet paranes, maht mitte, ja järgmine sprint on saidiväline, mitte saidisisene.

## 8. Tarnejärjekord

| Voor | Sisu | h |
|---|---|---|
| 1 · kiired võidud | 8 → 7 → 6 → 2 | 9 |
| 2 · kataloogipind | kataloogivärav → 10 → 9 → 4 | 11 |
| 3 · suured tükid | 5 → 3a → 3b (+kimbuvärav) → 1 | 19 |
| 4 · käsitöö ja sisu | 14 → 11 (+allikavärav) | 16 |
| 5 · saidiväline | O1 → O2 → O3 → O4 → O5 | 21 |
| — | puhver | 4 |

**Miks selles järjekorras:** voor 1 on sõltuvusteta ja kui sprint katkeb, on sait juba parem. Voor 2 kolm ideed loevad samu kataloogivälju, seega järjest, mitte paralleelselt. Voor 3 mikroaudit tuleb viimasena, sest ta puudutab hero CTA-hierarhiat ja 4e värav peab teiste muudatuste peale juba stabiliseerunud olema. Voor 5 tuleb pärast ideed 11, sest artikkel ON O3 ja O4 sisu — üks kirjutustöö, kolm kanalit.

## 9. Riskid

| Risk | Tõenäosus | Maandus |
|---|---|---|
| 4e CTA-värav kukub | keskmine | „Üks `btn-fill` lehe kohta"; voor 3 lisab hero'sse pinda alles pärast voore 1–2 |
| Mobiili Lighthouse < 0,85 | madal-keskmine | Sammu 0 mõõtmine + kimbueelarve värav; kukkumisel 3b revert, 3a jääb |
| Mikroaudit toob rämpsliiklust | keskmine | Mikroaudit on `btn-ghost`, hero peamine tegevus jääb kontaktiks; mõõdame `audit_handoff` → `inquiry_accepted` suhet; alla 5 % kuu pärast → revert ühe failiga |
| Case ilma kliendita loeb ostja enesekiituseks | keskmine | Kolm lugu on kõik vigade parandused mõõdetud numbritega, mitte saavutused |
| Hinnavõrdlusartikkel vananeb | kõrge | Allikavärav + nähtav „Uuendatud" + kvartaalne ülevaatus |
| Konkurent reageerib artiklile | madal | Kõik numbrid on avalikud ja allikaviidetega; vaidlus käib faktide, mitte arvamuse üle |

## 10. Järgmine sprint (mitte selles)

1. Saidiväline jätk: YouTube, podcastid, Friends of Figma Tallinn speaker-slot
2. Idee 12 ostupäringu maandumisleht — kui artikkel mõõdetult liiklust toob
3. Idee 13 automaatne vastuskiri — kui päringumaht seda õigustab
4. KMKR-i registreerimine, kui tingimus §5-s täitub

---

# Lisa A — 10 agentuuri raster

Mõõdetud 2026-09-20 WebFetch'iga, igaüks vähemalt 3 lehelt. Täisteekond läbitud: Veebimets, Caotica, Websystems.

## A1 · Veebimets — veebimets.ee

- **H1:** „Veebimets OÜ" (firmanimi, mitte kasutegur). Alapealkiri: „Käsitsi kodeeritud kodulehed väikeettevõtetele: kiired, Google'is leitavad ja ilma kuutasudeta."
- **Hind:** 290 € / 490 €+ / 790 €+ · hooldus al. 20 €/kuu · hädaabi al. 90 € · domeen 35 €. **Tähtajad paketi kõrval:** 3–5 tp / 7–14 tp / 3–4 näd.
- **Tõendid:** 3 nimelist case't (Sarmet.eu, Rukman.ee, Värvimistööd.ee), „15+ valminud kodulehte", PageSpeed 97–100. Tsitaate ei ole.
- **Vorm:** 8 välja, sh eelarve-rippmenüü. **„Vastame tööpäeviti 2 tunni jooksul. Ei mingit spämi."**
- **Sisu:** „Uuendatud: 13. september 2026", nimeline autor, 17 Eesti tegija hinnavõrdlustabel, 3-aastane kulude võrdlus, nummerdatud „8 küsimust".
- **Usaldus:** reg-nr 17404991, telefon. KMKR, aadress, meeskonna näod, arvustused puuduvad. Garantii: „100% rahulolu. Parandame tasuta kuni oled rahul."
- **Nõrkus:** 4 erinevat CTA-sõnastust ühe vormi jaoks.
- **Ülekantav:** hind + tähtaeg alati kõrvuti.

## A2 · Caotica — caotica.ee

- **H1:** „Läbimõeldud kodulehe disain, eesmärgiga veebiarendus ja turvaline haldus"
- **Hind:** one-pager al. 1500 € · infoleht al. 3000 € · e-pood al. 5000 €. „Hinnakalkulaator" **ei ole kalkulaator** — neli artiklit.
- **Tõendid:** 4 case't + 30+ logo. Mõõdetud: Deep Space Energy „ca 1 mil euro rahastus 2 kuud pärast lansseerimist"; CENOS kontaktide määr „20 %-lt 80 %-le". Tsitaate ei ole.
- **Vorm:** 8 välja, 6 kohustuslikku, sh **eelarve sundvalik** + CAPTCHA. Vastamisaega ei lubata.
- **Usaldus:** reg-nr 11573928, KMKR EE101280172, telefon, asutaja nimi + LinkedIn. Fotot, aadressi, arvustusi ei ole.
- **Teekonnajälg:** kogemuste leht (SEB, Sorainen, Pärnu Sadam) on **kõige tugevam lahkumispunkt** — väikefirma järeldab „liiga suur minu jaoks".
- **Ülekantav:** alates-hinna kolmik avalehel nähtaval.

## A3 · Websystems — websystems.ee

- **H1:** „Veebiarendus, e-poed ja SEO teenused ettevõtetele"
- **Hind:** **ei ole peamenüüs.** `/kodulehe-hind/`: koduleht al. 4000 €+km, e-pood al. 6000 €+km, tunnihind **60 € + km**, „iga projekt sisaldab vähemalt 100 tundi tööd". Uuendatud 08.05.2026.
- **Tõendid:** 6 case't nimeliselt, 10 pikka arvustust, „880+ rahulolevat klienti", „20+ aastat". Mõõdetud tulemusi ei ole.
- **Vorm:** 4 välja, madal barjäär. Vastamisaega ei lubata.
- **Usaldus:** meeskonna nimed ja rollid, telefon, e-post. Reg-nr ja KMKR jaluses puuduvad.
- **Protsess:** 10-astmeline etapiloend.
- **Teekonnajälg:** hinnaleht pole menüüs → ostja peab otsima; leides näeb 100 h / 6000 € miinimumi → **kõige tõenäolisem lahkumiskoht.**
- **Ülekantav:** „meie tunnihind on X, miinimum on Y, ja siin on miks".

## A4 · Marketing Sharks — marketingsharks.ee

- **H1:** „HUNGRY FOR YOUR SUCCESS". Alapealkiri kasvu-/AI-keskne.
- **Hind:** oma teenuste hind **puudub**. Blogiartiklis turuvahemikud: 1500–5000 € (valmislahendus), 4000–10 000 € (eritellimus), e-pood al. 3000 €.
- **Tõendid:** kliendinimed (Kalle Beds, Vunder, Persona, Lottemaa), „95 % soovitavad", „250+ kodulehte", „14 aastat". Tsitaate ei ole.
- **Vorm:** 8 välja, ainult teenuse valik kohustuslik. Vastamisaega ei lubata („Vastame kiiresti!").
- **Usaldus:** reg-nr 12228889, KMKR EE101519746, telefon, LHV konto, sertifikaadid (Google Partners, HubSpot, Semrush Academy). Meeskonna nimesid/nägusid ei ole.
- **Nõrkus:** kaks konkureerivat peamist CTA-d — „tasuta audit" vs „küsi pakkumist".
- **Ülekantav:** hinnaartikli struktuur — vahemikud + „odav vs kallis lõks" + 10-küsimuseline KKK. Aus lause: „kõige kallim koduleht on see, mis ei too ühtegi klienti."

## A5 · Navik — navik.ee/veeb/

- **H1:** „Uus koduleht **alates 100 €**". Alapealkiri: „Tehisintellekt teeb musta töö. Sina räägid oma ärist — mina ehitan puhta, kiire ja professionaalse kodulehe."
- **Hind:** 100 € (1 päev) · 350–890 €+ · 590–1490 €+ · 40 €/h muudatused · lisad fikseeritud hinnaga (mitmekeelsus 120–250 €, lisaleht 70 € jne).
- **Kalkulaator:** 4 sammu (maht → sisu muutmise viis → lisad → olemasolevad materjalid) → orienteeruv maksumus + tööaeg + paketi sisu; lõpus e-post.
- **Tõendid:** 7 case't nimeliselt, **igaühe juures hind ja tähtaeg**. 1 tsitaat (Raul S., RS Auto 24).
- **Usaldus:** reg-nr 17454389, aadress, telefon. KMKR, fotod, logod puuduvad.
- **Nõrkus:** bränditasandi vastuolu — sama domeen müüb „väldi 50 000 € viga" (korporatiivne) ja „100 € kiirleht" (mikroettevõtja).
- **Ülekantav:** case'i juures hind + tähtaeg, mitte ainult „vaata portfooliot".

## A6 · Veebiagentuur.ee

- **H1:** „Veebiarendus ettevõttele, kes vajab rohkem kui lihtsalt kodulehte"
- **Hind:** hinnalehel **ükski number puudub**. Kõik numbrid on ainult JS-kalkulaatoris (Stylish Cost Calculator): moodulipõhised fikseeritud lisahinnad (blogi 60 €, broneerimine 180 €, mitmekeelsus 180/220 €, maksevärav 90 €…). Lähtekoodis **8 sisseehitatud veateadet** „JavaScript files … didn't fully load". Väljundnupp „Email Quote" (ingliskeelne eestikeelsel lehel).
- **Tõendid:** 6 projekti, **0 mõõdetud tulemust, 0 klienditsitaati**. Ainus tsitaat on iseendale.
- **Usaldus:** reg-nr 12050902, aadress, telefon. `/meist/` annab **404**. KMKR, arvustused, logod, sertifikaadid puuduvad.
- **Tehniline:** HTML 750–916 KB, 17 skripti + 13 stiililehte. Statistikaloendurid ilma JS-ita „00"/„000". Blogis 3,5-aastane auk.
- **Ülekantav:** tõsta fikseeritud lisahinnad katkisest vidinast staatilisele lehele tabelina.

## A7 · Webabi — webabi.ee

- **H1:** „Kodulehed, SEO, digiturundus, mis toovad päringuid". Alapealkiri: „Rohkem päringuid, vähem peavalu."
- **Hind:** koduleht al. 590 € · SEO al. 390 € · digiturundus al. 290 €. Artiklis vahemik 300–5000 € **koos sisulise põhjendusega** (300–600 € = „flaier" vs 1500+ € strateegiaga).
- **Tõendid:** 3 case't ainult initsiaalidega (MK, SZ, PA). Mõõdetud: +260 % liiklus, −86 % konversioonihind. Tsitaate ei ole. Avalehel **„0+ projekti", „0 riiki"** — täitmata platsihoidjad.
- **Sihtrühm:** ainus, kes kõnetab väikeettevõtjat otse — asutaja Dmitri Lefanov: „Väike tiim liigub kiiresti, teeb otsused ruttu ja võtab iga projekti isiklikult."
- **Vorm:** 5 välja + eelarvevalik. Lubab 1–2 tööpäeva + tasuta 15–30 min konsultatsiooni.
- **Usaldus:** reg-nr 16467705, telefon. KMKR, aadress, näod, arvustused puuduvad; „keskmine hinnang 5.0" ilma allikata. Kuupäev inglise formaadis („May 21, 2025"), nupp „Submit" eestikeelsel lehel.
- **Ülekantav:** „mida sa saad 400 € vs 4000 € eest" sisuline põhjendamine.

## A8 · Trinidad Wiseman — twn.ee

- **H1:** „Loome inimkeskseid digiteenuseid". Alapealkiri: „Kas sinu veeb on ligipääsetav nii inimestele kui ka tehisintellektile?"
- **Hind:** puudub täielikult.
- **Tõendid:** 10+ case't, filtreeritav 8 teenuse ja 11 valdkonna järgi. Case'id on **kuupäevastatud, autoritega blogipostitused** (~2300–2500 sõna, 5 kuvatõmmist): väljakutse → kontekst → protsess ajajärkudes → mahunumbrid (145 000+ domeeni, ~300 000 e-posti kontot) → tulemus. Klienditsitaate terve saidi peale **üks**.
- **Usaldus:** kontaktilehel **30+ spetsialisti nimeliselt, fotoga, telefoni ja e-mailiga**. Avalehel 20+ aastat, 140+ spetsialisti, 1500+ projekti, 23,8 M € käive (2025). „Trusted by": ERGO, TEHIK, Elisa, Alexela, RIA, SEB, Telia, EEA.
- **Vorm:** lubab vastust **„within 3 working days"**.
- **Nõrkus:** tsitaate ja enne/pärast mõõdikuid praktiliselt ei ole; usaldus toetub brändinimedele.
- **Ülekantav:** üks põhjalik kuupäevastatud autoriga case „väljakutse → protsess → konkreetne number" — ei vaja meeskonda ega eelarvet, ainult distsipliini kirjutada numbrid, mitte omadussõnad.

## A9 · Velvet — velvet.ee

- **H1:** „Hello, we are Velvet, a design agency operating at the intersection of complex systems and human empathy."
- **Hind:** puudub.
- **Tõendid:** ~20 projekti nähtaval, filtreeritav (Graphic 101, Digital 67, Environmental 54, Strategic 42, Live Events 12). Case'i struktuur: metaandmed → intro → probleem → väljakutse → lahendus → Outcome → meeskond → partnerid → auhinnad. RYTM case'is **üks number** („#1 Finance App in Estonia within first week"), 6 pilti, tsitaati ei ole.
- **Kontakt:** **vormi ei ole** — info@velvet.ee, telefon, nimeline kontakt (Pärtel Vurma), kaks kontorit.
- **Toon:** „Design is far too important to be left to a bunch of designers" · „We fuck up. Often." — usaldus haavatavuse, mitte lubaduste kaudu.
- **Nõrkus:** üks number ilma kontekstita; `/insights` annab 404.
- **Ülekantav:** **struktuur, mitte maht** — iga case rangelt Probleem → Lahendus → Tulemus koos ühe konkreetse arvuga.

## A10 · Brand Manual — thebrandmanual.com

*(brandmanual.ee ei laadinud; brandmanual.com on parkimisleht.)*

- **H1-elementi ei ole** — hero on lõik: „Brand Manual is a service design and branding consultancy…"
- **Hind:** puudub.
- **Tõendid:** 19 case't, igaüks 2–4 lauset + „Read More". Mõõdetud tulemusi ei ole; tsitaadid **anonüümsed**. Erand: Elron „nominated as the best service design project of 2024".
- **Kontakt:** **vormi ei ole, 0 klõpsu** — e-post ja telefon otse avalehel + kolme partneri otsekontaktid. „Don't know what you need? Drop us a line and let's have a chat."
- **Usaldus:** kolm partnerit (Margus Klaar, Kaarel Mikkin, Kaili Kallas) fotode, pikkade CV-de, otsemeilide ja telefonidega. ~15 kliendilogo. Blogis 9+ artiklit, nimelise autoriga, viimane 09.10.2025.
- **Nõrkus:** „mõtleja" positsioon on lubadus, mitte tõend — nimelist metoodikat ei ole avaldatud.
- **Ülekantav:** **otsekontakt ilma vormita** — nimi, e-post, telefon otse lehel. Üksikstuudio saab 1:1 üle võtta: null infrastruktuuri, vähem klõpse, isiklikum.

---

## Lisa B — leisson.eu hetkeseis (mõõdetud 2026-09-21)

- Kataloog `service-catalog.json` v2026-09-16.1, RATE 50, **15 aktiivset pakkumist**, neist 3 `primary` fikseeritud hinnaga (290 / 590 / 1190 €) ja 6 `from … kokkuleppel`.
- `seller`: LEISSON OÜ, reg 16952932, `vatRegistered: false`, `priceBasis: final`, kontrollitud 2026-09-15 ariregister.rik.ee vastu.
- Hero: eyebrow „Kodulehed · veebiparandused · Tallinn", kaks nuppu („Vaata pakette" `btn-fill` + kontakt `btn-ghost`), hinnaankur `dim`-klassiga väiketekstina.
- Kontaktivorm: 5 välja (nimi*, e-post*, ettevõte, teenuse valik, praegune veebiaadress, sõnum*), honeypot, `initialService` prop olemas, GA4 `service_selected` ja `inquiry_accepted` juba sees. Vastuse lubadus on ainult lehe sissejuhatuses, mitte nupu juures.
- Jalus: reg-nr ja e-post. **Telefoni, aadressi, nägu ega nime ei ole.**
- Sisu: 8 lehte + 8 case study't (kõik stuudio **enda tooted**) + 3 insights-artiklit. Teenusecase'i ei ole.
- GEO-kiht olemas: .md paralleelvaated, robots 20 botti nimeliselt, JSON-LD Organization+ProfessionalService, küsimusekujulised H2-d, nähtav „Uuendatud".
