# Arve ja maksetingimused

Kontrollitud 13.09.2026. Vt ka käsiraamatut:
https://claude.ai/code/artifact/40018028-856b-43c8-903a-babab02c37bf

## Enne kui midagi muud

**LEISSON OÜ ei ole käibemaksukohustuslane** (äriregister, 13.09.2026).

- KMKR-numbri rida **ei ole** arvel.
- Käibemaksu rida **ei ole** arvel.
- Hinnale **ei lisandu** midagi. Hinnakirja number on lõppsumma.
- Registreerimiskohustus tekib, kui maksustatav käive ületab kalendriaastas 40 000 €.
  Käibemaksumäär on 24%.

> Saidi hinnaleht ütleb praegu „+ km" ja selgitab EL-i pöördmaksustamist.
> See tuleb parandada enne esimest arvet. EL-i ärikliendile arveldamine
> kontrolli raamatupidajaga — see ei ole koht, kus oletada.

## Arve väljad

Seaduse miinimum (raamatupidamise seadus § 7) on ainult kolm asja:
tehingu toimumise aeg, majandusliku sisu kirjeldus, arvnäitajad (kogus, hind, summa).
Ülejäänu on praktiline vajadus, et arve oleks vastuvõetav ja makstav.

| Väli | Näide |
|---|---|
| Dokumendi nimetus | `ARVE` |
| Number | `2026-014` — järjestikune, kordumatu, ilma auguta |
| Kuupäev | üleandmise päev |
| Maksetähtaeg | kuupäevana, mitte „14 päeva" |
| Müüja | LEISSON OÜ · 16952932 · Ülase tee 7, Püünsi küla, Viimsi vald 74013, Harjumaa |
| Müüja KMKR | **ei ole** — rida puudub |
| Ostja | nimi · registrikood · aadress |
| Teenuse kirjeldus | teenus + domeen + **viide pakkumise numbrile** |
| Kogus · hind | `1 tk × 1450,00 €` — tundide arvu arvele ei panda |
| Käibemaks | **rida puudub** |
| Tasumisele kuulub | üks summa; ettemaks eraldi real miinusega |
| Pangarekvisiidid | vt plokki allpool — saaja nimi peab kattuma konto omaniku nimega |
| Viitenumber | soovitatav — teeb laekumiste sidumise automaatseks |
| Allkiri | ei ole vaja |

### Arve päis ja jalus — kopeerimiseks

```
LEISSON OÜ
Registrikood 16952932
Ülase tee 7, Püünsi küla, Viimsi vald 74013, Harjumaa, Eesti
Tel +372 5880 1355 · leisson@leisson.eu

Saaja:  LEISSON OÜ
IBAN:   EE521010220302185228
Pank:   AS SEB Pank, Tornimäe 2, 15010 Tallinn, Eesti
SWIFT:  EEUHEE2X
Selgitus: arve number
```

> **Aadresside lahknevus.** E-äriregistri kaardil on 13.09.2026 seisuga Lume tn 7, Tallinn.
> Arvel kasutatakse ülalolevat Viimsi aadressi. Kui registrikaart on vananenud, tasub see
> äriregistris ära parandada — ostja raamatupidaja võrdleb neid aeg-ajalt.

### Allmärkus iga arve alla

```
LEISSON OÜ ei ole käibemaksukohustuslane, käibemaksu ei lisandu.
Maksetähtaja ületamisel kohaldub seadusjärgne viivis (VÕS § 113).
Arve aluseks on pakkumine nr .... ja selle kinnitus ...........
Makse selgitusse palun arve number.
```

## E-arve — etapi 08 värav

Alates 01.07.2025 võib **äriregistris e-arve saajaks registreeritud ostja nõuda e-arvet**
ja müüja peab selle esitama. Vorm: EN 16931 (või kokkuleppel EVS 923:2014).

1. Enne arve saatmist vaata äriregistrist ostja kaarti: „võtab vastu e-arveid"?
2. Kui jah — PDF kirja manuses **ei täida nõuet**. Vaja on e-arvet operaatori kaudu.
   Tasuta tee mikroettevõtjale: RIK-i **e-arveldaja**.
3. LEISSON OÜ ise **ei ole** täna e-arve saajaks registreeritud. Registreerimine on tasuta.

## Maksetingimused

- **Maksetähtaeg 14 päeva** — see on avaldatud tingimus, seega ta kehtib.
  Kui tähtajas ei ole kokku lepitud, annab VÕS § 82 ostjale **30 päeva**.
  Ettevõtjate vahel võib kokku leppida kuni 60 päeva.
  → **Ära jäta maksetähtaega kokku leppimata.**
- **Ettemaks 50%** uuelt kliendilt. 249 € toode 100% ette. Töö algab ettemaksu laekumisest.
- **Viivis on seadusjärgne** (VÕS § 113 = VÕS § 94 määr + 8% aastas).
  Eesti Panga määr **2,40%** alates 01.07.2026 → viivis **10,40% aastas**.
  Arvele kirjuta „seadusjärgne viivis", mitte number — määr muutub iga poolaasta.
- **Sissenõudmiskulude hüvitis 40 €** (VÕS § 113¹), ilma tõendamata.
  1450 € arvelt on viivis 0,41 €/päevas — 40 € on tegelik hoob, mitte viivis.

## Võlgnevuse redel

| Aeg | Tegevus |
|---|---|
| tähtpäev + 1 tööpäev | „kas arve jõudis õigesse kohta?" — enamik hilinemisi lõpeb siin |
| + 7 päeva | meeldetuletus, arve koopia, viivise lause; kiri ka juhatuse liikmele |
| + 14 päeva | töö peatub, kordusmõõtmist ei tehta; viivise arvestus + 40 € |
| + 30 päeva | **maksekäsu kiirmenetlus** e-toimikus |

Maksekäsu kiirmenetlus: nõuetele kuni **8000 €** koos kõrvalnõuetega — kõik paketid mahuvad.
Riigilõiv 3% nõudelt, vähemalt 65 €. Kohus lahendab 10 tööpäeva jooksul.
Digiallkirjastatud avaldus, advokaati ei ole vaja.

**Mida ei tee:** ei võta juba üle antud aruannet tagasi ega kustuta tehtud tööd.
See ei ole õiguslik survevahend ja lõhub soovituse.
