#!/usr/bin/env node
// Äriregistri avaandmed -> data/registry/registry.ndjson
//
// Laeb ettevotja_rekvisiidid__lihtandmed.csv.zip (18,5 MB, uueneb IGA PÄEV),
// pakib voona lahti ja kirjutab kitsa väljavõtte, mida CRM kasutab:
// registrikood, nimi, normaliseeritud nimi, KMKR-number, staatus, EHAK-tekst
// ja normaliseeritud aadress. 97 MB CSV-st jääb kettale ~80 MB NDJSON;
// vahepealset faili ei teki.
//
// Kasutus:
//   npm run registry:sync                 # laeb võrgust
//   node agent/registry-sync.mjs --fail=<kohalik.zip>
//
// Litsents: Äriregistri avaandmed, CC BY-SA 4.0 (RIK). Sisekasutuses vaba;
// tuletatud andmestiku AVALIKUL levitamisel kehtib sama litsents.
import { mkdirSync, createWriteStream, writeFileSync, createReadStream } from 'node:fs';
import { once } from 'node:events';
import { fetchZipEntry, unzipFirstEntry, lines, progressReporter } from '../lib/zipstream.mjs';
import { REGISTRY_DIR, REGISTRY_FILE, META_FILE, normalizeRegName, splitCsvLine } from '../lib/registry.mjs';

export const LIHTANDMED_URL = 'https://avaandmed.ariregister.rik.ee/sites/default/files/avaandmed/ettevotja_rekvisiidid__lihtandmed.csv.zip';

// Veeru indeksid lihtandmete CSV-s (päis kontrollitakse jooksu alguses üle,
// et vaikiv veerunihe ei saaks kunagi märkamatult andmeid rikkuda).
export const VEERUD = {
  nimi: 0, kood: 1, vorm: 2, kmkr: 4, staatus: 5,
  ehak_tekst: 11, aadress: 15,
};
const PAIS_OOTUS = ['nimi', 'ariregistri_kood', 'ettevotja_oiguslik_vorm'];

export function parseLihtandmedRida(line) {
  const f = splitCsvLine(line);
  const kood = (f[VEERUD.kood] || '').trim();
  const nimi = (f[VEERUD.nimi] || '').trim();
  if (!/^\d+$/.test(kood) || !nimi) return null;
  return {
    kood: Number(kood),
    nimi,
    norm: normalizeRegName(nimi),
    vorm: (f[VEERUD.vorm] || '').trim() || null,
    kmkr: (f[VEERUD.kmkr] || '').trim() || null,
    staatus: (f[VEERUD.staatus] || '').trim() || null,
    ehak: (f[VEERUD.ehak_tekst] || '').trim() || null,
    aadress: (f[VEERUD.aadress] || '').trim() || null,
  };
}

export function kontrolliPais(line) {
  const f = splitCsvLine(line.replace(/^﻿/, ''));
  for (let i = 0; i < PAIS_OOTUS.length; i += 1) {
    if (f[i] !== PAIS_OOTUS[i]) {
      throw new Error(`Lihtandmete veerud on muutunud: ootasin "${PAIS_OOTUS[i]}" veerus ${i}, sain "${f[i]}". Paranda agent/registry-sync.mjs VEERUD enne edasi minekut.`);
    }
  }
}

async function main() {
  const failArg = process.argv.find((a) => a.startsWith('--fail='));
  mkdirSync(REGISTRY_DIR, { recursive: true });

  let stream; let lastModified = null;
  if (failArg) {
    stream = unzipFirstEntry(createReadStream(failArg.slice('--fail='.length)));
  } else {
    const r = await fetchZipEntry(LIHTANDMED_URL, { onProgress: null });
    stream = r.stream; lastModified = r.lastModified;
    r.stream.on('error', (e) => { throw e; });
    process.stderr.write(`Laen ${(r.total / 1048576).toFixed(1)} MB (viimati muudetud: ${lastModified})\n`);
  }

  const out = createWriteStream(REGISTRY_FILE);
  let ridu = 0; let aktiivseid = 0; let vigaseid = 0; let esimene = true;
  for await (const line of lines(stream)) {
    if (!line.trim()) continue;
    if (esimene) { esimene = false; kontrolliPais(line); continue; }
    const rec = parseLihtandmedRida(line);
    if (!rec) { vigaseid += 1; continue; }
    ridu += 1;
    if (rec.staatus === 'R') aktiivseid += 1;
    if (!out.write(JSON.stringify(rec) + '\n')) await once(out, 'drain');
    if (ridu % 50000 === 0) process.stderr.write(`\r  ${ridu} rida   `);
  }
  out.end();
  await once(out, 'finish');
  process.stderr.write('\r');

  const meta = {
    allikas: 'Äriregistri avaandmed (RIK), CC BY-SA 4.0',
    url: failArg ? failArg : LIHTANDMED_URL,
    laaditud: new Date().toISOString(),
    fail_muudetud: lastModified,
    ridu, aktiivseid, vigaseid,
  };
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(`registry.ndjson: ${ridu} kirjet (${aktiivseid} aktiivset, ${vigaseid} vahele jäetud rida)`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('registry-sync.mjs')) {
  main().catch((e) => { console.error('registry-sync nurjus:', e.message); process.exit(1); });
}
