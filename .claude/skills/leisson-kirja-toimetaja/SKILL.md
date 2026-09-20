---
name: leisson-kirja-toimetaja
description: "Kirjuta ja toimeta Leissoni kliendikirju: mõõdetud number + argipäevane tagajärg + üks selge järgmine samm, seejärel kohustuslik /eesti-keele-toimetaja kontroll. Kasuta iga kirja jaoks, mis läheb kliendile."
---

# Leissoni kliendikiri

## Kellele ja kelle nimel

Gert Leisson, LEISSON OÜ (reg 16952932, Tallinn). Veebiarendus, disainisüsteemid, ligipääsetavus, jõudlus. Lugeja on enamasti **mittetehniline omanik või juht**, kellel on 40 sekundit.

## Kirja ehitus — viis osa, selles järjekorras

1. **Üks lause, mis ütleb miks ma kirjutan.** Nimeliselt nende asi, mitte minu tutvustus.
2. **Üks mõõdetud number.** Ainult üks. Mõõdetud, mitte hinnatud.
3. **Number argipäevakeeles.** Mida see number teeb inimesega, kes lehele tuleb.
4. **Aus piir.** Mida ma ei mõõtnud, ei tea või ei luba.
5. **Üks järgmine samm.** Konkreetne, väike, ajaliselt määratud.

Allkiri tuleb `crm/signature/leisson-signature.html`-ist. Ära kirjuta allkirja käsitsi.

## Numbri tõlkimise reegel

Tehniline number ilma tagajärjeta on müra. Iga number saab tõlke:

| Mõõdetu | Kuidas seda öelda |
|---|---|
| Lehe maht MB-des | "See on telefonis 10 Mbit/s ühendusega umbes N sekundit ootamist, enne kui midagi näha on." |
| CLS (paigutuse nihe) | "Nupp nihkub sõrme alt ära hetkel, mil inimene vajutab." |
| axe-core leid | "Klient, kes hiirt ei kasuta, jääb siin kinni ega saa vormi täita." |
| LCP | "Suurim pilt ilmub N sekundi pärast — enne seda on ekraan sisuliselt tühi." |
| Pikk skript (longtask) | "Leht on N sekundit klõpsamisele kurt, kuigi näeb valmis välja." |

Eeldus pannakse alati kirja ("10 Mbit/s mobiiliühendusel"). Number ilma eelduseta on lubadus, mida ei saa pidada.

## Keelatud

- **Hirmutamine.** Trahvid, seadusenumbrid, "te rikute seadust" — ainult siis, kui nõue tõesti kehtib (tarbijale suunatud broneeritav või ostetav teenus üle mikroettevõtte piiri, või avalik sektor). B2B-tutvustuslehel see nõue ei kehti ja seda ei mainita.
- **Väljamõeldud numbrid.** Kui ei mõõtnud, siis ei ütle. "Ilmselt", "tõenäoliselt umbes" ei päästa.
- **Sisutühjad fraasid:** "loodan, et leiate mu kirja hästi", "soovin tutvustada oma teenuseid", "oleme pikaajalise kogemusega", "win-win", "sünergia", "digitaalne transformatsioon", "vabandan häirimise pärast".
- **Kaks küsimust korraga.** Üks küsimus, üks vastus.
- **Manused esimeses kirjas.**
- **Emotikonid.**

## Pikkus

Esimene pöördumine: 120–180 sõna. Vastus päringule: nii lühike, kui küsimus lubab. Järelkiri: alla 80 sõna ja ta ei korda esimest kirja.

## Teemarida

Konkreetne ja kontrollitav, mitte turunduslik. Hea: "Teie broneerimisvormi kohta — üks mõõdetud koht". Halb: "Kasvatage oma müüki!".

## Kohustuslik viimane samm

Enne kui kiri läheb salvestamisele või inimese ette, **käivita `/eesti-keele-toimetaja`** kogu teksti peal — teemarida kaasa arvatud. See ei ole valikuline. Claude teeb eesti keeles süstemaatilisi vigu (liitsõnad lahku, inglise sõnajärg, valed jutumärgid) ja kliendikirjas on need kallid.

Kui toimetaja teeb parandusi, salvesta **parandatud** tekst ja pane muudatuste arv kirja töö tulemusse.

## Kui infot ei jätku

Ära kirjuta kirja, milles on tühi koht või kohatäide. Kui mõõdetud numbrit ei ole, siis öelda ausalt, et mõõtmist pole tehtud, ja pakkuda mõõtmist järgmise sammuna — see on parem kiri kui väljamõeldud number.