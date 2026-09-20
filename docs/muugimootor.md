# Müügimootor — mis on automaatne ja mis mitte

Seis 14.09.2026. Kõik numbrid siin on mõõdetud, mitte hinnatud.

## Mida mõõtmine näitas

| | Leisson | Turu keskmine | Tipptegijad |
|---|---|---|---|
| Vastuseprotsent | **21%** (9 / 42) | 3,43% | üle 10% |

Allikas: Instantly *Cold Email Benchmark Report 2026*. **Kirjad ei ole probleem —
need on turu keskmisest kuus korda paremad.** Kinni jäi mujal:

- 3 päris inimese vastust, kõik viisakad äraütlemised
- 3 pakkumist, 1 arve, **0 kohtumist, 0 võidetud**
- **0 järelkirja** — samas ütleb sama uuring, et 58% vastustest tuleb esimesest
  kirjast ja **42% järelkirjadest**. Ligi pool võimalikest vastustest jäi
  olemasolevast torust lihtsalt võtmata.

Kaks järeldust panid paika kaks parandust: **redel** (esimene samm oli liiga suur)
ja **järelkirjad** (teist sammu ei olnud üldse).

## Neli automaati

| Ülesanne | Millal | Piir | Mida teeb |
|---|---|---|---|
| `Leisson CRM saatja` | E–R 09–16, iga tund | 4 / jooks, 12 / päev | külmkirjad ette valmistatud sihtmärkidele |
| `Leisson CRM jarelkirjad` | E–R 10:30 | 6 / päev | järelkirjad neile, kes ei vastanud |
| `Leisson CRM loobumised` | iga päev 08:30 | — | loeb postkastist loobumised, summutab domeeni kaupa |
| `Leisson CRM konduktor` | E–R 07:50 | eelarve `.env`-ist | triaaž ja vastusemustandid |

Paigaldus ja eemaldus: `.\win\install-saatja.ps1` / `-Eemalda`.

## Järelkirjad — kaks puudet, ei rohkem

```
külmkiri  ──3 tööpäeva──▶  järelkiri 1 „kaart"     ──9 tööpäeva──▶  järelkiri 2 „viimane"
                           kaks mõõdetud kohta                      üks uus fakt + lõpp
                           + pakub tasuta A4                        ja siis vaikus
```

Vordlusandmed soovitavad 4–7 puudet. **Meie teeme kaks.** Põhjus: see arv tuleb
masspostitajatelt, kelle kiri on mall. Leissoni kiri on iga sihtmärgi kohta eraldi
mõõdetud ja bränd on „mõõdetud number, mitte müügijutt". Neljas meeldetuletus ilma
uue faktita on müra ja ESS-i mõttes tulisem kui esimene kiri. Kaks puudet võtavad
ära suurema osa sellest 42%-st — üksainus järelkiri annab niikuinii kõige suurema
hüppe — ilma et kirjast saaks jälitamine.

### Raudne reegel: iga järelkiri kannab uut mõõdetud fakti

„Tõusen kirja peale üles" ei ole järelkiri, vaid müra. `lib/jarelgate.mjs` →
`uusFakt()` võrdleb uue kirja mõõdetud signaali (`JSON-LD Organization: puudub`)
kõigi varem öeldutega. Kordus jääb värava taha ja kirja ei saadeta.

**Mille peale see esimesel katsel komistas:** esimene versioon otsis „ridu, kus on
number". Kolmas leid — *ettevõtte andmeid ei ole masinloetaval kujul* — ei kanna
ühtegi numbrit, aga on täiesti uus fakt. Number ei ole uudsuse tunnus; mõõdetud
signaal on. Värav `test/gate-jarelkiri.mjs` hoiab seda nüüd lukus.

### Mida järelkiri EI tee

- ei küsi kohtumist (ütleb otse välja, et ei küsi)
- ei nimeta hinda — ta juba korra ei vastanud, hind teeb kirjast müügikirja
- ei anna kõiki leide ära — kaks tõendiks, ülejäänud on põhjus vastata
- ei kasuta manust ega linki (mõlemad lõhuvad kohaletoimetavust külmkirjas)
- ei arva eesnime rollipostkastist: `katre@` → „Tere Katre", `info@` → „Tere".
  Vale nimi kirja alguses on hullem kui nimeta.

## Redel — üks hind korraga

| Aste | Teenus | Hind | Kohtumine |
|---|---|---|---|
| 0 | Nähtavuskaart | 0 € | ei |
| 1 | Masinloetav leht | 290 € | ei |
| 2 | AI-nähtavuse audit / UX + ligipääsetavus / kiirussprint | 990–1900 € | jah |
| 3 | Tokenid / disainisüsteem | 2900–6000 € | jah |

Vt `docs/teenuseredel.md`. Allikas `lib/hinnakiri.mjs`, värav `test/gate-hinnakiri.mjs`.

## Nähtavuskaart — aste 0

Üks A4: neli mõõdetud kohta, iga number argipäevakeeles, mõõtmisviis ja kuupäev
juures, **hinda ega kohtumiskutset ei ole**.

```powershell
node win\kaart.mjs                  # kellele saab kaardi teha
node win\kaart.mjs as-nurme-turvas  # üks kaart -> data\kaardid\<id>.html
node win\kaart.mjs --koik           # kõik, kellel 3+ puudu
```

CRM-ist: `http://127.0.0.1:4310/doc?kind=kaart&id=<id>` → „Prindi / PDF".

Miks see Gertile midagi ei maksa: mõõtmine tehakse niikuinii **enne** iga külmkirja.
Kaart on selle olemasoleva mõõtmise väljatrükk, mitte uus töö. Nii ei teki tasuta
töö tavalist lõksu — kulu ilma tuluta.

## Mõõtmine on kogu masina vundament

```powershell
node win\moot-masinloetav.mjs          # mõõdab mõõtmata lehed
node win\moot-masinloetav.mjs --koik   # mõõdab kõik uuesti
```

Tulemus: `data\mootmised-masinloetav.json`. **Sellest failist sõltuvad nähtavuskaart,
järelkirjad ja sihtmärkide nimekiri.** Kui fail on vana või puudu, ütleb järelkirjade
värav „mõõtmist ei ole — uut fakti ei ole öelda" ja ei saada midagi. See on tahtlik:
parem saatmata kiri kui kiri ilma faktita.

Värskenda mõõtmist, kui torru on lisatud uusi ettevõtteid või kui viimasest
mõõtmisest on üle kuu.

## Kontroll ilma saatmiseta

```powershell
npm run saatja:seis        # külmkirjad: kes järjekorras, kes välja jääb ja miks
npm run jarelkiri:seis     # järelkirjad: sama
npm run jarelkiri:kuiv     # näitab täpse teksti, mis välja läheks
node win\saatmislugu.mjs   # kogu saatmislugu koos vahedega
```

## Mis EI ole automaatne — ja see on tahtlik

- **Ükski kiri ei lähe välja agendi otsusest.** Agendil ei ole ühtegi
  saatmistööriista, üheski režiimis. Nii külmkirja kui järelkirja saadab
  serveripoolne skript läbi `/api/send` — sama tee, mida inimese klikk.
- **Vastused sissetulevatele kirjadele** on alati mustandid. Konduktor kirjutab,
  Gert klikib.
- **Pakkumine ja arve** tehakse käsitsi. Raha ei liigu automaatselt.
