# CRM Riigihanked — teostusplaan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** CRM saab seitsmenda saki „Riigihanked“ — hankeradar ja otsustuslaud, mille andmed tulevad RHR-ist CRM-i enda SQLite-baasi ja mille iga sünkimiskäsk on lehelt nupuga käivitatav.

**Architecture:** Lisav SQLite-migratsioon (`hanked`, `hanke_lepingud`, `hanke_sync`, `hanke_runs`) CRM-i olemasolevas baasis; sünk Node'i skriptidena `agent/`-is, mis trükivad edenemist JSON-ridadena stdout-i; CRM-i server käivitab need lapsprotsessina ja on ainus, kes baasi kirjutab; vaade `public/views.js`-is sama mustriga nagu olemasolevad neli lisavaadet. Skoor on puhas funktsioon, mitte mudelikõne.

**Tech Stack:** Node >= 22.5 (`node:sqlite`, `node:http`, `node:child_process`), sõltuvusteta vanilla JS klient, olemasolev `lib/zipstream.mjs`, `node:assert/strict` väravates, PowerShell Task Scheduleri jaoks.

**Disain:** `docs/plans/2026-09-20-crm-riigihanked-design.md` (commit `38f1a5a`).

---

## Enne alustamist — loe need viis asja

1. **Testid jooksevad Windowsis, mitte Linuxi-VM-ist.** `node:sqlite` ei ava monteeritud kettal olevat baasi VM-i kaudu („disk I/O error“). Käsud käivita Desktop Commanderiga:
   `cmd /c "cd /d C:\Users\gert\Desktop\LEISSON.CREATIVE\Leisson Creative\crm && node test/gate-hanked.mjs"`
2. **Testibaas käib `os.tmpdir()`-i alla**, mitte `data/` alla. Vaata eeskuju `test/gate-sales.mjs`-ist.
3. **Väravad ei tohi lugeda `data/` ega `seed/` sisu** — need on gitignore'is ja CI-s puuduvad. Kõik fikstuurid on failis sees.
4. **Pärast iga `server.mjs`, `lib/` või `public/` muudatust:** `win\restart-server.ps1`. Brauseri värskendamisest ei piisa.
5. **Iga ülesanne lõpeb commitiga.** Commitisõnumi lõppu käivad read:
   `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` ja `Claude-Session: https://claude.ai/code/session_012JWvMgTKb2Uzt1LN7xBX71`.
   Windowsi `cmd`-s tõlgendatakse `<` ja `>` ümbersuunamisena — kirjuta sõnum ajutisse faili ja kasuta `git commit -F fail.txt`, seejärel kustuta fail.

---

# Etapp F1 — andmekiht (ülesanded 1–6)

> **Plaan on ajalugu, kood on tõde.** Iga tehtud ülesande all on rida „TEOSTATUD", mis
> nimetab commiti(d). Kui plaani näidiskood ja teostus lahknevad, siis KEHTIB TEOSTUS —
> lahknevused on põhjendatud commiti sõnumis ja koodikommentaarides, mitte siin.

## Ülesanne 1: tabelid ja migratsioon

> **TEOSTATUD** — `ae2d2aa`, parandused `31ead85`, `7b5707d`. Teostus erineb plaanist: `ref` on
> `TEXT PRIMARY KEY NOT NULL`, seisul on `CHECK`, lepingute unikaalindeks on avaldisindeks
> `COALESCE`-iga, ja lausete vahemälu on baasipõhine (`WeakMap` + `finalized`-korduskatse).


**Failid:**
- Loo: `crm/lib/hanked.mjs`
- Loo: `crm/test/gate-hanked.mjs`

**Samm 1: kirjuta kukkuv test**

```js
// crm/test/gate-hanked.mjs
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrateHanked, upsertHange, listHanked } from '../lib/hanked.mjs';

function testDb() {
  const dir = mkdtempSync(join(tmpdir(), 'hanked-'));
  const db = new DatabaseSync(join(dir, 'test.sqlite'));
  db.exec('PRAGMA foreign_keys = ON');
  migrateHanked(db);
  return db;
}

{
  const db = testDb();
  upsertHange(db, { ref: '314159', rhr_id: '10682825', buyer: 'Tervise Arengu Instituut',
    buyer_reg: '70006292', title: 'Eneseabiprogramm', menetlus: 'Avatud hankemenetlus',
    est: 85000, cpv: '72230000', deadline: '2026-10-13', published: '2026-09-10', segment: 'nišš' });
  const rows = listHanked(db, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, 'uus', 'uus hange algab seisus uus');
  assert.equal(rows[0].note, null);
  console.log('PASS hanked: upsert ja vaikeseis');
}
```

**Samm 2: jooksuta ja veendu, et kukub**

Käsk: `node test/gate-hanked.mjs`
Oodatav: `ERR_MODULE_NOT_FOUND: ../lib/hanked.mjs`

**Samm 3: kirjuta minimaalne teostus**

```js
// crm/lib/hanked.mjs
export const HANKE_STATES = ['uus','vaatan','valmistun','esitatud','voidetud','kaotatud','jatsin','aegunud'];

export function migrateHanked(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hanked (
      ref TEXT PRIMARY KEY,
      rhr_id TEXT, buyer TEXT, buyer_reg TEXT, title TEXT NOT NULL,
      menetlus TEXT, nature TEXT, est INTEGER, cpv TEXT,
      deadline TEXT, published TEXT, segment TEXT,
      score INTEGER, score_why TEXT,
      state TEXT NOT NULL DEFAULT 'uus', note TEXT,
      docs_dir TEXT, docs_count INTEGER NOT NULL DEFAULT 0,
      seen TEXT NOT NULL DEFAULT (datetime('now')),
      updated TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS hanke_lepingud (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT, date TEXT NOT NULL, buyer TEXT, title TEXT, cpv TEXT,
      winner TEXT, winner_reg TEXT, winner_size TEXT,
      amount INTEGER, tenders INTEGER, menetlus TEXT, segment TEXT,
      UNIQUE (ref, winner_reg, amount)
    );
    CREATE INDEX IF NOT EXISTS idx_lep_cpv ON hanke_lepingud(cpv);
    CREATE INDEX IF NOT EXISTS idx_lep_date ON hanke_lepingud(date);
    CREATE TABLE IF NOT EXISTS hanke_sync (
      key TEXT PRIMARY KEY, ts TEXT NOT NULL, rows INTEGER, ok INTEGER NOT NULL DEFAULT 1, note TEXT
    );
    CREATE TABLE IF NOT EXISTS hanke_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cmd TEXT NOT NULL, args TEXT, state TEXT NOT NULL,
      started TEXT NOT NULL, finished TEXT,
      progress TEXT, rows INTEGER, log TEXT, error TEXT, pid INTEGER
    );
  `);
}

const FIELDS = ['rhr_id','buyer','buyer_reg','title','menetlus','nature','est','cpv','deadline','published','segment'];

export function upsertHange(db, h) {
  const olemas = db.prepare('SELECT ref FROM hanked WHERE ref = ?').get(h.ref);
  if (!olemas) {
    db.prepare(`INSERT INTO hanked (ref,${FIELDS.join(',')}) VALUES (?,${FIELDS.map(() => '?').join(',')})`)
      .run(h.ref, ...FIELDS.map((f) => h[f] ?? null));
    return 'uus';
  }
  // Avastusväljad uuenevad, inimese omad (state, note) EI uuene kunagi.
  db.prepare(`UPDATE hanked SET ${FIELDS.map((f) => f + ' = COALESCE(?, ' + f + ')').join(', ')},
              updated = datetime('now') WHERE ref = ?`).run(...FIELDS.map((f) => h[f] ?? null), h.ref);
  return 'uuendatud';
}

export function listHanked(db, { state = null } = {}) {
  const sql = 'SELECT * FROM hanked' + (state ? ' WHERE state = ?' : '') + " ORDER BY COALESCE(deadline,'9999') ASC";
  return state ? db.prepare(sql).all(state) : db.prepare(sql).all();
}
```

**Samm 4: jooksuta ja veendu, et läbib**

Käsk: `node test/gate-hanked.mjs`
Oodatav: `PASS hanked: upsert ja vaikeseis`

**Samm 5: commiti**

```bash
git add crm/lib/hanked.mjs crm/test/gate-hanked.mjs
git commit -F commitmsg.txt   # "feat(hanked): tabelid ja upsert, mis ei kirjuta seisu üle"
```

---

## Ülesanne 2: seis ja märkus jäävad sünkides puutumata

> **TEOSTATUD** — `c234464`. Kriitiline parandus plaani suhtes: `markExpired` võrdleb
> `date()`-ga, mitte stringidena (`'13.10.2026'` aegus muidu kohe), ja `today` valideeritakse.
> `setNote` kasutab sama normaliseerijat mis `upsertHange`.


**Failid:**
- Muuda: `crm/test/gate-hanked.mjs` (lisa plokk)
- Muuda: `crm/lib/hanked.mjs` (lisa `setState`, `setNote`, `markExpired`)

**Samm 1: kirjuta kukkuv test**

```js
import { migrateHanked, upsertHange, listHanked, setState, setNote, markExpired } from '../lib/hanked.mjs';

{
  const db = testDb();
  upsertHange(db, { ref: '111', title: 'Veebileht', deadline: '2026-10-01' });
  setState(db, '111', 'valmistun');
  setNote(db, '111', 'Küsi majutuse kohta');
  upsertHange(db, { ref: '111', title: 'Veebileht (muudetud)', deadline: '2026-10-08' });
  const h = listHanked(db, {})[0];
  assert.equal(h.state, 'valmistun', 'sünk ei tohi seisu üle kirjutada');
  assert.equal(h.note, 'Küsi majutuse kohta', 'sünk ei tohi märkust kustutada');
  assert.equal(h.title, 'Veebileht (muudetud)', 'avastusväli uueneb');
  assert.equal(h.deadline, '2026-10-08');
  console.log('PASS hanked: sünk ei puutu inimese välju');
}

{
  const db = testDb();
  upsertHange(db, { ref: 'a', title: 'A', deadline: '2020-01-01' });           // vana, uus
  upsertHange(db, { ref: 'b', title: 'B', deadline: '2020-01-01' });
  setState(db, 'b', 'esitatud');
  const n = markExpired(db, '2026-09-20');
  assert.equal(n, 1, 'ainult üks läks aegunuks');
  const map = Object.fromEntries(listHanked(db, {}).map((r) => [r.ref, r.state]));
  assert.equal(map.a, 'aegunud');
  assert.equal(map.b, 'esitatud', 'esitatud pakkumus ei aegu');
  console.log('PASS hanked: aegumine puudutab ainult seisu uus');
}
```

**Samm 2: jooksuta** — `node test/gate-hanked.mjs`, oodatav: `SyntaxError`/`setState is not a function`.

**Samm 3: teosta**

```js
export function setState(db, ref, state) {
  if (!HANKE_STATES.includes(state)) throw new Error('Tundmatu seis: ' + state);
  const r = db.prepare("UPDATE hanked SET state = ?, updated = datetime('now') WHERE ref = ?").run(state, ref);
  if (!r.changes) throw new Error('Hanget ei leitud: ' + ref);
  return { ok: true };
}

export function setNote(db, ref, note) {
  const r = db.prepare("UPDATE hanked SET note = ?, updated = datetime('now') WHERE ref = ?")
    .run(note?.trim() ? note.trim() : null, ref);
  if (!r.changes) throw new Error('Hanget ei leitud: ' + ref);
  return { ok: true };
}

export function markExpired(db, today = new Date().toISOString().slice(0, 10)) {
  return db.prepare("UPDATE hanked SET state = 'aegunud', updated = datetime('now') WHERE state = 'uus' AND deadline IS NOT NULL AND deadline < ?").run(today).changes;
}
```

**Samm 4: jooksuta** — mõlemad uued read PASS.

**Samm 5: commiti** — `feat(hanked): seis, märkus ja aegumine`

---

## Ülesanne 3: RSS-i lugeja ja nišifilter

> **TEOSTATUD** — `eb8e0b1`, parandused `d482884`, `ddead1c`. Kolm viga, mida plaanis ei olnud:
> FIT peab vaatama pealkirja JA kirjeldust (muidu 3 leidu 6 asemel); sama ref tuleb feedis
> mitu korda ja vanem teade kirjutas uuema üle; puuduv/parseerimatu `pubDate` laskis vanemal
> ikkagi võita. `segmentOf(title, kirjeldus)` peab jääma sünkroonis failiga
> `riigihanked/rhr_tools/rhr_watch.py`.


**Failid:**
- Muuda: `crm/lib/hanked.mjs` (lisa `FIT`, `EXCL`, `SMALLWEB`, `segmentOf`, `parseRss`)
- Muuda: `crm/test/gate-hanked.mjs`

**Samm 1: kirjuta kukkuv test** — fikstuur on failis sees, võrku ei puututa.

```js
import { parseRss, segmentOf } from '../lib/hanked.mjs';

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0"><channel>
<item><title>314159 - Digitaalse eneseabiprogrammi „Aitab“ arendus- ja hooldustööd</title>
<link>https://riigihanked.riik.ee/rhr-web/#/procurement/10682825/notices</link>
<description>Teenused; Avatud hankemenetlus; Programmi arendus; Tähtaeg: 13.10.2026 11:00</description>
<pubDate>Wed, 10 Sep 2026 07:00:04 GMT</pubDate>
<dc:creator>Tervise Arengu Instituut</dc:creator></item>
<item><title>315624 - Kevade eramud liitumine detailplaneeringu alal</title>
<link>https://riigihanked.riik.ee/rhr-web/#/procurement/10827704/notices</link>
<description>Ehitustööd; Väikehange; Ehitada vastavalt projektile; Tähtaeg: 30.09.2026 10:00</description>
<pubDate>Thu, 18 Sep 2026 07:00:17 GMT</pubDate>
<dc:creator>Elektrilevi OÜ</dc:creator></item>
<item><title>315700 - Valla noorteinfo veebileht</title>
<link>https://riigihanked.riik.ee/rhr-web/#/procurement/10900000/notices</link>
<description>Teenused; Väikehange; Uue veebilehe loomine; Tähtaeg: 02.10.2026 12:00</description>
<pubDate>Fri, 19 Sep 2026 06:00:00 GMT</pubDate>
<dc:creator>Sakala Keskus</dc:creator></item>
</channel></rss>`;

{
  const rows = parseRss(RSS_FIXTURE);
  assert.equal(rows.length, 2, 'ehitustööd jäävad välja');
  const a = rows.find((r) => r.ref === '314159');
  assert.equal(a.rhr_id, '10682825');
  assert.equal(a.buyer, 'Tervise Arengu Instituut');
  assert.equal(a.deadline, '2026-10-13');
  assert.equal(a.menetlus, 'Avatud hankemenetlus');
  assert.equal(a.segment, 'nišš');
  assert.equal(rows.find((r) => r.ref === '315700').segment, 'väike veebileht');
  console.log('PASS hanked: RSS-i parser ja filter');
}

assert.equal(segmentOf('Tallinna disainisüsteemi edasiarendus'), 'nišš');
assert.equal(segmentOf('Ligipääsetavuse audit'), 'nišš');
assert.equal(segmentOf('Bussipeatuste ligipääsetavuse parandamine'), null, 'ehituslik ligipääsetavus ei ole meie nišš');
console.log('PASS hanked: segmentOf');
```

**Samm 2: jooksuta** — oodatav: `parseRss is not a function`.

**Samm 3: teosta** (regexid tulevad `riigihanked/rhr_tools/rhr_watch.py`-st, hoia samad):

```js
export const FIT = /veebi(leh|keskkon|portaal|sait|lahend|arendus)|koduleh|\bportaal|kasutajakogemus|kasutajaliides|\bux\b|\bui\b|teenusedisain|disainis[üu]steem|kasutajauuring|kasutatavus|protot[üu][üu]p|ligipääsetavus|wcag|tehisaru|tehisintellekt|\bai\b|keelemudel|vestlusrobot|juturobot|chatbot|visuaalne identiteet|\bcvi\b|br[äa]ndi|kujundust[öo][öo]|graafiline disain|digiturundus|sotsiaalmeedia|e-teenus|iseteenindus|rakenduse arendus|mobiilirakendus|digilahendus|digitaalse eneseabi|e-kursus|veebikoolitus/i;
export const EXCL = /ehitus|projekteeri|planeering|kinnisvara|keskkonnam[õo]ju|arhitekt|[üu]histransport|bussipeat|puude|j[õo]uluvalg|sisekujundus|tr[üu]kis|meene|litsents|videovalve/i;
export const SMALLWEB = /veebileh|koduleh|veebilahendus|veebisait|veebikeskkon|veebilehtede|kodulehe/i;

export function segmentOf(title) {
  if (!title || EXCL.test(title)) return null;
  if (!FIT.test(title)) return null;
  return SMALLWEB.test(title) ? 'väike veebileht' : 'nišš';
}

export function parseRss(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const pick = (tag) => (it.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'))?.[1] ?? '').trim();
    const title = pick('title');
    const desc = pick('description');
    const osad = desc.split(';').map((s) => s.trim());
    if (['Ehitustööd', 'Asjad'].includes(osad[0])) continue;
    const nimi = title.replace(/^\d+\s*-\s*/, '');
    const segment = segmentOf(nimi);
    if (!segment) continue;
    const d = desc.match(/Tähtaeg:\s*(\d\d)\.(\d\d)\.(\d{4})/);
    out.push({
      ref: (title.match(/^(\d+)/) || [])[1] || null,
      rhr_id: (pick('link').match(/procurement\/(\d+)/) || [])[1] || null,
      buyer: pick('dc:creator') || null,
      title: nimi, nature: osad[0] || null, menetlus: osad[1] || null,
      deadline: d ? `${d[3]}-${d[2]}-${d[1]}` : null,
      published: new Date(pick('pubDate')).toISOString().slice(0, 10),
      segment, est: null, cpv: null,
    });
  }
  return out.filter((r) => r.ref);
}
```

**Samm 4: jooksuta** — kaks uut PASS-rida.

**Samm 5: commiti** — `feat(hanked): RSS-i parser ja nišifilter`

---

## Ülesanne 4: skoor ja põhjendus

> **TEOSTATUD** — `3bff69d`. Teostus erineb plaani näidiskoodist seitsmes kohas, kõik
> kommenteeritud koodis: +40 on tingimuslik (tundmatu segment annab nähtava nullrea);
> vahemik 140 001 – 1 M € on teadlik auk; alltöövõtu põhjus nimetab mõlemad põhjused;
> vigane tähtaeg annab nullrea ja vigane `today` viskab; vorming `57 000 €`; `est`
> valideeritakse nagu `viide()`; punkte ei lõigata nulli.


**Failid:**
- Muuda: `crm/lib/hanked.mjs` (lisa `score`)
- Muuda: `crm/test/gate-hanked.mjs`

**Samm 1: kirjuta kukkuv test**

```js
import { score } from '../lib/hanked.mjs';

{
  const r = score({ title: 'Veebilehe arendus', segment: 'väike veebileht', est: 45000,
    menetlus: 'Lihthange', crit: ['price', 'quality'], deadline: '2026-12-01' },
    { today: '2026-10-01', ajalugu: null });
  assert.equal(r.points, 80);               // 40 + 10 + 15 + 10 + 5
  assert.equal(r.verdict, 'PAKU');
  assert.ok(r.why.some((x) => x.includes('+15')), 'põhjendus sisaldab maksumuse rida');
}

{
  const r = score({ title: 'Infosüsteemi arendus', segment: 'nišš', est: 4000000,
    menetlus: 'Avatud hankemenetlus', crit: ['price'], deadline: '2026-12-01',
    rollid: 3 }, { today: '2026-10-01', ajalugu: { medianTenders: 11 } });
  assert.equal(r.verdict, 'ALLTÖÖVÕTT', 'kolm rolli sunnib alltöövõttu');
  assert.ok(r.points < 35);
}

{
  const a = score({ title: 'UX audit', segment: 'nišš', est: 30000, menetlus: 'Väikehange',
    crit: ['quality'], deadline: '2026-10-02' }, { today: '2026-10-01', ajalugu: null });
  const b = score({ title: 'UX audit', segment: 'nišš', est: 30000, menetlus: 'Väikehange',
    crit: ['quality'], deadline: '2026-11-02' }, { today: '2026-10-01', ajalugu: null });
  assert.equal(b.points - a.points, 15, 'alla kolme päeva tähtaeg maksab 15 punkti');
  console.log('PASS hanked: skoor ja põhjendus');
}
```

**Samm 2: jooksuta** — oodatav: `score is not a function`.

**Samm 3: teosta**

```js
export function score(h, { today = new Date().toISOString().slice(0, 10), ajalugu = null, docs = null } = {}) {
  const why = [];
  const add = (p, txt) => { why.push((p > 0 ? '+' : '') + p + ' · ' + txt); return p; };
  let points = 0;
  points += add(40, 'nišš: ' + (h.segment || '—'));
  if (h.segment === 'väike veebileht') points += add(10, 'väikese veebilehe segment');
  if (h.est != null) {
    if (h.est <= 50000) points += add(15, 'maksumus ' + h.est + ' €');
    else if (h.est <= 140000) points += add(10, 'maksumus ' + h.est + ' €');
    else if (h.est > 1000000) points += add(-10, 'maksumus ' + h.est + ' € — üksi ei kata');
  }
  const crit = h.crit || [];
  if (crit.includes('quality')) points += add(docs?.qualityWeight >= 50 ? 20 : 10, 'kvaliteedikriteerium' + (docs?.qualityWeight ? ' (' + docs.qualityWeight + ' %)' : ''));
  if (/lihthange|väikehange/i.test(h.menetlus || '')) points += add(5, h.menetlus);
  const rollid = docs?.rollid ?? h.rollid ?? null;
  const kaive = docs?.kaiveNoue ?? h.kaiveNoue ?? null;
  const allt = (rollid != null && rollid >= 3) || (kaive != null && kaive > 50000);
  if (allt) points += add(-25, rollid >= 3 ? rollid + ' rolli CV-nõuet' : 'käibenõue ' + kaive + ' €');
  if (ajalugu?.medianTenders != null) {
    if (ajalugu.medianTenders >= 8) points += add(-10, 'sama CPV: mediaan ' + ajalugu.medianTenders + ' pakkujat');
    else if (ajalugu.medianTenders <= 3) points += add(5, 'sama CPV: mediaan ' + ajalugu.medianTenders + ' pakkujat');
  }
  if (h.deadline) {
    const paevi = Math.round((Date.parse(h.deadline) - Date.parse(today)) / 86400000);
    if (paevi < 3) points += add(-15, 'tähtajani ' + paevi + ' päeva');
  }
  const verdict = allt ? 'ALLTÖÖVÕTT' : points >= 60 ? 'PAKU' : points >= 35 ? 'KAALU' : 'JÄTA';
  return { points, verdict, why };
}
```

**Samm 4: jooksuta** — PASS.

**Samm 5: commiti** — `feat(hanked): sobivuse skoor puhta funktsioonina`

---

## Ülesanne 5: sünkimisskript (RSS → baas)

**Failid:**
- Loo: `crm/agent/hanked-sync.mjs`
- Muuda: `crm/package.json` (skript `hanked:sync`, `hanked:gate`)
- Muuda: `crm/test/gate-hanked.mjs`

**Samm 1: kirjuta kukkuv test** — skript ise ei jookse testis; testime puhast funktsiooni `syncFromXml`, mis võtab XML-i stringina.

```js
import { syncFromXml } from '../agent/hanked-sync.mjs';

{
  const db = testDb();
  const r1 = syncFromXml(db, RSS_FIXTURE, { today: '2026-09-20' });
  assert.equal(r1.uus, 2);
  const r2 = syncFromXml(db, RSS_FIXTURE, { today: '2026-09-20' });
  assert.equal(r2.uus, 0, 'teine jooks ei tekita dublikaate');
  assert.equal(r2.uuendatud, 2);
  const h = listHanked(db, {}).find((x) => x.ref === '314159');
  assert.ok(h.score > 0 && h.score_why.includes('+'), 'skoor ja põhjendus salvestatakse');
  const log = db.prepare("SELECT * FROM hanke_sync WHERE key='rss'").get();
  assert.equal(log.ok, 1);
  console.log('PASS hanked: sünk on idempotentne');
}
```

**Samm 2: jooksuta** — oodatav: `ERR_MODULE_NOT_FOUND: ../agent/hanked-sync.mjs`.

**Samm 3: teosta**

```js
// crm/agent/hanked-sync.mjs
import { open } from '../lib/db.mjs';
import { migrateHanked, parseRss, upsertHange, markExpired, score } from '../lib/hanked.mjs';

const RSS = 'https://riigihanked.riik.ee/rhr/api/public/v1/rss';
const teata = (o) => process.stdout.write(JSON.stringify(o) + '\n');   // server loeb neid ridu

export function syncFromXml(db, xml, { today = new Date().toISOString().slice(0, 10) } = {}) {
  migrateHanked(db);
  const rows = parseRss(xml);
  let uus = 0, uuendatud = 0;
  db.exec('BEGIN IMMEDIATE');                      // kõik või mitte midagi
  try {
    for (const h of rows) {
      const s = score(h, { today });
      const tulem = upsertHange(db, h);
      db.prepare('UPDATE hanked SET score = ?, score_why = ? WHERE ref = ?')
        .run(s.points, JSON.stringify(s.why), h.ref);
      if (tulem === 'uus') uus++; else uuendatud++;
    }
    const aegunud = markExpired(db, today);
    db.prepare(`INSERT INTO hanke_sync (key, ts, rows, ok) VALUES ('rss', datetime('now'), ?, 1)
                ON CONFLICT(key) DO UPDATE SET ts = excluded.ts, rows = excluded.rows, ok = 1, note = NULL`)
      .run(rows.length);
    db.exec('COMMIT');
    return { uus, uuendatud, aegunud, kokku: rows.length };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

async function main() {
  const db = open();
  teata({ progress: 'laen RSS-i' });
  const res = await fetch(RSS, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) { teata({ error: 'RHR vastas ' + res.status }); process.exit(1); }
  const r = syncFromXml(db, await res.text());
  teata({ progress: r.uus + ' uut · ' + r.uuendatud + ' uuendatud · ' + r.aegunud + ' aegunud', rows: r.kokku });
  teata({ done: true, rows: r.kokku });
}

if (import.meta.url === 'file://' + process.argv[1].replace(/\\/g, '/')) main();
```

`package.json`: lisa `"hanked:sync": "node agent/hanked-sync.mjs"`. ~~lisa `&& node test/gate-hanked.mjs` ahela `test:offline` lõppu~~ — **aegunud**: `test:offline` on alates `1a9b2f8`-st `node tools/varav.mjs`, mis avastab väravad ise.

**Samm 4: jooksuta** — `node test/gate-hanked.mjs` PASS, seejärel üks päris jooks: `npm run hanked:sync` peab lõppema `{"done":true,...}` reaga.

**Samm 5: commiti** — `feat(hanked): RSS-i sünk baasi, idempotentne`

---

## Ülesanne 6: eForms-parser (ettevalmistus ajaloole)

> **TEOSTATUD** — `8edc438`. Näidiskood oli mõõdetult vale: päris kuu (956 teadet) peal andis
> ta **274 teatel (29 %) vale või väljamõeldud võitja**, `notice_id` oli 956/956 vale ja `date`
> võttis 591 teatel lepingu sõlmimise kuupäeva teate kuupäeva asemel — see oleks ülesande 12
> 24 kuu akna vaikselt nihutanud. Teostus võtab võitja ahelast
> `LotResult → LotTender → TenderingParty → Tenderer → Organization` (nagu `rhr_parse.py`),
> valib statistika liigi järgi ja märgib iga oletuse väljadega `winner_allikas`,
> `tenders_allikas`, `amount_allikas`. Võrreldud `rhr_parse.py`-ga: 956/956 identne kõigil
> võrreldavatel väljadel.


**Failid:**
- Loo: `crm/lib/eforms.mjs`
- Muuda: `crm/test/gate-hanked.mjs`

**Samm 1: kirjuta kukkuv test.** Fikstuur sisaldab tahtlikult teadet, mille tekstiväljas esineb string `</ContractAwardNotice>` — see on lõks, mis lõhub naiivse tükeldaja.

```js
import { splitNotices, parseAward } from '../lib/eforms.mjs';

const AWARD_FIXTURE = `<OPEN-DATA>
<ContractAwardNotice><cbc:IssueDate>2026-08-04</cbc:IssueDate>
<cac:ProcurementProject><cbc:ID>312679-0000</cbc:ID><cbc:Name languageID="EST">Disainisüsteemi edasiarendus</cbc:Name>
<cbc:ProcurementTypeCode listName="contract-nature">services</cbc:ProcurementTypeCode>
<cac:MainCommodityClassification><cbc:ItemClassificationCode listName="cpv">72413000</cbc:ItemClassificationCode></cac:MainCommodityClassification></cac:ProcurementProject>
<efac:Organization><efac:Company><cac:PartyName><cbc:Name languageID="EST">Tallinna Strateegiakeskus</cbc:Name></cac:PartyName><cbc:CompanyID>75014913</cbc:CompanyID></efac:Company></efac:Organization>
<efac:Organization><efac:Company><cac:PartyName><cbc:Name languageID="EST">VELVET OÜ</cbc:Name></cac:PartyName><cbc:CompanyID>11221221</cbc:CompanyID><efbc:CompanySizeCode>small</efbc:CompanySizeCode></efac:Company></efac:Organization>
<efac:ReceivedSubmissionsStatistics><efbc:StatisticsNumeric>16</efbc:StatisticsNumeric></efac:ReceivedSubmissionsStatistics>
<cbc:PayableAmount currencyID="EUR">50000.00</cbc:PayableAmount>
<cbc:Note languageID="EST">Tekstis esineb string &lt;/ContractAwardNotice&gt; nagu päris teadetes</cbc:Note>
</ContractAwardNotice>
<ContractAwardNotice><cbc:IssueDate>2026-08-05</cbc:IssueDate>
<cac:ProcurementProject><cbc:ID>300811-0000</cbc:ID><cbc:Name languageID="EST">Kontorimööbel</cbc:Name>
<cbc:ProcurementTypeCode listName="contract-nature">supplies</cbc:ProcurementTypeCode></cac:ProcurementProject>
</ContractAwardNotice></OPEN-DATA>`;

{
  const tykid = splitNotices(AWARD_FIXTURE, 'ContractAwardNotice');
  assert.equal(tykid.length, 2, 'tekstis olev lõputag ei tohi teadet pooleks lõigata');
  const a = parseAward(tykid[0]);
  assert.equal(a.ref, '312679');
  assert.equal(a.date, '2026-08-04');
  assert.equal(a.nature, 'services');
  assert.equal(a.cpv, '72413000');
  assert.equal(a.buyer, 'Tallinna Strateegiakeskus');
  assert.equal(a.winner, 'VELVET OÜ');
  assert.equal(a.winner_size, 'small');
  assert.equal(a.tenders, 16);
  assert.equal(a.amount, 50000);
  assert.equal(parseAward(tykid[1]).nature, 'supplies');
  console.log('PASS eforms: teadete piir ja väljad');
}
```

**Samm 2: jooksuta** — oodatav: `ERR_MODULE_NOT_FOUND: ../lib/eforms.mjs`.

**Samm 3: teosta.** Võti: tükelda ALATI avatagi järgi ja lõpeta järgmise avatagi ees, mitte lõputagi järgi (nii ei sega tekstis olev lõputag).

```js
// crm/lib/eforms.mjs — teatepiiri järgi tükeldav lugeja, mitte täisparser.
export function splitNotices(xml, tag) {
  const algus = new RegExp('<' + tag + '[\\s>]', 'g');
  const idx = [...xml.matchAll(algus)].map((m) => m.index);
  return idx.map((a, i) => xml.slice(a, i + 1 < idx.length ? idx[i + 1] : xml.length));
}

const t = (blk, re) => (blk.match(re)?.[1] ?? '').trim() || null;
const num = (v) => (v == null ? null : Math.round(Number(v)));

export function parseAward(blk) {
  const orgs = [...blk.matchAll(/<efac:Company>([\s\S]*?)<\/efac:Company>/g)].map((m) => ({
    name: t(m[1], /<cbc:Name[^>]*>([^<]+)</),
    reg: t(m[1], /<cbc:CompanyID>([^<]+)</),
    size: t(m[1], /<efbc:CompanySizeCode[^>]*>([^<]+)</),
  }));
  const stats = [...blk.matchAll(/<efbc:StatisticsNumeric>(\d+)<\/efbc:StatisticsNumeric>/g)].map((m) => Number(m[1]));
  const winner = orgs.find((o) => o.size) || orgs[1] || null;
  return {
    ref: (t(blk, /<cac:ProcurementProject>[\s\S]*?<cbc:ID>([^<]+)</) || '').split('-')[0] || null,
    date: (t(blk, /<cbc:IssueDate>([^<]+)</) || '').slice(0, 10) || null,
    title: t(blk, /<cac:ProcurementProject>[\s\S]*?<cbc:Name[^>]*>([^<]+)</),
    nature: t(blk, /<cbc:ProcurementTypeCode listName="contract-nature">([^<]+)</),
    cpv: t(blk, /<cbc:ItemClassificationCode listName="cpv">([^<]+)</),
    buyer: orgs[0]?.name ?? null, buyer_reg: orgs[0]?.reg ?? null,
    winner: winner?.name ?? null, winner_reg: winner?.reg ?? null, winner_size: winner?.size ?? null,
    amount: num(t(blk, /<cbc:PayableAmount[^>]*>([\d.]+)</)),
    tenders: stats.length ? Math.max(...stats) : null,
    menetlus: t(blk, /<cbc:ProcedureCode[^>]*>([^<]+)</),
  };
}
```

**Samm 4: jooksuta** — PASS.

**Samm 5: commiti** — `feat(hanked): eForms-lugeja koos teatepiiri regressioonitestiga`

**Etapi F1 lõpp:** jooksuta `npm test` (kõik väravad) ja veendu, et 114+ kontrolli on rohelised. Alles siis järgmine etapp.

---

# Etapp F2 — leht ja nupud (ülesanded 7–11)

## Ülesanne 7: käivitaja lukuga

> **TEOSTATUD** — `4c3fc54`. 409-lukk ei ole kontroll-siis-INSERT, vaid osaline unikaalindeks
> `(cmd) WHERE state='käib'` — kaks paralleelset päringut ei saa enam mõlemad läbi. Serveril on
> `boot_id`, sest pid-id lähevad pärast taaskäivitust ringlusse: võõra instantsi jooks on alati orb
> ja teda ei tapeta pid-i järgi. Logi puhverdatakse mälus: **2401 baasikirjutust → 4**. Plaani väide
> „`exit` kaotab viimased read" ei reprodutseerunud — `close` valiti, sest ta ei ole kunagi halvem.


**Failid:**
- Loo: `crm/lib/hanked-runs.mjs`
- Muuda: `crm/test/gate-hanked.mjs`

**Samm 1: kirjuta kukkuv test.** Päris protsessi ei käivitata — `spawnFn` antakse sisse.

```js
import { startRun, finishRun, runsView, cleanupOrphans } from '../lib/hanked-runs.mjs';

{
  const db = testDb();
  const fake = () => ({ pid: 4242, stdout: { on() {} }, stderr: { on() {} }, on() {} });
  const r1 = startRun(db, 'sync', {}, { spawnFn: fake });
  assert.equal(r1.state, 'käib');
  assert.throws(() => startRun(db, 'sync', {}, { spawnFn: fake }), /käib juba/, 'teist jooksu ei alga');
  startRun(db, 'history', {}, { spawnFn: fake });   // teine käsk tohib käia paralleelselt
  finishRun(db, r1.id, { ok: true, rows: 41 });
  const v = runsView(db);
  assert.equal(v.find((x) => x.id === r1.id).state, 'tehtud');
  console.log('PASS runs: üks jooks korraga käsu kohta');
}

{
  const db = testDb();
  const fake = () => ({ pid: 999999, stdout: { on() {} }, stderr: { on() {} }, on() {} });
  startRun(db, 'sync', {}, { spawnFn: fake });
  const n = cleanupOrphans(db, { alive: () => false });
  assert.equal(n, 1);
  assert.match(runsView(db)[0].error, /taaskäivitati/);
  console.log('PASS runs: serveri taaskäivitus ei jäta spinnerit');
}
```

**Samm 2: jooksuta** — oodatav: moodul puudub.

**Samm 3: teosta**

```js
// crm/lib/hanked-runs.mjs
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './env.mjs';

const LOG_MAX = 4000;
export const CMD = {
  sync:    { script: 'agent/hanked-sync.mjs',    label: 'Sünkroon' },
  history: { script: 'agent/hanked-history.mjs', label: 'Lae ajalugu' },
  docs:    { script: 'agent/hanked-docs.mjs',    label: 'Lae dokumendid' },
  gate:    { script: 'test/gate-hanked.mjs',     label: 'Värav' },
};

export function startRun(db, cmd, args = {}, { spawnFn = spawn } = {}) {
  if (!CMD[cmd]) throw new Error('Tundmatu käsk: ' + cmd);
  const kaib = db.prepare("SELECT id FROM hanke_runs WHERE cmd = ? AND state = 'käib'").get(cmd);
  if (kaib) { const e = new Error(CMD[cmd].label + ' käib juba'); e.runId = kaib.id; e.code = 409; throw e; }
  const id = db.prepare(`INSERT INTO hanke_runs (cmd,args,state,started) VALUES (?,?,'käib',datetime('now'))`)
    .run(cmd, JSON.stringify(args)).lastInsertRowid;
  const argv = [join(ROOT, CMD[cmd].script), ...Object.entries(args).map(([k, v]) => `--${k}=${v}`)];
  const laps = spawnFn(process.execPath, argv, { cwd: ROOT });
  db.prepare('UPDATE hanke_runs SET pid = ? WHERE id = ?').run(laps.pid ?? null, id);
  lapseKuulajad(db, id, laps);
  return { id: Number(id), state: 'käib', cmd };
}

function lapseKuulajad(db, id, laps) {
  let puhver = '';
  laps.stdout?.on('data', (tk) => {
    puhver += tk;
    const read = puhver.split('\n'); puhver = read.pop();
    for (const rida of read) {
      let o = null; try { o = JSON.parse(rida); } catch { /* logirida */ }
      if (o?.progress) db.prepare('UPDATE hanke_runs SET progress = ?, rows = COALESCE(?, rows) WHERE id = ?').run(o.progress, o.rows ?? null, id);
      lisaLogi(db, id, rida);
    }
  });
  laps.stderr?.on('data', (tk) => lisaLogi(db, id, String(tk)));
  laps.on?.('exit', (kood) => finishRun(db, id, { ok: kood === 0, error: kood === 0 ? null : 'Protsess lõppes koodiga ' + kood }));
}

function lisaLogi(db, id, rida) {
  const vana = db.prepare('SELECT log FROM hanke_runs WHERE id = ?').get(id)?.log ?? '';
  const uus = (vana + rida + '\n').slice(-LOG_MAX);
  db.prepare('UPDATE hanke_runs SET log = ? WHERE id = ?').run(uus, id);
}

export function finishRun(db, id, { ok = true, rows = null, error = null } = {}) {
  db.prepare(`UPDATE hanke_runs SET state = ?, finished = datetime('now'), rows = COALESCE(?, rows), error = ?
              WHERE id = ? AND state = 'käib'`).run(ok ? 'tehtud' : 'viga', rows, error, id);
}

export function stopRun(db, id, { kill = (pid) => process.kill(pid, 'SIGTERM') } = {}) {
  const r = db.prepare("SELECT pid FROM hanke_runs WHERE id = ? AND state = 'käib'").get(id);
  if (!r) return { ok: false, error: 'See jooks ei käi' };
  if (r.pid) try { kill(r.pid); } catch { /* juba surnud */ }
  db.prepare("UPDATE hanke_runs SET state='katkestatud', finished=datetime('now') WHERE id = ?").run(id);
  return { ok: true };
}

export function cleanupOrphans(db, { alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } } } = {}) {
  const read = db.prepare("SELECT id, pid FROM hanke_runs WHERE state = 'käib'").all();
  let n = 0;
  for (const r of read) if (!r.pid || !alive(r.pid)) {
    db.prepare("UPDATE hanke_runs SET state='katkestatud', finished=datetime('now'), error='Server taaskäivitati' WHERE id = ?").run(r.id);
    n++;
  }
  return n;
}

export function runsView(db, limit = 5) {
  return db.prepare('SELECT * FROM hanke_runs ORDER BY id DESC LIMIT ?').all(limit);
}
```

**Samm 4: jooksuta** — kaks uut PASS-rida.

**Samm 5: commiti** — `feat(hanked): käivitaja lukuga ja orbude koristus`

---

## Ülesanne 8: marsruudid

> **TEOSTATUD** — `68a3aa9`. Plaani import oleks serveri käivitumast takistanud (`hangeDetail`
> tuleb alles ülesandes 13, ESM viskab puuduva ekspordi peale) — tehtud minimaalne `hangeDetail`.
> Toores `e.message` ei lähe enam kliendile: ainult numbrilise koodiga (400/404/409) erindid,
> muu on 500 + serveri logi. Polliv vastus 20 KB → 6,3 KB (`logTail` 400 märki, mitte täislogi).


**Failid:**
- Muuda: `crm/lib/routes2.mjs` (kuus marsruuti `extraRoutes`-i sisse)
- Muuda: `crm/server.mjs` (kutsu `cleanupOrphans` käivitumisel, `migrateHanked` `initSales` kõrval)

**Samm 1: kirjuta kukkuv test** (marsruudid on objektivõtmed — testi nende olemasolu ja lukuvastust):

```js
import { extraRoutes } from '../lib/routes2.mjs';
{
  const db = testDb();
  const marsruudid = extraRoutes(db, {}, { json: () => {}, readBody: async () => ({}), mail: {} });
  for (const k of ['GET /api/hanked', 'POST /api/hanked/run', 'GET /api/hanked/runs'])
    assert.ok(marsruudid[k], 'marsruut puudub: ' + k);
  console.log('PASS hanked: marsruudid registreeritud');
}
```

**Samm 2: jooksuta** — oodatav: `marsruut puudub: GET /api/hanked`.

**Samm 3: teosta.** `lib/routes2.mjs` importidesse:

```js
import { migrateHanked, listHanked, setState, setNote, hangeDetail } from './hanked.mjs';
import { startRun, stopRun, runsView, CMD } from './hanked-runs.mjs';
```

ja `extraRoutes`-i tagastatavasse objekti:

```js
    'GET /api/hanked': async (req, res) => json(res, 200, { hanked: listHanked(db, {}), tasks: CMD, runs: runsView(db) }),
    'POST /api/hanked/detail': async (req, res) => {
      const { ref } = await readBody(req);
      try { json(res, 200, hangeDetail(db, ref)); } catch (e) { json(res, 404, { error: e.message }); }
    },
    'POST /api/hanked/state': async (req, res) => {
      const { ref, state } = await readBody(req);
      try { json(res, 200, setState(db, ref, state)); } catch (e) { json(res, 400, { error: e.message }); }
    },
    'POST /api/hanked/note': async (req, res) => {
      const { ref, note } = await readBody(req);
      try { json(res, 200, setNote(db, ref, note)); } catch (e) { json(res, 400, { error: e.message }); }
    },
    'POST /api/hanked/run': async (req, res) => {
      const { cmd, args } = await readBody(req);
      try { json(res, 200, startRun(db, cmd, args || {})); }
      catch (e) { json(res, e.code === 409 ? 409 : 400, { error: e.message, runId: e.runId ?? null }); }
    },
    'GET /api/hanked/runs': async (req, res) => json(res, 200, { runs: runsView(db, 10) }),
    'POST /api/hanked/stop': async (req, res) => {
      const { id } = await readBody(req);
      json(res, 200, stopRun(db, Number(id)));
    },
```

`server.mjs`-i `initSales(db)` järele: `migrateHanked(db); cleanupOrphans(db);`

**Samm 4: jooksuta** — värav PASS; seejärel `win\restart-server.ps1` ja `curl http://127.0.0.1:4310/api/hanked` peab andma JSON-i.

**Samm 5: commiti** — `feat(hanked): API marsruudid ja orbude koristus serveri käivitusel`

---

## Ülesanne 9: sakk ja tabel

> **TEOSTATUD** — `f7ea83f`. Seisufilter ei ole kliendis käsitsi kirjutatud nimekiri, vaid tuletatud
> `SEISU_LIIK`-ist (`töös`/`lõpp`). Tähtajaarvutus võrdleb kalendripäevi, mitte millisekundeid —
> naiivne `Date.parse` andis Eesti ajavööndis ühe võrra vale vastuse. Seisumuutus ei joonista
> tabelit uuesti. Testid on kahes failis: puhas loogika `gate-hanked-ui.mjs`, brauser
> `gate-hanked-vaade.mjs` (vajab playwrighti, jookseb `npm run varav:brauser`).


**Failid:**
- Muuda: `crm/public/index.html:19-26` (sakk) ja lisa `<main class="wide" id="viewHanked" hidden><div class="sheet" id="hankedBody"></div></main>` teiste `main`-ide kõrvale
- Muuda: `crm/public/app.js:42` (`VIEWS` massiiv)
- Muuda: `crm/public/views.js` (`renderHanked` + ruuter `R`)
- Muuda: `crm/public/crm2.css`

**Samm 1: kirjuta kukkuv test** — UI-värav loeb faile tekstina (sama muster mis `test/gate-campaign-ui.mjs`):

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/env.mjs';
{
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const views = readFileSync(join(ROOT, 'public/views.js'), 'utf8');
  assert.match(html, /data-view="hanked"/, 'sakk puudub');
  assert.match(html, /id="viewHanked"/, 'vaate konteiner puudub');
  assert.match(app, /VIEWS\s*=\s*\[[^\]]*'hanked'/, 'VIEWS ei sisalda hanked');
  assert.match(views, /hanked:\s*renderHanked/, 'ruuter ei tunne vaadet');
  console.log('PASS hanked UI: sakk, konteiner, ruuter');
}
```

**Samm 2: jooksuta** — oodatav: `sakk puudub`.

**Samm 3: teosta.**

`index.html` nav-i lõppu (Agendid järele):
```html
    <button class="view-tab" type="button" role="tab" data-view="hanked" aria-selected="false">Riigihanked <span class="badge" id="hankedBadge" hidden>0</span></button>
```

`app.js`: `const VIEWS = ['pipeline','inbox','stats','services','billing','agents','hanked'];`

`views.js` (enne ruuterit):
```js
  const PAEVI = (d) => (d ? Math.round((Date.parse(d) - Date.now()) / 86400000) : null);
  const VERDICT_CLS = { PAKU: 'top', KAALU: '', JÄTA: 'muted', ALLTÖÖVÕTT: 'warn' };
  let hankedData = { hanked: [], runs: [], filter: { seis: 'aktiivsed', segment: 'kõik' }, valitud: null };

  async function renderHanked() {
    const host = $('#hankedBody');
    let d; try { d = await api('/api/hanked'); } catch (e) { return host.replaceChildren(el('p', { class: 'warn', text: e.message })); }
    hankedData = { ...hankedData, ...d };
    const read = d.hanked.filter((h) => {
      if (hankedData.filter.seis === 'aktiivsed') return !['aegunud','kaotatud','jatsin'].includes(h.state);
      return hankedData.filter.seis === 'kõik' ? true : h.state === hankedData.filter.seis;
    });
    const kiired = d.hanked.filter((h) => h.state === 'uus' && PAEVI(h.deadline) != null && PAEVI(h.deadline) <= 7).length;
    const badge = document.querySelector('#hankedBadge');
    if (badge) { badge.textContent = String(kiired); badge.hidden = kiired === 0; }
    host.replaceChildren(
      el('div', { class: 'head' }, [
        el('h1', { text: 'Riigihanked' }),
        el('p', { text: kiired ? kiired + ' hanget tähtajaga alla 7 päeva ootavad otsust' : 'Kiireloomulisi hankeid ei ole' }),
      ]),
      andmeRiba(d),
      filtriRiba(),
      el('table', { class: 'tbl' }, [
        el('thead', {}, el('tr', {}, ['Tähtaeg','Viitenr','Hankija','Nimetus','Maksumus','Menetlus','Skoor','Seis','Dok'].map((text) => el('th', { text })))),
        el('tbody', {}, read.map(rida)),
      ]),
      hankedData.valitud ? detailPaneel(hankedData.valitud) : null,
    );
  }
```
`rida(h)` teeb ühe `<tr>` (klikk → `hankedData.valitud = h.ref; renderHanked()`), näitab `PAEVI` väärtust („5 p“), `eur(h.est)`, skoori `h.score` koos `VERDICT_CLS` klassiga ja seisu rippmenüüd, mis kutsub `POST /api/hanked/state`.

Ruuter: `const R = { stats: renderStats, services: renderServices, billing: renderBilling, agents: renderAgents, hanked: renderHanked };`

`crm2.css`: lisa `.runbar { display:flex; gap:.5rem; flex-wrap:wrap }` ja `.run-row { font-size:.85rem; color:var(--muted) }`.

**Samm 4: jooksuta** — värav PASS; `win\restart-server.ps1`, ava `http://127.0.0.1:4310`, klõpsa sakki, veendu, et tabel tuleb.

**Samm 5: commiti** — `feat(hanked): sakk, tabel ja filtririba`

---

## Ülesanne 10: nupud, staatus ja detailpaneel

> **TEOSTATUD** — `3551e9c`, `8cd4d0e`. Plaani `poll()` oli aegunud: ta kutsus `renderHanked()`,
> mis teeb uue päringu — ülesanne 9 keelab selle mustri. Lisaks kaks kasutaja kinnitatud tööd:
> **verdikt läheb baasi** (`verdict TEXT`; `ALLTÖÖVÕTT` ei ole punktidest tagasi arvutatav) ja
> **märk uueneb `app.js` `load()`-is** (`kiireidLoend` = üks `SELECT COUNT(*)` `/api/state` vastuses;
> värav võrdleb serveri SQL-i kliendi `onKiire`-ga 16 piirijuhtumi peal). `8cd4d0e` ühendas
> `markExpired` ja `kiireidLoend` kuupäevavalved — aegumise oma oli lõdvem ja andis samale reale
> teise vastuse.
>
> **NB:** `ALLTÖÖVÕTT` ei ole täna toodangus saavutatav — `score()` loeb `rollid` ja `kaiveNoue`,
> mida `hanked`-tabelis ei ole. Need tulevad ülesandega 14.


**Failid:** `crm/public/views.js`, `crm/public/crm2.css`, `crm/test/gate-hanked.mjs`

**Samm 1: kirjuta kukkuv test**

```js
{
  const views = readFileSync(join(ROOT, 'public/views.js'), 'utf8');
  assert.match(views, /\/api\/hanked\/run/, 'nupud ei kutsu käivitajat');
  assert.match(views, /\/api\/hanked\/runs/, 'staatust ei küsita');
  assert.match(views, /setInterval|setTimeout/, 'pollimine puudub');
  assert.match(views, /state === 'käib'|kaibJooks/, 'pollimine peab lõppema, kui ükski jooks ei käi');
  console.log('PASS hanked UI: nupud ja staatus');
}
```

**Samm 2: jooksuta** — kukub.

**Samm 3: teosta.**

```js
  function andmeRiba(d) {
    const nupud = Object.entries(d.tasks).map(([cmd, t]) => {
      const kaib = d.runs.find((r) => r.cmd === cmd && r.state === 'käib');
      const viimane = d.runs.find((r) => r.cmd === cmd && r.state !== 'käib');
      return el('div', {}, [
        el('button', {
          class: 'btn' + (kaib ? ' busy' : ''), disabled: kaib ? 'disabled' : null,
          text: kaib ? t.label + ' …' : t.label,
          onclick: () => kaivita(cmd),
        }),
        kaib ? el('span', { class: 'run-row', text: kaib.progress || 'käivitub' }) : null,
        kaib ? el('button', { class: 'btn ghost', text: 'Peata', onclick: () => api('/api/hanked/stop', { id: kaib.id }).then(renderHanked) }) : null,
        !kaib && viimane ? el('span', { class: 'run-row', text: dt(viimane.finished) + ' · ' + (viimane.rows ?? 0) + ' rida · ' + (viimane.state === 'tehtud' ? 'korras' : viimane.error || viimane.state) }) : null,
      ].filter(Boolean));
    });
    return block('Andmed', el('div', { class: 'runbar' }, nupud),
      'Käsud jooksevad CRM-i serveri all. Öine Task Scheduleri jooks kirjutab samasse tabelisse.');
  }

  async function kaivita(cmd, args = {}) {
    if (cmd === 'docs') { if (!hankedData.valitud) return toast('Vali enne hange', true); args = { ref: hankedData.valitud }; }
    try { await api('/api/hanked/run', { cmd, args }); } catch (e) { return toast(e.message, true); }
    poll();
  }

  let pollTimer = null;
  async function poll() {
    clearTimeout(pollTimer);
    const { runs } = await api('/api/hanked/runs');
    hankedData.runs = runs;
    await renderHanked();
    if (runs.some((r) => r.state === 'käib')) pollTimer = setTimeout(poll, 2000);   // pollimine lõpeb, kui miski ei käi
  }
```

Detailpaneel (`detailPaneel(ref)`) kutsub `POST /api/hanked/detail` ja näitab: skoori põhjendusread (`score_why`), CPV-d, link RHR-i (`https://riigihanked.riik.ee/rhr-web/#/procurement/<rhr_id>/general-info`), märkuse `textarea` (`onblur` → `POST /api/hanked/note`), seisunupud, failinimekirja ja ploki „Sarnased lepingud“ (täidetakse ülesandes 13).

**Samm 4: jooksuta** — värav PASS; käsitsi: vajuta „Sünkroon“, jälgi progressi ja lõpprida.

**Samm 5: commiti** — `feat(hanked): käivitusnupud, progress ja detailpaneel`

---

## Ülesanne 11: Task Scheduler

> **OTSUS TEHTUD (21.09.2026): laps jääb kirjutajaks, aga pikk tehing lõhutakse kuudeks.**
>
> Mõõdetud olukord (ülesanne 7): `node:sqlite` `DatabaseSync` on SÜNKROONNE. Kui laps hoiab
> kirjutuslukku, ei blokeeru mitte ainult vanema kirjutus, vaid kogu serveri sündmustsükkel
> kuni `busy_timeout`-ini (5 s). RSS-jooksu juures on see millisekundid — mõõdetud:
> `SQLITE_BUSY` 0 korda, vanema pool tegi kogu jooksu peale 5 kirjutust (naiivne versioon
> oleks teinud 2401). Ajaloo import (ülesanne 12) kestab aga kümneid minuteid ja üks
> `BEGIN IMMEDIATE` kogu 24 kuu peale tähendaks **kinni jooksnud CRM-i**.
>
> Otsus: (a) vanem puhverdab logi mälus ja kirjutab intervalliga, mitte rea kaupa —
> **tehtud** ülesandes 7; (b) ajaloo import commitib **KUU KAUPA**, mitte kogu akna kaupa,
> nii et kirjutuslukku hoitakse sekundeid, mitte minuteid. Kuupõhine commit on nagunii vajalik
> `tehtudKuud`-i jaoks ja teeb katkenud impordi jätkatavaks.
>
> Alternatiiv „laps ei ava baasi, kirjutab stdout-i ja server salvestab" lükati tagasi: serveri
> kirjutus on samuti sünkroonne, seega blokeering ainult koliks vanemasse, ja `npm run
> hanked:sync` käsurealt lakkaks töötamast.


> **TEOSTATUD** — `d3530fb`. **Allolev näidiskood on katki, ära kopeeri seda:**
> `New-ScheduledTaskTrigger` EI TOETA lippu `-Monthly` (ainult `-Once/-Daily/-Weekly/-AtLogOn/-AtStartup`)
> — kuine käiviti tuleb CIM-klassist `MSFT_TaskMonthlyTrigger`, kus `DaysOfMonth` on bitimask
> (3. päev = 4). Nimed on masina mustris `Leisson CRM hanked sync` / `… ajalugu`, ilma mõttekriipsuta
> (U+2014 läheb konsooli vaikekodeeringus prügiks ja `-Eemalda` ei leiaks ülesannet enam üles).
>
> Kaks sisulist parandust: (a) **ajaloo-ülesanne jääb registreerimata**, kuni
> `agent/hanked-history.mjs` on olemas — registreeritud ülesanne puuduva failiga kukuks iga kuu
> vaikselt; (b) **`hanked-sync.mjs` kirjutab otsekäivitusel ise `hanke_runs` rea**
> (`boot_id='otse:<uuid>'` → `oma=false`), sest Task Scheduler kutsub skripti serverist mööda ja
> öine jooks ei oleks CRM-i vaates üldse näha. Elav lukk → vahelejätt väljumiskoodiga 0 ja
> põhjusega, mitte ingliskeelne `UNIQUE constraint failed`.
>
> **Ülesandeid EI OLE registreeritud** — see on Gerti otsus. Käsk:
> `powershell -NoProfile -ExecutionPolicy Bypass -File win\install-hanked-task.ps1`
> (`-Kuiv` näitab, mida teeks; `-Eemalda` võtab maha).

**Failid:**
- Loo: `crm/win/install-hanked-task.ps1`
- Muuda: `crm/test/gate-hanked.mjs`

**Samm 1: kirjuta kukkuv test** (skripti sisu kontroll, mitte käivitamine):

```js
{
  const ps = readFileSync(join(ROOT, 'win/install-hanked-task.ps1'), 'utf8');
  assert.match(ps, /LEISSON — hanked sync/);
  assert.match(ps, /07:40|07\.40/);
  assert.match(ps, /hanked-sync\.mjs/);
  assert.match(ps, /hanked-history\.mjs/);
  console.log('PASS hanked: Task Scheduleri skript');
}
```

**Samm 2: jooksuta** — kukub (faili ei ole).

**Samm 3: teosta**

```powershell
# crm/win/install-hanked-task.ps1 — registreerib kaks ülesannet. Jooksuta administraatorina.
$crm  = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node).Source

$päev = New-ScheduledTaskAction -Execute $node -Argument "agent\hanked-sync.mjs" -WorkingDirectory $crm
$kell = New-ScheduledTaskTrigger -Daily -At 07:40
Register-ScheduledTask -TaskName "LEISSON — hanked sync" -Action $päev -Trigger $kell -Description "RHR RSS -> CRM" -Force

$kuu  = New-ScheduledTaskAction -Execute $node -Argument "agent\hanked-history.mjs --kuud=1" -WorkingDirectory $crm
$kuuT = New-ScheduledTaskTrigger -Monthly -DaysOfMonth 3 -At 05:00
Register-ScheduledTask -TaskName "LEISSON — hanked ajalugu" -Action $kuu -Trigger $kuuT -Description "eForms kuuvärskendus" -Force

Get-ScheduledTask -TaskName "LEISSON — hanked*" | Format-Table TaskName, State
```

**Samm 4: jooksuta** — värav PASS; seejärel päriselt: `powershell -ExecutionPolicy Bypass -File win\install-hanked-task.ps1` ja kontrolli `Get-ScheduledTask`.

**Samm 5: commiti** — `feat(hanked): Task Scheduleri ülesanded päevasele sünkile ja kuuajaloole`

**Etapi F2 lõpp:** `npm test` roheline, server taaskäivitatud, sakk töötab, nupud näitavad staatust.

---

# Etapp F3 — ajalugu (ülesanded 12–15)

## Ülesanne 12: kuine ajaloo import

> **MEELDETULETUS (ülesandest 11):** kui `agent/hanked-history.mjs` on valmis, tuleb
> `win\install-hanked-task.ps1` UUESTI jooksutada — kuine ülesanne jäeti teadlikult
> registreerimata, sest skripti ei olnud. Ilma selleta ei uuene ajalugu kunagi ja keegi ei märka.
>
> **LÕKS (ülesandest 6):** `segmentOf(a.title)` ainult pealkirjaga kaotas ülesandes 3 päris
> hanke (310983) — FIT peab vaatama pealkirja JA kirjeldust. Lepinguteatel ei ole RSS-i
> kirjeldust; otsusta, kas anda teine argument `cbc:Description`-ist või teadvustada, et
> ajaloo segment on kitsam kui elava hanke oma. Praegune rida on ainult kohahoidja.
>
> **OTSUS TEHTUD (21.09.2026): rida OSA kohta, mitte teate kohta.**
> Konkurentide pingerida on selle tabeli ainus mõte, ja teatepõhine rida annab
> süstemaatiliselt vale vastuse just seal, kus raha on — suured mitmeosalised hanked on
> täpselt need, kus alltöövõtu partnerid välja paistavad. Skeemi muutmine praegu maksab ühe
> additiivse migratsiooni; pärast 24 kuu laadimist maksab ta uuesti laadimise. Tabel on veel
> tühi, seega arenduskiirusele see midagi ei maksa.
>
> Mõõdetud taust (august 2026, 956 lepinguteadet): **54 teatel on nii mitu osa kui mitu
> võitjat** (`osi > 1 && winner_arv > 1`), **17-l on osade tulemused erinevad** (`segu`) ja
> **137 on võitjata** (`clos-nw`). NB: ülesandes 6 nimetati arve 113 ja 143 — need tulid
> laiemast definitsioonist („mitu võitjat kokku, sõltumata osade arvust"). Kehtivad ülemised,
> sest need on mõõdetud pariteedifikstuuri ehitamisel sama failiga. `hanke_lepingud` hoiab praegu ÜHT rida teate kohta, seega `winner` ja `tenders`
> kirjeldavad esimest osa. Rida OSA kohta on ainus kuju, mis annab õige konkurentide
> pingerea. Vaata ka: eForms annab `nature`/`menetlus` ingliskeelsete koodidena
> (`services`, `open`), RSS-i tee annab eestikeelsed sõnad (`Teenused`, `Avatud
> hankemenetlus`) — üks sõnavara tuleb valida ja normaliseerida, lugeja ise ei tõlgi.


**Failid:**
- Loo: `crm/agent/hanked-history.mjs`
- Muuda: `crm/test/gate-hanked.mjs`

**Samm 1: kirjuta kukkuv test**

```js
import { importMonthXml, tehtudKuud, kustutaVanemad } from '../agent/hanked-history.mjs';

{
  const db = testDb();
  const r = importMonthXml(db, '2026-08', AWARD_FIXTURE);
  assert.equal(r.rows, 1, 'ainult teenuste read salvestatakse');
  assert.deepEqual(tehtudKuud(db), ['2026-08']);
  const r2 = importMonthXml(db, '2026-08', AWARD_FIXTURE);
  assert.equal(r2.vahelejäetud, true, 'tehtud kuud ei laeta uuesti');
  const lep = db.prepare('SELECT * FROM hanke_lepingud').all();
  assert.equal(lep.length, 1);
  assert.equal(lep[0].winner, 'VELVET OÜ');
  console.log('PASS ajalugu: import, filter ja korduskaitse');
}

{
  const db = testDb();
  importMonthXml(db, '2026-08', AWARD_FIXTURE);
  db.prepare("UPDATE hanke_lepingud SET date='2023-01-01'").run();
  assert.equal(kustutaVanemad(db, '2026-09-20', 24), 1, '24 kuust vanem rida kustub');
  console.log('PASS ajalugu: 24 kuu aken');
}
```

**Samm 2: jooksuta** — moodul puudub.

**Samm 3: teosta**

```js
// crm/agent/hanked-history.mjs
import { open } from '../lib/db.mjs';
import { migrateHanked, segmentOf } from '../lib/hanked.mjs';
import { splitNotices, parseAward } from '../lib/eforms.mjs';

const URL_AWARD = (a, k) => `https://riigihanked.riik.ee/rhr/api/public/v1/opendata/notice_award/${a}/month/${k}/xml`;
const teata = (o) => process.stdout.write(JSON.stringify(o) + '\n');

export function tehtudKuud(db) {
  return db.prepare("SELECT key FROM hanke_sync WHERE key LIKE 'notice_award:%' AND ok = 1 ORDER BY key").all()
    .map((r) => r.key.split(':')[1]);
}

export function importMonthXml(db, kuu, xml) {
  migrateHanked(db);
  if (tehtudKuud(db).includes(kuu)) return { kuu, vahelejäetud: true, rows: 0 };
  const lisa = db.prepare(`INSERT OR IGNORE INTO hanke_lepingud
    (ref,date,buyer,title,cpv,winner,winner_reg,winner_size,amount,tenders,menetlus,segment)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  let rows = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const blk of splitNotices(xml, 'ContractAwardNotice')) {
      const a = parseAward(blk);
      if (a.nature !== 'services' || !a.winner) continue;          // ehitus ja asjad lendavad minema
      lisa.run(a.ref, a.date, a.buyer, a.title, a.cpv, a.winner, a.winner_reg, a.winner_size,
               a.amount, a.tenders, a.menetlus, segmentOf(a.title, a.title));
      rows++;
    }
    db.prepare(`INSERT INTO hanke_sync (key,ts,rows,ok) VALUES (?, datetime('now'), ?, 1)
                ON CONFLICT(key) DO UPDATE SET ts=excluded.ts, rows=excluded.rows, ok=1`)
      .run('notice_award:' + kuu, rows);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { kuu, rows, vahelejäetud: false };
}

export function kustutaVanemad(db, today = new Date().toISOString().slice(0, 10), kuud = 24) {
  const piir = new Date(Date.parse(today) - kuud * 30.4 * 86400000).toISOString().slice(0, 10);
  return db.prepare('DELETE FROM hanke_lepingud WHERE date < ?').run(piir).changes;
}
```

`main()`: loeb `--alates=YYYY-MM` või `--kuud=N`, käib kuud järjest läbi, **iga kuu eraldi tehinguga**, ühe kuu viga logib (`ok = 0`) ja jätkab järgmisega, lõpus `kustutaVanemad`. Enne algust kontroll, et vaba ketast ≥ 2 GB (`statfsSync(ROOT).bavail * bsize`), muidu `teata({error:'Vaba ketast alla 2 GB'})` ja `exit(1)`.

**Samm 4: jooksuta** — mõlemad uued PASS-read. Päris jooks Desktop Commanderiga (kestab minuteid): `npm run hanked:history -- --alates=2025-01`.

**Samm 5: commiti** — `feat(hanked): kuine ajaloo import 24 kuu aknaga`

---

## Ülesanne 13: sarnased lepingud ja skoori ajalootegur

**Failid:** `crm/lib/hanked.mjs` (`sarnasedLepingud`, `hangeDetail`), `crm/public/views.js`, `crm/test/gate-hanked.mjs`

**Samm 1: kirjuta kukkuv test**

```js
import { sarnasedLepingud } from '../lib/hanked.mjs';
{
  const db = testDb();
  const lisa = db.prepare(`INSERT INTO hanke_lepingud (ref,date,cpv,winner,amount,tenders) VALUES (?,?,?,?,?,?)`);
  lisa.run('1','2026-01-01','72413000','A',50000,16);
  lisa.run('2','2026-02-01','72413000','B',60000,4);
  lisa.run('3','2026-03-01','79822500','C',10000,2);
  const r = sarnasedLepingud(db, '72413000');
  assert.equal(r.read.length, 2, 'ainult sama CPV');
  assert.equal(r.medianTenders, 10);
  assert.equal(r.medianAmount, 55000);
  console.log('PASS ajalugu: sarnased lepingud ja mediaanid');
}
```

**Samm 2: jooksuta** — kukub.

**Samm 3: teosta** — `sarnasedLepingud(db, cpv, limit = 5)` tagastab `{ read, medianTenders, medianAmount }` (mediaan = keskmine kahest keskmisest paarisarvu korral); `hangeDetail(db, ref)` tagastab hanke, `JSON.parse(score_why)`, failide nimekirja ja `sarnasedLepingud`. `syncFromXml` annab skoorile `ajalugu: sarnasedLepingud(db, h.cpv)`, kui CPV on teada.

**Samm 4: jooksuta** — PASS. Ava detailpaneel ja veendu, et plokk „Sarnased lepingud“ on täidetud.

**Samm 5: commiti** — `feat(hanked): sarnaste lepingute plokk ja skoori ajalootegur`

---

## Ülesanne 14: dokumentide allalaadimine

**Failid:** `crm/agent/hanked-docs.mjs`, `crm/test/gate-hanked.mjs`

**Samm 1: kirjuta kukkuv test** — zip-slip kaitse ilma võrguta:

```js
import { turvalineSihtkoht } from '../agent/hanked-docs.mjs';
{
  const base = '/tmp/riigihanked/314159';
  assert.equal(turvalineSihtkoht(base, 'Lisa 1.pdf'), base + '/Lisa 1.pdf');
  assert.throws(() => turvalineSihtkoht(base, '../../evil.mjs'), /väljaspool/);
  assert.throws(() => turvalineSihtkoht(base, '/etc/passwd'), /väljaspool/);
  console.log('PASS dokumendid: zip-slip kaitse');
}
```

**Samm 2: jooksuta** — kukub.

**Samm 3: teosta.** `turvalineSihtkoht(base, nimi)` normaliseerib (`path.resolve`) ja viskab vea, kui tulemus ei alga `base + sep`-ist. `main()`: `GET /rhr/api/public/v1/procurement/<rhr_id>/documents-temp-url` → `{value}` → `https://riigihanked.riik.ee<value>` (zip) → pakib lahti `riigihanked/<ref>/` alla → `UPDATE hanked SET docs_dir = ?, docs_count = ?`. 500 vastuse korral `teata({error:'RHR ei andnud dokumente'})` ja väljumiskood 1 (paneel näitab RHR-i linki).

**Samm 4: jooksuta** — värav PASS; päris jooks ühe hanke peal, kontrolli kausta sisu.

**Samm 5: commiti** — `feat(hanked): alusdokumentide allalaadimine zip-slip kaitsega`

---

## Ülesanne 15: lõppkontroll ja dokumentatsioon

**Sammud:**

1. `npm test` Windowsis — kõik väravad rohelised (114 + uued 8 kontrolli).
2. `win\restart-server.ps1`, seejärel käsitsi läbikäik: sakk avaneb · „Sünkroon“ annab progressi ja lõpprea · hange saab seisu ja märkuse · detailpaneel näitab põhjendusi ja sarnaseid lepinguid · „Lae dokumendid“ täidab kausta.
3. Lisa `crm/README.md`-sse lõik „Riigihanked“: neli käsku, Task Scheduleri paigaldus, kus andmed asuvad.
4. Uuenda projektimälu `project_leisson_crm` (uus vaade, tabelid, väravad, lõksud) ja projektidokument `claude/riigihanked-analyys-2026-09.md` (radar on nüüd CRM-is).
5. Commiti: `docs(crm): Riigihanked lehe kasutusjuhend ja mälu uuendus`.

---

## Mida see plaan tahtlikult EI tee

- Pakkumuse dokumendihaldust CRM-is (failid jäävad kausta `riigihanked/<viitenr>/`).
- CV-de ja kontrollnimekirjade haldust.
- Automaatset kirjade saatmist hankijatele — CRM-i saatmisvärav jääb puutumata ja ükski selle plaani marsruut ei saada midagi välja.
- Pythoni skriptide kustutamist: `riigihanked/rhr_tools/` jääb pilve ajastatud valvuri tarbeks alles.
