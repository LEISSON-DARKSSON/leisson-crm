# HANDOFF — Leisson CRM, agendid ja leisson.eu

Kirjutatud 15.09.2026 Codexile ülevõtmiseks. Siin on see, mida koodist **ei näe**:
miks asjad on nii, mis on juba katki läinud, ja mida mitte teha.

Iga number siin on mõõdetud. Kui number on vana, jooksuta `node win	ohusus.mjs`.

---

## 0. Kolm reeglit, mida ei tohi murda

**1. Agendil EI OLE saatmistööriista.** Üheski režiimis, mitte kunagi. Kiri läheb
välja ainult `POST /api/send` kaudu — sama tee, mida inimese klikk kasutab.
Automaatsaatjad (`agent/saatja.mjs`, `agent/jarelkiri.mjs`) on **deterministlikud
skriptid**, mitte agendi tööriistad: nad ei kutsu mudelit ja nad kutsuvad serveri
API-t. Väravad `gate-agent.mjs` ja `gate-saatja.mjs` kontrollivad seda.

**2. Iga väide kirjas on mõõdetud.** Mitte hinnatud, mitte üldistatud. Kui
mõõtmist ei ole, siis kirja ei ole — `lib/kylmkiri.mjs` → `kolbab()` keeldub
kirjutamast alla kahe leiuga lehele. Leiutatud probleem tapab kogu ülejäänud
mõõtmise usaldusväärsuse.

**3. Iga värav peab sabotaažiga kukkuma.** Roheline värav ei tõesta midagi.
Vt skill `varava-negatiivtest`. Selles projektis on vale-roheline päriselt
juhtunud (vt § 7).

---

## 1. Mis see on

Kohalik CRM Gerti masinal: `C:\Users\gert\Desktop\LEISSON.CREATIVE\leisson-crm` (repo `LEISSON-DARKSSON/leisson-crm`; varem monorepo kaust `crm/`).
Node 22, `node:sqlite` (`DatabaseSync`), **null natiivset sõltuvust**. Server
kuulab ainult `127.0.0.1:4310`. Andmebaas: `data/crm.sqlite` (WAL).

Töövoog: külmkiri → vastus → triaaž → mustand → inimese klikk → pakkumine → arve.

```
seed/*.json ──seed()──▶ companies ──sendGate──▶ /api/send ──▶ activity(sent)
                             │                                      │
                        messages(in) ◀──IMAP sync──────────────┘
                             │
                    eelfilter (tasuta) ──▶ classified
                             │ (ülejäänu)
                        triaaž (mudel) ──▶ category
                             │
                        konduktor ──▶ drafts(ootab_kinnitust) ──▶ INIMESE KLIKK
```

---

## 2. Üks reeglistik, üks koht

Iga väärtus elab **täpselt ühes moodulis** ja värav keelab teise koopia.

| Moodul | Mida hoiab | Värav |
|---|---|---|
| `lib/hinnakiri.mjs` | teenused, hinnad, redel, käibemaksuseis | `gate-hinnakiri.mjs` — keelab 3+ hinna koopia teises failis |
| `lib/sendgate.mjs` | külmkirja limiidid, tööaeg, loobumine, loobumisrida | `gate-saatja.mjs` |
| `lib/jarelgate.mjs` | järelkirja kadents, uue fakti reegel | `gate-jarelkiri.mjs` |
| `lib/eelfilter.mjs` | tasuta triaaž enne mudelit | `gate-eelfilter.mjs` |
| `lib/kaart.mjs` | nähtavuskaart + leidude argipäevakeelne seletus | `gate-kylmkiri.mjs` |
| `lib/logo.mjs` | sõnamärk (arve, pakkumine, allkiri, kaart) | `gate-sales.mjs` |
| `lib/gates.mjs` | masinaadress, vastatavad kategooriad, paki suurus | `gate-sales.mjs` |
| `lib/doc.mjs` | A4 kujundus, 17 mm veeris, müüja andmed | `gate-sales.mjs` |

**Kui lisad väärtuse, lisa ka värav, mis keelab selle kopeerimise.**

---

## 3. Teenuseredel — miks üks hind korraga

Mõõdetud 14.09: 45 külmkirja → 9 vastust (**21%**, turu keskmine 3,43%).
Kolm päris inimvastust, kõik viisakad äraütlemised, kõigil sama sõna: *„hetkel"*.
0 kohtumist, 0 eurot.

Diagnoos: kirjad töötavad, **esimene samm oli liiga suur**. Võõras palus kohe
990–1900 € ja kohtumist.

| Aste | Teenus | Hind | Kohtumine |
|---|---|---|---|
| 0 | Nähtavuskaart | 0 € | ei |
| 1 | Masinloetav leht | 290 € | ei |
| 2 | AI-nähtavuse audit / UX+ligipääsetavus / kiirussprint | 990–1900 € | jah |
| 3 | Tokenid / disainisüsteem | 2900–6000 € | jah |

`next_step_offer` (MCP) tagastab **täpselt ühe** teenuse. `docs/protsess.md`:
kaks hinda muudab küsimuse „kumb?" asemel „kas üldse?".

**290 € on valitud otsustuspiiri, mitte tunnihinna järgi** — see jääb alla
enamiku juhtide iseotsustamise piiri ja ei vaja kinnitusringi. Just see
kinnitusring tappis kõik kolm senist vastust.

Nähtavuskaart on tasuta ilma tasuta töö lõksuta: mõõtmine tehakse **niikuinii**
enne iga külmkirja, kaart on selle väljatrükk, mitte uus töö.

---

## 4. Saatmine — mõõdetud piirid

`lib/sendgate.mjs`. Vaikeväärtused, kõik `.env`-ist ülekirjutatavad.

| Piir | Väärtus | Miks just see |
|---|---|---|
| `SEND_PER_DAY` | 40 | turvaline vahemik on 50–100/postkast; alumine ots, sest külmsaatmise ajalugu on lühike |
| `SEND_PER_HOUR` | 8 | **puhang tõstab rämpsuks märgistamist 26%** ka väikese päevakoguse juures |
| `SEND_PER_RUN` | 5 | 8 tunnijooksu × 5 = 40 |
| `SEND_GAP_MIN` | 7 | kirjade vahe minutites |
| tööaeg | 9–17, E–R | |
| `JAREL_PER_DAY` | 6 | järelkiri läheb inimesele, kes juba korra ei vastanud |

**leisson.eu ei ole ühekordne saatmisdomeen — see on Gerti päris töö-postkast.**
Kui ta musta nimekirja läheb, kaovad ka pakkumised, arved ja vastused klientidele.
Autentimine on korras: SPF `-all`, DKIM (selektor `zone`), DMARC `p=none`.

14.09 hommikul läks **36 kirja kahe tunni sees** (käsitsi klikkides). Tunnivärav
on ehitatud just selle vastu. 15.09 automaatjooks: 09→5, 10→3, 11→5, 12→3.
Puhangut ei tekkinud.

---

## 5. Loobumine — kaks peent, kallist vahet

**ESS § 103¹**: kaubanduslik kiri peab olema äratuntav ja kandma toimivat
loobumisviisi. Loobumisrea paneb peale **server ise** (`POST /api/send` →
`lisaLoobumisrida`), mitte saatja — nii katab see ka inimese kliki.

**Müügi-ei EI OLE loobumisavaldus.** 14.09 summutas liiga lai muster
AS Papiniidu Projekti (Kaubamajakas) ära lause peale *„hetkel ei soovi teenust"*.
See on pakkumise tagasilükkamine. `onKirjadestLoobumine()` eristab neid.

**JavaScripti `\b` on ASCII-põhine.** `/\bärge saatke/` **ei taba** teksti
„palun ärge saatke", sest `ä` ei ole `\b` jaoks sõnatäht. See jätaks PÄRIS
loobumise tunnustamata — ainus suund, kuhu selles väravas eksida ei tohi.
`lib/sendgate.mjs` kasutab oma sõnapiiri, mis tunneb `äöüõšž`.

**Summutus käib DOMEENI kaupa.** Kirjutasime `info@firma.ee`-le, loobumise
saatis kolleeg `digimeedia@firma.ee`. Aadressipõhine summutus oleks lasknud
järgmise kirja ikka läbi.

---

## 6. Järelkirjad — kaks puuet, ei rohkem

58% vastustest tuleb esimesest kirjast, **42% järelkirjadest**. Gert ei saatnud
ühtegi — pool võimalikest vastustest jäi olemasolevast torust võtmata.

```
külmkiri ──3 tööpäeva──▶ järelkiri 1 ──9 tööpäeva──▶ järelkiri 2 ──▶ vaikus
                         kaks leidu +                üks uus fakt
                         pakub tasuta A4             ja selge lõpp
```

Võrdlusandmed soovitavad 4–7 puudet. **Meie teeme kaks**, sest see arv tuleb
masspostitajatelt, kelle kiri on mall. Kolmas ilma uue faktita on müra.

**Raudne reegel: iga järelkiri kannab uut mõõdetud fakti.** `uusFakt()` võrdleb
mõõdetud signaali (`JSON-LD Organization: puudub`) kõigi varem öeldutega.

⚠️ **Uudsuse tunnus on signaal, MITTE number.** Esimene versioon otsis „ridu, kus
on number" — kolmas leid (*ettevõtte andmeid ei ole masinloetaval kujul*) ei
kanna ühtegi numbrit, aga on täiesti uus fakt.

Järelkiri **ei** küsi kohtumist, **ei** nimeta hinda, **ei** anna kõiki leide ära
(kaks tõendiks, ülejäänu on põhjus vastata), **ei** kasuta manust ega linki,
ja **ei arva eesnime rollipostkastist** (`katre@` → „Tere Katre", `info@` → „Tere").

---

## 7. Lõksud, mis on juba raha maksnud

**Seemnefail kirjutab andmebaasi üle igal serveri käivitusel.** `server.mjs`
kutsub `seed(db)` ja upsert kirjutab üle `name, seg, loc, regcode, turnover,
email, url, priority, offer, price, finding, why, angle, meet_day, lang, listid`.
`subject`/`body` ainult siis, kui `body IS NULL`. `status` jääb puutumata.

→ **Kirje kustutamine või ühendamine ilma seemnefaili parandamata ei püsi.**
Kasuta `win/kustuta-seemnest.mjs`. Sama lõks andis vale-rohelise värava: ma
rikkusin andmebaasi rea, aga seeme taastas selle enne, kui värav luges.

**`--uuesti` lipp hävitas 20 käsitsi kirjutatud kirja.** Generaator kirjutab
AINULT tühja peale. Käsitsi kiri kannab ligipääsetavuse rikkumisi ja failinimesid,
mida masinloetav mõõtmine ei näe — see on alati rikkalikum. Lipp on eemaldatud ja
värav keelab tagasituleku.

**`node:sqlite` ei ava `$HOME/mnt` all olevat WAL-baasi Linuxi VM-ist**
(`disk I/O error`). Päris andmebaasi lugevad väravad jooksuta **Windowsist**
(`npm test`), mitte `device_bash`-ist. Ajutised andmebaasid → `os.tmpdir()`,
mitte `data/` (mnt-kettal ei saa faile kustutada, jäänuk lõhub järgmise jooksu).

**cmd.exe lõksud** on kirjas `win/README.md`-s. Lühidalt: `node -e "..."`
jutumärgid söödakse ära — kirjuta päris `.mjs` fail.

**CSS-i spetsiifilisus.** `.field.fill > :last-child { min-height: 0 }` on (0,3,0)
ja võidab iga (0,2,1) reegli, ükskõik mis järjekorras. Vastusekasti tekstiväli
kahanes 26 px-ni ja jäi jaluse taha peitu.

**Grid-veeru vaikimisi alampiir on `min-content`** — üks pikk e-posti aadress
venitas parema tulba 459 px-ni 419 px raamis. Alati `minmax(0, 1fr)` + `min-width: 0`.

---

## 8. Agendikiht ja kulu

MCP-server `agent/mcp-server.mjs`, kolm režiimi (`mcp.json` read,
`mcp.write.json` write, `mcp.fixture.json` test). Read: 7 tööriista.
Write: +10. **Saatmistööriista ei ole üheski.**

Konduktor `agent/conductor.mjs` (E–R 07:50) paneb tööd järjekorda:
eelfilter (tasuta) → triaaž (haiku) → mustandid (sonnet) → kokkuvõte `data/digest.md`.

Mõõdetud 15.09: **10,24 $ kulu, 0 € tulu.** Triaaž oli 6,20 $ ehk 57%.
34% sissetulevast postist on masinaadressid ja automaatvastused, mille
`lib/eelfilter.mjs` lahendab **tasuta** (~2,53 $ sama mahu juures).

⚠️ **Raha ei lähe kunagi eelfiltrist läbi.** Esimene versioon oleks visanud
„uudiskirjaks" viis päris arvet `no-reply@zone.ee`-lt (Gerti majutaja).
Arved **tulevadki** masinaadressilt. Üks tähelepanuta jäänud maksemeeldetuletus
maksab rohkem kui kõik säästetud mudelikutsed kokku.

⚠️ **„auto" üksi ei tohi tabada.** Esimene automaatvastuse muster tabas
„Automaatika uudised" ja „Re: Auto müük" — torus ON Osaühing Import Auto.
Nõutakse täielikku sõna või koolonit (`Auto:`).

---

## 9. Ajastatud ülesanded (Windows)

> Ajakavad allpool on 15.09 seis. Kehtiv ajakava on `win/README.md` ja `win/install-*.ps1`.

```powershell
.\win\install-saatja.ps1            # saatja + järelkirjad + loobumised
.\win\install-saatja.ps1 -Eemalda   # kõik välja
.\win\install-konduktor.ps1         # triaaž ja mustandid
```

| Ülesanne | Millal |
|---|---|
| `Leisson CRM konduktor` | E–R 07:50 |
| `Leisson CRM loobumised` | iga päev 08:30 |
| `Leisson CRM saatja` | E–R iga tund 09–16 |
| `Leisson CRM jarelkirjad` | E–R 10:30 |

`LogonType Interactive` — vajab sisselogitud kasutajat, paroole ülesandesse
ei kirjutata.

---

## 10. Käsud, mida päriselt kasutad

```powershell
npm test                      # KÕIK väravad, peab olema 0 kukkumist
node win	ohusus.mjs          # mõõdetud tõhusus: toru, raha, agendikulu, puhangud
npm run saatja:seis           # kes järjekorras, kes välja jääb ja miks
npm run jarelkiri:kuiv        # näitab täpse teksti, mis välja läheks
node win\saatmislugu.mjs      # kogu saatmislugu koos vahedega
node win\moot-masinloetav.mjs # mõõda torus olevad lehed (KAARDI JA JÄRELKIRJA ALUS)
node win\kaart.mjs <id>       # nähtavuskaart -> data\kaardid\<id>.html
node win\kirjuta-kylmkirjad.mjs --tee    # kirjad neile, kellel on leid ja kiri puudub
node win\uhenda-kirje.mjs <jääb> <kaob> --tee   # duplikaadi ühendamine
node win\kustuta-seemnest.mjs <id> --tee        # ...ja seemnest eemaldamine
```

**`data/mootmised-masinloetav.json` on kogu masina vundament.** Sellest sõltuvad
nähtavuskaart, järelkirjad ja sihtmärkide nimekiri. Vana või puudu → järelkirjade
värav ütleb „mõõtmist ei ole" ja ei saada midagi. See on tahtlik.

---

## 11. Seis 15.09.2026

- 111 ettevõtet · 61 külmkirja saadetud · 10 vastanut (16,4%) · 7 inimvastust
- **0 € laekunud.** Ainus arve 2026-001 (1900 €) on tühistatud.
- Agendikulu kokku 10,24 $
- Järjekorras 19 valmis kirja; 14 ilma kirjata; 17 ilma e-postita
- Järelkirju saadetud 0 — esimesed tulevad 17.09
- Inimese klikki ootab 3 mustandit

**Lähim euro ei ole uus külmkiri.** 45 kirja andsid 9 vastust ja 0 eurot.
Redeli aste 1 (290 €) ei ole veel kellelegi pakutud peale Pärnu Muuseumi.

---

## 12. leisson.eu

Sait elab eraldi repos `leisson-site` (mitte selles repos); allolev on 15.09 seis: repo `LEISSON-DARKSSON/leisson-greative`, Vercel projekt `leisson-creative`.
Disainisüsteem **Orbit** — skill `leisson-orbit-ds` (tokenid, komponendid,
väravad, ET/EN).

**Väljalase:** `git push origin main:release/production`. Production Branch on
`release/production`; `main` teeb ainult eelvaateid. Gert on andnud püsiva
õiguse seda ise teha — Desktop Commanderi kaudu tema masinal.

**Vercel lükkab tagasi `gertleisson-sys` autorluse** — commit peab olema
autoriks LEISSON / `gertleisson@gmail.com`.

CRM-i logo ja allkiri tulevad samast sõnamärgist (`lib/logo.mjs`):
LEISSON + CREATIVE tihedalt koos, alarida „AI-Augmented Workflows and Design
Systems". Registrikoodi alareal EI OLE (see on arve Müüja plokis, RPS § 7).
Monokroomne: halli tohib kasutada ainult mustal aluspinnal.

---

## 13. Mida MITTE teha

- Ära anna agendile saatmistööriista. Mitte kunagi, mitte ajutiselt.
- Ära kirjuta kirja ilma mõõtmiseta.
- Ära tõsta päevalimiiti üle 40 ilma uue mõõtmiseta — ja mitte kunagi ilma tunnilimiidita.
- Ära kustuta ega ühenda kirjet ilma seemnefaili parandamata.
- Ära kirjuta generaatoriga käsitsi tehtud kirja peale.
- Ära lisa hinda teise faili. Ära lisa kaht hinda samasse kirja.
- Ära usu rohelist väravat, mida sa ei ole sabotaažiga kontrollinud.
