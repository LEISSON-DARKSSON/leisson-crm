# Riigihanked CRM-is — avatud otsad

Seisuga 21.09.2026, haru `feat/crm-riigihanked`, ülesanne 15 (lõppkontroll).

See fail on ÜKS koht kõigele, mis jäi lahti. Iga rida ütleb kolm asja: **mis on lahti**,
**mis juhtub, kui seda ei tee** (see on tähtsaim veerg — lahtine ots, mille hind on
kirjutamata, ei saa kunagi prioriteeti) ja **kui suur töö on**. Ükski rida siin ei ole
oletus: nad on korjatud voorude lõppudest, commitide sõnumitest ja koodikommentaaridest
ning mõõdetud arvud on mõõdetud uuesti üle.

Töö suurus: **S** = kuni pool päeva · **M** = 1–2 päeva · **L** = üle kahe päeva või vajab
eraldi mõõtmisvooru.

---

## A. Dokumentide lugemine

### A1. Mustripõhine lugemine on tõestatud kolmel hankel

`lib/hanked-leiud.mjs` mustrid (nõutud rollid, käibenõue, kvaliteedikriteeriumi kaal) on
ehitatud kolme päris hanke dokumentide peale: 314159 (TAI „Aitab"), 315437 (TTJA) ja
312645 (Eesti Post). Muu maailm on katmata — iga hankija kirjutab vastavustingimusi oma
sõnadega.

- **Kui ei tee:** iga uus hankija toob uue sõnastuse, mida muster ei tunne. Tagajärg ei ole
  viga vaid VAIKUS: „ei tuvastatud". Vt A2.
- **Töö:** L — vajab 15–20 päris hanke dokumendikomplekti ja mustrivooru nende peal.
  Odavam variant: koguda dokumente jooksvalt (igast kaalutud hankest) ja teha mustrivoor
  siis, kui komplekte on 15.

### A2. Alalugemine on VAIKNE — „ei tuvastatud" näeb välja nagu „nõuet ei ole"

Paneel näitab „KÄIBENÕUE · ei tuvastatud" ka siis, kui käibenõue on dokumendis olemas, aga
sõnastus jäi mustrist välja. Ekraanil ei ole neid kahte juhtumit võimalik eristada.

- **Kui ei tee:** hange, mille käibenõudele me ei vasta, näib kvalifitseeruvana. See viga ei
  anna endast KUNAGI märku — ta tuleb välja alles siis, kui pakkumus tagasi lükatakse.
  Vastupidine viga (vale arv) annab vähemalt verdikti `ALLTÖÖVÕTT` ja jääb silma.
- **Võimalik parandus:** eristada „mustrid jooksid läbi, vastet ei olnud" ja „faili ei
  saanud tekstiks / dokumente ei ole" ning näidata paneelil, MITU dokumenti mustrit üldse
  nägi. Sama loogika võiks nõuda, et kui komplektis ei ole ühtki vastavustingimuste faili,
  öeldaks see välja.
- **Töö:** S paneeli poolel, M koos mustrite enesekontrolliga.

### A3. `--uuesti` kogub `docs-vana-*` kaustu

Kood **ei kustuta** kunagi midagi: `--uuesti` tõstab vana kausta kõrvale nimega
`riigihanked/<viitenumber>/docs-vana-<ajatempel>`. See on teadlik otsus (mounditud kaustas
annab `rm` EPERM-i, „puhastame ära" oleks kattetu lubadus), aga koristajat ei ole.

- **Kui ei tee:** ketas täitub tasa ja targu. Üks hanke dokumendikomplekt on suurusjärgus
  mõnikümmend MB; kümme hanget × kolm lugemist teeb ühe gigabaidi. Ohtlikku midagi ei
  juhtu, aga keegi ei tea, milline neist kaustadest on praegune.
- **Kui teed:** koristuskäsk on `crm/README.md` lõigus „Riigihanked".
- **Töö:** S — kas `npm run hanked:koristus` (loendab ja kustutab üle N päeva vanad) või
  jäta käsitsi ja ela sellega.

### A4. ESPD XML ja XLSX jäävad tekstita

`failiTekst` oskab `.pdf` (pdftotext), `.docx` (meie oma zip-lugeja), `.txt/.md/.csv`. Kõik
muu saab põhjuse „tekstiks ei saanud: toetamata failitüüp". Mõõdetud 314159 peal: 16 failist
15 sai tekstiks, tekstita jäi täpselt üks — `314159_ESPD_v2.0_laiendatud.xml`.

- **Kui ei tee:** ESPD-s on kvalifitseerimistingimused struktureeritud kujul — see on
  tegelikult PARIM allikas käibenõudele ja seda me ei loe. XLSX-is on sageli
  hindamiskriteeriumide tabel ehk kvaliteedikaal. Tagajärg on jällegi A2: vaikne „ei
  tuvastatud".
- **Töö:** ESPD XML on S–M (fikseeritud skeem, meil on juba XML-lugeja `lib/eforms.mjs`-is).
  XLSX on M (sharedStrings + sheet XML meie oma zip-lugeja peal; uut npm-sõltuvust ei tooda).

### A5. ZIP64 ei ole toetatud

`lib/zip.mjs` keeldub ZIP64-arhiivist nähtava veaga („RHR-i zip on muutunud, vaata üle") —
ta ei vaiki ega tee poolikut tööd. Piir on 65 535 kirjet või 4 GB.

- **Kui ei tee:** kui RHR hakkab kunagi ZIP64-d väljastama, kukub `hanked:dokumendid`
  **kõikidel** hangetel korraga, punase reaga. Vähe tõenäoline (hanke dokumendikomplekt on
  kümneid faile), aga kui juhtub, on ta täielik seisak.
- **Töö:** S–M, aga alles siis, kui ta päriselt juhtub. Praegune vali keeldumine on õige
  vahevastus.

### A6. PDF-ide lugemine sõltub masinas olevast `pdftotext`-ist

Väline binaar (poppler), mida `package.json` ei kontrolli.

- **Kui ei tee:** teisel masinal (või pärast PATH-i muutust) ei jõua ÜKSKI PDF tekstini.
  Jooks ütleb seda hoiatusena ja failid on loendis, seega vaikne see ei ole — aga rollid ja
  käibenõue jäävad tühjaks ja keegi võib seda lugeda kui „nõudeid ei ole".
- **Töö:** S — `npm run doctor` võiks `pdftotext -v` ära kontrollida.

---

## B. Ajalugu ja skoor

### B1. ~~Ajalootegur on ebastabiilne~~ — TEHTUD 21.09.2026, mõõdetud 24 kuu peal

**Mõõdetud tootmise peal (ainult lugemine):** `hanke_lepingud` 46 845 rida, 21 398 hanget,
aken 2024-09-21 … 2026-08-31, 24 kuud. Mediaanifiltri (`winner IS NOT NULL AND amount IS NOT
NULL`) läbib 38 532 rida; võitjata 6 230, summata 8 313.

**Läved koodist enne muutust** (`lib/hanked.mjs` `score()` plokk 6): `+5` kui
`medianTenders <= 3`, `−10` kui `>= 8`, vahemik auk, alus alla `SARNASED_MIN = 5` lepingu →
tegurit ei rakendata (nähtav nullrida).

#### Mis mõõtmine ütles

**1. Aknasõltuvus oli päris, aga ainult lühikeses aknas.** Nišisegmendi (`segment='nišš'`,
`segment_allikas='pealkiri'`) mediaanne pakkujate arv:

| Aken | Alus (lepingut) | Mediaan | Vana lävi | Uus lävi |
| --- | --- | --- | --- | --- |
| 3 kuud | 24 | **3,5** | auk → 0 | auk → 0 |
| 6 kuud | 39 | **2** | **+5** | auk → 0 |
| 12 kuud | 70 | **2** | **+5** | auk → 0 |
| 24 kuud | 132 | **2** | **+5** | auk → 0 |

Vana lävi andis 3 kuu peal ühe vastuse ja 6/12/24 kuu peal teise — sama hange, eri skoor,
olenevalt sellest, kui palju ajalugu parasjagu laetud oli. Uus lävi annab kõigi nelja akna
peal sama vastuse. See seos on väravas lukus.

**2. Tõeline viga oli mujal: vana lävi ei eraldanud midagi.** Eesti riigihangete turul on
pakkujaid vähe. Kõigi 32 987 lepingu peale on mediaan 2 (p25 = 1, p75 = 4, p90 = 7, max 131).
Meie niši CPV-koodid (72*, 79*, 48*, 92*), millel on vähemalt 5 lepingut — **88 koodi** —
jagunesid vana läve all nii:

| | vana lävi (≤3 / ≥8) | uus lävi (≤1 / ≥4) |
| --- | --- | --- |
| +5 | **73 koodi (83 %)** | 26 koodi (30 %) |
| auk | 14 (16 %) | 49 (56 %) |
| −10 | **1 kood (1,1 %)** | 13 koodi (15 %) |

Kõigi 825 piisava CPV-koodi peal oli sama pilt: +5 sai 592 (72 %), −10 sai 20 (2,4 %).
Reegel, mis ütleb 83 %-le „jah" ja 1 %-le „ei", on konstant, mitte reegel.

**3. Nišisegmendi jaotus ise ei ole ühetaoline** — mediaan 2 ei tähenda, et kõik on väikesed.
132 lepingut, neist 129-l on pakkujate arv: p25 = 1, p50 = 2, p75 = 5, p90 = 8, max **43**.
Kuni 3 pakkujat on 80 lepingul (62 %), 4…7 on 32-l (25 %), ≥8 on **17-l (13 %)**. Saba on
päriselt olemas — seetõttu on `−10` haru mõttekas hoida, ainult õigel kõrgusel.

**4. Kuus elavat hanget said vana läve all KÕIK sama +5.** Ühelgi neist ei ole CPV-d (RSS ei
anna seda), seega nad kõik käivad sama segmendimediaani (2 pakkujat / 132 lepingut) kaudu.
Tegur ei eristanud ühtegi hanget teisest — ta oli ühtlane nihe kogu radari peal.

#### Otsus (üks kalibreering)

Läved on nüüd **tuletatud mõõdetud jaotuse kvantiilidest, mitte valitud käest**:
`AJALUGU_PLUSS5_KUNI = 1` (88 koodi mediaanide **p25**) ja `AJALUGU_MIINUS10_ALATES = 4`
(sama jaotuse **p90**). Asümmeetria on teadlik: `−10` on kaks korda suurem liigutus kui `+5`
ja peab nõudma tugevamat tõendit.

| Elav hange | Skoor vana läve all | Skoor uue läve all | Verdikt |
| --- | --- | --- | --- |
| 315437 Rakendusuuring | 50 | 45 | KAALU → KAALU |
| 314194 Tulevikuseire koolitus | 50 | 45 | KAALU → KAALU |
| 310983 OsKus infosüsteem | 45 | 40 | KAALU → KAALU |
| 313518 Turvalise koostöö e-kursus | 45 | 40 | KAALU → KAALU |
| 314159 Nikotiini eneseabi | 45 | 40 | KAALU → KAALU |
| 312645 Reisiteenuste platvorm | 30 | 25 | JÄTA → JÄTA |

**Verdikt muutus 0 hankel kuuest.** See ei ole nõrk tulemus, vaid tõend: vana `+5` oli
ühtlane nihe, mis ei kandnud ühegi hanke kohta infot. Nüüd ütleb `score_why` selle välja —
`0 · segmendi ajalugu (CPV-d ei ole): mediaan 2 pakkujat 132 lepingul — üle 1 ja alla 4 jääb
kahe reegli vahele`.

#### Mis seda lukus hoiab

`crm/test/gate-hanked-ajalugu-kalibreering.mjs` jookseb **kommititud fikstuuri**
`crm/test/fixtures/hanked-ajalugu-24k.json` peal (4 553 rida tootmisbaasist, **ilma
isikuandmeteta** — nimesid, registrikoode, ostjat ega pealkirju ei ole kaasas ja võitja on
pseudonüüm `V0001`; põhjus on mõõdetud: `winner_reg`-is on 329 rida Eesti isikukoodi kujul).
Värav nõuab, et `AJALUGU_PLUSS5_KUNI === p25` ja `AJALUGU_MIINUS10_ALATES === p90` selle
fikstuuri jaotusest, ja et kõik neli akent annaksid sama teguri. **Läve muutmine ilma uue
mõõtmiseta kukutab värava** — pöördtestitud: vanade lävedega 3 / 8 kukub värav real
„AKEN EI TOHI TEGURIT LIIGUTADA … andsid: 0, 5".

#### Mis jääb ikka lahti

Nišisegmendi mediaan on **kogu segmendi omadus, mitte selle hanke oma** — iga `nišš`-hange
saab sama arvu. Seni kuni RSS CPV-d ei anna, on ajalootegur kogu radari peale ühtlane nihe,
ükskõik kus lävi on. Praegu on see nihe 0, ehk kahjutu. Päriselt eristama hakkab tegur alles
siis, kui elavatel hangetel on CPV (ülesande 6 eForms-tee) — **siis tuleb see mõõtmine üle
korrata** ja vaadata, kas p25/p90 on ikka õiged lõikekohad.

### B2. Ajaloo laadimine EI arvuta skoore ümber

`hanked:ajalugu` täidab `hanke_lepingud`, aga `hanked`-tabeli `score`/`score_why`/`verdict`
jäävad vanaks kuni järgmise sünkini. Mõõdetud päris läbikäigul: pärast ajaloo laadimist
näitas detailpaneel uut mediaani („18 lepingut") ja KÕRVAL vana skoori, milles seda mediaani
ei olnud. Pärast `hanked:sync`-i klappis.

- **Kui ei tee:** ekraanil on korraga kaks eri hetke ja kasutaja ei saa aru, kumb kehtib.
  Praktikas laheneb ta järgmise öise sünkiga, seega elu ei sega — aga see on täpselt see
  „näeb välja nagu töötav asi" klass, mis meid juba korra hammustas.
- **Töö:** S — ajaloo jooksu lõpus sama ümberarvutus, mida sünk teeb, või paneelile rida
  „skoor on arvutatud enne ajaloo laadimist".

### B3. RHR-i parandusteade tekitab `hanke_lepingud`-i TEISE rea

Unikaalindeks on `(ref, lot, winner_reg, winner, amount)`. Kui RHR avaldab paranduse, kus
summa või võitja muutub, ei ole see dublikaat — ta on uus rida. „Viimane võidab" loogikat ei
ole (erinevalt `hanked`-tabelist, kus RSS-i uuem teade kirjutab vanema üle).

- **Kui ei tee:** parandatud leping on mediaanis KAKS korda, eri summadega. Kuna mediaan
  võtab osa kohta MAX-i, võidab suurem summa — ehk parandus allapoole ei jõua kunagi
  kohale. Mõõdetud mõju 3 kuu peal on väike (68 + 77 + 22 = 167 `INSERT OR IGNORE` dublikaati,
  parandusteateid eraldi ei ole loetud), aga 24 kuu peal kasvab ta koos andmetega.
- **Töö:** M — vaja `notice_id` järgi versioonitunnust ja reeglit „sama (ref, lot) uusim
  teade võidab". Otsustada tuleb ka see, kas vana rida kustub või jääb ajalooks.

### B4. Kirjelduspõhine nišifilter on mürane

`segment_allikas` eristab, kas hange sattus nišši pealkirja või kirjelduse kaudu. Mõõdetud
3 kuud: **75 rida pealkirjast, 47 kirjeldusest**. Kirjelduse pool sisaldab registri
boilerplate'i — ülesandes 13 leitud näide on „Kunda alajaama 110kV jõutrafode ost"
(4 389 920 €), mis sattus nišši ainult selle tõttu, et kirjelduses seisab „leitavad
Elektrilevi veebilehelt".

- **Praegune kaitse:** „Sarnased lepingud" ja mediaanid vaatavad AINULT `segment_allikas =
  'pealkiri'` ridu (kasutaja siduv otsus 21.09.2026). Ilma selleta tõusis mediaanhind
  48 460 € → 90 000 €.
- **Kui ei tee:** kirjelduse pool jääb tabelisse alles ja on kasutu — iga hilisem päring,
  mis unustab `segment_allikas` filtri, saab vaikselt vale vastuse. RSS-i pool (avatud
  hangete nišifilter) vaatab endiselt ka kirjeldust ja seal seda kaitset EI OLE: mõõdetud
  kasu oli reaalne (310983 OsKus tuli sisse ainult kirjelduse kaudu), seega filtri
  eemaldamine ei ole vastus.
- **Töö:** M — kas kirjeldusele oma, kitsam sõnaloend, või „kirjeldusest tulnud" märge ka
  `hanked`-tabelisse ja vaates nähtavaks.

### B5. `amount` on INTEGER-afiinsusega, aga hoiab sente

Veerg on deklareeritud `INTEGER`, SQLite afiinsus jätab mittetäisarvu `REAL`-iks —
56 515,72 € jääb alles täpselt nii. See TÖÖTAB ja on testiga lukus, aga veeru nimi ja tüüp
valetavad lugejale.

- **Kui ei tee:** järgmine inimene (või agent) kirjutab `CAST(amount AS INTEGER)` või
  `SUM(amount)/100` ja saab vaikselt vale arvu. Andmetes viga ei ole, viga on ootuses.
- **Töö:** S — kommentaar skeemi juurde on juba olemas; õige lahendus on veerg ümber
  nimetada (`amount_eur REAL`) järgmise migratsiooni käigus, sest tabel täitub alles nüüd.

---

## C. Käitamine

### C1. KUMBKI Task Scheduleri ülesanne ei ole registreeritud

Kontrollitud 21.09.2026 (`schtasks /query`): masinal on `Leisson CRM jarelkirjad`,
`kampaaniad`, `konduktor`, `loobumised` ja `saatja` — **`Leisson CRM hanked sync` ja
`Leisson CRM hanked ajalugu` PUUDUVAD MÕLEMAD**. Ülesandes 11 testiti ainult kuivjooksu ja
kuine ülesanne jäi teadlikult registreerimata (skript puudus); päevane jäi registreerimata
koos temaga.

- **Kui ei tee:** radar ei jookse kunagi ise. Uus hange ilmub CRM-i ainult siis, kui keegi
  vajutab „Sünkroon" — ja lihthanke tähtaeg on mediaanis 12 päeva (min 6). Ühe unustatud
  nädala hind on üks kaotamata jäänud hange.
- **Kuidas teha:** `powershell -NoProfile -ExecutionPolicy Bypass -File win\install-hanked-task.ps1`
  **peakoopiast** (`C:\...\Leisson Creative\crm`), MITTE worktree'st — vt C2.
- **Töö:** S (üks käsk), aga see on TEADLIKULT kasutaja otsus, mitte agendi oma.

### C2. Worktree'st paigaldatud ülesanne kukub pärast merge'i vaikselt

Ülesanne salvestab töökataloogi absoluutse teena. `_worktrees\riigihanked\crm` kaob pärast
haru merge'i ja worktree eemaldamist.

- **Kui ei tee (st kui teed valesti):** ülesanne jääb Task Scheduleris alles, kukub iga kord
  ja ainus jälg on Task Scheduleri ajalugu, kuhu keegi ei vaata. CRM-i vaates näeb see välja
  nagu „sünki ei ole jooksutatud".
- **Töö:** null — ainult paigaldamise koht. Hoiatus on `crm/README.md`-s ja
  `crm/win/README.md`-s.

### C3. „Lae ajalugu" nupp laeb terve 24 kuu akna

Nupp saadab ainult `{ cmd: 'history' }` ja agendi vaikimisi aken on `MAX_KUUD = 24`.
Mõõdetud päris läbikäigul: progressiks tuli „laen 24 kuud (2024-09…2026-08)", esimene kuu
1895 rida, kolm kuud 5611 rida. Üht kuud saab ainult käsurealt
(`npm run hanked:ajalugu -- --kuud=1`). Kommentaar failis `agent/hanked-history.mjs` (rida
184–185) väidab, et CRM-i nupp annab `--kuud=1` — **see ei vasta tõele**.

- **Kui ei tee:** esimesel korral on 24 kuud ÕIGE (nii see aken täidetaksegi), aga iga
  hilisem klikk maksab kümneid minuteid ja sadu megabaite selleks, et laadida uuesti see,
  mis juba olemas on. „Peata" töötab (mõõdetud: jooks lõppes seisuga „katkestatud",
  5611 rida alles), seega lõksu ei ole — on ainult raisatud aeg.
- **Võimalik parandus:** nupp annab `--kuud=1` ja kõrvale tuleb eraldi „Lae kogu ajalugu"
  (või nupp küsib akent). Vale kommentaar tuleb igal juhul parandada.
- **Töö:** S.

### C4. Käsurealt või ajastajast käivitatud jooks ei ilmu avatud lehele ise

Riba pollib ainult siis, kui jooks on käivitatud selle lehe kaudu. Öine jooks on `hanke_runs`-is
ja ilmub nähtavale järgmisel sakivahetusel või lehe laadimisel.

- **Kui ei tee:** lahtiunustatud CRM näitab eilset seisu. Pisiasi, aga ta selgitab ära
  „miks ma öist jooksu ei näe" küsimuse enne, kui ta tekib.
- **Töö:** S — sakile astudes küsitakse jooksud niikuinii; lisada võiks ainult ühe
  värskenduse riba kohale.

---

## D. Arvud, mis olid kahes kohas erinevad

Ülesande 12 loendureid on nimetatud kolmes kohas eri ühikutes. **Mõõdetud üle 21.09.2026**,
värske baas, 3 kuud (2026-06…2026-08), `agent/hanked-history.mjs --alates=2026-06 --tana=2026-09-01`:

| Suurus | Mõõdetud väärtus |
| --- | --- |
| ridu kokku | **6671** |
| teateid | 3309 · hankeid (ref) 3030 · osi 5585 |
| **summata ridu** | **1268** (19,0 %) |
| **võitjata ridu** | **867** (13,0 %) |
| konsortsiumi ridu | 354 |
| nišis, pealkirjast | 75 rida / 28 osa |
| nišis, kirjeldusest | 47 rida |
| mediaani alus (summa + võitja olemas) | 24 lepingut |
| mediaanhind / mediaan pakkujaid | 48 460 € / 3,5 |

**`crm/lib/hanked.mjs` rida 533–534 („1268 rida 6671-st summata, 867 võitjata") on ÕIGE** —
mõõdetud uuesti, klapib bait-baidilt.

Lahknevus on mujal ja ta on **ühikute lahknevus, mitte viga**:

- `docs/plans/2026-09-20-crm-riigihanked-teostusplaan.md` rida 1075: „**137 on võitjata**
  (`clos-nw`)" — see on augusti **TEATEID** tulemusekoodi järgi, 956 teate hulgast.
- Jooksu enda loendur sama kuu kohta: „**206 võitjata osa**" (2026-08, 1532 rida) — see on
  **OSI**, mitte teateid.
- Ülesandes 6 nimetatud 113 ja 143 tulid laiemast definitsioonist („mitu võitjat kokku,
  sõltumata osade arvust") ja ei kehti.

Kolm arvu, kolm ühikut, üks kuu: 137 teadet · 206 osa · (augusti ridu 1532). Kui neid kõrvuti
kirjutada, PEAB ühik alati juures olema — muidu loeb järgmine lugeja neid vastuoluna ja hakkab
uuesti mõõtma.

- **Kui ei tee:** keegi mõõdab sama asja neljandat korda.
- **Töö:** S — see tabel ongi see töö; plaanidokumendi rida 1075 võiks saada ühikumärke.

---

## Kokkuvõte: kolm kõige kallimat

1. **B1 — ajalootegur vajab 24 kuu mõõtmisvooru.** Praegu on skooris tegur, mis kas ei tee
   midagi või teeb kõigile sama. Ta on skoori kõige uuem ja kõige vähem tõestatud osa.
2. **A2 + A4 — vaikne alalugemine.** „Ei tuvastatud" ja „nõuet ei ole" on ekraanil sama
   asi. ESPD XML, kus see info struktureeritult olemas on, jääb lugemata.
3. **C1 — radar ei jookse ise.** Kogu ülejäänud töö annab väärtust ainult siis, kui keegi
   ülesanded registreerib — peakoopiast.
