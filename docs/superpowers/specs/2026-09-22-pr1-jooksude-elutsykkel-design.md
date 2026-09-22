# PR1 — jooksude elutsükkel ja RSS-taastumise terviklus

Kuupäev: 22.09.2026 · Repo `leisson-crm` · haru `main` @ `f3d8b3e`
Allikas: väline lähtekoodiaudit (kontrollitud GitHubi `main` peal, CI offline+browser roheline), promoteeritud brainstorm-sessiooni kaudu.
Ulatus: kolm sõltumatut, koodist kontrollitud viga jooksude/RSS-i eluringis. Ei puuduta riigihangete v2 arhitektuuri (`docs/plans/2026-09-22-riigihanked-v2-design.md`) ega selle E0–E5 järjekorda — see on iseseisev, väiksem parandustöö, mille audit soovitas teha esimesena.

## 0. Kontekst ja kontrollitud tõendid

Kõik kolm viga on selles sessioonis otse koodist üle kontrollitud (mitte ainult auditi väitest üle võetud):

- `lib/hanked-runs.mjs:325-344` (`cleanupOrphans`)
- `agent/hanked-sync.mjs:163-166,205-230` (`OTSE_BOOT`, `alustaOtseJooks`)
- `agent/hanked-sync.mjs:288-299,369` (`eelmineAndis`/`tyhjenes`)
- `lib/hanked.mjs:68-70` (`hanke_sync` skeem)
- `lib/hanked-runs.mjs:111-153,190-268` (`startRun`, `lapseKuulajad`, `lopeta`)
- `agent/hanked-sync.mjs:395-441` (`lopetaOtseJooks` kutsekoht)

## 1. Viga A — `cleanupOrphans` orbustab elavaid otse-jookse

**Fail:** `lib/hanked-runs.mjs:325-344`

**Praegune käitumine:** iga `hanke_runs` rida olekus `käib`, mille `boot_id ≠ server.BOOT_ID`, märgitakse serveri käivitumisel katkestatuks — **ilma pid-i elususe kontrollita**. Otse-/ajastatud jooksudel on `boot_id` kujul `'otse:' + uuid` (`agent/hanked-sync.mjs:166`, konstant `OTSE_BOOT`); selline `boot_id` ei saagi kunagi serveri `BOOT_ID`-ga kokku langeda, seega tabab tingimus **iga otse-jooksu, alati**, olenemata sellest, kas protsess tegelikult elab.

**Tagajärg:** ajastatud ajalooimport töötab → CRM-i server käivitub/taaskäivitub → import märgitakse katkestatuks, kuigi ta ise jätkab tööd → osalise unikaalindeksi (`idx_runs_kaib ON hanke_runs(cmd) WHERE state='käib'`) kaitse kaob selle rea alt → teine sama `cmd` jooks saab alustada paralleelselt.

**Oluline leid selles sessioonis:** täpselt õige elususekontrolli muster **on juba repos olemas**, teises kohas. `alustaOtseJooks` (`agent/hanked-sync.mjs:205-230`) teeb oma lukukonflikti lahendamisel täpselt seda, mida `cleanupOrphans` peaks tegema:

```js
const meieOrb =
  Boolean(kaib) &&
  String(kaib.boot_id || "").startsWith(OTSE_BOOT) &&
  !elab(nr(kaib.pid));
```

See tähendab: `cleanupOrphans` ei vaja uut disaini, vaid olemasoleva mustri ülekandmist.

**Parandus:**

```
kui r.boot_id algab OTSE_BOOT-iga:
    kui alive(pid) → JÄTA PUUTUMATA (elav sõltumatu jooks; ei ole meie orb)
    muidu          → märgi katkestatuks, põhjus: 'Otsejooks suri (pid ei ela)'
muidu, kui r.boot_id !== bootId (võõra serveri-instantsi rida):
    märgi katkestatuks nagu praegu, põhjus muutumatu.
    (Siin JÄÄB pid-i mitte-kontrollimine tahtlikuks — vt allpool.)
muidu (meie oma serveri-instantsi rida):
    olemasolev käitumine muutumatu (pid puudub / ei ela → katkestatud).
```

**Miks võõra-serveri harus pid-i ei kontrollita (teadlik otsus, mitte unustus):** kui `boot_id` kuulub eelmisele serveri-instantsile, ei ole meil garantiid, et sama pid tähistab sama protsessi — server võib olla taaskäivitatud OS-i poolt pid-de ringlusega vahepeal. See on sama põhjendus, mis on juba `stopRun`-i kommentaaris (`:304-305`, „VOORAST PID-I EI TAPETA"). Otse-jooksude puhul see risk erineb: `OTSE_BOOT` prefiksiga rida tekib **samas** masinas jooksva sõltumatu protsessi kohta, ilma serveri restardi vahenduseta, seega pid-kontroll on seal usaldusväärsem samas ulatuses, mis `alustaOtseJooks` juba usaldab.

**Teadlik jääkrisk (nimetatud, mitte lahendatud):** teoreetiline pid-taaskasutus ka otse-jooksu harus — kui pid vahepeal mõne teise protsessi kätte läheb, näitab `elab(pid)` valesti "elus". Sama riskiklass mis mujal repos aktsepteeritud; tagajärg siin on väiksem (vale "käib" näit UI-s), mitte vale `kill()`.

**Teostuslik märkus (avastatud selle spec-i kirjutamisel):** `OTSE_BOOT` on praegu defineeritud `agent/hanked-sync.mjs`-is, mis **impordib** `lib/hanked-runs.mjs`-ist (`finishRun, LOG_MAX, CMD`). Otseimport vastupidises suunas tekitaks ringimpordi. Lahendus: **tõsta `OTSE_BOOT` konstant `lib/hanked-runs.mjs`-i** (madalama taseme moodul) ja `agent/hanked-sync.mjs` impordib selle sealt edasi — see järgib olemasolevat sõltuvussuunda (`lib/` ei impordi `agent/`-ist).

**Regressioon (uus fail `test/gate-hanked-runs-elutsykkel.mjs`):**

1. Fixture-baasi loomine, `hanke_runs` rida `boot_id='otse:test'`, `pid=process.pid` (oma protsess, garanteeritult elus), `state='käib'`.
2. `cleanupOrphans(db, {bootId:'server-uus'})` → rida jääb `käib`-olekusse.
3. Teine sama `cmd` katse `startRun`/`alustaOtseJooks`-i kaudu → saab lukuvastuse (409 / "käib juba"), mitte edu.
4. Sama, aga `pid` võltsitud surnuks (`alive: () => false`) → rida märgitakse katkestatuks, põhjusega.
5. Sabotaaž: eemalda `OTSE_BOOT`-kontroll koodist → test 2 läheb punaseks (elav jooks kaotab kaitse).

## 2. Viga B — RSS-tühjenemise valve loeb iseennast

**Failid:** `lib/hanked.mjs:68-70` (skeem), `agent/hanked-sync.mjs:85-95,283-299,369`

**Praegune käitumine:** `hanke_sync` on üks-rida-per-`key` tabel (`key TEXT PRIMARY KEY`), `SYNC_SQL` teeb `ON CONFLICT(key) DO UPDATE` iga jooksu kohta. `eelmineAndis` (`:288`) loeb **sama rea**, mille see jooks kohe pärast üle kirjutab (`:373`).

**Tagajärg — mõõdetud järjestus:**

| Katse          | Tulemus  | Salvestatav `ok`                                                           |
| -------------- | -------- | -------------------------------------------------------------------------- |
| viimane edukas | 6 kirjet | `1`                                                                        |
| 1. tühi katse  | 0 kirjet | `0` (`tyhjenes=true`, sest eelmine `ok=1,rows>0`)                          |
| 2. tühi katse  | 0 kirjet | **`1`** (eelmine on juba `ok=0` → `eelmineAndis=false` → `tyhjenes=false`) |

Süsteem kuulutab taastumise välja ainult sellepärast, et sama probleem kordus.

**Parandus:** kaks uut veergu, mis kajastavad **viimast teadaolevat head seisu**, eraldi jooksu enda viimasest katsest:

```sql
ALTER TABLE hanke_sync ADD COLUMN last_good_ts TEXT;
ALTER TABLE hanke_sync ADD COLUMN last_good_rows INTEGER;
```

Loogika (`agent/hanked-sync.mjs`):

```js
const eelmine = db
  .prepare("SELECT rows, ok, last_good_rows FROM hanke_sync WHERE key = ?")
  .get(VOTI);
const eelmineAndis = Boolean(eelmine && eelmine.last_good_rows > 0); // MITTE eelmine.rows/ok
const tyhjenes = eelmineAndis && read.length === 0;

// kirjutamisel:
const lastGoodRows =
  read.length > 0 ? read.length : (eelmine && eelmine.last_good_rows) || null;
const lastGoodTs =
  read.length > 0 ? nowIso() : (eelmine && eelmine.last_good_ts) || null;
```

`last_good_*` muutub **ainult** siis, kui `read.length > 0`; muidu kandub vana väärtus edasi muutumatuna, sõltumata sellest, mitu tühja katset vahele jääb.

**Migratsioon:** `ALTER TABLE ... ADD COLUMN` `NULL`-vaikeväärtusega, olemasoleva `lisaVeerg`-mustriga (sama mis repos mujal — idempotentne, kontrollib veeru olemasolu enne lisamist). Olemasolev rida saab `last_good_rows = rows kui ok=1, muidu NULL` ühekordse backfill-lausega.

**Regressioon (laiendus olemasolevale `test/gate-hanked.mjs` sync-osale või uus `test/gate-hanked-sync-tyhjenemine.mjs`):**

1. edukas (6) → tühi → tühi: **teine tühi peab jääma `tyhjenes=true`**.
2. edukas → võrguviga (erind) → tühi: `last_good_rows` ei tohi võrguvea pealt muutuda; järgnev tühi loeb ikka vana head baseline'i.
3. edukas → tühi → edukas (6): taastumine tuvastatakse õigesti, `last_good_*` uueneb.
4. Sabotaaž: kirjuta `eelmineAndis` tagasi vana kujule (`eelmine.rows/ok`) → test 1 läheb punaseks.

## 3. Viga C — server-käivitatud jooksu tulemus ei loe `tyhjenes`-t

**Fail:** `lib/hanked-runs.mjs:190-268` (`lapseKuulajad`, `lopeta`)

**Praegune käitumine:** `lisaRida` (`:225-238`) parsib lapse stdout JSON-ridadest `progress`, `rows`, `error` — **mitte `tyhjenes`**. `lopeta(kood, signaal)` (`:255-263`) arvutab `ok = kood === 0 && !signaal`, puhtalt väljumiskoodist. Laps (`agent/hanked-sync.mjs` `main()`, `:395-441`) ei sea `process.exitCode`-i tühja-feedi harus (ainult `catch`-plokk `:445` seab `1`) — tühjenemise harul jõutakse `return`-ini normaalse `exitCode=0`-ga.

**Tagajärg:** kui sama sünk käivitatakse CRM-i nupu (server spawnib lapse) kaudu ja feed tühjeneb, siis:

- otse-käivituse tee (`lopetaOtseJooks`, `:434-439`) annaks `ok: !tyhjenes` = `false`
- server-käivituse tee annab `ok: kood===0` = `true`

Sama sündmus, kaks eri `hanke_runs.state` väärtust, olenevalt käivitajast.

**Parandus (minimaalne, valitud lahendusena — mitte eraldi jagatud "outcome" moodul):** `lisaRida` loeb JSON-väljalt lisaks `tyhjenes` boolean'i ja hoiab viimast nähtud väärtust suletuna `lapseKuulajad`-i skoopi (sama muster mis `lapseViga`-l juba on, `:225-230`). `lopeta` arvestab seda:

```js
let lapseTyhjenes = false;
// lisaRida sees, done:true sõnumi juures:
if (o.tyhjenes === true) lapseTyhjenes = true;

// lopeta sees:
const ok = kood === 0 && !signaal && !lapseTyhjenes;
finishRun(db, id, {
  ok,
  error: ok
    ? null
    : lapseTyhjenes
      ? "Feed tühjenes — vaata hanke_sync rida"
      : signaal
        ? "Protsess sai signaali " + signaal
        : "Protsess lõppes koodiga " + kood,
});
```

See peegeldab täpselt `lopetaOtseJooks`-i olemasolevat lepingut (`agent/hanked-sync.mjs:434-439`) — sama tähendus, kaks kutsekohta, nüüd üks tulemus.

**Regressioon (sama uus fail mis §1, või `test/gate-hanked-sync-tyhjenemine.mjs`):**

1. `startRun`/serveri-simulatsioon: laps kirjutab stdout'i `{"done":true,"rows":0,"tyhjenes":true}`, lõpeb koodiga `0` → `hanke_runs.state` peab olema `'viga'`, `error` sisaldama „tühjenes".
2. Sama, `tyhjenes:false`, kood `0` → `state='tehtud'` (olemasolev käitumine muutumatu — mitte-regressioon).
3. Sabotaaž: eemalda `!lapseTyhjenes` kontroll → test 1 läheb punaseks.

## 4. Mis jääb tahtlikult välja

- Claude autentimisfaili kontopõhine lukk, worker'i päevaeelarve atomaarsus, hanked-lapse env-lubaloend — audit's PR2/PR5, eraldi disain ja eraldi PR.
- `tools/varav.mjs` aegunud kommentaar `test/gate.mjs` kohta — juba parandatud `docs/plans/2026-09-22-riigihanked-v2-design.md` §E0.10 all; teostatakse selle plaani E0 käigus, mitte siin.
- Ühine masinloetav "run outcome" leping mitme kutsekoha jaoks — kaalutud, lükatud tagasi minimaalse läpi kasuks (vt §3 valik).
- B1 ajaloo kalibreering — puutumata.
- Riigihangete v2 arhitektuur (ESPD, XLSX, otsustuspakett) — eraldi dokument, eraldi voor.

## 5. Vastuvõtutingimused (kokkuvõte)

| #   | Tingimus                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | Elav otse-jooks jääb `käib`-olekusse üle serveri taaskäivituse; surnud otse-jooks märgitakse katkestatuks nähtava põhjusega; võõra-serveri rea käitumine muutumatu |
| B   | Kaks järjestikust tühja RSS-jooksu annavad mõlemad `tyhjenes=true`; taastumine tuvastatakse ainult päris mittetühja loendi pealt                                   |
| C   | Sama tulemus (`tyhjenes`) annab sama `hanke_runs.state` olenemata käivitajast (nupp vs otse)                                                                       |
| —   | Kõik kolm väravad (`node tools/varav.mjs --ainult=hanked` laiendatuna uue failiga) rohelised; sabotaažitest iga uue reegli kohta punaseks ja tagasi                |
| —   | `npm run varav:range` roheline enne PR-i                                                                                                                           |

## 6. Failid, mida see töö puudutab

```
lib/hanked-runs.mjs        -- cleanupOrphans (A), lapseKuulajad/lopeta (C), OTSE_BOOT tõstmine siia
agent/hanked-sync.mjs      -- OTSE_BOOT import lib/hanked-runs.mjs-ist (A), eelmineAndis/SYNC_SQL (B)
lib/hanked.mjs             -- hanke_sync skeem: last_good_ts, last_good_rows (B)
test/gate-hanked-runs-elutsykkel.mjs   -- uus, katab A + C
test/gate-hanked-sync-tyhjenemine.mjs  -- uus, katab B
```

Rakenduskoodi selles spec-is ei ole — see kirjutatakse `writing-plans` etapis.

---

## Järelparandus PR1b (22.09.2026, väline audit PR #3 peale)

PR #3 (`72bad8c`) merge järel leidis sõltumatu audit kolm kitsast järelviga sama
alamsüsteemi sees. Kõik kolm on parandatud samas voorus, kood ja testid
uuendatud, committitud (68901e7) ja merge'itud (PR #4, d7e0924). See EI tõenda
tootmisse rakendamist (Windowsi peakoopia/ajastaja/tootmismigratsioon on
eraldi, kontrollimata sammud).

- **F1 (P1):** `lisaVeerg` lisas `last_good_ts`/`last_good_rows` NULL-ina — vana
  (enne PR1) või PR3-järgne (veerud olemas, aga NULL) edukas rida kaotas oma
  tõendatud lähtejoone. Parandus: `migrateHanked` lisab idempotentse backfilli
  (`WHERE last_good_rows IS NULL AND ok = 1 AND rows > 0`), mis kannab rea ENDA
  vana `ts`-i üle, mitte migratsiooni praegust aega, ja ei fabritseeri
  lähtejoont vigasest/tundmatust katsest.
- **F2 (P1):** `SYNC_SQL` kontrollis last_good_* uuendamisel ainult `rows > 0`,
  mitte ka `ok = 1` — ebaõnnestunud, aga positiivse reaarvuga katse (nt
  `syncFromXml` catch pärast `ROLLBACK`, mis kutsub `logiSyncKindel({rows:
  read.length, ok: 0})`) kirjutas vale lähtejoone üle. Parandus: CASE
  kontrollib nüüd mõlemat tingimust (`rows > 0 AND ok = 1`, vastavalt
  `excluded.ok = 1` ON CONFLICT harus).
- **F3 (P2):** `lib/hanked-runs.mjs` `elab()` ja `agent/hanked-sync.mjs`
  `pidElab()` käsitlesid EPERM-i erinevalt — `elab()` puudis IGA erindi
  surmana, `pidElab()` ainult ESRCH-i. Parandus: üks madalama taseme kontroll
  (`lib/hanked-runs.mjs` eksporditud `elab`), mis annab ELUS igal juhul peale
  ESRCH-i (sh EPERM JA tundmatu viga) — `agent/hanked-sync.mjs` impordib sama
  funktsiooni aliasega `pidElab`.

**Testid:** `test/gate-hanked.mjs` (F1: M1–M4; F2: B3, B3-ts, B4, B5, B6,
tühi-baas, võrguviga-juht), `test/gate-hanked-runs.mjs` (F3: blokk Q, sh A2
regressioonijuht `alustaOtseJooks` vaikeparameetriga). Kõik kolm parandust
sabotaaži-kontrollitud (murdmine → punane täpsel kaitstaval väitel → taastamine
→ roheline). `node tools/varav.mjs --ainult=hanked`: 12 OK · 0 kukkus.
`npm run varav:range`: 43 OK · 0 kukkus (sama baastulemus mis enne PR1b-d).

**Jääkriskid:** olemasolev, PR1b poolt puutumata rikutud lähtejoon (nt
tootmisandmestikus juba ok=1 rida, mille last_good_* on vale muu tundmatu
põhjuse tõttu) ei taastu — backfill usaldab ainult `ok=1 AND rows>0`
tingimust, mitte tabeli praegust `COUNT(*)`-i ega oletatavat `ts`-i. `hanke_sync`
`eelmine` SELECT-i tarbetu `rows`/`ok` valik (viidatud PR1 enda code review'is)
jääb endiselt puudutamata — kosmeetiline, mõjuta käitumist.
