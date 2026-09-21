# Registriprofiili puhastus – mõõdetud seis ja tehtud otsused

**Kuupäev:** 21.09.2026 · **Voor 5 / Task 16 (O1)** · LEISSON OÜ, registrikood 16952932

Kõik allpool on 21.09.2026 loetud avalikelt lehtedelt. Ükski rida ei ole tuletatud.

---

## 1. Mida avalik register tegelikult näitab

Allikas: <https://ariregister.rik.ee/est/company/16952932/LEISSON-OÜ> (loetud 21.09.2026)

| Väli | Väärtus |
|---|---|
| Staatus | **Registrisse kantud** |
| Registreeritud | 27.03.2024 |
| Osakapital | 2 400 € |
| Maksuvõlg | **puudub** (seisuga 20.09.2026) |
| Majandusaasta aruanne 2024 | esitatud 05.10.2025, staatus **Kehtiv** |
| Majandusaasta aruanne 2025 | esitatud 28.08.2026, staatus **Kehtiv** |
| Käibemaks | ei ole käibemaksukohustuslane |
| Põhitegevusala | Programmeerimine, EMTAK 62101 – **ainus tegevusala** |
| WWW | leisson.eu **ja** axondeck.com |

Avaandmetest (RIK CSV, `crm/data/registry/`, sünkroonitud 20.09.2026):
käive 2024 = 0, käive 2025 = 0, töötajaid = 0, KMKR = puudub.

---

## 2. Kolm plaanieeldust, mis mõõtmisel ei pidanud

### „Passiivne ettevõte alates 2025" tuleb registris ära parandada

**Ei ole registri väli.** Register ütleb „Registrisse kantud". Silt on
inforegister.ee **tuletis**, mille kõrval seisab samal lehel põhjus:
„No tax and business transactions in 2026" ja „No labour taxes paid".
Allikas: <https://www.inforegister.ee/en/16952932-LEISSON-OU/> (21.09.2026)

Seda silti ei saa avaldusega maha võtta, sest seda ei hoia keegi käsitsi.
Ta kaob siis, kui EMTA kvartaliandmetes tekib tööjõumaks või deklareeritud käive
– see on raamatupidamise ja tasustamise otsus, mitte registriparandus.
**Ainus aus järeldus: O1 ei saa seda lahendada. Ära kuluta sellele tunde.**

### 2024. aasta aruandes on vaja neli kirjaviga parandada

Aruanne on **juba kinnitatud ja kehtiv**. Registrikaardilt on näha, kuidas
asendamine päriselt toimub: 25.09.2025 versioon on staatuses **Aegunud**,
05.10.2025 oma **Kehtiv**. Ehk kinnitatud aruannet ei redigeerita – esitatakse
uus, mis vana asendab.

Kas registripidaja võtab paranduseks esitatud aruande vastu siis, kui sisuline
number ei muutu ja parandus on ainult keeleline, **ei ole avalikust abiinfost
kontrollitav**. See on küsimus raamatupidajale või RIK-i kasutajatoele, mitte
asi, mille ma siin ära otsustan.

### Kirjavead on kõige nähtavam probleem

Ei ole. Kirjavead on PDF-i sees, mille avab see, kes on juba otsustanud sind
kontrollida. Nähtav on hoopis see, mis on lehel ilma ühegi klikita: tegevusala
„Programmeerimine", kaks eri veebiaadressi ja tühi töötajate rida.

---

## 3. Mis on päriselt parandatav – kolm tööd

### T1. Teine veebiaadress registrikaardilt maha – 15 min, 0 €

Registrikaardil on `leisson.eu` ja `axondeck.com` kõrvuti, ilma hierarhiata.
Iga masin, mis seda kaarti loeb (inforegister, storybook, taust.ee, AI-roomajad),
saab ühe juriidilise isiku kohta kaks eri brändi ja ei tea, kumb on ettevõte.
Entiteet lahjeneb täpselt seal, kus ta peaks olema kõige teravam.

**Tee:** ettevõtjaportaali töölaud → kontaktandmete muutmine. Digiallkiri,
notarit ei ole, riigilõivu ei ole, kui aadress ise ei muutu.
Allikas: <https://abiinfo.rik.ee/en/applications-and-dashboard/changing-data-legal-person/changing-address-and-contact-details> (21.09.2026)

**Otsus vajalik (vt §5).**

### T2. Teine tegevusala juurde – järgmise aruande juures, 0 €

Täna on ainus EMTAK 62101 „Programmeerimine". Ostja, kes otsib veebiagentuuri
või disaineri, ei leia sind selle koodi alt, ja disainikeskuse andmebaasis
(vt `voor5-pakett-2026-09.md`) on samasugused stuudiod märgitud disaini- ja
veebidisainikoodidega.

Tegevusalad deklareeritakse majandusaasta aruandes, seega see muutus **jõustub
alles järgmise aruandega** – kiiret teed ei ole.

Suund: arvutialane nõustamine, disain või reklaam. **Täpset EMTAK-koodi ma
siin ei kirjuta** – klassifikaator muutub ja vale kood on halvem kui puuduv.
Vali see aruande esitamise hetkel klassifikaatorist. Maksimaalselt üks lisaks:
kolm koodi teeb sinust „kõike natuke".

### T3. Tegevusaruande tekst – OOTEL, sisend puudub

Neljast kirjaveast ei ole mul teksti. Kinnitatud aruande PDF ei ole
ilma sisselogimiseta loetav ja masinas koopiat ei ole (otsitud
`C:\Users\gert\Desktop\LEISSON.CREATIVE`, 21.09.2026).

**Vajan:** tegevusaruande tekst (PDF või copy-paste). Siis käib see läbi
`anthropic-skills:eesti-keele-toimetaja` ja tagasi tuleb parandatud tekst koos
loeteluga, mis muutus. **Enne teksti ei ole siin midagi teha.**

---

## 4. Käibemaks – otsus ei muutu

**LEISSON OÜ ei registreeru käibemaksukohustuslaseks.** Põhjendus on
benchmarki disainidokumendi §5-s, kontroll `project_toetuste_vaited`-s.

Register kinnitab hetkeseisu: „Juriidiline isik ei ole käibemaksukohustuslane".
Kataloogis (`packages/service-catalog/catalog.json`) on `vatRegistered: false` ja
`priceBasis: "final"`, mistõttu `vatNote()` ütleb saidil „lõpphinnad, käibemaksu
ei lisandu". See on hetkel **tõsi ja kontrollitud** (`verifiedAt: 2026-09-15`).

**Värav, mida ei tohi mööda minna:** kui käive ületab kunagi kohustusliku
registreerimise piirmäära, muutub see lause saidil valeks samal päeval.
Enne mis tahes hinna-copy puudutamist kontrolli kehtiv määr ja piirmäär EMTA
lehelt ja uuenda `catalog.json` `seller`-plokki – mitte teksti.

---

## 5. Sinu otsus: axondeck.com registrikaardil

**Valik A – võta maha, jäta ainult leisson.eu.**
Registrikaart ütleb ühe asja: LEISSON OÜ = leisson.eu. Iga automaatne kataloog,
mis kaardi üle võtab, kordab sama. AxonDeck jääb elama oma domeenil ja saab
hiljem vajadusel oma kirje.

**Valik B – jäta mõlemad.**
Kaart ütleb, et sul on kaks asja. Masin, mis peab valima, valib esimese
või mõlemad – ja „Leisson Creative" kui entiteet jääb nõrgemaks.

**Soovitan A.** Põhjus on kitsalt selle voo oma: Voor 5 kogu mõte on, et üks
nimi, üks domeen ja üks kirjeldus korduks kõigis välistes allikates identselt
(äriregister → inforegister → Wikidata → LinkedIn → kataloogid). Kaks domeeni
registrikaardil lõhub selle ahela kohe esimeses lülis. Kiirus: 15 minutit.
Puhtus: üks entiteet, üks tõeallikas. Skaleeritavus: kui AxonDeck kasvab omaette
ettevõtteks, on tal niikuinii vaja oma registrikirjet, mitte rida kellegi teise
kaardil.

---

## 6. Mis jäi teadlikult tegemata

| Asi | Miks |
|---|---|
| „Passiivne" sildi eemaldamine | ei ole kellegi käes – vt §2 |
| Kirjavigade parandamine | ootab teksti – T3 |
| KMKR registreerimine | teadlik otsus, §4 |
| Aruande näitajate „parandamine" | 0 on 0; seda ei kirjutata ümber |
