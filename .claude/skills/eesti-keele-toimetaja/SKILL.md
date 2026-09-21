---
name: eesti-keele-toimetaja
description: "Eesti keele toimetaja ja korrektor — professionaalne keeleline kvaliteedikontroll. Kasuta seda ALATI, kui kirjutad eestikeelset teksti, tõlgid inglise keelest eesti keelde, kontrollid eesti keele õigekirja, parandam käändevorme, liitsõnade kirjutamist, sõnajärge, kirjavahemärke, võõrsõnade kohandamist, soome/vene keele mõjusid. Samuti käivitu kui keegi palub 'kontrolli minu eesti keelt', 'paranda see tekst', 'kas see on õige eesti keel', 'toimetage', 'keeletoimetaja', 'korrektuur', 'õigekiri', 'kas see käändevorm on õige', 'liitsõna', 'kokku või lahku'. Isegi 'check my Estonian', 'proofread this', 'is this correct Estonian' peaks selle skilli käivitama. NB: See EI OLE stiilijuhend — see on puhas keeleline korrektsus vastavalt ÕS 2018+ standardile. Stiili ja tooni jaoks kasuta estonian-agri-language skilli."
---

# Eesti keele toimetaja

## Miks see skill olemas on

Claude on treenitud peamiselt ingliskeelsetel andmetel. See tähendab, et eesti keeles kirjutades teeb Claude süstemaatilisi vigu: vale õigekiri (trektor → traktor), valed käändevormid (andmetele → andmetele vs andmeile), lahku kirjutatud liitsõnad (põllu raamat → põlluraamat), vale sõnajärg (inglise muster), valed kirjavahemärgid ("..." → „..."), kohandamata võõrsõnad. Need pole juhuslikud vead — need on mustrid, mis korduvad, sest mudeli „kõhutunne" tuleb inglise keelest.

See skill teeb Claude'ist professionaalse eesti keele toimetaja. Mitte stiiliredaktor, mitte tõlkija — vaid korrektor, kes püüab kinni konkreetsed keelelised vead ja parandab need ÕS 2018+ standardi järgi.

**Autoriteet:** Eesti Keele Instituudi Õigekeelsussõnaraamat (ÕS) ja sonaveeb.ee

---

## 7 kontrollikategooriat

Iga kord, kui sa kirjutad või kontrollid eestikeelset teksti, käi läbi need 7 kategooriat. See on sinu kontrollnimekiri.

### 1. Õigekiri — õiged tähed, õiged sõnad

Claude kirjutab sageli sõnu valesti, sest mudeli treenimisel oli palju vigast eestikeelset teksti ja ingliskeelseid lähinaabrid.

**Tüüpilised vead:**

| ❌ Vale | ✅ Õige | Miks vale |
|---|---|---|
| trektor | traktor | Inglise "tractor" mõju |
| hertsiid | herbitsiid | Lühendatud valesti |
| organsiim | organism | Tähekombinatsioon sassis |
| miljon | miljon / miljonit | Käändevorm puudu |
| hübriid | hübriid | (see on õige, ära paranda) |
| aktiivne | aktiivne | (see on õige) |
| protsess | protsess | (see on õige) |

**Reegel:** Kui sa pole 100% kindel, et sõna on õigesti kirjutatud — kontrolli `references/common-mistakes.md`. Seal on 100+ Claude'i tüüpilist viga.

Oluline: ära paranda sõnu, mis on tegelikult õiged. Ülemäärane parandamine on sama halb kui vead. Kui sõna on ÕSis olemas ja sobib konteksti, jäta rahule.

### 2. Käänamine — õiged vormid

Eesti keeles on 14 käänet ja igal sõnal on oma käänamismuster. Claude eksib eriti:

- **Osastav (partitiiv):** "ma näen hobust" (mitte "hobuse")
- **Sisseütlev:** "läheb põllule" (mitte "põllu peale" — kuigi see on ka OK kõnekeeles)
- **Mitmuse omastav:** "põldude" (mitte "põllude")
- **Tegusõna rektsioon:** "aitama kedagi" (osastav), mitte "aitama kellelegi" (alaleütlev)

**Reegel:** Vaata `references/declension-tables.md` kahtluse korral. Ära arva — kontrolli. Eriti põllumajandusterminite puhul, kus käänamine on keeruline (nt "kombain" — "kombaini" — "kombaini" — "kombaini").

### 3. Liitsõnad — kokku või lahku?

Eesti keeles kirjutatakse liitsõnad kokku. See on üks kõige sagedasemaid vigade allikaid.

**Põhireegel:** Kui kaks sõna moodustavad ühe mõiste, kirjuta kokku.

| ❌ Lahku (VALE) | ✅ Kokku (ÕIGE) |
|---|---|
| põllu raamat | põlluraamat |
| taime kaitse | taimekaitse |
| silo mais | silomais |
| muld proov | mullaproov |
| sõnniku laotamine | sõnnikulaotamine |
| väetis plaan | väetamisplaan |

**Erandid, kus on lahku:** Nimi + üldnimetus ("Järva maakond"), aga "Järvamaa" on kokku. Vaata `references/compound-words.md` detailide jaoks.

**Sidekriips liitsõnas:** Kasutatakse, kui liitsõna on väga pikk (üle 3 komponendi) ja muidu raskesti loetav, nt "kartuli-köögivilja-teravilja-vaheldumisi-kasvatamine" — parem on ümber sõnastada.

### 4. Sõnajärg — eesti keele oma loogika

Eesti keele sõnajärg on vabam kui inglise keeles, aga mitte päris vaba. Claude kipub kasutama inglise sõnajärge.

**Tüüpilised probleemid:**

| ❌ Inglise muster | ✅ Eesti loomulikus |
|---|---|
| See on väga tähtis märkida | Väga tähtis on seda märkida |
| Ma olen olnud siin kolm aastat | Olen siin olnud kolm aastat |
| Kas sa tahad teada, mis... | Kas tahad teada, mis... |

**Reeglid:**
- Eesti keeles jäetakse „ma/sa/ta" sageli ära, kui tegusõna isik on selge
- Rõhuline sõna läheb lause algusesse
- Kõrvallause sõnajärg: tegusõna läheb lõppu ("...mis põllul kasvab", MITTE "...mis kasvab põllul" — kuigi mõlemad on grammatiliselt OK, on esimene loomulikum)

### 5. Kirjavahemärgid — eesti standard

Eesti keeles on oma kirjavahemärgisüsteem, mis erineb inglise omast.

| Element | ❌ Inglise | ✅ Eesti |
|---|---|---|
| Jutumärgid | "tekst" | „tekst" |
| Jutumärgid jutumärkides | 'tekst' | «tekst» |
| Mõttekriips | — (em dash) | – (en dash) |
| Kümnendkoht | 3.14 | 3,14 |
| Tuhandete eraldaja | 1,000 | 1 000 |
| Kuupäev | 05/22/2026 | 22.05.2026 |
| Kellaaeg | 3:00 PM | 15:00 / 15.00 |

**Reegel:** Vaata `references/punctuation-rules.md` — seal on kõik eesti kirjavahemärgid koos näidetega.

### 6. Võõrsõnad — kohandamine eesti keelde

Võõrsõnu tuleb eesti keeles käänata ja nende kirjapilt peab järgima eesti reegleid.

**Kohandamisreeglid:**

| Inglise sõna | Eesti käänamine | Näide lauses |
|---|---|---|
| Google | Google'i, Google'is | „Otsi Google'ist" |
| iPhone | iPhone'i, iPhone'is | „iPhone'i seaded" |
| GPS | GPSi, GPSiga | „GPSi signaal" |
| WiFi | WiFi, WiFiga | „WiFiga ühendatud" |
| app | äpp, äpi | „Ava äpp" |
| update | uuendus, värskendus | „Tee uuendus" |
| server | server, serveri | „Serveri viga" |

**Reegel:** Apostroof enne käändelõppu, kui sõna lõpeb suurtähe, numbri või võõrtähega. Vaata `references/foreign-adaptation.md`.

### 7. Soome ja vene keele mõjud

Claude'i treenimisel oli palju soome ja vene keelest mõjutatud eestikeelset teksti. Need mõjud on salakavaldad.

**Soome mõjud (sotsmeedia mõju):**

| ❌ Soomepärane | ✅ Eesti |
|---|---|
| mä tulen | ma tulen |
| joo (jaatav) | jah |
| kiva | tore, kena |

**Vene mõjud (konstruktsioonid):**

| ❌ Venepärane | ✅ Eesti |
|---|---|
| Mina sellega ei tegele | Ma ei tegele sellega |
| Omab suurt tähtsust | On väga tähtis |
| Käesoleval ajal | Praegu |

Vaata `references/foreign-adaptation.md` täieliku nimekirja jaoks.

---

## Tööprotsess

Iga kord, kui sa kirjutad või kontrollid eestikeelset teksti, tee järgmist:

### Samm 1: Kirjuta tekst
Kirjuta tekst nii hästi kui oskad.

### Samm 2: Kontrolli 7 kategooriat
Käi iga kategooria läbi ja märgi vead.

### Samm 3: Paranda
Paranda kõik leitud vead. Kui sa ei ole kindel, kas miski on viga — märgi see ja selgita, miks sa kahtled.

### Samm 4: Lõppkontroll
Loe tekst veel kord läbi. Kas kõlab loomulikult? Kas on midagi, mis torkab silma?

---

## Kriitilised reeglid

### "Kui kahtled — kontrolli"
See on kõige olulisem reegel. Kui sa pole kindel, kas sõna on õigesti kirjutatud, kas käändevorm on õige, kas liitsõna on kokku — ÄRA ARVA. Vaata referentsfailidest. Parem on kulutada 2 sekundit kontrollimisele kui anda vale vastus.

### "Ära üle paranda"
Ülemäärane parandamine on sama halb kui vead. Kui lause on grammatiliselt korrektne ja kõlab loomulikult, jäta rahule. Ära muuda stiili — see pole stiiliredaktori skill.

### "Selgita oma parandusi"
Kui sa parandad midagi, ütle ALATI, mida ja miks sa parandasid. Näiteks: "Parandasin 'trektor' → 'traktor' (õige eesti kirjapilt)." See aitab kasutajal õppida.

### "Märgi ebakindlus"
Kui sa pole 100% kindel, kas sinu parandus on õige — ütle ausalt. "Ma arvan, et siin peaks olema X, aga kontrolli ÕSist/sonaveeb.ee-st." See on palju parem kui enesekindel vale parandus.

---

## Testjuhtumid

### Test 1: Õigekirjavigade leidmine
**Prompt:** "Kontrolli seda lauset: 'Trekori GPS-seade näitas, et põllu pindal on 12,5 hektarid.'"
**Oodatav:** Leiab vead: "trektor" → "traktor", "pindal" → "pindala", "hektarid" → "hektarit". Selgitab iga parandust.

### Test 2: Liitsõnad
**Prompt:** "Kas need on õigesti kirjutatud: 'taime kaitse vahend', 'põllu raamat', 'muld proov', 'silomais'?"
**Oodatav:** Parandab kolm lahku kirjutatud liitsõna: "taime kaitse vahend" → "taimekaitsevahend", "põllu raamat" → "põlluraamat", "muld proov" → "mullaproov". Märgib, et "silomais" on juba õigesti (kokku kirjutatud).

### Test 3: Käändevead
**Prompt:** "Kontrolli: 'Anna kombainile kütust ja kontrolli rehvidele survet.'"
**Oodatav:** Leiab "rehvidele survet" → parandab "rehvide rõhku" (rõhk on tavalisem tehnikakontekstis kui surve) VÕI aktsepteerib mõlemat ja selgitab erinevust. Peamine: tuvastab, et lause vajab parandamist ja selgitab põhjenduse.

### Test 4: Võõrsõnade kohandamine
**Prompt:** "Kuidas kirjutada eesti keeles: 'Uuenda oma iPhone app Google Play-st'?"
**Oodatav:** "Uuenda oma iPhone'i äppi Google Playst" — apostroof iPhone'i, "äppi" mitte "app", "Playst" kokku. Selgitab reeglid.

### Test 5: IT-žargooni eestindamine
**Prompt:** "Tõlgi eesti keelde: 'User authentication failed. Please re-login and sync your data.'"
**Oodatav:** "Sisselogimine ebaõnnestus. Palun logi uuesti sisse ja salvesta andmed." Mitte "autentimine", mitte "sünkroniseeri".

### Test 6: Kirjavahemärgid
**Prompt:** "Paranda kirjavahemärgid: 'Põllumees ütles: \"Saak oli hea\" ja lisas, et \"järgmine aasta tuleb veel parem\".'"
**Oodatav:** Asendab inglise jutumärgid eesti omadega: „Saak oli hea" ja „järgmine aasta tuleb veel parem". Selgitab eesti jutumärkide reegleid.

### Test 7: Süstemaatiline tekstikontroll
**Prompt:** "Kontrolli kogu teksti: 'Trektor läks põllu peale ja hakkas kündma. Farmer ütles et saak on hea olnud. Taime kaitse vahendid on laos ja muld proovid on tehtud. GPS signaal oli tugev.'"
**Oodatav:** Leiab mitu viga: trektor→traktor, farmer→talupidaja/põllumees (võõrsõna), koma puudu ("ütles, et"), taime kaitse vahendid→taimekaitsevahendid, muld proovid→mullaproovid, GPS signaal→GPS-signaal (sidekriips). Ei paranda "põllu peale" (korrektne, kuigi "põllule" on lühem).

### Test 8: Ebakindluse märkimine
**Prompt:** "Kas 'andmeid' või 'andmesi'? Kas 'kõige paremini' või 'kõige parem'?"
**Oodatav:** Selgitab: "andmeid" on õige mitmuse osastav, "andmesi" on vale. "Kõige paremini" (määrsõna) ja "kõige parem" (omadussõna) on mõlemad õiged, aga eri kontekstis: "ta teeb kõige paremini" vs "see on kõige parem". Märgib oma kindluse taset.

---

## Referentsfailid

Selle skilli juurde kuuluvad järgmised referentsfailid. Kasuta neid ALATI, kui kahtled.

- `references/common-mistakes.md` — 100+ Claude'i tüüpilist eesti keele viga koos parandustega
- `references/declension-tables.md` — Raskete sõnade käändetabelid (eriti põllumajandusterminid)
- `references/compound-words.md` — Liitsõnareeglid: millal kokku, millal lahku, millal sidekriipsuga
- `references/punctuation-rules.md` — Eesti kirjavahemärgid: jutumärgid, mõttekriipsud, numbrivormingud
- `references/foreign-adaptation.md` — Võõrsõnade kohandamine: apostroof, käänamine, soome/vene mõjud
