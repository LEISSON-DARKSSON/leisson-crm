# Leisson CRM

Kohalik müügitöölaud: Zone IMAP, inimese kinnitatud SMTP, SQLite ja ChatGPT tellimusega Codex.

## Käivitamine

Node 24+; `npm ci`, olemasolev kohalik `.env`, `npm start`.
Ava http://127.0.0.1:4310. Andmed ja postkasti paroolid jäävad `data/` ja `.env` sisse.
Algandmete import lisab ainult puuduvaid ettevõtteid; taaskäivitus ei kirjuta käsitsi parandusi üle.

## Müügi töövoog

1. Vaata päringut ja viimast inimvastust. Keeldumine, loobumine, “mitte praegu” ja olemasolev arendaja peatavad uue müügijada.
2. Kinnita vajadus ja sobiv töömaht; vali pakett ühisest `../packages/service-catalog/catalog.json` kataloogist.
3. Koosta pakkumine või vastus. Kõigi müügikirjade saatja on **gert@leisson.eu**.
4. Saatmisaken näitab saajat, teemat ja täielikku kirja. Iga saatmine vajab inimese täpset kinnitust. Teksti, saaja või allikkirja muutus tühistab kinnituse.
5. Arve ja laekumine on eraldi. Märgi raha laekunuks ainult pangaväljavõtte alusel, koos kuupäeva ja kordumatu viitega.

290 € pakett: 100% ette. 590/1190 €: 50% ette. Tasumata ettemaks ei muutu automaatselt tasutud summaks.
SMTP ebaselge tulemus jääb kontrollimiseks; automaatset kordussaatmist ei tehta.

## Codex

`node agent/worker.mjs --status` — ainult lugemine.
`node agent/conductor.mjs --dry --why` — plaani ülevaade ilma kirjutamiseta.
`node agent/probe-codex-policy.mjs` — kohaliku tööriistapoliitika kontroll.
`node agent/scheduled-run.mjs` — eraldatud sünkroonimine, otsustaja ja üks järjekorratäitja.
Tööpäeviti 08–18 Tallinnas, kontroll iga 30 minuti järel; muutuseta ei kutsuta mudelit.
Vana üldine automaatne saatja ja järelkirjade saatja peavad jääma välja lülitatuks. Loobumiste töötlemine säilib.

### Kinnitatud kampaania

Ava CRM-is **Kampaaniad**. Vali ainult asjakohased ärikontaktid, vaata üle iga saaja, teema,
täielik tekst, HTML-versioon ja allkiri ning kinnita kogu muutumatu loend ühe korraga.
Ettevalmistus ega kinnitamine ei saada kirju. Saaja, kirja, allkirja või kliendi seisu muutus
peatab selle kirja; uus variant vajab uut eelvaadet ja kinnitust. Tuttavad jäävad omaniku
müügipausiga välja. Loobumine ja inimvastus peatavad vana külmkirja.

Deterministlik töötaja on vaikimisi **väljas**, ajastajat ei paigaldata:
`node agent/campaign-worker.mjs <kinnitatud-kampaania-id>` keskkonnamuutujaga
`CRM_CAMPAIGN_SEND_ENABLED=1`
teeb ühe postkasti sünkroonimise ja kõige rohkem ühe saatmiskatse. Saatja peab olema
`gert@leisson.eu`; tööaeg, päevane/tunnine piir ja minimaalne vahe kehtivad.
Pärast omaniku täpse kampaania kinnituse kontrolli saab ühe sweep'i teha käsitsi
PowerShellis CRM-i kaustast:
```powershell
$env:CRM_CAMPAIGN_SEND_ENABLED = '1'
try { node agent/campaign-worker.mjs --sweep }
finally { Remove-Item Env:CRM_CAMPAIGN_SEND_ENABLED -ErrorAction SilentlyContinue }
```
See leiab ainult `approved` kampaania `pending` kirja ja teeb kõige rohkem ühe katse.
Käsu kordamine või ajastajasse lisamine on eraldi aktiveerimissamm; praegu ei ole
Windowsi ajastajat ega aktiivset saatmisülesannet. Kinnituse puudumisel ei leita
saadetist ja SMTP-d ei avata.
SMTP ebaselguse või katkestuse korral ei korrata kirja automaatselt. Kui protsess katkeb
pärast kirja võtmist, jääb see käsitsi kontrolli ootama ja peatab järgmise automaatse katse.
Ära lülita ajastajat sisse enne, kui Gert on päris kampaania täpse loendi kinnitanud.

Kampaania tulemuste vaade koondab saadetised, viimased inimvastused, kirjeldatud vajadused
ja pärast saatmist registreeritud laekumised. Ajalisest järgnevusest ei järeldu müügi põhjus.
Soovitus puudutab ainult uut ettevalmistatavat versiooni; kinnitatud kampaaniat ega hinda
ei muudeta automaatselt. Uus versioon läbib sama täieliku kinnituse.

Kampaania kinnitus salvestatakse nimega `local-crm-operator`. Kohalik `127.0.0.1` ühendus,
lubatud Origin ja CSRF-token kaitsevad teiste veebilehtede päringute eest, kuid **ei tõenda
Gerti isikut**. Sama Windowsi kasutaja õigustega kohaliku protsessi vastu see ei ole
autentimine. Enne saatja ajastamist tuleb omaniku kinnitusvoog eraldi üle vaadata.

Luna medium liigitab, Sol medium koostab/toimetab. Mudelil pole SMTP võtmeid, shelli ega saatmistööriista.
Kvoodi, autentimise või tööriistapoliitika viga peatab töö; Claude'i või tasulise API varuvarianti pole.
Jooksu ajalugu näitab tegelikke tokeneid ja teenusepakkujat. Ajalooline Claude'i dollarikulu jääb ajalooks.
Põhjalik runtime juhend: [agent/README.md](agent/README.md).

## Riigihanked

Hangete radar elab CRM-i sakis **Riigihanked**. Allikas on RHR-i avaandmed: päevane RSS
(avatud hanked) ja kuine eForms-XML (lepinguteated). Kogu töö käib kohaliku SQLite-i
vastu; hankijatele ei lähe siit mitte midagi välja.

### Neli käsku

| Käsk | Mida teeb |
| --- | --- |
| `npm run hanked:sync` | Loeb RHR-i RSS-i, filtreerib meie niši välja, arvutab iga hanke sobivuse skoori ja verdikti (`PAKU`/`KAALU`/`JÄTA`/`ALLTÖÖVÕTT`) ning kirjutab read tabelisse `hanked`. Idempotentne: teine jooks ei tee dublikaate. Avastusväljad uuenevad, **seis ja märkus ei uuene kunagi üle**. Möödunud tähtajaga read seisus `uus` märgitakse `aegunud`. |
| `npm run hanked:ajalugu` | Laeb eForms-i lepinguteated kuu kaupa tabelisse `hanke_lepingud`, aken on 24 kuud ja aknast välja jäänud read kustutatakse. Üks rida = üks **osa** (mitmeosalisel hankel on osadel eri võitjad ja summad). Jooksva kuu faili ei laeta, sest ta täieneb veel. Jätkatav: katkenud jooks jätkab sealt, kus jäi. Üks kuu korraga: `npm run hanked:ajalugu -- --kuud=1`. |
| `npm run hanked:dokumendid -- --ref=314159` | Küsib RHR-ist ühe hanke alusdokumentide ajutise URL-i, laeb zip-i, pakib lahti `riigihanked/<viitenumber>/docs/` alla ja loeb dokumenditekstist nõutud rollid, käibenõude ja kvaliteedikriteeriumi kaalu. Iga leid kannab **tõendit** — lauset ja failinime —, ebakindel leid saab märke „kontrolli" ja skoori ei liiguta. Skoor ja verdikt arvutatakse pärast lugemist uuesti. Teist korda sama kausta peale ei kirjutata: vaikimisi keeldutakse, `--uuesti` tõstab vana kausta kõrvale. |
| `npm run hanked:gate` | Radari oma värav. `npm test` ja `npm run varav:range` jooksutavad teda niikuinii; eraldi käsku läheb vaja siis, kui tahad ainult radarit kontrollida. Kõrval on veel `hanked:ajalugu:gate`, `hanked:dokumendid:gate`, `hanked:ui:gate` ja `hanked:vaade:gate` (viimane on brauserivärav, jookseb `npm run varav:brauser`). |

Kõik neli on CRM-is ka **nuppudena** („Andmed" riba sakis Riigihanked): *Sünkroon*, *Lae
ajalugu*, *Lae dokumendid*, *Värav*. Nupust käivitatud jooks jookseb serveri all, näitab
progressi ja lõpprida ning on peatatav („Peata" ilmub ainult selle serveri enda jooksule).
Sama käsu teine klikk annab eestikeelse „käib juba (jooks #N)" selle käsu juures, mitte
anonüümse teatena — ja see teade kaob ise ära, kui jooks lõpeb.

Kaks asja nuppude juures, mida tasub teada:

- **„Lae dokumendid" käib ÜHE hanke kohta.** Vali kõigepealt nimekirjast hange; siis ütleb
  nupp ise, millise viitenumbri kohta ta käib. Hanget valimata on nupp keelatud.
- **„Lae ajalugu" nupp laeb terve 24 kuu akna** (kümneid minuteid, sadu megabaite). Üht kuud
  saab ainult käsurealt: `npm run hanked:ajalugu -- --kuud=1`.

PDF-ide lugemine vajab masinas `pdftotext`-i (poppler või xpdf). Kui teda ei ole, ei teeskle
kood midagi: failid jäävad loendisse „ei saanud tekstiks" ja jooks ütleb seda hoiatusena.

Binaari **ei otsita ainult PATH-ist** ja see on mõõdetud vajadus: hankel 315437 (21.09.2026)
oli `pdftotext` masinas olemas (`C:\Program Files\Git\mingw64\bin`), aga jooks sai `ENOENT`
ja luges tekstiks 0 faili 9-st — tagajärg oli NULL `rollid`/`kaive_noue`/`quality_weight` ja
vale verdikt `KAALU`. Nüüd proovib `leiaPdftotext()` järjekorras: `PDFTOTEXT`
keskkonnamuutuja (täistee) → paljas `pdftotext` PATH-ist → teadaolevad kohad. Kui su masinas
on ta mujal, pane `.env`-i `PDFTOTEXT=C:\...\pdftotext.exe`. Värav
`test/gate-hanked-docs-tekst.mjs` nõuab, et binaar SELLES masinas leitaks.

**Kumb binaar loeb, see muudab tulemust.** xpdf 4.00 `-layout` lõhub hindamiskriteeriumide
mitmeveerulise tabeli (osakaal satub labelist eraldi reale) ja kvaliteedikaal jääb lugemata;
poppleri sama käsk hoiab rea koos. Paneel näitab rea „tekstiks luges &lt;tee&gt;", et seda
oleks tagantjärele näha. Kui kvaliteedikaal jääb korduvalt „ei tuvastatud", on esimene
kahtlustatav see.

**Isikupõhine blokeeriv nõue.** Alusdokumentidest loetakse ka nõue, mida ettevõtte suurus ei
lahenda: doktorikraad, kutsetunnistus, atesteering, tegevusluba. Leid kirjutatakse veergu
`blokeeriv_noue` ja annab score-is verdikti `ALLTÖÖVÕTT` — täpselt nagu kolm rolli või suur
käibenõue. Hindamiskriteeriumi keel („kõrgemalt hinnatakse doktorikraadi") ja seadusetsitaat
(„Viide seadusele: RHS § 101 ...") jäävad märkega `kontrolli` ja verdikti EI liiguta.

### Ajastatud ülesanded (Windows)

```
rem kuivjooks — trükib, mida teeks, ei kirjuta midagi
powershell -NoProfile -ExecutionPolicy Bypass -File win\install-hanked-task.ps1 -Kuiv

rem päris paigaldus
powershell -NoProfile -ExecutionPolicy Bypass -File win\install-hanked-task.ps1

rem eemaldamine (puudutab täpselt neid kahte ülesannet)
powershell -NoProfile -ExecutionPolicy Bypass -File win\install-hanked-task.ps1 -Eemalda
```

Registreeritakse kaks ülesannet: `Leisson CRM hanked sync` (iga päev 07:40) ja
`Leisson CRM hanked ajalugu` (kuu 3. päeval 05:00, `--kuud=1`). Öine jooks on CRM-i vaates
nähtav — agent kirjutab otsekäivitusel ise rea `hanke_runs`-i. Täpsem taust:
[win/README.md](win/README.md).

> **PAIGALDA PEAKOOPIAST, MITTE WORKTREE'ST.** Ülesanne salvestab töökataloogi absoluutse
> teena. Kui paigaldad selle `_worktrees\<haru>\crm` alt, siis pärast haru merge'i ja
> worktree eemaldamist osutab ülesanne olematule kaustale ja **kukub iga kuu vaikselt**
> Task Scheduleri ajaloos, kuhu keegi ei vaata. Jooksuta skript
> `C:\...\Leisson Creative\crm` alt. Kui oled juba worktree'st paigaldanud: `-Eemalda`
> sealt ja paigalda uuesti peakoopiast.

### Kus andmed on

| Koht | Mis seal on |
| --- | --- |
| `hanked` | Üks rida hanke kohta. Avastusväljad tulevad RSS-ist, `state` ja `note` on **sinu omad** ja sünkimine ei kirjuta neid üle. Siin on ka `score`, `score_why`, `verdict`, `docs_dir`, `docs_count`, `rollid`, `kaive_noue`, `quality_weight` ja `docs_leiud`. |
| `hanke_lepingud` | Lepinguteated, üks rida **osa** (ja konsortsiumi liikme) kohta. Siit tuleb „Sarnased lepingud" plokk ja skoori ajalootegur. |
| `hanke_sync` | Iga sünkimise/impordi jälg: aeg, ridade arv, õnnestumine ja `note`, kus on loendatud KÕIK mahavisatu (võitjata osad, loetamatud teated, tundmatud koodid, dublikaadid). |
| `hanke_runs` | Jooksud: käsk, seis, progress, logi, viga. Nii nupujooksud kui öised Task Scheduleri jooksud on siin — eraldi logifaili ei ole. |
| `riigihanked/<viitenumber>/docs/` | Ühe hanke alusdokumendid lahtipakituna. Kaust on Giti-väline (`.gitignore`). |

Andmebaas ise on `data/crm.sqlite` — sama fail, mis kogu ülejäänud CRM.

### Vanade dokumendikaustade koristus

`--uuesti` **ei kustuta** midagi: vana kaust tõstetakse kõrvale nimega
`riigihanked/<viitenumber>/docs-vana-<ajatempel>`. See on teadlik — CRM-i töökoopia võib
elada mounditud kaustas, kus `rm` annab EPERM-i, ja „puhastame ära" oleks lubadus, mida kood
ei saa täita. Seega kogunevad need kaustad ja **sina kustutad nad käsitsi**:

```powershell
# vaata kõigepealt, mis kaob
Get-ChildItem riigihanked -Recurse -Directory -Filter 'docs-vana-*'
# ja alles siis
Get-ChildItem riigihanked -Recurse -Directory -Filter 'docs-vana-*' | Remove-Item -Recurse -Force
```

### Mida see süsteem EI tee

- **Ei saada midagi hankijatele.** Ükski radari marsruut ei ava SMTP-d. CRM-i saatmisvärav
  on puutumata ja kehtib edasi: iga kiri vajab inimese täpset kinnitust.
- **Ei halda CV-sid ega kontrollnimekirju.** Dokumentidest LOETAKSE, mitmele rollile CV-d
  nõutakse, aga CV-de kogumine, versioonid ja pakkumuse kokkupanek jäävad kaustadesse.
- **Ei esita pakkumusi ega täida vorme.** Dokumendihaldus jääb `riigihanked/<viitenumber>/`
  kausta, CRM hoiab ainult otsust: seis, märkus, skoor ja põhjendus.
- **Ei otsusta sinu eest.** Skoor ja verdikt on sorteerimisabi koos nähtava põhjendusega;
  `ALLTÖÖVÕTT` tähendab „üksi ei kvalifitseeru", mitte „ära paku".

Lahtised otsad ja nende hind on ühes kohas:
[`docs/plans/2026-09-21-crm-riigihanked-avatud-otsad.md`](../docs/plans/2026-09-21-crm-riigihanked-avatud-otsad.md).

## Kontrollid ja andmed

`npm test` — kohalikud käitumiskontrollid. `npm run test:offline` — CI-s lubatud eraldatud katsed.
`node agent/mail-inventory.mjs` — kogu olemasoleva Zone konto kaustade inventuur, Seen-lippe muutmata.
`node agent/import-prouxaudit.mjs --help` — allika-ID järgi teostusabi impordi töövoog; vaikimisi eelvaade.
`node agent/proof-prouxaudit.mjs --help` — kohalik tõendipakk ilma tasulise API-ta.

Privaatne kirjavahetuse analüüs: `data/mail-strategy-audit.md`; tegevused: `data/contact-next-actions.json`.
Need ei kuulu Giti. Postkasti inventuuri täielikkus ei tähenda, et iga manust on loetud.
PROUXAUDITi päring ja veebivormi metadata on kontrollimist vajav sisend, mitte saatmisluba või ostu tõend.

Skillid asuvad `.agents/skills/`; ühised Leissoni ja PROUXAUDITi töövõtted repo `../.agents/skills/`.
