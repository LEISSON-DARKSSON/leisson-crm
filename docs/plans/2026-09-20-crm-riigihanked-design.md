# CRM „Riigihanked“ leht — disain

Kuupäev: 2026-09-20 · Otsustaja: Gert Leisson · Seis: kinnitatud, teostus ootab plaani

## Probleem

Riigihangete radar elab praegu väljaspool CRM-i: Pythoni skriptid kaustas `riigihanked/rhr_tools/`,
pilve ajastatud ülesanne ja üks xlsx. Otsus („kas pakun?“) sünnib peast, seisu ei salvestata kuhugi
ja lihthanke tähtaeg on mediaanis 12 päeva, lühim mõõdetud 6 — seega üks vahelejäänud päev maksab hanke.
CRM-is on juba müügitoru, postkast, arved ja agendid; hanked on ainus müügikanal, mida seal ei ole.

## Otsus

Riigihanked saab CRM-i seitsmenda saki: **hankeradar ja otsustuslaud ühes vaates**, andmed CRM-i
enda SQLite-baasi, sünk Node'is (Pythoni skriptid jäävad pilve valvurile alles).

Kaalutud ja kõrvale jäetud:
- **Server pärib RSS-i iga vaate avamisel.** Vähem koodi, aga vaade sõltub võrgust ja ajalugu ei teki.
- **Hanked eraldi baasi (`data/hanked.db`).** CRM-i baas jääks puutumata, aga „kas see hankija on
  juba minu torus“ nõuaks kahte päringut ja väravad peaksid kaks baasi ette valmistama.
- **Ainult RSS ilma ajaloota.** Väikseim töö, aga konkurentsipilt (kes võitis, mis hinnaga, mitme
  pakkujaga) on täpselt see, mis otsust muudab.

## Andmemudel

Lisav migratsioon `migrateHanked(db)` failis `lib/hanked.mjs`, sama muster mis `migrateSales`.

| Tabel | Sisu | Võti |
|---|---|---|
| `hanked` | viitenumber, RHR id, hankija + registrikood, nimetus, menetlus, eeldatav maksumus, CPV-d, tähtaeg, avaldatud, segment, skoor, `score_why`, **seis**, **märkus**, dokumentide kaust ja arv, `seen` / `seen_last` / `updated` | `ref` |
| `hanke_lepingud` | kuupäev, hankija, nimetus, CPV, võitja + registrikood + suurus, summa, pakkumuste arv, menetlus | `id`; indeksid `cpv`, `winner`, `date` |
| `hanke_sync` | mis on laetud (`rss`, `notice_award:2026-08`), ridade arv, aeg, tulemus | `key` |
| `hanke_runs` | `cmd`, `args`, `state`, algus, lõpp, progress, ridu, log (≤4000 tm), viga, pid | `id` |

**Reegel:** sünk kirjutab ainult avastusvälju. `state`, `note` ja otsus on inimese omad ja neid ei
kirjutata kunagi üle (sama kaitse mis registrikoodi täitmisel).

**Reegel (mõõdetud 21.09.2026):** `updated` tähendab „mõni väli muutus“, `seen_last` „sünk nägi rida
viimati“. Iga jooks kirjutab `seen_last`-i; `updated` liigub ainult päris muutuse peale. Ilma selleta
„muutuks“ vaates iga 15 minuti tagant kogu nimekiri ja üks päris muutus (nihkunud tähtaeg) upuks müra
sisse.

**Reegel (mõõdetud 21.09.2026):** jooksu värskust arvutab vaade `hanke_sync.ts` pealt — punane, kui
rida on vanem kui 2× sünkimisintervall — mitte ainult `ok`-lipu pealt. Lukus baasi korral ei pruugi
`ok` üldse liikuda; laps annab siis stdout-is rea `{"jalgeta": true}`, mis ütleb, et vaade on vana.

Ajalugu hoitakse 24 kuud; vanemad read kustutatakse impordi lõpus. Salvestatakse ainult teenuste
read — ehitustööd ja asjad visatakse parsimise ajal minema (~1,4 GB allalaadimisest jääb baasi 30–60 MB).

## Sünk ja käivitamine

Neli käsku, igaühel **nupp lehel** ja rida `hanke_runs`-is:

| Käsk | Nupp | Kestus |
|---|---|---|
| `npm run hanked:sync` | Sünkroon | sekundid (RSS) |
| `npm run hanked:history -- --alates=2025-01` | Lae ajalugu | kümneid minuteid (kuised eForms XML-id) |
| `npm run hanked:docs -- <viitenr>` | Lae dokumendid | sekundid |
| `npm run hanked:gate` | Värav | sekundid |

**Kes kirjutab:** nupp → `POST /api/hanked/run` → server käivitab lapsprotsessi ja loeb selle
stdout-i JSON-ridadena (`{"progress":"…","rows":41}`). Baasi kirjutab ainult server; laps ei ava
baasi. See väldib kahe kirjutaja lukustusviga pika impordi ajal.

Neli reeglit: üks jooks korraga käsu kohta (teine päring → 409); serveri taaskäivitusel märgitakse
elutu pid-iga `käib`-read „katkestatud“; „Peata“ saadab SIGTERM-i ja pooleliolevat kuud ei märgita
tehtuks; veaga jooks jääb punasena nimekirja koos logi viimaste ridadega.

**Task Scheduler (v1):** `win/install-hanked-task.ps1` registreerib „LEISSON — hanked sync“ iga päev
07:40 ja ajaloo kuuvärskenduse iga kuu 3. kuupäeval. Mõlemad kirjutavad samasse `hanke_runs`
tabelisse, nii et öine jooks on lehel näha. Kui ülesannet ei ole, ütleb leht seda ja pakub käsku.

## Skoor

`score(hange, ajalugu)` on puhas funktsioon, mitte mudelikõne — sama sisend annab sama väljundi ja
hinnangut saab hankija ees põhjendada.

| Tegur | Mõju |
|---|---|
| nišši märksõna või CPV | +40 |
| väike veebileht / UX / disainisüsteem | +10 |
| maksumus ≤50 k€ · 50–140 k€ · >1 M€ | +15 · +10 · −10 |
| kvaliteedikriteerium (kaal ≥50 %) | +10, pärast dokumente +20 |
| lihthange või väikehange | +5 |
| ≥3 rolli CV-nõue või käive >50 k€ | −25 ja silt ALLTÖÖVÕTT |
| sama CPV: pakkumusi mediaan ≥8 · ≤3 | −10 · +5 |
| tähtajani alla 3 päeva | −15 |

≥60 PAKU · 35–59 KAALU · <35 JÄTA. Iga tegur kirjutatakse `score_why`-sse eraldi reana ja leht
näitab neid ridu. Skoor ei muuda kunagi seisu — see on nõuanne.

## Vaade

Sakk „Riigihanked“ märgendiga (mitu hanget tähtajaga alla 7 päeva ja endiselt „uus“).
Ülal „Andmed“ riba nuppude ja viimase viie jooksuga; all filtririba (seis · segment · soovitus ·
otsing) ja tabel: tähtaeg + päevi jäänud · viitenumber · hankija · nimetus · maksumus · menetlus ·
skoor + soovitus · seis · dokumente. Aktiivsed tähtaja järgi ees, aegunud lõpus.

Detailpaneel (klikk real): skoori põhjenduste read, CPV-d, link RHR-i, märkus (salvestub ise),
seisunupud, allalaetud failide nimekiri, **„Sarnased lepingud“** (viis rida sama CPV ajaloost +
mediaanid) ja rida „Hankija on juba sinu torus“, kui `hanke.buyer_reg` leidub `companies.regcode`-is.

Seisud: `uus · vaatan · valmistun · esitatud · võidetud · kaotatud · jätsin · aegunud`.

## Veakäsitlus

1. RHR ei vasta → jooks punaseks, baasi ei kirjutata midagi poolikult (kirjutamine ühe tehinguga
   pärast edukat parsimist).
2. Katkine kuu ajaloos → see kuu veaga, ülejäänud jätkuvad, katkine ei jää „tehtuks“.
3. Dokumentide API 500 → paneel ütleb „RHR ei andnud dokumente“ ja pakub RHR-i linki.
4. Vaba ketast alla 2 GB → ajaloo import keeldub kohe, mitte poole pealt.
5. Baasi kasv → 24 kuu aken.

## Väravad (`test/gate-hanked.mjs`, ahelas `npm test`, ilma võrguta)

1. Skoor on determinstlik: fikstuur → täpne summa ja põhjendusread.
2. Sünk ei kirjuta üle seisu ega märkust.
3. Aegumine puudutab ainult seisu „uus“.
4. eForms-parser: kaks teadet fikstuuris; regressioon lõputag-stringi peale teate sees.
5. Käivitaja lukk: teine samaaegne päring → 409, teist protsessi ei teki.
6. Serveri taaskäivitus: elutu pid → „katkestatud“.
7. Ajaloo import: tehtud kuu vahele, katkestatud kuu mitte tehtuks.
8. Zip-slip: lahtipakkimine ei kirjuta väljapoole `riigihanked/<viitenr>/`.

CI-märkus: värav ei tohi lugeda `data/` ega `seed/` sisu (gitignore'is) — kõik fikstuuridest.
Testibaas `os.tmpdir()`-is, sest `node:sqlite` ei ava monteeritud kettal baasi Linuxi-VM-ist.

## Failid (12)

`lib/hanked.mjs` · `lib/eforms.mjs` · `lib/hanked-runs.mjs` · `agent/hanked-sync.mjs` ·
`agent/hanked-history.mjs` · `agent/hanked-docs.mjs` · `lib/routes2.mjs` (6 marsruuti) ·
`public/index.html` · `public/views.js` · `public/crm2.css` · `test/gate-hanked.mjs` ·
`win/install-hanked-task.ps1` (+ `package.json` skriptid).

API: `GET /api/hanked` · `GET /api/hanked/:ref` · `POST /api/hanked/:ref/state` ·
`POST /api/hanked/:ref/note` · `POST /api/hanked/run` · `GET /api/hanked/runs` ·
`POST /api/hanked/runs/:id/stop`.

## Etapid

1. **F1 andmekiht** — tabelid, eForms-parser, sünk, skoor, värav. Käsurida töötab, lehte ei ole.
2. **F2 leht** — käivitaja lukuga, sakk, tabel, detailpaneel, seis ja märkus, Task Scheduler.
3. **F3 ajalugu** — kuine import, „Sarnased lepingud“, skoori ajalootegur, dokumentide nupp.

Iga etapp lõpeb rohelise `npm test`-iga ja serveri taaskäivitusega (`win/restart-server.ps1`).

## Mis jääb välja (YAGNI)

Pakkumuse dokumendihaldus CRM-is (failid jäävad kausta), CV-de ja kontrollnimekirjade haldus,
hankijate müügikampaania hangete pealt, automaatne pakkumuse koostamine.
