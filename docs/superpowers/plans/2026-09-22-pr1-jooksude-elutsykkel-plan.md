# PR1 — jooksude elutsükkel ja RSS-taastumise terviklus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** parandada kolm sõltumatut, koodist kontrollitud viga riigihangete jooksude/RSS-i eluringis: elava otsejooksu vale orbustamine serveri taaskäivitusel, RSS-tühjenemise valve, mis loeb iseennast, ja server-käivitatud jooksu tulemus, mis ei loe lapse `tyhjenes`-teadet.

**Architecture:** kõik kolm parandust on lokaalsed, olemasolevaid mustreid taaskasutavad muudatused kahes failis (`lib/hanked-runs.mjs`, `agent/hanked-sync.mjs`) + üks skeemi lisandus (`lib/hanked.mjs`, `lisaVeerg`-mustriga). Ei uut moodulit, ei uut sõltuvust, ei muudetud avalikku API-t peale kahe uue eksporditud konstandi/veeru.

**Tech Stack:** Node.js (`node:sqlite`, `node:child_process`, `node:assert/strict`), olemasolev repo testimuster (`test/gate-*.mjs`, plain assert-skriptid, `node tools/varav.mjs`).

**Spec:** `docs/superpowers/specs/2026-09-22-pr1-jooksude-elutsykkel-design.md`

---

## Enenõutav kontekst (loe enne alustamist)

- `lib/hanked-runs.mjs` — jooksude käivitaja, lapse stdout-kuulaja, orbude koristus. Ei impordi kusagilt `agent/`-i alt (madalama taseme moodul).
- `agent/hanked-sync.mjs` — RSS→baas süngija. Impordib `lib/hanked-runs.mjs`-ist (`finishRun, LOG_MAX, CMD`). **Impordisuund on tähtis:** `lib/` ei tohi kunagi importida `agent/`-ist, muidu tekib ringimport.
- `test/gate-hanked-runs.mjs` — jooksude elutsükli olemasolev värav, 574 rida, lettered blokid A–M ja R. Kasutab **päris lapsprotsesse** (mitte mocke) `close`/`exit` järjestuse, logipuhverduse ja topeltkirjutaja testimiseks — vt faili päise kommentaari, miks.
- `test/gate-hanked.mjs` — RSS-süngi olemasolev värav. Blokid Z5/Z5b juba testivad tühjenemise valvet, aga **mitte** kahe järjestikuse tühja jooksu juhtumit (see on täpselt auditi leitud auk).
- Kõik testid jooksevad otse: `node test/gate-hanked-runs.mjs`, `node test/gate-hanked.mjs`. Väravate koondkäsk: `node tools/varav.mjs --ainult=hanked`.
- `npm test` käivitab `test/gate.mjs`-i (fixture-baasil, vt parandust `docs/plans/2026-09-22-riigihanked-v2-design.md` §T7) + `test:offline`-ahela. **See käivitub automaatselt igal `git commit`-il** (kasutajataseme `PreToolUse` konks). Ära ürita seda vältida — kui see kukub sinu muudatuse tõttu, paranda, ära commiti `--no-verify`-ga.

---

## Task 1: `cleanupOrphans` ei tohi elavat otsejooksu orbustada

**Files:**

- Modify: `lib/hanked-runs.mjs:28-30` (uus eksport `OTSE_BOOT`), `lib/hanked-runs.mjs:321-344` (`cleanupOrphans`)
- Modify: `agent/hanked-sync.mjs:23` (import), `agent/hanked-sync.mjs:163-166` (kohaliku konstandi eemaldus + re-eksport)
- Test: `test/gate-hanked-runs.mjs` (uus blokk "N", lisatud pärast blokki H)

### Miks re-eksport on kohustuslik

`test/gate-hanked.mjs:16-17` impordib juba täna `OTSE_BOOT`-i `'../agent/hanked-sync.mjs'`-ist:

```js
import {
  syncFromXml,
  logiSync,
  avaBaas,
  logiSyncKindel,
  baasiViga,
  alustaOtseJooks,
  lopetaOtseJooks,
  OTSE_BOOT,
} from "../agent/hanked-sync.mjs";
```

Kui `OTSE_BOOT` kolib `lib/hanked-runs.mjs`-i ja `agent/hanked-sync.mjs` ei ekspordi teda enam samast kohast, läheb see olemasolev import katki. Seetõttu jääb `agent/hanked-sync.mjs` **re-eksportima** sama konstanti samast nimest — ükski olemasolev import ei muutu.

- [ ] **Step 1: Kirjuta ebaõnnestuv test (blokk N) `test/gate-hanked-runs.mjs`-i**

Ava fail, leia blokk H lõpp (rida ~351-354):

```js
  assert.ok(r.id && r3.id);
  db.close(); db2.close(); db3.close(); db4.close();
  console.log('PASS runs: pid usaldatakse ainult koos boot_id-ga');
}

// ---------------------------------------------------------------------------
// I (p6): lapse enda veateade voidab uldise "Protsess loppes koodiga 1" ule.
```

Lisa vahele, kohe pärast `}` ja tühja rida enne `// --- I` kommentaari, uus blokk:

```js
// ---------------------------------------------------------------------------
// N (audit P1, 22.09.2026): OTSE_BOOT-prefiksiga rida on SÕLTUMATU jooks (Task
// Scheduler / käsurida), mitte serveri laps. cleanupOrphans margib täna IGA
// boot_id !== bootId rea orbuks pid-i kusimata (vt blokk H) - aga otsejooksu
// boot_id ei saagi KUNAGI serveri BOOT_ID-ga klappida, seega tabas see reegel
// elavaid otsejookse ALATI. alustaOtseJooks (agent/hanked-sync.mjs) juba
// eristab OTSE_BOOT-prefiksit ja kontrollib pid-i - cleanupOrphans peab tegema
// sama.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const jooks = alustaOtseJooks(db, { pid: process.pid, elab: () => true });
  assert.equal(
    jooks.pohjus,
    null,
    "esimene otsejooks peab algama takistuseta: " + jooks.pohjus,
  );

  // Serveri taaskaivitus UUE boot_id-ga ei tohi elavat otsejooksu puutuda.
  const n = cleanupOrphans(db, {
    bootId: "server-uus-boot-id",
    alive: () => true,
  });
  assert.equal(n, 0, "elav otsejooks ei ole orb");
  assert.equal(
    db.prepare("SELECT state FROM hanke_runs WHERE id = ?").get(jooks.id).state,
    "käib",
    "elav otsejooks peab jääma käib-olekusse üle serveri taaskäivituse",
  );

  // Kaitse ei tohi olla kadunud: teine sama käsu katse peab endiselt lukku austama.
  const teine = alustaOtseJooks(db, { pid: process.pid, elab: () => true });
  assert.equal(
    teine.id,
    null,
    "teine otsejooks sama käsu peale ei tohi alata, kui esimene on elus",
  );
  assert.match(
    teine.pohjus,
    /käib juba/,
    "lukk peab olema nähtav: " + teine.pohjus,
  );
  db.close();
  console.log(
    "PASS runs: elav otsejooks ei kaota kaitset serveri taaskäivitusel",
  );
}

// ---------------------------------------------------------------------------
// O (audit P1, 22.09.2026): surnud otsejooks EI TOHI jääda igaveseks 'käib'-
// olekusse kinni - ilma serverita ei koristaks teda kunagi keegi teine.
// ---------------------------------------------------------------------------
{
  const db = testDb();
  const jooks = alustaOtseJooks(db, { pid: 999999, elab: () => true });
  assert.equal(jooks.pohjus, null);
  const n = cleanupOrphans(db, {
    bootId: "server-uus-boot-id",
    alive: () => false,
  });
  assert.equal(n, 1, "surnud otsejooks peab minema orbuks");
  const rida = db
    .prepare("SELECT state, error FROM hanke_runs WHERE id = ?")
    .get(jooks.id);
  assert.equal(rida.state, "katkestatud");
  assert.match(
    rida.error,
    /suri|ei ela/i,
    "põhjus peab olema nähtav: " + rida.error,
  );
  db.close();
  console.log("PASS runs: surnud otsejooks märgitakse katkestatuks");
}
```

Lisa import: leia rea 25 lähedal olev import `'../lib/hanked-runs.mjs'`-ist ja lisa selle **kõrvale** uus rida (ära muuda olemasolevat):

```js
import {
  CMD,
  BOOT_ID,
  LOG_MAX,
  RIDA_MAX,
  cmdView,
  startRun,
  finishRun,
  stopRun,
  cleanupOrphans,
  runsView,
} from "../lib/hanked-runs.mjs";
import { alustaOtseJooks } from "../agent/hanked-sync.mjs";
```

> **Märkus:** blokkides N ja O kasutatavad tähed järgivad faili olemasolevat "üks täht = üks juhtum" nummerdust (A–M, siis R). N ja O on esimesed vabad tähed pärast M-i.

- [ ] **Step 2: Käivita ja veendu, et test kukub praeguse koodi peal**

Run: `node test/gate-hanked-runs.mjs`

Expected: skript viskab `AssertionError`-i blokis N, teatega ligikaudu:

```
AssertionError [ERR_ASSERTION]: teine otsejooks sama käsu peale ei tohi alata, kui esimene on elus
```

(Praegune `cleanupOrphans` orbustab elava otsejooksu juba enne teist `alustaOtseJooks` kutset, seega `teine.id` ei ole `null`.) Skript lõpeb mittenulliga väljumiskoodiga, `'PASS runs: elav otsejooks...'` rida EI ilmu.

- [ ] **Step 3: Tõsta `OTSE_BOOT` `lib/hanked-runs.mjs`-i**

Fail: `lib/hanked-runs.mjs`, rida 30 (kohe pärast `BOOT_ID` definitsiooni):

Enne:

```js
// Serveri KAIVITUSE id. Uks protsess = uks vaartus. Vt migrateHanked kommentaari:
// pid uksi ei toesta, et jooks on meie oma.
export const BOOT_ID = randomUUID();
```

Pärast:

```js
// Serveri KAIVITUSE id. Uks protsess = uks vaartus. Vt migrateHanked kommentaari:
// pid uksi ei toesta, et jooks on meie oma.
export const BOOT_ID = randomUUID();

// Otsejooksu (Task Scheduler / kasurida, ilma serverita) boot_id-prefiks. See EI
// OLE ukski BOOT_ID vaartus, seega selliste ridade "oma" on alati false (vt
// runsView) ja "Peata" nuppu ei pakuta. Elab agent/hanked-sync.mjs
// alustaOtseJooks-is; cleanupOrphans kasutab sama prefiksit, et eristada
// soltumatut jooksu serveri-instantsi omast (vt cleanupOrphans allpool).
export const OTSE_BOOT = "otse:";
```

- [ ] **Step 4: Kirjuta ümber `cleanupOrphans`**

Fail: `lib/hanked-runs.mjs`, read 321-344.

Enne:

```js
// Orb = jooks, mille peale ei ole enam kedagi ootamas. Kaks pohjust:
//   1. rida kuulub TEISELE serveri-instantsile (boot_id ei klapi) - siis on ta orb
//      ALATI, olenemata pid-ist, ja pid-i EI KUSITA ega TAPETA;
//   2. rida on meie oma, aga protsessi enam ei ole.
export function cleanupOrphans(db, { alive = elab, bootId = BOOT_ID } = {}) {
  const read = db
    .prepare("SELECT id, pid, boot_id FROM hanke_runs WHERE state = 'käib'")
    .all();
  const margi =
    db.prepare(`UPDATE hanke_runs SET state = 'katkestatud', finished = datetime('now'),
      error = COALESCE(error, ?) WHERE id = ? AND state = 'käib'`);
  let n = 0;
  for (const r of read) {
    let pohjus = null;
    if (r.boot_id !== bootId) {
      pohjus = "Server taaskäivitati — eelmise serveri jooks jäi pooleli";
    } else if (!r.pid) {
      pohjus = "Server taaskäivitati — jooksul ei ole pid-i";
    } else if (!alive(nr(r.pid))) {
      pohjus =
        "Server taaskäivitati või protsess suri — pid " + r.pid + " ei ela";
    }
    if (!pohjus) continue;
    margi.run(pohjus, nr(r.id));
    n++;
  }
  return n;
}
```

Pärast:

```js
// Orb = jooks, mille peale ei ole enam kedagi ootamas. Kolm juhtu:
//   1. rida kannab OTSE_BOOT-prefiksit (sõltumatu jooks, Task Scheduler/kasurida) -
//      see EI SÕLTU serveri elueast, seega kontrollime PID-i elususe, mitte
//      boot_id vastavust. Sama muster mis agent/hanked-sync.mjs
//      alustaOtseJooks-is (audit P1, 22.09.2026 - vana kood tabas neid ALATI,
//      olenemata sellest, kas protsess elas);
//   2. rida kuulub TEISELE SERVERI-instantsile (boot_id ei klapi ega kanna
//      OTSE_BOOT prefiksit) - siis on ta orb ALATI, olenemata pid-ist, ja pid-i
//      EI KUSITA ega TAPETA (vt stopRun-i sama pohjendust: parast taaskaivitust
//      voib sama pid kuuluda kellelegi teisele);
//   3. rida on meie oma (sama boot_id), aga protsessi enam ei ole.
export function cleanupOrphans(db, { alive = elab, bootId = BOOT_ID } = {}) {
  const read = db
    .prepare("SELECT id, pid, boot_id FROM hanke_runs WHERE state = 'käib'")
    .all();
  const margi =
    db.prepare(`UPDATE hanke_runs SET state = 'katkestatud', finished = datetime('now'),
      error = COALESCE(error, ?) WHERE id = ? AND state = 'käib'`);
  let n = 0;
  for (const r of read) {
    const boot = String(r.boot_id || "");
    let pohjus = null;
    if (boot.startsWith(OTSE_BOOT)) {
      if (r.pid && alive(nr(r.pid))) continue; // elav otsejooks - jäta puutumata
      pohjus = "Otsejooks suri (pid ei ela)";
    } else if (boot !== bootId) {
      pohjus = "Server taaskäivitati — eelmise serveri jooks jäi pooleli";
    } else if (!r.pid) {
      pohjus = "Server taaskäivitati — jooksul ei ole pid-i";
    } else if (!alive(nr(r.pid))) {
      pohjus =
        "Server taaskäivitati või protsess suri — pid " + r.pid + " ei ela";
    }
    if (!pohjus) continue;
    margi.run(pohjus, nr(r.id));
    n++;
  }
  return n;
}
```

- [ ] **Step 5: Uuenda importi ja re-ekspordi `OTSE_BOOT` `agent/hanked-sync.mjs`-is**

Fail: `agent/hanked-sync.mjs`, rida 23:

Enne:

```js
import { finishRun, LOG_MAX, CMD } from "../lib/hanked-runs.mjs";
```

Pärast:

```js
import { finishRun, LOG_MAX, CMD, OTSE_BOOT } from "../lib/hanked-runs.mjs";
// OTSE_BOOT elab nüüd lib/hanked-runs.mjs-is (cleanupOrphans vajab sama
// prefiksit) - re-eksport, et olemasolevad importijad (test/gate-hanked.mjs)
// ei katkeks.
export { OTSE_BOOT };
```

Nüüd eemalda kohalik definitsioon, rida 166. Enne:

```js
// boot_id = 'otse:<uuid>'. See EI OLE ukski serveri BOOT_ID, seega runsView annab
// oma = false ja vaade ei paku "Peata" nuppu - ta ei tohikski, sest see pid ei
// kuulu serverile ja parast masina taaskaivitust voib ta kuuluda kellelegi teisele.
export const OTSE_BOOT = "otse:";
const OTSE_CMD = "sync";
```

Pärast:

```js
// boot_id = 'otse:<uuid>'. See EI OLE ukski serveri BOOT_ID, seega runsView annab
// oma = false ja vaade ei paku "Peata" nuppu - ta ei tohikski, sest see pid ei
// kuulu serverile ja parast masina taaskaivitust voib ta kuuluda kellelegi teisele.
// (OTSE_BOOT konstant ise elab lib/hanked-runs.mjs-is, imporditud ja
// re-eksporditud ülalt.)
const OTSE_CMD = "sync";
```

- [ ] **Step 6: Käivita test uuesti, veendu, et läbib**

Run: `node test/gate-hanked-runs.mjs`

Expected: kõik read `PASS runs: ...` read ilmuvad, sh uued `PASS runs: elav otsejooks ei kaota kaitset serveri taaskäivitusel` ja `PASS runs: surnud otsejooks märgitakse katkestatuks`. Väljumiskood 0.

- [ ] **Step 7: Veendu, et olemasolev blokk H ikka läbib muutumatult**

Run: `node test/gate-hanked-runs.mjs 2>&1 | grep "pid usaldatakse"`

Expected: `PASS runs: pid usaldatakse ainult koos boot_id-ga` — see tõestab, et võõra-serveri-rea (mitte OTSE_BOOT) haru käitub endiselt täpselt nagu enne (pid-i ei küsita, `aliveKutsuti` jääb 0-ks).

- [ ] **Step 8: Veendu, et `test/gate-hanked.mjs` import ei katkenud**

Run: `node test/gate-hanked.mjs`

Expected: kõik `PASS hanked: ...` read, väljumiskood 0. (See fail impordib `OTSE_BOOT`-i `agent/hanked-sync.mjs`-ist — kontrollib, et re-eksport töötab.)

- [ ] **Step 9: Commit**

```bash
git add lib/hanked-runs.mjs agent/hanked-sync.mjs test/gate-hanked-runs.mjs
git commit -m "fix(hanked): cleanupOrphans ei tohi elavat otsejooksu orbustada

boot_id='otse:<uuid>' read (Task Scheduler / käsurida) ei saanud kunagi
klappida serveri BOOT_ID-ga, seega margis cleanupOrphans nad serveri
taaskäivitusel ALATI katkestatuks, olenemata pid-i elususest - see
kaotas ka osalise unikaalindeksi (idx_runs_kaib) kaitse elava jooksu
alt. OTSE_BOOT tõstetud lib/hanked-runs.mjs-i (agent/hanked-sync.mjs
re-ekspordib sama nime, et olemasolevad importijad ei katkeks) ja
cleanupOrphans kontrollib nüüd OTSE_BOOT-prefiksiga ridadel pid-i
elususe, mitte boot_id vastavust - sama muster, mis
alustaOtseJooks-i enda lukukonflikti lahendus juba kasutab.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: RSS-tühjenemise valve loeb iseennast

**Files:**

- Modify: `lib/hanked.mjs:68-70` (skeem), `lib/hanked.mjs:102` (migratsioon)
- Modify: `agent/hanked-sync.mjs:84-95` (`SYNC_SQL`, `logiSync`), `agent/hanked-sync.mjs:288-289` (`eelmine`/`eelmineAndis`), `agent/hanked-sync.mjs:369-373` (kirjutus + teate tekst)
- Test: `test/gate-hanked.mjs` (uus blokk "Z5c", lisatud pärast blokki Z5b)

### Miks SQL-põhine, mitte JS-põhine lahendus

Spetsifikatsioon kirjeldas JS-poolset `lastGoodRows = read.length>0 ? ... : eelmine.last_good_rows` arvutust. Täpsem kontroll koodis näitas, et `SYNC_SQL`-i `ON CONFLICT DO UPDATE` saab sama tulemuse **ühe SQL-lause CASE-avaldisega**, ilma et iga `logiSync`/`syncFromXml` kutsekoht peaks ise eelmist väärtust lugema ja edasi kandma. See on väiksem diff ja üks tõe allikas (SQL ise), mitte mitu kutsekohta, mis peavad sama loogikat kordama.

- [ ] **Step 1: Kirjuta ebaõnnestuv test (blokk Z5c) `test/gate-hanked.mjs`-i**

Leia blokk Z5b lõpp (umbes rida 1783-1786):

```js
  db.close(); db2.close();
  console.log('PASS hanked: tais feed ilma tulemusteta on punane');
}

// Z6 (K5): `updated` peab tahendama "midagi muutus", mitte "sunk nagi teda viimati".
```

Lisa vahele, kohe pärast `}` ja tühja rida enne `// Z6` kommentaari:

```js
// Z5c (audit P1, 22.09.2026): KAKS jarjestikust tyhja jooksu parast paris andmeid
// peavad MOLEMAD jaama punaseks. Vana kood luges eelmineAndis otse
// hanke_sync.rows/ok pealt, mille see JOOKS ISE kohe ule kirjutab - teine tyhi
// katse luges juba nullitud eelmist rida (ok=0) ja EELMINEANDIS lakkas olemast
// tosi, kuigi paris viimane HEA tulemus oli 5 rida. Tulemus: teine tyhi jooks
// naitas vale taastumist (ok=1) ilma uheainsa uue hanketa.
{
  const tyhi =
    '<?xml version="1.0"?><rss version="2.0"><channel><title>RHR</title></channel></rss>';
  const db = testDb();
  const r1 = syncFromXml(db, RSS_FIKSTUUR, { today: "2026-09-20" });
  assert.equal(r1.kokku, 5);
  assert.equal(
    db.prepare("SELECT ok FROM hanke_sync WHERE key='rss'").get().ok,
    1,
  );

  const r2 = syncFromXml(db, tyhi, { today: "2026-09-20" });
  assert.equal(
    r2.tyhjenes,
    true,
    "esimene tyhi parast paris andmeid on punane",
  );
  assert.equal(
    db.prepare("SELECT ok FROM hanke_sync WHERE key='rss'").get().ok,
    0,
  );
  assert.equal(
    db.prepare("SELECT last_good_rows FROM hanke_sync WHERE key='rss'").get()
      .last_good_rows,
    5,
    "viimane teadaolev hea baseline peab jääma 5-ks",
  );

  const r3 = syncFromXml(db, tyhi, { today: "2026-09-20" });
  assert.equal(
    r3.tyhjenes,
    true,
    "TEINE järjestikune tühi jooks peab OLEMA endiselt punane, mitte näitama vale taastumist",
  );
  assert.equal(
    db.prepare("SELECT ok FROM hanke_sync WHERE key='rss'").get().ok,
    0,
    "teine tühi ei tohi kirjutada ok=1",
  );
  assert.equal(
    db.prepare("SELECT last_good_rows FROM hanke_sync WHERE key='rss'").get()
      .last_good_rows,
    5,
    "baseline ei tohi tühja jooksu pealt muutuda",
  );

  const r4 = syncFromXml(db, RSS_FIKSTUUR, { today: "2026-09-20" });
  assert.equal(r4.tyhjenes, false);
  assert.equal(
    db
      .prepare("SELECT ok, last_good_rows FROM hanke_sync WHERE key='rss'")
      .get().ok,
    1,
  );
  assert.equal(
    db.prepare("SELECT last_good_rows FROM hanke_sync WHERE key='rss'").get()
      .last_good_rows,
    5,
  );
  db.close();
  console.log(
    "PASS hanked: kaks järjestikust tühja jooksu jäävad mõlemad punaseks",
  );
}
```

- [ ] **Step 2: Käivita ja veendu, et test kukub praeguse koodi peal**

Run: `node test/gate-hanked.mjs`

Expected: `AssertionError` blokis Z5c, teatega ligikaudu:

```
AssertionError [ERR_ASSERTION]: TEINE järjestikune tühi jooks peab OLEMA endiselt punane, mitte näitama vale taastumist
```

(Enne fixi ei ole `last_good_rows` veergu üldse olemas — tegelikult viskab esimene `SELECT last_good_rows FROM hanke_sync` juba `SqliteError: no such column: last_good_rows`. See on samuti oodatud "FAIL", lihtsalt teise veateatega. Mõlemad on õiged sabotaaži-tõendid: kood ei tööta, kuni parandus on tehtud.)

- [ ] **Step 3: Lisa skeemi kaks uut veergu**

Fail: `lib/hanked.mjs`, rida 100-102 (kohe pärast `lisaVeerg(db, 'hanked', 'docs_leiud', 'TEXT');`, enne `lepinguteVeerud(db);`):

Enne:

```js
lisaVeerg(db, "hanked", "docs_leiud", "TEXT");
lepinguteVeerud(db);
```

Pärast:

```js
lisaVeerg(db, "hanked", "docs_leiud", "TEXT");
// AUDIT P1 (22.09.2026): hanke_sync on uks-rida-per-key ja iga jooks kirjutab
// ta üle - eelmineAndis (agent/hanked-sync.mjs) luges TÄPSELT sama rida, mida
// ta kohe ise üle kirjutab, seega teine järjestikune tühi jooks kaotas jälje
// viimasest PÄRIS heast tulemusest. last_good_* uuenevad AINULT siis, kui
// read.length > 0 (vt SYNC_SQL) - baseline püsib muutumatuna suvalise arvu
// järjestikuste tühjade jooksude vältel.
lisaVeerg(db, "hanke_sync", "last_good_ts", "TEXT");
lisaVeerg(db, "hanke_sync", "last_good_rows", "INTEGER");
lepinguteVeerud(db);
```

- [ ] **Step 4: Uuenda `SYNC_SQL`-i ja `logiSync`-i**

Fail: `agent/hanked-sync.mjs`, read 84-95.

Enne:

```js
// hanke_sync.key on PRIMARY KEY (vt migrateHanked), seega ON CONFLICT(key) on
// olemas - kontrollitud migratsioonist, mitte eeldatud.
const SYNC_SQL = `INSERT INTO hanke_sync (key, ts, rows, ok, note)
    VALUES (?, datetime('now'), ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET ts = excluded.ts, rows = excluded.rows,
      ok = excluded.ok, note = excluded.note`;

// VIGANE JOOKS PEAB JATMA JALJE. Kui ebaonnestumine ei kirjuta midagi, naitab vaade
// eelmist edukat aega ja inimene arvab, et sunk tootab - vaikne rike on siin hullem
// kui punane rida. Seda kutsub ka main() vorguvea peal, kus syncFromXml-ini ei joutud.
export function logiSync(
  db,
  { rows = null, ok = 1, note = null, key = VOTI } = {},
) {
  migrateHanked(db);
  db.prepare(SYNC_SQL).run(key, rows, ok ? 1 : 0, note);
}
```

Pärast:

```js
// hanke_sync.key on PRIMARY KEY (vt migrateHanked), seega ON CONFLICT(key) on
// olemas - kontrollitud migratsioonist, mitte eeldatud.
//
// last_good_ts/last_good_rows (audit P1, 22.09.2026) UUENEVAD AINULT rows > 0
// korral - CASE avaldis sees. Kui rows on 0 voi NULL, kannab UPDATE vana
// hanke_sync.last_good_* vaartuse edasi MUUTUMATUNA (bare `hanke_sync.veerg`
// DO UPDATE SET sees viitab REA VANALE vaartusele, `excluded.veerg` uuele -
// standardne SQLite upsert-semantika). Seega ei kao "viimane teadaolev hea"
// jalg suvalise arvu jarjestikuste tuhjade jooksude all.
const SYNC_SQL = `INSERT INTO hanke_sync (key, ts, rows, ok, note, last_good_ts, last_good_rows)
    VALUES (?, datetime('now'), ?, ?, ?,
      CASE WHEN ? > 0 THEN datetime('now') ELSE NULL END,
      CASE WHEN ? > 0 THEN ? ELSE NULL END)
    ON CONFLICT(key) DO UPDATE SET
      ts = excluded.ts, rows = excluded.rows, ok = excluded.ok, note = excluded.note,
      last_good_ts = CASE WHEN excluded.rows > 0 THEN excluded.ts ELSE hanke_sync.last_good_ts END,
      last_good_rows = CASE WHEN excluded.rows > 0 THEN excluded.rows ELSE hanke_sync.last_good_rows END`;

// VIGANE JOOKS PEAB JATMA JALJE. Kui ebaonnestumine ei kirjuta midagi, naitab vaade
// eelmist edukat aega ja inimene arvab, et sunk tootab - vaikne rike on siin hullem
// kui punane rida. Seda kutsub ka main() vorguvea peal, kus syncFromXml-ini ei joutud.
export function logiSync(
  db,
  { rows = null, ok = 1, note = null, key = VOTI } = {},
) {
  migrateHanked(db);
  db.prepare(SYNC_SQL).run(key, rows, ok ? 1 : 0, note, rows, rows, rows);
}
```

- [ ] **Step 5: Uuenda `eelmineAndis`-t ja kirjutuskutset `syncFromXml`-is**

Fail: `agent/hanked-sync.mjs`, read 283-299.

Enne:

```js
const eelmine = db
  .prepare("SELECT rows, ok FROM hanke_sync WHERE key = ?")
  .get(VOTI);
const eelmineAndis = Boolean(eelmine && eelmine.ok === 1 && eelmine.rows > 0);
```

Pärast:

```js
const eelmine = db
  .prepare("SELECT rows, ok, last_good_rows FROM hanke_sync WHERE key = ?")
  .get(VOTI);
// AUDIT P1: eelmineAndis loeb last_good_rows-t, MITTE rows/ok-d - viimased
// kaks kannavad ainult VIIMASE KATSE tulemust, mille see jooks kohe ule
// kirjutab. last_good_rows uueneb ainult paris andmete peal (vt SYNC_SQL).
const eelmineAndis = Boolean(eelmine && eelmine.last_good_rows > 0);
```

Fail: `agent/hanked-sync.mjs`, read 367-373.

Enne:

```js
const note = tyhjenes
  ? pohjus +
    ": eelmine jooks andis " +
    vorm(eelmine.rows, "kirje", "kirjet") +
    " · " +
    loendiTekst(loend)
  : loendiTekst(loend);
db.prepare(SYNC_SQL).run(
  VOTI,
  read.length,
  tyhjenes ? 0 : 1,
  margiAllikas(note, allikas),
);
```

Pärast:

```js
const note = tyhjenes
  ? pohjus +
    ": viimane teadaolev hea jooks andis " +
    vorm(eelmine.last_good_rows, "kirje", "kirjet") +
    " · " +
    loendiTekst(loend)
  : loendiTekst(loend);
db.prepare(SYNC_SQL).run(
  VOTI,
  read.length,
  tyhjenes ? 0 : 1,
  margiAllikas(note, allikas),
  read.length,
  read.length,
  read.length,
);
```

> **Tähelepanu:** olemasolev test Z5 (rida ~1734) kontrollib täpset teksti `/^feed tühjenes: eelmine jooks andis 5 kirjet/`. See test jääb roheliseks ka pärast seda muudatust, sest sealses stsenaariumis on `eelmine.rows === eelmine.last_good_rows === 5` (viimane kirjutus OLIGI edukas). Ainult sõna "eelmine jooks" muutus sisuliselt "viimane teadaolev hea jooks"-uks tekstis — vaata Step 7, kus see kontrollitakse.

- [ ] **Step 6: Käivita test uuesti, veendu, et läbib**

Run: `node test/gate-hanked.mjs`

Expected: kõik `PASS hanked: ...` read, sh uus `PASS hanked: kaks järjestikust tühja jooksu jäävad mõlemad punaseks`. Väljumiskood 0.

- [ ] **Step 7: Kontrolli olemasoleva Z5 testi täpset teksti käsitsi**

Kuna Step 5 muutis note-teksti sõnastust ("eelmine jooks" → "viimane teadaolev hea jooks"), ent Z5 test kontrollib regex-iga `/^feed tühjenes: eelmine jooks andis 5 kirjet/`, mis eeldab sõna-sõnalt "eelmine jooks andis" — see regex **läheb katki**, kui sõnastust muudeti. Kontrolli:

Run: `node test/gate-hanked.mjs 2>&1 | grep -A2 "tyhjaks jaanud"`

Expected: `PASS hanked: tyhjaks jaanud feed ei ole roheline jooks`

Kui see FAILib (regex ei klapi uue tekstiga), paranda Z5 testi enda regex `test/gate-hanked.mjs`-is (rida ~1734):

Enne:

```js
  assert.ok(/^feed tühjenes: eelmine jooks andis 5 kirjet/.test(log.note || ''),
```

Pärast:

```js
  assert.ok(/^feed tühjenes: viimane teadaolev hea jooks andis 5 kirjet/.test(log.note || ''),
```

Ja jooksuta `node test/gate-hanked.mjs` uuesti, kuni kõik read on rohelised.

- [ ] **Step 8: Commit**

```bash
git add lib/hanked.mjs agent/hanked-sync.mjs test/gate-hanked.mjs
git commit -m "fix(hanked): RSS-tühjenemise valve ei tohi lugeda iseennast

eelmineAndis luges hanke_sync.rows/ok - täpselt sama rida, mille see
jooks kohe üle kirjutab. Teine järjestikune tühi jooks luges juba
nullitud eelmist rida (ok=0) ja tyhjenes lakkas rakendumast, kuigi
viimane PÄRIS hea tulemus oli olemas. Kaks uut veergu (last_good_ts,
last_good_rows) uuenevad ainult rows>0 korral (SQL CASE upsert-i
sees) ja kannavad viimast teadaolevat head tulemust edasi suvalise
arvu tühjade jooksude vältel.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: server-käivitatud jooksu tulemus peab lugema `tyhjenes`-t

**Files:**

- Modify: `lib/hanked-runs.mjs:196-267` (`lapseKuulajad`, `lopeta`)
- Test: `test/gate-hanked-runs.mjs` (uus blokk "P", lisatud pärast blokki I)

- [ ] **Step 1: Kirjuta ebaõnnestuv test (blokk P) `test/gate-hanked-runs.mjs`-i**

Leia blokk I lõpp (pärast Task 1 lisandusi on see nüüd nihkunud, aga tekst on muutumatu):

```js
  assert.match(lopp2.error, /koodiga 3/, 'vaikiv laps saab uldise teate: ' + lopp2.error);
  db2.close();
  console.log('PASS runs: lapse enda veateade jääb alles');
}

// ---------------------------------------------------------------------------
// J (p7): kask on valge nimekirja taga ja argumendid valideeritakse.
```

Lisa vahele, kohe pärast blokk I `}` ja tühja rida enne `// --- J`:

```js
// ---------------------------------------------------------------------------
// P (audit P1, 22.09.2026): server-käivitatud jooks peab lugema lapse
// tyhjenes-teadet, mitte ainult väljumiskoodi. agent/hanked-sync.mjs main() EI
// SEA process.exitCode-i tühja-feedi harul (ainult catch-plokk seab 1), seega
// laps lõpeb koodiga 0 ka siis, kui hanke_sync.ok=0 samal sündmusel. Enne seda
// parandust näitas nupu kaudu käivitatud sünk 'tehtud', kui otsejooks samal
// sündmusel oleks andnud 'viga' (vt agent/hanked-sync.mjs lopetaOtseJooks).
// ---------------------------------------------------------------------------
{
  const TYHJENEB = skript(
    "tyhjeneb.mjs",
    `
process.stdout.write(JSON.stringify({ progress: 'laen RSS-i' }) + '\\n');
process.stdout.write(JSON.stringify({ done: true, rows: 0, tyhjenes: true }) + '\\n');
`,
  );
  const db = testDb();
  const r = startRun(db, "sync", {}, { spawnFn: lapseks(TYHJENEB) });
  const lopp = await ootaLopp(db, r.id);
  assert.equal(
    lopp.state,
    "viga",
    "tühjenenud feed ei tohi näidata tehtud, kuigi laps lõpeb koodiga 0",
  );
  assert.match(
    lopp.error,
    /tühjenes/i,
    "põhjus peab ütlema, et feed tühjenes: " + lopp.error,
  );
  db.close();

  // Kontrolljuht: sama kuju, aga tyhjenes:false - PEAB jääma tehtud (mitte-regressioon).
  const EI_TYHJENE = skript(
    "ei-tyhjene.mjs",
    `
process.stdout.write(JSON.stringify({ done: true, rows: 7, tyhjenes: false }) + '\\n');
`,
  );
  const db2 = testDb();
  const r2 = startRun(db2, "sync", {}, { spawnFn: lapseks(EI_TYHJENE) });
  const lopp2 = await ootaLopp(db2, r2.id);
  assert.equal(
    lopp2.state,
    "tehtud",
    "tavaline edukas jooks ei tohi minna vigaseks",
  );
  assert.equal(lopp2.rows, 7);
  db2.close();
  console.log(
    "PASS runs: server-käivitatud jooks loeb tühjenes-e, mitte ainult väljumiskoodi",
  );
}
```

- [ ] **Step 2: Käivita ja veendu, et test kukub praeguse koodi peal**

Run: `node test/gate-hanked-runs.mjs`

Expected: `AssertionError` blokis P, teatega:

```
AssertionError [ERR_ASSERTION]: tühjenenud feed ei tohi näidata tehtud, kuigi laps lõpeb koodiga 0
```

(`lopp.state` on `'tehtud'`, mitte `'viga'`, sest praegune `lopeta` loeb ainult väljumiskoodi.)

- [ ] **Step 3: Lisa `lapseTyhjenes` muutuja ja loe seda `lisaRida`-s**

Fail: `lib/hanked-runs.mjs`, read 201-206.

Enne:

```js
let logi = "";
let progress = null;
let read = null;
let lapseViga = null;
let must = false;
let viimaneBaasiViga = null;
```

Pärast:

```js
let logi = "";
let progress = null;
let read = null;
let lapseViga = null;
let lapseTyhjenes = false;
let must = false;
let viimaneBaasiViga = null;
```

Fail: `lib/hanked-runs.mjs`, read 227-242.

Enne:

```js
const lisaRida = (r) => {
  if (r.length && r[0] === "{") {
    try {
      const o = JSON.parse(r);
      if (o && typeof o === "object") {
        if (typeof o.progress === "string") progress = o.progress;
        if (Number.isFinite(o.rows)) read = o.rows;
        // Lapse SISULINE viga (nt "RSS-i ei saanud: RHR vastas 502") on tapsem kui
        // vanema uldine "Protsess lõppes koodiga 1" - esimene voidab.
        if (typeof o.error === "string" && o.error && lapseViga === null)
          lapseViga = o.error.slice(0, 500);
      }
    } catch {
      /* tavaline logirida, mitte JSON */
    }
  }
  logi = (logi + r + "\n").slice(-LOG_MAX);
  must = true;
};
```

Pärast:

```js
const lisaRida = (r) => {
  if (r.length && r[0] === "{") {
    try {
      const o = JSON.parse(r);
      if (o && typeof o === "object") {
        if (typeof o.progress === "string") progress = o.progress;
        if (Number.isFinite(o.rows)) read = o.rows;
        // Lapse SISULINE viga (nt "RSS-i ei saanud: RHR vastas 502") on tapsem kui
        // vanema uldine "Protsess lõppes koodiga 1" - esimene voidab.
        if (typeof o.error === "string" && o.error && lapseViga === null)
          lapseViga = o.error.slice(0, 500);
        // AUDIT P1 (22.09.2026): tyhjenes ei ole viga (o.error), vaid eraldi
        // lipp - laps ei viska erindit, lopeb koodiga 0. Ilma selleta arvutab
        // lopeta() ok-i AINULT valjumiskoodist ja "feed tuhjenes" jaab
        // markimata (vt agent/hanked-sync.mjs lopetaOtseJooks, mis sama
        // signaali juba oigesti loeb otsejooksu teel).
        if (o.tyhjenes === true) lapseTyhjenes = true;
      }
    } catch {
      /* tavaline logirida, mitte JSON */
    }
  }
  logi = (logi + r + "\n").slice(-LOG_MAX);
  must = true;
};
```

- [ ] **Step 4: Uuenda `lopeta`-t**

Fail: `lib/hanked-runs.mjs`, read 254-267.

Enne:

```js
const lopeta = (kood, signaal) => {
  clearInterval(kell);
  valja.lopeta();
  vead.lopeta();
  // Lukus baas: paar korduskatset (busy_timeout ootab ise) ja siis NAHTAV rida
  // serveri logis - vaikselt kaduv logi on tapselt see viga, mida see moodul valvab.
  for (let i = 0; i < 3 && !kirjuta(); i++) {
    /* busy_timeout on juba oodanud */
  }
  if (must)
    console.error(
      "[hanked] jooksu " +
        id +
        " logi ei saanud baasi: " +
        lyhike(viimaneBaasiViga),
    );
  const ok = kood === 0 && !signaal;
  finishRun(db, id, {
    ok,
    error: ok
      ? null
      : signaal
        ? "Protsess sai signaali " + signaal
        : "Protsess lõppes koodiga " + kood,
  });
};
```

Pärast:

```js
const lopeta = (kood, signaal) => {
  clearInterval(kell);
  valja.lopeta();
  vead.lopeta();
  // Lukus baas: paar korduskatset (busy_timeout ootab ise) ja siis NAHTAV rida
  // serveri logis - vaikselt kaduv logi on tapselt see viga, mida see moodul valvab.
  for (let i = 0; i < 3 && !kirjuta(); i++) {
    /* busy_timeout on juba oodanud */
  }
  if (must)
    console.error(
      "[hanked] jooksu " +
        id +
        " logi ei saanud baasi: " +
        lyhike(viimaneBaasiViga),
    );
  // AUDIT P1: tyhjenes teeb jooksu vigaseks ka valjumiskoodiga 0 - sama
  // lepingu, mida agent/hanked-sync.mjs lopetaOtseJooks juba jargib
  // (ok: !r.tyhjenes) otsejooksu teel.
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
};
```

- [ ] **Step 5: Käivita test uuesti, veendu, et läbib**

Run: `node test/gate-hanked-runs.mjs`

Expected: kõik `PASS runs: ...` read, sh uus `PASS runs: server-käivitatud jooks loeb tühjenes-e, mitte ainult väljumiskoodi`. Väljumiskood 0.

- [ ] **Step 6: Veendu, et blokk I (veateate prioriteet) endiselt läbib muutumatult**

Run: `node test/gate-hanked-runs.mjs 2>&1 | grep "lapse enda veateade"`

Expected: `PASS runs: lapse enda veateade jääb alles` — see tõestab, et `lapseViga`-prioriteet (lapse enda `o.error` võidab üldise "Protsess lõppes koodiga N" ees) ei muutunud, sest `lapseTyhjenes`-i lisamine ei puutu `lapseViga`-t.

- [ ] **Step 7: Commit**

```bash
git add lib/hanked-runs.mjs test/gate-hanked-runs.mjs
git commit -m "fix(hanked): server-käivitatud jooks loeb lapse tyhjenes-teadet

lopeta() arvutas ok-i ainult väljumiskoodist. agent/hanked-sync.mjs
main() ei sea process.exitCode-i tühja-feedi harul (ainult
catch-plokk), seega laps lõpeb koodiga 0 ka siis, kui hanke_sync.ok=0
samal sündmusel - server-käivitatud sünk näitas 'tehtud', kus
otsejooks (lopetaOtseJooks: ok=!tyhjenes) oleks andnud 'viga'. lopeta
loeb nüüd lapse stdout-JSON-i tyhjenes-lippu samamoodi nagu
lapseViga-t.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Lõplik kontroll — kogu hanked-väravate grupp

**Files:** ei muudeta, ainult käivitatakse.

- [ ] **Step 1: Jooksuta kogu hanked-väravate grupp**

Run: `node tools/varav.mjs --ainult=hanked`

Expected: kõik väravad (sh `gate-hanked.mjs` — kuigi see on `VALJAJATED`-is väljas põhiahelast, `--ainult=hanked` võib selle siiski kaasata; kui mitte, on see juba Task 1/2/3 sammudes eraldi jooksutatud) rohelised, `0 kukkus`.

- [ ] **Step 2: Jooksuta täisulatuslik offline-värav**

Run: `npm run varav:range`

Expected: kõik grupid rohelised. Kui midagi kukub väljaspool `hanked`-gruppi, on see selle töö poolt puutumata regressioon — uuri eraldi, ära lülita väravat välja.

- [ ] **Step 3: Sabotaaži-kontroll (CLAUDE.md §Gates reegel 3)**

Kontrolli käsitsi, et kõik kolm parandust lähevad punaseks, kui reegel eemaldada:

1. `cleanupOrphans`-is eemalda ajutiselt `if (boot.startsWith(OTSE_BOOT)) { if (r.pid && alive(nr(r.pid))) continue; ... }` haru (jäta ainult vana kolme tingimuse ahel) → `node test/gate-hanked-runs.mjs` peab kukkuma blokis N. Taasta.
2. `eelmineAndis`-is vaheta `eelmine.last_good_rows > 0` tagasi `eelmine.ok === 1 && eelmine.rows > 0` vastu → `node test/gate-hanked.mjs` peab kukkuma blokis Z5c. Taasta.
3. `lopeta`-s eemalda `&& !lapseTyhjenes` → `node test/gate-hanked-runs.mjs` peab kukkuma blokis P. Taasta.

- [ ] **Step 4: Lõplik commit (kui sabotaaži-kontroll tegi ajutisi muudatusi, veendu et need on taastatud)**

```bash
git status --short
git diff
```

Expected: tühi (kõik ajutised sabotaaži-muudatused taastatud, kolm eelmist committi juba tehtud).

---

## Self-Review (täidetud plaani kirjutamisel)

**1. Spec coverage:** kõik kolm spec'i vea (§1 A, §2 B, §3 C) katab üks task igaüks. Spec'i §5 vastuvõtutingimused (A/B/C tabel) katab Task 1/2/3 test-assertid üks-ühele. Spec'i §6 failinimekiri (`test/gate-hanked-runs-elutsykkel.mjs`, `test/gate-hanked-sync-tyhjenemine.mjs`) on plaanis **teadlikult asendatud** olemasolevate `test/gate-hanked-runs.mjs` ja `test/gate-hanked.mjs` laiendustega — avastasin plaani kirjutamisel, et need failid juba katavad täpselt sama alamsüsteemi ja juba impordivad vajalikud funktsioonid (`alustaOtseJooks`, `OTSE_BOOT` on juba `test/gate-hanked.mjs`-is kasutusel); uue paralleelse gate-faili loomine dubleeriks väravaid samale koodile. See on kooskõlas spec'i enda mustriga "ühine mustrite taaskasutus, mitte uus struktuur".

**2. Placeholder scan:** ei ühtki "TBD"/"implement later"/"handle edge cases" tüüpi rida. Kõik koodiplokid on täielikud, kopeeritavad.

**3. Type consistency:** `OTSE_BOOT` (string, `'otse:'`), `lapseTyhjenes` (boolean), `last_good_ts`/`last_good_rows` (TEXT/INTEGER) nimed ja tüübid on läbivalt samad kõigis kolmes tasks kasutuses ja testides.

**Täpsustused, mis leiti alles koodi täpsel lugemisel (mitte spec'i tasemel nähtavad):**

- `test/gate-hanked.mjs` juba impordib `OTSE_BOOT`-i `agent/hanked-sync.mjs`-ist — nõudis re-eksporti (Task 1, Step 5), muidu oleks see fail katki läinud.
- `SYNC_SQL`-i saab lahendada ühe SQL CASE-avaldisega, mitte JS-poolse mitmekohalise arvutusega (Task 2) — väiksem diff.
- Olemasolev test Z5 kontrollib note-teksti täpset sõnastust regex-iga — Task 2 Step 5 sõnastusmuudatus nõuab Step 7 kontrolli/parandust selle regex-i peal.
- `test/gate-hanked-runs.mjs` kasutab juba tähti A–M ja R — uued testid said tähed N, O, P, et mitte kollideeruda.
- `test/gate-hanked-runs.mjs` olemasolev test H juba tõestab, et VÕÕRA-serveri (mitte-`otse:`) rea pid-i ei küsita — see jääb Task 1-ga muutumatuks ja on eraldi kontrollitud (Step 7).
