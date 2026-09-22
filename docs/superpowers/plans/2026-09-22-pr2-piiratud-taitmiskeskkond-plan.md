# PR2 — piiratud täitmiskeskkond (hanked-käskude spawn env + fiktiivne testkonfiguratsioon)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lib/hanked-runs.mjs`'i `startRun` ei anna lapsprotsessidele (sync/history/docs/gate) enam kogu `process.env`-i edasi (saladused MAIL*PASS/ACC*_*PASS/IMAP*_/SMTP\_\*/API-võtmed), vaid käsupõhist allowlist'i + runtime'i loodud `HANKED_RUN_ID`-d õigesse kolme käsku (sync/history/docs, MITTE gate'i). `test/gate.mjs` lakkab lugemast/kirjutamast/kustutamast repo `.env`-i. `lib/hanked.mjs`'i backfill ei taotle kirjutuslukku, kui pole midagi teha, ilma korrektsust ohverdamata.

**Architecture:** Explicit per-käsk env allowlist (uus sisemine map, EI puuduta `cmdView()` avalikku API-kuju). `HANKED_RUN_ID` süstitakse eraldi, MITTE allowlist'i osana (see ei ole pärandatav muutuja). `lib/env.mjs` saab `CRM_ENV_PATH` üle kirjutatava konfiguratsioonitee (viga nähtavaks, kui puudub/loetamatu — mitte vaikne tagasilangus). `test/gate.mjs` ehitab testserverile eksplitsiitse env-objekti (mitte `{...process.env}`).

**Tech Stack:** node:child_process, node:sqlite, node:fs. Ei uusi sõltuvusi.

**Taust:** väline audit PR #4 (`d7e0924`) järel — vt kaks eelnevat ülevaatustsüklit selle vestluse ajaloos. F1/F2/F3 (PR1/PR1b) on SULETUD, ei avata uuesti.

---

### Task 1: env-allowlist + HANKED_RUN_ID õigesse kolme käsku

**Files:**

- Modify: `lib/hanked-runs.mjs`
- Test: `test/gate-hanked-env.mjs` (uus)

- [ ] **Step 1: Kirjuta ebaõnnestuvad testid `test/gate-hanked-env.mjs`-is**

```js
// Väravas: käsupõhine env-allowlist ei anna last saladusi ega tundmatuid
// muutujaid edasi; HANKED_RUN_ID läheb ainult sync/history/docs-ile, mitte
// gate'ile (audit PR2, ENV-1/ENV-2/ENV-5/ENV-6, 22.09.2026).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lubatudEnv } from "../lib/hanked-runs.mjs";

const SALADUSED = [
  "MAIL_PASS",
  "ACC_GERT_PASS",
  "IMAP_HOST",
  "SMTP_HOST",
  "PARTNER_API_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NODE_OPTIONS",
  "NODE_PATH",
];

function fiktiivneAllikas() {
  const out = {
    SystemRoot: "C:\\Windows",
    PATH: "C:\\real\\path",
    TEMP: "C:\\tmp",
    CRM_DB_PATH: "C:\\fixture\\db.sqlite",
    HANKED_RSS_URL: "https://fake/rss",
    HANKED_AWARD_BASE: "https://fake/award",
    HANKED_DOCS_DIR: "C:\\fake\\docs",
    HANKED_RHR_BASE: "https://fake/rhr",
    PDFTOTEXT: "C:\\fake\\pdftotext.exe",
    HANKED_RUN_ID:
      "999999" /* võlts pärandväärtus - ei tohi kunagi väljundisse jõuda */,
  };
  for (const k of SALADUSED) out[k] = "salajane-" + k;
  return out;
}

// ENV-1: saladused ja ambient-konfiguratsioon ei jõua ÜHESSEGI käsku.
for (const cmd of ["sync", "history", "docs", "gate"]) {
  const out = lubatudEnv(cmd, fiktiivneAllikas());
  for (const salajane of SALADUSED) {
    assert.equal(
      out[salajane],
      undefined,
      cmd + ": " + salajane + " ei tohi lekkida",
    );
  }
  assert.equal(
    out.HANKED_RUN_ID,
    undefined,
    cmd +
      ": HANKED_RUN_ID ei tule kunagi lähteallikast (ainult startRun süstib värske väärtuse)",
  );
}
console.log(
  "PASS hanked-env: ükski käsk ei saa saladusi ega võlts HANKED_RUN_ID-d (ENV-1)",
);

// ENV-6: käsupõhised muutujad AINULT õigel käsul.
{
  const sync = lubatudEnv("sync", fiktiivneAllikas());
  assert.equal(sync.HANKED_RSS_URL, "https://fake/rss");
  assert.equal(sync.HANKED_AWARD_BASE, undefined);
  assert.equal(sync.PDFTOTEXT, undefined);

  const history = lubatudEnv("history", fiktiivneAllikas());
  assert.equal(history.HANKED_AWARD_BASE, "https://fake/award");
  assert.equal(history.HANKED_RSS_URL, undefined);

  const docs = lubatudEnv("docs", fiktiivneAllikas());
  assert.equal(docs.HANKED_DOCS_DIR, "C:\\fake\\docs");
  assert.equal(docs.HANKED_RHR_BASE, "https://fake/rhr");
  assert.equal(docs.PDFTOTEXT, "C:\\fake\\pdftotext.exe");
  assert.equal(docs.HANKED_RSS_URL, undefined);

  const gate = lubatudEnv("gate", fiktiivneAllikas());
  assert.equal(gate.HANKED_RSS_URL, undefined);
  assert.equal(gate.HANKED_DOCS_DIR, undefined);
  assert.equal(
    gate.CRM_DB_PATH,
    "C:\\fixture\\db.sqlite",
    "CRM_DB_PATH on ühine baas-muutuja",
  );
}
console.log("PASS hanked-env: käsupõhised muutujad ei sega üksteist (ENV-6)");

// Tundmatu käsk - tühi lisakonfiguratsioon, ei laiene, ei kuku.
{
  const out = lubatudEnv("tundmatu-kask-xyz", fiktiivneAllikas());
  assert.equal(out.HANKED_RSS_URL, undefined);
  assert.equal(
    out.SystemRoot,
    "C:\\Windows",
    "Windows-baas jääb ka tundmatul käsul",
  );
}
console.log("PASS hanked-env: tundmatu käsk ei laienda lubaloendit");

// ENV-2: Windows võtmekuju on kanooniline ja konfliktireegel deterministlik.
// Object.keys({Path,PATH}) hoiab kirjutusjärjekorra - ESIMENE vaste võidab (dokumenteeritud
// lubatudEnv-is). Test tõestab tulemuse DETERMINISMI, mitte "õiget" OS-käitumist.
{
  const segane = {
    Path: "esimene-vaste",
    PATH: "teine-vaste",
    SystemRoot: "C:\\Windows",
  };
  const out1 = lubatudEnv("sync", segane);
  const out2 = lubatudEnv("sync", segane);
  assert.equal(
    Object.keys(out1).filter((k) => k.toUpperCase() === "PATH").length,
    1,
    "täpselt üks PATH-kujuline väljundvõti, mitte mõlemad",
  );
  assert.equal(
    out1.PATH,
    "esimene-vaste",
    "esimene Object.keys() vaste võidab (dokumenteeritud reegel)",
  );
  assert.equal(out1.PATH, out2.PATH, "sama sisend annab alati sama väljundi");
}
console.log(
  "PASS hanked-env: Windows Path/PATH konflikt on deterministlik (ENV-2)",
);

// Staatiline regressioonivärav: sync/history/docs/gate ei tohi ISE kutsuda
// loadEnv/rawEnv-i (lib/env.mjs). See EI TÕENDA failisüsteemi-isolatsiooni -
// see on regressioonivärav teadaoleva konfiguratsioonilugeja tagasitoomise
// vastu (audit PR2, p.3). Sabotaaž: lisa üks selline kutse - värav läheb punaseks.
{
  const KEELATUD = /\b(loadEnv|rawEnv)\s*\(/;
  for (const tee of [
    "agent/hanked-sync.mjs",
    "agent/hanked-history.mjs",
    "agent/hanked-docs.mjs",
    "test/gate-hanked.mjs",
  ]) {
    const sisu = readFileSync(tee, "utf8");
    assert.equal(
      KEELATUD.test(sisu),
      false,
      tee +
        " ei tohi kutsuda loadEnv()/rawEnv() - need loeksid päris .env-i otse",
    );
  }
}
console.log(
  "PASS hanked-env: sync/history/docs/gate ei loe .env-i loadEnv/rawEnv kaudu (staatiline piir, p.3)",
);
```

- [ ] **Step 2: Käivita, veendu et kukub (`lubatudEnv` puudub)**

Run: `node test/gate-hanked-env.mjs`
Expected: `Cannot find module` / `lubatudEnv is not a function` või sarnane.

- [ ] **Step 3: Kirjuta `lubatudEnv` ja muuda `startRun` seda kasutama**

`lib/hanked-runs.mjs` muudatused:

1. Lisa `CMD`-i kõrvale (mitte selle sisse — `cmdView()` levitab `{...CMD[cmd], valmis}` otse SPA vastusesse, sisemine env-konfiguratsioon ei tohi sinna kaasa minna):

```js
// Sisemine env-konfiguratsioon per käsk. TEADLIKULT EI OLE CMD osa (vt cmdView),
// et avalik API-kuju ei muutuks selle lisandumisel.
const KASU_ENV = Object.freeze(
  Object.assign(Object.create(null), {
    sync: { lisa: ["HANKED_RSS_URL"], runId: true },
    history: { lisa: ["HANKED_AWARD_BASE"], runId: true },
    docs: {
      lisa: ["HANKED_DOCS_DIR", "HANKED_RHR_BASE", "PDFTOTEXT"],
      runId: true,
    },
    // gate = test/gate-hanked.mjs. EI saa HANKED_RUN_ID-d: see skript kutsub SISEMISELT
    // agent/hanked-sync.mjs `alustaOtseJooks`-i oma fikstuuribaaside peal (vt selle
    // funktsiooni testid) - kui väline 'gate'-käivituse run-id pärandataks, loeks need
    // sisemised testkutsed VALE haru (arvaks end serveri lapseks) ja rikuksid testi
    // enda tulemuse (audit PR2, ENV-5).
    gate: { lisa: [], runId: false },
  }),
);

// Windows'il on CreateProcess/DLL-otsingu jaoks vaja neid süsteemimuutujaid - ilma
// nendeta võib lapsprotsess (isegi node.exe ise) käivitumisel vaikselt untsu minna.
// Sama eeldus mis agent/codex-runner.mjs `childEnvironment`-il.
const WIN_BASE = [
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATH",
  "PATHEXT",
  "TEMP",
  "TMP",
  "LOCALAPPDATA",
  "APPDATA",
];

/**
 * Käsupõhine env-allowlist. EI anna edasi kogu process.env-i - ainult Windows'i
 * baasmuutujad, CRM_DB_PATH (õige baasi suunamiseks) ja käsu enda lisakonfiguratsioon.
 * HANKED_RUN_ID EI ole siin osa - see on runtime'i loodud väärtus (vt startRun),
 * mitte pärandatav muutuja; vana/võlts väärtus lähteallikast ei tohi kunagi läbi minna.
 * Võtmekuju on alati kanooniline (nt 'PATH', mitte 'Path'); mitme kirjatüübi
 * konflikti korral võidab Object.keys(sourceEnv) järjekorras ESIMENE vaste -
 * deterministlik, dokumenteeritud reegel (vt test/gate-hanked-env.mjs ENV-2).
 */
export function lubatudEnv(cmd, sourceEnv = process.env) {
  const kasu = KASU_ENV[cmd] || { lisa: [], runId: false };
  const out = {};
  for (const votikuju of [...WIN_BASE, "CRM_DB_PATH", ...kasu.lisa]) {
    let leitud;
    for (const k of Object.keys(sourceEnv)) {
      if (k.toUpperCase() === votikuju.toUpperCase()) {
        leitud = k;
        break;
      }
    }
    if (leitud !== undefined) out[votikuju] = sourceEnv[leitud];
  }
  return out;
}
```

2. Muuda `startRun`'i spawn-kohta (praegu rida ~150-152):

```js
// Vt lubatudEnv() - saladused (MAIL_PASS jne) ja tundmatud muutujad ei lähe
// lapsele. HANKED_RUN_ID süstitakse SIIN eraldi, ainult kui KASU_ENV lubab
// (sync/history/docs) - gate ei saa seda kunagi (vt KASU_ENV kommentaar).
const baasEnv = lubatudEnv(cmd);
const lapseEnv =
  KASU_ENV[cmd] && KASU_ENV[cmd].runId
    ? { ...baasEnv, HANKED_RUN_ID: String(id) }
    : baasEnv;
laps = spawnFn(process.execPath, argv, {
  cwd: root,
  windowsHide: true,
  env: lapseEnv,
});
```

- [ ] **Step 4: Käivita testid, veendu et läbivad**

Run: `node test/gate-hanked-env.mjs`
Expected: kõik `PASS` read, exit code 0.

- [ ] **Step 5: Käivita täisahel veendumaks, et startRun'i olemasolevad testid ei murdunud**

Run: `node test/gate-hanked-runs.mjs`
Expected: kõik PASS (eriti need, mis kontrollivad `startRun`'i reaalset spawni).

- [ ] **Step 6: Commit**

```bash
git add lib/hanked-runs.mjs test/gate-hanked-env.mjs
git commit -m "fix(hanked): käsupõhine env-allowlist startRun spawnile

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: ENV-3/ENV-4 — server-käivitatud history/docs saavad õige HANKED_RUN_ID

**Files:**

- Test: `test/gate-hanked-runs.mjs`

**Context:** Task 1 muutis `startRun`'i env'i. See test tõestab, et `history`/`docs` PÄRIS `main()`-tee (mitte ainult `lubatudEnv()` väljund) käitub õigesti, kui `startRun` käivitab need reaalse lapsprotsessina fikstuuribaasi peal — st et regressioon "HANKED_RUN_ID kaob → laps arvab end vahelejäetuks ja lõpetab koodiga 0 midagi tegemata" on kaetud.

- [ ] **Step 1: Kirjuta ebaõnnestuv test**

Lisa `test/gate-hanked-runs.mjs` lõppu (pärast olemasolevat Q plokki):

```js
// ENV-3/ENV-4 (audit PR2, 22.09.2026): startRun peab andma history/docs lapsele
// ÕIGE HANKED_RUN_ID (mitte ainult sync-ile). Kontroll läbi PÄRIS spawni fikstuuri
// peal - kui env kaob, main() teataks `vahelejaetud:true` ja teeks MITTE MIDAGI,
// mis näeks välja nagu edukas jooks (exit 0), aga kuud/dokumendid ei laeks kunagi.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync as _DS } from "node:sqlite";

for (const [cmd, argv] of [
  ["history", ["--kuud=1"]],
  ["docs", ["--ref=ei-eksisteeri"]],
]) {
  const dir = mkdtempSync(join(tmpdir(), "hanked-envrun-"));
  const dbPath = join(dir, "test.sqlite");
  const db = new DatabaseSync(dbPath);
  migrateHanked(db);
  const { id } = startRun(
    db,
    cmd,
    {},
    {
      spawnFn: (bin, argv2, opts) => {
        // ÕIGE tee: HANKED_RUN_ID PEAB olema opts.env-is (startRun süstis selle).
        assert.ok(
          opts.env.HANKED_RUN_ID,
          cmd + ": startRun peab süstima HANKED_RUN_ID",
        );
        assert.equal(String(opts.env.HANKED_RUN_ID), String(idRef.id));
        // Ei käivita reaalset last siin - piisab env-kontrollist. process-mock:
        const { EventEmitter } = require("node:events");
        const fake = new EventEmitter();
        fake.pid = 424243;
        queueMicrotask(() => fake.emit("close", 0, null));
        return fake;
      },
    },
  );
  const idRef = { id };
  db.close();
  console.log(
    "PASS runs: startRun süstib HANKED_RUN_ID õigesti käsule " +
      cmd +
      " (ENV-3)",
  );
}
```

_(Implementeerija märkus: kohanda importe/mock-mustrit vastavalt failis juba olemasolevale `startRun`-testimise mustrile — vaata olemasolevaid `spawnFn`-mock plokke samas failis ja korda sama stiili, sh `idRef`-i asemel otsene sulundmuutuja, kui see on loetavam. Oluline on AINULT sisuline kontroll: `opts.env.HANKED_RUN_ID === String(loodud rea id)` `history`- JA `docs`-käsul.)_

Lisaks: kirjuta üks test, kus `gate` käsu jaoks kontrollitakse, et `opts.env.HANKED_RUN_ID` on **undefined** (ENV-5, sümmeetriline Task 1 üksiktestile, aga läbi päris `startRun`-tee).

- [ ] **Step 2: Käivita, veendu, et kukub ilma Task 1-ta (juba peaks olema roheline, kui Task 1 tehtud — kui nii, kirjuta test AJUTISELT vana `{...process.env, HANKED_RUN_ID}` peale, veendu punases, siis taasta)**

- [ ] **Step 3: Käivita täisfail, veendu roheline**

Run: `node test/gate-hanked-runs.mjs`

- [ ] **Step 4: Commit**

```bash
git add test/gate-hanked-runs.mjs
git commit -m "test(hanked): startRun süstib HANKED_RUN_ID õigesti history/docs/gate käsule

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `CRM_ENV_PATH` + `test/gate.mjs` ei puuduta repo `.env`-i

**Files:**

- Modify: `lib/env.mjs`
- Modify: `test/gate.mjs`
- Modify: `tools/varav.mjs` (kommentaar)

- [ ] **Step 1: `lib/env.mjs` — `rawEnv` saab üle kirjutatava tee**

Praegu (`lib/env.mjs:7-17`):

```js
export function rawEnv() {
  const f = join(ROOT, '.env');
  if (!existsSync(f)) throw new Error('.env puudub. Käivita esmalt: npm run setup');
  ...
```

Muuda:

```js
export function rawEnv() {
  const f = process.env.CRM_ENV_PATH || join(ROOT, ".env");
  if (!existsSync(f)) {
    throw new Error(
      process.env.CRM_ENV_PATH
        ? "CRM_ENV_PATH osutab olematule failile: " + f
        : ".env puudub. Käivita esmalt: npm run setup",
    );
  }
  const out = {};
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
```

Ei muuda `loadEnv()`-i ennast — `server.mjs`'i tavakäivitus (ilma `CRM_ENV_PATH`-ita) käitub identselt.

- [ ] **Step 2: Test `lib/env.mjs` uue lepingu kohta**

Lisa uude faili `test/gate-env.mjs` (kontrolli enne, ega selline juba olemas ei ole):

```js
// CRM_ENV_PATH: konfiguratsioonitee peab olema üle kirjutatav ja mitte langema
// vaikselt tagasi repo .env-ile (audit PR2, CFG-2, 22.09.2026).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rawEnv } from "../lib/env.mjs";

const algne = process.env.CRM_ENV_PATH;
try {
  const dir = mkdtempSync(join(tmpdir(), "crm-env-"));
  const fail = join(dir, "fiktiivne.env");
  writeFileSync(
    fail,
    "ACCOUNTS=gate\nACC_GATE_USER=gate@example.invalid\nACC_GATE_PASS=gate\n",
  );
  process.env.CRM_ENV_PATH = fail;
  const e = rawEnv();
  assert.equal(e.ACC_GATE_USER, "gate@example.invalid");
  console.log("PASS env: CRM_ENV_PATH loeb määratud faili (CFG-1)");

  process.env.CRM_ENV_PATH = join(dir, "ei-eksisteeri.env");
  assert.throws(
    () => rawEnv(),
    /CRM_ENV_PATH osutab olematule failile/,
    "puuduv CRM_ENV_PATH ei tohi vaikselt langeda repo .env-ile",
  );
  console.log(
    "PASS env: puuduv CRM_ENV_PATH annab nähtava vea, mitte vaikse tagasilanguse (CFG-2)",
  );
} finally {
  if (algne === undefined) delete process.env.CRM_ENV_PATH;
  else process.env.CRM_ENV_PATH = algne;
}
```

- [ ] **Step 3: Käivita, veendu roheline**

Run: `node test/gate-env.mjs`

- [ ] **Step 4: `test/gate.mjs` — kaota repo `.env` puudutamine täielikult**

Praegune (rida ~33-47, 72-74, 366-367) kirjutab/kustutab `join(ROOT, '.env')` ja spreadib `{...process.env}` server-lapsele. Asenda:

- Eemalda `envPath`/`tempEnv`/`writeFileSync(envPath, ...)`/`unlinkSync(envPath)` plokk täielikult.
- Enne serveri spawni: `mkdtempSync` juba olemasoleva `fixtureDir`-i KÕRVALE (või samasse) kirjuta fiktiivne env-fail:

```js
const fakeEnvPath = join(fixtureDir, "fake.env");
writeFileSync(
  fakeEnvPath,
  [
    "ACCOUNTS=gate",
    "ACC_GATE_USER=gate@example.invalid",
    "ACC_GATE_PASS=gate",
    "ACC_GATE_NAME=Gate",
    `CRM_PORT=${PORT}`,
    "POLL_MINUTES=999",
  ].join("\n") + "\n",
);
```

- Serveri spawn (praegu rida ~72-74) muutub eksplitsiitseks (EI SPREADI `process.env`-i):

```js
const srv = spawn(process.execPath, [join(ROOT, "server.mjs")], {
  cwd: ROOT,
  env: {
    CRM_ENV_PATH: fakeEnvPath,
    CRM_PORT: String(PORT),
    CRM_DB_PATH: fixtureDb,
    CRM_NO_SEED: "1",
    CRM_NO_POLL: "1",
    POLL_MINUTES: "999",
    // Windows'il vajalikud süsteemimuutujad - vt lib/hanked-runs.mjs WIN_BASE
    // (sama põhjendus: ilma nendeta ei pruugi node.exe ise käivituda).
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
```

_(implementeerija: säilita olemasolev `stdio`/logi-lugemise loogika, muuda AINULT `env` väli.)_

- Fail-lõpu koristusest (rida ~366-367) eemalda `if (tempEnv) { unlinkSync(envPath) }` plokk täielikult — `fixtureDir` on juba `mkdtempSync`, koristub olemasoleva loogikaga (kontrolli, kas `rmSync(fixtureDir,...)` juba tehakse; kui mitte, lisa `finally`-s).

- [ ] **Step 5: `tools/varav.mjs` — paranda aegunud kommentaar**

Rida ~25-27 räägib "elav suitsutest, mis avab päris CRM-i SQLite-i ja postkasti seadistuse" — see polnud enam täpne juba enne seda PR-i (fixture DB oli juba kasutuses) ja on nüüd veel vähem täpne (fiktiivne env samuti). Uuenda kommentaari faktiliselt täpseks (fixture DB + fiktiivne `.env`, Playwright-nõue on ainus tegelik "miks väljas" põhjus).

- [ ] **Step 6: Käivita `test/gate.mjs` käsitsi, veendu et läbib PÄRIS `.env` OLEMASOLUL (kui arendusmasinal on repo `.env`, veendu et see jääb muutumatuks: `git status` peab olema puhas selle faili osas)**

Run: `npm test`
Expected: läbib, `git status --short .env` (kui `.env` on jälgimata — see on gitignored, seega kontrolli faili muutumise aega/sisu käsitsi, mitte git-status'iga) tõestab, et faili ei puudutatud.

- [ ] **Step 7: Commit**

```bash
git add lib/env.mjs test/gate.mjs test/gate-env.mjs tools/varav.mjs
git commit -m "fix(env): CRM_ENV_PATH ja test/gate.mjs ei puuduta enam repo .env-i

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: browser-CI kajastab parandatud `test/gate.mjs` tee

**Files:**

- Modify: `.github/workflows/ci.yml`

**Context:** `test/gate.mjs` jääb väljapoole `gate-*.mjs` avastusmustrit (tahtlik). Pärast Task 3-te on see konfiguratsioonist sõltumatu — CI `browser` töö peab seda käitama (praegu `npm run varav:brauser` ei kutsu `npm test`-i eraldi; kontrolli, kas mõni CI samm juba jookseb `npm test`, ja kui mitte, lisa).

- [ ] **Step 1: Loe `.github/workflows/ci.yml` `browser` tööd, tuvasta praegune samm**

- [ ] **Step 2: Lisa samm, mis käivitab `npm test` (test/gate.mjs) PÄRAST `npm run varav:brauser`-i, samas `browser` töös (sama Playwright-install juba tehtud)**

```yaml
- name: UI-värav (test/gate.mjs)
  run: npm test
```

_(implementeerija: pane õigesse kohta olemasoleva step-järjestuse sisse, korda olemasolevat "Private dependency recipe" mustrit kui vaja env-i.)_

- [ ] **Step 3: Kontrolli lokaalselt, et `npm test` läbib (juba Task 3-s tehtud), commit workflow muudatus eraldi**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: käivita test/gate.mjs browser-töös nüüd, kui see ei sõltu enam päris .env-ist

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Backfill loe-enne-kirjuta + konkurentsiregressioon

**Files:**

- Modify: `lib/hanked.mjs`
- Test: `test/gate-hanked.mjs`

- [ ] **Step 1: Kirjuta ebaõnnestuv konkurentsitest**

Lisa `test/gate-hanked.mjs` lõppu:

```js
// DB-3/DB-4 (audit PR2, 22.09.2026): migrateHanked ei tohi taotleda kirjutuslukku,
// kui backfill'iks sobivaid ridu pole - PÄRIS funktsiooniga, PÄRIS teise ühendusega
// hoitud BEGIN IMMEDIATE ajal, mitte käsitsi SELECT COUNT. WHERE-tingimus (F1-F3)
// jääb UPDATE-isse muutumatuna - see EI ole lukuvaba lahendus üldiselt, ainult
// nulltöö juhtumi jaoks.
{
  const dir = mkdtempSync(join(tmpdir(), 'hanked-backfill-lock-'));
  const teeA = join(dir, 'test.sqlite');
  const a = new DatabaseSync(teeA);
  a.exec('PRAGMA journal_mode = WAL');
  migrateHanked(a); // skeem valmis, last_good_* veerud olemas, backfill juba läbi (0 sobivat)
  a.close();

  const b = new DatabaseSync(teeA);
  b.exec('PRAGMA journal_mode = WAL');
  b.exec('BEGIN IMMEDIATE'); // kirjutuslukk teise ühenduse käes

  const aUuesti = new DatabaseSync(teeA);
  aUuesti.exec('PRAGMA journal_mode = WAL');
  aUuesti.exec('PRAGMA busy_timeout = 0'); // deterministlik: ei oota, kukub kohe kui üritab kirjutada
  assert.doesNotThrow(() => migrateHanked(aUuesti),
    'nulltöö backfill ei tohi üritada kirjutada, kui B hoiab BEGIN IMMEDIATE - ei tohi anda SQLITE_BUSY');
  aUuesti.close();
  b.exec('ROLLBACK');
  b.close();
  console.log('PASS hanked: migrateHanked ei taotle kirjutuslukku nulltöö backfill''i korral (DB-3)');
}

// DB-4: kui sobiv rida PÄRISELT olemas ja teine ühendus blokeerib, UPDATE peab
// nähtavalt ebaõnnestuma (busy_timeout=0), MITTE vaikselt "eduna" mööda minema.
{
  const dir = mkdtempSync(join(tmpdir(), 'hanked-backfill-lock2-'));
  const teeA = join(dir, 'test.sqlite');
  const a = new DatabaseSync(teeA);
  a.exec('PRAGMA journal_mode = WAL');
  a.exec(`CREATE TABLE hanke_sync (key TEXT PRIMARY KEY, ts TEXT, rows INTEGER, ok INTEGER, note TEXT)`);
  a.prepare(`INSERT INTO hanke_sync (key, ts, rows, ok, note) VALUES ('rss','2026-09-18 08:00:00',5,1,'legacy')`).run();
  a.close();

  const b = new DatabaseSync(teeA);
  b.exec('PRAGMA journal_mode = WAL');
  b.exec('BEGIN IMMEDIATE');

  const aUuesti = new DatabaseSync(teeA);
  aUuesti.exec('PRAGMA journal_mode = WAL');
  aUuesti.exec('PRAGMA busy_timeout = 0');
  assert.throws(() => migrateHanked(aUuesti), /database is locked/i,
    'kui sobiv rida päriselt olemas ja kirjutus blokeeritud, viga peab olema NÄHTAV, mitte neelatud');
  aUuesti.close();
  b.exec('ROLLBACK');
  b.close();
  console.log('PASS hanked: vajalik backfill-kirjutus jääb nähtavaks lukukonflikti korral, ei neelata (DB-4)');
}
```

_(vajalikud impordid faili algusesse, kui puuduvad: `DatabaseSync` `node:sqlite`-ist juba imporditud üleval; `mkdtempSync`, `tmpdir`, `join` samuti juba faili algul kasutusel — kontrolli ja lisa vajadusel.)_

- [ ] **Step 2: Käivita, veendu et DB-3 kukub (praegune UPDATE alati üritab kirjutada)**

Run: `node test/gate-hanked.mjs`
Expected: DB-3 osas `SQLITE_BUSY`/`database is locked` viga (kuna `busy_timeout=0` ja praegune kood üritab tingimusteta UPDATE-i).

- [ ] **Step 3: Muuda `lib/hanked.mjs` (rida ~124-125)**

Praegu:

```js
db.prepare(
  `UPDATE hanke_sync SET last_good_ts = ts, last_good_rows = rows
      WHERE last_good_rows IS NULL AND ok = 1 AND rows > 0`,
).run();
```

Muuda:

```js
// Loe-enne-kirjuta: SELECT ei taotle kirjutuslukku (WAL-lugeja), UPDATE
// ainult siis, kui midagi PÄRISELT on teha. WHERE-tingimus jääb UPDATE-isse
// MUUTUMATUNA - see ei asenda kirjutamise tingimust, ainult väldib tarbetut
// luku-taotlust nulltöö juhul. Sobivaid ridu VÕIB tekkida uuesti (nt
// agent/hanked-history.mjs importMonthXml oma INSERT ei täida last_good_*-i) -
// seega EI ehitata siia "korra tehtud, valmis igaveseks" lippu (audit PR2, p.6).
const onSobivaid = db
  .prepare(
    `SELECT 1 FROM hanke_sync
      WHERE last_good_rows IS NULL AND ok = 1 AND rows > 0 LIMIT 1`,
  )
  .get();
if (onSobivaid) {
  db.prepare(
    `UPDATE hanke_sync SET last_good_ts = ts, last_good_rows = rows
        WHERE last_good_rows IS NULL AND ok = 1 AND rows > 0`,
  ).run();
}
```

- [ ] **Step 4: Käivita uuesti, veendu et DB-3 läbib ja DB-4 endiselt läbib (viga jääb nähtavaks, kui rida päriselt sobib)**

Run: `node test/gate-hanked.mjs`

- [ ] **Step 5: Käivita täisahel, veendu et F1/M1-M4 ja kõik muud olemasolevad testid jäävad roheliseks**

Run: `node tools/varav.mjs --ainult=hanked`

- [ ] **Step 6: Commit**

```bash
git add lib/hanked.mjs test/gate-hanked.mjs
git commit -m "fix(hanked): backfill ei taotle kirjutuslukku, kui pole midagi teha

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: DB-1/DB-2 — M1/M3 päris topelt-tühisünk, B5 erineva reaarvuga

**Files:**

- Modify: `test/gate-hanked.mjs`

- [ ] **Step 1: M1/M3 — lisa PÄRIS topelt-tühisüngi test peale legacy/PR3-NULL migratsiooni**

Lisa kohe pärast olemasolevat F1/M4 plokki (rida ~1910-1924):

```js
// DB-1 (audit PR2, 22.09.2026): legacy rida migreerub, SIIS kaks PÄRIS
// syncFromXml tühja fikstuuriga - mõlemad peavad olema tyhjenes=true JA
// säilitama mõlemad last_good_* väljad muutumatuna (mitte ainult üks kord).
{
  const tyhi =
    '<?xml version="1.0"?><rss version="2.0"><channel><title>RHR</title></channel></rss>';
  const db = testDb();
  db.prepare(
    `INSERT INTO hanke_sync (key, ts, rows, ok, note) VALUES
      ('rss', '2026-09-18 08:00:00', 5, 1, 'legacy')`,
  ).run();
  migrateHanked(db); // backfill täidab last_good_*

  const esimene = syncFromXml(db, tyhi, { today: "2026-09-20" });
  assert.equal(esimene.tyhjenes, true, "esimene tühi süng: tyhjenes=true");
  let rida = db
    .prepare(
      "SELECT last_good_ts, last_good_rows FROM hanke_sync WHERE key='rss'",
    )
    .get();
  assert.equal(rida.last_good_ts, "2026-09-18 08:00:00");
  assert.equal(rida.last_good_rows, 5);

  const teine = syncFromXml(db, tyhi, { today: "2026-09-21" });
  assert.equal(teine.tyhjenes, true, "teine tühi süng: tyhjenes=true");
  rida = db
    .prepare(
      "SELECT last_good_ts, last_good_rows FROM hanke_sync WHERE key='rss'",
    )
    .get();
  assert.equal(
    rida.last_good_ts,
    "2026-09-18 08:00:00",
    "lähtejoon püsib ka teisel tühjal jooksul",
  );
  assert.equal(rida.last_good_rows, 5);
  db.close();
  console.log(
    "PASS hanked: legacy migratsioon + kaks päris tühja süngi säilitavad lähtejoone (DB-1)",
  );
}
```

- [ ] **Step 2: B5 parandus — erinev reaarv baasi ja katkestatud katse vahel**

Muuda olemasolevat F2/B5 plokki (rida ~2008-2033). Praegu mõlemad `syncFromXml`-kutsed kasutavad `RSS_FIKSTUUR`-i (sama reaarv, 5). Vaja on TEIST fikstuuri erineva reaarvuga katkestatud katsele. Kontrolli, kas failis on juba mõni 9-realine fikstuur (F2/tyhi-baas plokk kasutab `rows:9` sünteetiliselt, mitte reaalset XML-i) — kui mitte, lisa uus minimaalne XML-fikstuur konstant faili algusesse (nt `RSS_FIKSTUUR_9` üheksa `<item>`-iga, samas kujus mis olemasolev `RSS_FIKSTUUR`).

```js
// F2/B5 (parandatud DB-2, audit PR2): baas ja katkestatud katse PEAVAD olema
// erineva reaarvuga, muidu ei erista test "säilis vana" vs "kogemata arvutati
// uuesti sama väärtus".
{
  const db = testDb();
  syncFromXml(db, RSS_FIKSTUUR, { today: "2026-09-20" }); // baas: 5 rida
  const baasTs = db
    .prepare("SELECT last_good_ts FROM hanke_sync WHERE key='rss'")
    .get().last_good_ts;
  assert.equal(
    db.prepare("SELECT last_good_rows FROM hanke_sync WHERE key='rss'").get()
      .last_good_rows,
    5,
  );

  db.exec(`CREATE TRIGGER f2_katke BEFORE UPDATE OF score ON hanked BEGIN
      SELECT RAISE(ABORT, 'F2 test: sunnitud katke');
    END`);
  assert.throws(
    () => syncFromXml(db, RSS_FIKSTUUR_9, { today: "2026-09-21" }),
    /sunnitud katke/,
  );
  db.exec("DROP TRIGGER f2_katke");

  const rida = db
    .prepare(
      "SELECT ok, rows, last_good_ts, last_good_rows FROM hanke_sync WHERE key='rss'",
    )
    .get();
  assert.equal(rida.ok, 0, "katkenud katse peab jätma ok=0 jälje");
  assert.equal(
    rida.rows,
    9,
    "katkenud katse ENDA rows (9, teisest fikstuurist) peab diagnostikaks säilima",
  );
  assert.equal(
    rida.last_good_ts,
    baasTs,
    "B5: last_good_ts peab olema VANA (18.09), mitte katkenud katse oma",
  );
  assert.equal(
    rida.last_good_rows,
    5,
    "B5: last_good_rows peab olema VANA (5), mitte katkenud katse 9",
  );
  db.close();
  console.log(
    "PASS hanked: katkenud sünk erineva reaarvuga ei riku lähtejoont (DB-2/B5)",
  );
}
```

- [ ] **Step 3: Käivita, veendu roheline**

Run: `node test/gate-hanked.mjs`

- [ ] **Step 4: Commit**

```bash
git add test/gate-hanked.mjs
git commit -m "test(hanked): päris topelt-tühisünk migratsiooni järel, B5 erineva reaarvuga

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: PID-1 — cleanupOrphans vaikeabifunktsioon + DOC-1 dok-parandus

**Files:**

- Modify: `test/gate-hanked-runs.mjs`
- Modify: `docs/superpowers/specs/2026-09-22-pr1-jooksude-elutsykkel-design.md`

- [ ] **Step 1: Lisa `cleanupOrphans` vaikeabifunktsiooni test (ilma `alive`-mockita, OS-kutse piiril)**

Lisa `test/gate-hanked-runs.mjs`-i olemasoleva Q ploki (rida ~431-476) järele:

```js
// PID-1 (audit PR2, 22.09.2026): cleanupOrphans ILMA süstitud `alive`-argumendita
// (vaikimisi `elab`) peab käituma õigesti EPERM/tundmatu vea/ESRCH korral, kui
// process.kill on OS-KUTSE PIIRIL mockitud - mitte ainult siis, kui test ise
// annab valmis `alive`-vastuse (nagu kõik muud cleanupOrphans testid failis).
{
  const stsenaariumid = [
    { kood: "EPERM", ootus: "käib" },
    { kood: "UNKNOWN", ootus: "käib" },
    { kood: "ESRCH", ootus: "katkestatud" },
  ];
  for (const { kood, ootus } of stsenaariumid) {
    const db = testDb();
    db.prepare(
      `INSERT INTO hanke_runs (cmd, args, state, started, boot_id, pid)
        VALUES ('history', '{}', 'käib', datetime('now'), ?, 4242)`,
    ).run(OTSE_BOOT + "fixture");
    const algne = process.kill;
    try {
      process.kill = () => {
        if (kood === "UNKNOWN") throw new Error("tundmatu viga ilma koodita");
        const e = new Error("mock " + kood);
        e.code = kood;
        throw e;
      };
      cleanupOrphans(db); // VAIKIMISI alive = elab, EI anta üle
    } finally {
      process.kill = algne;
    }
    const rida = db
      .prepare("SELECT state FROM hanke_runs WHERE cmd='history'")
      .get();
    assert.equal(rida.state, ootus, kood + ": rida peaks jääma " + ootus);
    if (ootus === "käib") {
      // rida jääb kinni: sama cmd teine käivitus on endiselt blokeeritud.
      assert.throws(
        () =>
          startRun(
            db,
            "history",
            {},
            {
              spawnFn: () => {
                throw new Error("ei tohiks siia jõuda");
              },
            },
          ),
        /käib juba/,
      );
    }
    db.close();
  }
  console.log(
    "PASS runs: cleanupOrphans vaikeabifunktsioon EPERM/tundmatu/ESRCH OS-kutse piiril (PID-1)",
  );
}
```

_(implementeerija: kontrolli, kas `cleanupOrphans`/`OTSE_BOOT`/`startRun` on juba imporditud faili algusesse — kõik peaksid olema, lisa vajadusel puuduvad.)_

- [ ] **Step 2: Käivita, veendu roheline**

Run: `node test/gate-hanked-runs.mjs`

- [ ] **Step 3: DOC-1 — paranda aegunud staatuslause**

`docs/superpowers/specs/2026-09-22-pr1-jooksude-elutsykkel-design.md:192`:

Praegu: `"kood ja testid uuendatud, **commit/push tegemata** — muudatused ootavad omaniku ülevaatust."`

Muuda: `"kood ja testid uuendatud, committitud (68901e7) ja merge'itud (PR #4, d7e0924). See EI tõenda tootmisse rakendamist (Windowsi peakoopia/ajastaja/tootmismigratsioon on eraldi, kontrollimata sammud)."`

- [ ] **Step 4: Commit**

```bash
git add test/gate-hanked-runs.mjs docs/superpowers/specs/2026-09-22-pr1-jooksude-elutsykkel-design.md
git commit -m "test(hanked): cleanupOrphans vaikeabifunktsioon OS-kutse piiril + PR4 staatuse parandus

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: PDF-1 — leiaPdftotext päris puhastatud lapses

**Files:**

- Modify: `test/gate-hanked-docs.mjs`

- [ ] **Step 1: Loe `test/gate-hanked-docs.mjs` olemasolevat struktuuri, leia sobiv koht**

- [ ] **Step 2: Lisa test, mis spawnib PÄRIS lapse puhastatud env-iga ja kutsub selle SEES `leiaPdftotext()`-i**

```js
// PDF-1 (audit PR2, 22.09.2026): leiaPdftotext({env}) parameeter ei jõua
// spawnSync-ile - seega OS-tasandi PATH-otsingu tõestamiseks peab test
// käivitama PÄRIS lapse KONTROLLITUD env-iga ja kutsuma leiaPdftotext() SISEMISELT.
{
  const skript = `
    import { leiaPdftotext } from '${pathToFileURL(join(ROOT, "agent/hanked-docs.mjs")).href}';
    const tee = leiaPdftotext();
    console.log(JSON.stringify({ tee }));
  `;
  const dir = mkdtempSync(join(tmpdir(), "pdf-env-"));
  const skriptifail = join(dir, "test.mjs");
  writeFileSync(skriptifail, skript);

  // Haru A: puhas env ILMA PATH-ita (peale Windows-baasi) ja ILMA PDFTOTEXT-ita -
  // leidmine peab käima ainult teadaolevate varukohtade järgi VÕI ebaõnnestuma.
  const ilmaPath = spawnSync(process.execPath, [skriptifail], {
    env: {
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
    },
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(
    ilmaPath.status,
    0,
    "skript ise ei tohi kukkuda: " + ilmaPath.stderr,
  );

  // Haru B: PDFTOTEXT absoluutse teega üle kirjutatud - peab kasutama TÄPSELT seda,
  // kui see on kehtiv binäär (kontrolli, kas leiaPdftotext() ise annab tee ilma
  // ülekirjutuseta - kui jah, kasuta sama teed siin võrdluseks).
  const pohitulemus = JSON.parse(
    spawnSync(process.execPath, [skriptifail], {
      encoding: "utf8",
      windowsHide: true,
    }).stdout,
  );
  if (pohitulemus.tee) {
    const ulekirjutusega = spawnSync(process.execPath, [skriptifail], {
      env: {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        PDFTOTEXT: pohitulemus.tee,
      },
      encoding: "utf8",
      windowsHide: true,
    });
    const j = JSON.parse(ulekirjutusega.stdout);
    assert.equal(
      j.tee,
      pohitulemus.tee,
      "PDFTOTEXT ülekirjutus peab võitma PATH-otsingu",
    );
    console.log(
      "PASS hanked-docs: PDFTOTEXT absoluutne ülekirjutus võidab PATH-otsingu (PDF-1)",
    );
  } else {
    console.log(
      "SKIP hanked-docs: pdftotext ei ole selles keskkonnas saadaval - PDF-1 haru B jäetakse vahele",
    );
  }
}
```

_(implementeerija: Windows-native täiskäitumine on plaanis eraldi märgitud "vajalik, kuni tehtud" — see test katab PÕHIMÕTTE (puhas laps, sisemine kutse), aga käitub CI Linux-runneril nii, et kui pdftotext puudub, jääb haru B vahele nähtava `SKIP`-teatega, mitte vaikse rohelisega. Ära lase testil punaseks minna AINULT sellepärast, et CI-l pdftotext puudub — vaata olemasolevat `leiaVaravad`/`VALJAJATED` mustrit, kas see gate vajab CI-s `poppler-utils`-i, mis on juba `.github/workflows/ci.yml` offline töös installitud (vt CLAUDE.md "pdftotext on required").)_

- [ ] **Step 3: Käivita, veendu roheline (kohalikul masinal, kus pdftotext on saadaval — vt CLAUDE.md)**

Run: `node test/gate-hanked-docs.mjs`

- [ ] **Step 4: Commit**

```bash
git add test/gate-hanked-docs.mjs
git commit -m "test(hanked-docs): leiaPdftotext PATH/PDFTOTEXT haru päris puhastatud lapses

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Final: täisahela kontroll enne branchi lõpetamist

- [ ] `node tools/varav.mjs --range` (offline täisahel, vahelejätt = viga)
- [ ] `npm test` (test/gate.mjs, Playwright)
- [ ] `python tools/validate-skills.py`
- [ ] Lõplik terve-branchi review (superpowers:code-reviewer), seejärel superpowers:finishing-a-development-branch — kasutaja on andnud PÜSIVA loa commit/push/PR/CI-watch/merge'iks selles vestluses.
