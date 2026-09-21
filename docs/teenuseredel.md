# Teenuseredel — miks üks hind korraga

Allikas: `lib/hinnakiri.mjs`. Värav: `test/gate-hinnakiri.mjs`.
Hinda ei kirjutata kunagi teise faili — agent loeb selle `get_pricing`
ja `next_step_offer` kaudu.

## Mida mõõtmine näitas (14.09.2026)

42 külmkirja → **9 vastust (21%)**. Kolm neist olid päris inimese vastused,
ülejäänud automaatvastused. Kõik kolm ütlesid sisuliselt sama:

| Ettevõte | Vastus |
|---|---|
| AS Papiniidu Prisma (Kaubamajakas) | „Täname pakkumise eest, aga hetkel ei soovi teenust." |
| Pärnu Muuseum | „Tänan ühendust võtmast, pakkumist hetkel vastu ei võta." |
| AS Nurme Turvas | „see ei ole AS Nurme Turvas eesmärk" |

Toru: 3 pakkumist, 1 arve, **0 kohtumist, 0 võidetud**.

Järeldus: kirjad töötavad — 21% vastust on külmkirjade kohta erakordselt hea tulemus.
Kinni jääb **vastus → pakkumine** samm. Põhjus ei ole hind, vaid **esimese sammu suurus**:
võõras inimene palub kohe 990–1900 € ja kohtumist. „Hetkel" ei tähenda „liiga kallis",
vaid „mitte sinult, keda ma ei tunne".

## Redel

| Aste | Teenus | Hind | Kohtumine | Miks see aste olemas on |
|---|---|---|---|---|
| 0 | Nähtavuskaart | 0 € | ei | Ainus asi, mille kohta „ei" öelda ei ole |
| 1 | Masinloetav leht | 290 € | ei | Alla juhi otsustuspiiri — ei vaja kinnitusringi |
| 2 | AI-nähtavuse audit | 990 € | jah | Esimene ost, mis vajab eelarveotsust |
| 2 | UX + ligipääsetavus | 1450 € | jah | |
| 2 | Next.js kiirussprint | 1900 € | jah | |
| 3 | Tokenite migratsioon, disainisüsteem | 2900 € / 6000 € | jah | |

`next_step_offer` tagastab **täpselt ühe** teenuse. `docs/protsess.md`: kaks hinda
muudab küsimuse „kumb?" asemel „kas üldse?".

## Aste 0 — Nähtavuskaart, 0 €

Üks A4 PDF: neli mõõdetud kohta, iga number argipäevakeeles lahti kirjutatud,
mõõtmisviis ja kuupäev juures. **Ei sisalda hinda ega kohtumiskutset.**

Miks see ei maksa Gertile midagi: mõõtmine tehakse niikuinii **enne** iga külmkirja
(`leisson-prospect-audit`). Kaart on selle olemasoleva mõõtmise väljatrükk, mitte uus töö.
Seepärast on see tasuta ilma, et tasuta töö tavaline lõks — kulu ilma tuluta — tekiks.

Roll müügis: muudab viisaka „ei" dokumendiks, millel on Gerti nimi peal. Aste 1 küsitakse
alles siis, kui kaart on käes.

## Aste 1 — Masinloetav leht, 290 €

Viis signaali, enne ja pärast sama skriptiga mõõdetud:

1. otsingukirjeldus (meta description)
2. jagamismärgendid (Open Graph) — et link kannaks LinkedInis pealkirja, kirjeldust ja pilti
3. ettevõtte struktuurandmed (JSON-LD Organization / LocalBusiness)
4. keeleviited (hreflang), kui lehel on rohkem kui üks keel
5. pealkirja ja H1 pikkus, et Google neid ei lõikaks

**Ei sisalda:** sisu kirjutamist, kujunduse muutmist, kiiruse optimeerimist ega
lubadust otsingupositsiooni kohta. Viimane on `docs/protsess.md` reegel: lubatud
tulemust pakkumisse ei panda.

### Miks 290 €

- ~6 h tööd 50 €/h juures.
- Alla enamiku keskastmejuhtide otsustuspiiri — ostja ei pea kellegi käest luba küsima.
  Just see kinnitusring tappis kõik kolm senist vastust.
- 3,4× odavam kui 990 € audit, seega ei söö seda ära: audit on **diagnoos kõige kohta**,
  see on **teostus ühe teadaoleva asja kohta**.

### Kui suur see turg juba täna on

Mõõtsin 14.09.2026 kõik 80 torus olevat lehte (`data/mootmised-masinloetav.json`):

| Puudub | Ettevõtet | Osa |
|---|---|---|
| ettevõtte struktuurandmed | 47 | 59% |
| keeleviited (hreflang) | 34 | 43% |
| otsingukirjeldus | 25 | 31% |
| jagamismärgendid (Open Graph) | 15 | 19% |
| pealkiri üle 60 või alla 15 tm | 26 | 33% |

**22 ettevõttel viiest kolm või enam puudu** — neile on see teenus põhjendatud
ilma ühegi uue mõõtmiseta. 22 × 290 € = 6 380 € juba olemasolevast torust.
12 ettevõttel on kõik viis korras — neile seda ei pakuta.

## Käibemaks

LEISSON OÜ **ei ole käibemaksukohustuslane**. Hinnakirja number on ühtlasi arve
lõppsumma. Seda ei nimetata „0% käibemaksuks" — maksuõiguses tähendab see muud.
Sama seisu hoiavad `docs/arve.md` ja `lib/hinnakiri.mjs`; värav kontrollib, et need
ei lähe lahku.
