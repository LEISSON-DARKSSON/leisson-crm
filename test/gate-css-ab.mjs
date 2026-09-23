#!/usr/bin/env node
// css-ab värava enda värav SELLE repo konfiga (css-ab.config.json): tööriist (@leisson/shared ≥ v1.4.0,
// oma 9 juhtumit jooksevad sharedi CI-s) peab siin kukkuma just siis, kui CSS muudab midagi, mida plaan ei luba.
// Ajalugu on fikstuur: #15 (964ab6f → 27e0269) muutis 6 sihti +1/+2 px. Vajab git-ajalugu
// (CI: fetch-depth 0) ja playwright + Chromium → brauserivärav (tools/varav.mjs VALJAJATED).
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const JUUR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'css-ab-'));
const PR15 = ['--base', '964ab6f', '--head', '27e0269'];
const SIHID15 = {
  'table.tbl.hanked td.taht .kp': 2, 'table.tbl th': 1, '.kv2 .k': 1, '.kv2 .v': 1, '.bigstats span': 1, '.task .t b': 1,
};
const plaan = (nimi, targets) => { const f = join(TMP, nimi + '.json'); writeFileSync(f, JSON.stringify({ targets })); return ['--plan', f]; };

const juhtumid = [
  ['sama ref mõlemal pool → 0 erinevust', ['--base', 'HEAD', '--head', 'HEAD'], 0],
  ['#15 ilma plaanita → FAIL (8 plaanimata muutust)', PR15, 1],
  ['#15 õige plaaniga → OK', [...PR15, ...plaan('oige', SIHID15)], 0],
  ['#15 vale deltaga (.kv2 .v +2) → FAIL', [...PR15, ...plaan('vale', { ...SIHID15, '.kv2 .v': 2 })], 1],
  ['#15 + siht, mis ei muutu (.lad span) → FAIL', [...PR15, ...plaan('liigne', { ...SIHID15, '.lad span': 1 })], 1],
  ['#15 plaan ilma ühe sihita (.task .t b puudu) → FAIL', [...PR15, ...plaan('puudu', Object.fromEntries(Object.entries(SIHID15).filter(([k]) => k !== '.task .t b')))], 1],
  ['süstitud muutus (.kv2 .v 20px) ilma plaanita → FAIL', ['--base', 'HEAD', '--head', 'HEAD', '--inject', '.kv2 .v{font-size:20px}'], 1],
];

let vigu = 0;
for (const [nimi, args, oodatud] of juhtumid) {
  const r = spawnSync(process.execPath, [join(JUUR, 'node_modules/@leisson/shared/tools/css-ab.mjs'), ...args], { cwd: JUUR, encoding: 'utf8' });
  const ok = r.status === oodatud;
  if (!ok) vigu++;
  console.log(`${ok ? 'OK ' : 'VIGA'} ${nimi} (exit ${r.status}, oodatud ${oodatud})`);
  if (!ok) console.log((r.stdout + r.stderr).split('\n').slice(-25).join('\n'));
}
console.log(vigu ? `\ngate-css-ab: ${vigu} juhtumit kukkus` : `\ngate-css-ab: ${juhtumid.length}/${juhtumid.length} OK`);
process.exit(vigu ? 1 : 0);
