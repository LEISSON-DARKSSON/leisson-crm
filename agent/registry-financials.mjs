#!/usr/bin/env node
// Majandusaasta aruannete põhinäitajad -> data/registry/financials.ndjson
//
// Kaks faili, mõlemad avaandmete lehelt (uuenevad kord kuus):
//   1.aruannete_yldandmed_*.zip      report_id -> registrikood + aruandeaasta
//   4.<aasta>_aruannete_elemendid_*.zip  report_id -> element -> väärtus
// Võtame kaks elementi:
//   Revenue                                           = müügitulu
//   AverageNumberOfEmployeesInFullTimeEquivalentUnits = töötajate arv (TTE)
// 2024. aasta kohta on need olemas vastavalt 204 197 ja 251 923 ettevõttel.
//
// MIKS: need kaks numbrit on TTJA mikroettevõtja erandi tingimus (alla 10
// töötaja JA kuni 2 M€). Seni oli töötajate arv kraabitud ebausaldusväärse
// regexiga ja seetõttu KASUTUSEST VÄLJAS — ligipääsetavuse seaduse väite
// kohaldumist ei saanud keegi kontrollida. Nüüd saab, ja seda teeb
// test/gate-registry.mjs automaatselt iga kirjapaki ees.
//
// Failinimedes on kuupäevalõige ("kuni_31082026"), mis muutub kord kuus —
// seepärast otsime lingid avaandmete lehelt, mitte ei kirjuta neid kivisse.
//
// Kasutus:  npm run registry:financials  [--aasta=2024,2025]
import { mkdirSync, createWriteStream, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { fetchZipEntry, lines } from '../lib/zipstream.mjs';
import { REGISTRY_DIR, FINANCIALS_FILE, META_FILE, splitCsvLine } from '../lib/registry.mjs';

export const ALLIKALEHT = 'https://avaandmed.ariregister.rik.ee/et/avaandmete-allalaadimine';
const BAAS = 'https://avaandmed.ariregister.rik.ee';
export const ELEMENT_KAIVE = 'Revenue';
export const ELEMENT_TOOTAJAD = 'AverageNumberOfEmployeesInFullTimeEquivalentUnits';
// Sihtasutused, MTÜ-d ja osa avalikust sektorist esitavad teise vormi, kus
// müügitulu rida ei kanna nime "Revenue". Ilma nendeta jääks käive puudu just
// neil sihtmärkidel, kes meie nimekirjas on (muuseumid, teatrid, SA-d).
export const ELEMENT_KAIVE_VARU = ['TotalRevenue', 'BusinessIncome'];

export function leiaLingidHtmlist(html) {
  const abs = (p) => (p.startsWith('http') ? p : BAAS + (p.startsWith('/') ? p : '/' + p));
  // Sama failinimi esineb lehel kaks korda: viitena (href="/sites/default/...")
  // ja nähtava tekstina (pelk failinimi). Kataloogita vaste annab 404 —
  // seepärast eelistame ALATI kaldkriipsuga (teekonnaga) vastet.
  const parim = (matches) => {
    const list = [...matches];
    if (!list.length) return null;
    const teega = list.filter((m) => m.includes('/'));
    return (teega.length ? teega : list).sort((a, b) => b.length - a.length)[0];
  };
  const yld = parim([...html.matchAll(/[^"'\s>]*1\.aruannete_yldandmed[^"'\s<]*\.zip/g)].map((m) => m[0]));
  const aastad = {};
  for (const aasta of new Set([...html.matchAll(/4\.(\d{4})_aruannete_elemendid/g)].map((m) => m[1]))) {
    const re = new RegExp(`[^"'\\s>]*4\\.${aasta}_aruannete_elemendid[^"'\\s<]*\\.zip`, 'g');
    const hit = parim([...html.matchAll(re)].map((m) => m[0]));
    if (hit) aastad[aasta] = abs(hit);
  }
  return { yldandmed: yld ? abs(yld) : null, aastad };
}

async function leiaLingid() {
  const res = await fetch(ALLIKALEHT);
  if (!res.ok) throw new Error(`Avaandmete leht ei vastanud (HTTP ${res.status})`);
  const links = leiaLingidHtmlist(await res.text());
  if (!links.yldandmed) throw new Error('Ei leidnud avaandmete lehelt aruannete üldandmete linki.');
  return links;
}

// report_id -> {kood, aasta} ainult küsitud aastate kohta.
async function loeAruanded(url, aastad) {
  const { stream, total } = await fetchZipEntry(url);
  process.stderr.write(`  aruannete üldandmed: ${(total / 1048576).toFixed(0)} MB\n`);
  const map = new Map();
  let esimene = true;
  for await (const line of lines(stream)) {
    if (!line) continue;
    if (esimene) {
      esimene = false;
      const f = splitCsvLine(line.replace(/^﻿/, ''));
      if (f[0] !== 'report_id' || f[2] !== 'registrikood' || f[5] !== 'aruandeaasta') {
        throw new Error(`Aruannete üldandmete veerud on muutunud: sain [${f[0]}, ${f[2]}, ${f[5]}]. Paranda agent/registry-financials.mjs.`);
      }
      continue;
    }
    const f = splitCsvLine(line);
    const aasta = Number(f[5]);
    if (!aastad.has(aasta)) continue;
    const kood = (f[2] || '').trim();
    if (!/^\d+$/.test(kood)) continue;
    map.set(f[0], { kood: Number(kood), aasta });
  }
  return map;
}

async function loeElemendid(url, aruanded, tulemus) {
  const { stream, total } = await fetchZipEntry(url);
  process.stderr.write(`  aruannete elemendid: ${(total / 1048576).toFixed(0)} MB\n`);
  let esimene = true;
  for await (const line of lines(stream)) {
    if (!line) continue;
    if (esimene) { esimene = false; continue; }
    // Kiire eelfilter enne parsimist: 99 % ridadest ei ole meie kaks elementi.
    if (!line.includes('Revenue') && !line.includes(ELEMENT_TOOTAJAD) && !line.includes('BusinessIncome')) continue;
    const f = splitCsvLine(line);
    const nimetus = f[3];
    const onKaive = nimetus === ELEMENT_KAIVE;
    const onKaiveVaru = ELEMENT_KAIVE_VARU.includes(nimetus);
    if (!onKaive && !onKaiveVaru && nimetus !== ELEMENT_TOOTAJAD) continue;
    const rep = aruanded.get(f[0]);
    if (!rep) continue;
    const v = Number(String(f[4]).replace(',', '.'));
    if (!Number.isFinite(v)) continue;
    const key = rep.kood + ':' + rep.aasta;
    let rec = tulemus.get(key);
    if (!rec) { rec = { kood: rep.kood, aasta: rep.aasta, kaive: null, tootajad: null }; tulemus.set(key, rec); }
    // Sama ettevõttel võib olla mitu aruannet (nt konsolideeritud + üksik) ja
    // sama element mitmes tabelis — võtame suurima, sest TTJA lävi on ülemine
    // piir: väiksema numbri valimine annaks vale "mikroettevõtja" vastuse.
    if (onKaive || onKaiveVaru) rec.kaive = rec.kaive == null ? v : Math.max(rec.kaive, v);
    else rec.tootajad = rec.tootajad == null ? v : Math.max(rec.tootajad, v);
  }
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--aasta='));
  const aastad = new Set((arg ? arg.slice('--aasta='.length) : '2024,2025').split(',').map((s) => Number(s.trim())).filter(Boolean));
  mkdirSync(REGISTRY_DIR, { recursive: true });

  const lingid = await leiaLingid();
  process.stderr.write(`Aastad: ${[...aastad].join(', ')}\n`);
  const aruanded = await loeAruanded(lingid.yldandmed, aastad);
  process.stderr.write(`  ${aruanded.size} aruannet küsitud aastatel\n`);

  const tulemus = new Map();
  for (const a of aastad) {
    const url = lingid.aastad[String(a)];
    if (!url) { process.stderr.write(`  HOIATUS: ${a}. aasta faili ei ole avaandmete lehel\n`); continue; }
    await loeElemendid(url, aruanded, tulemus);
  }

  const out = createWriteStream(FINANCIALS_FILE);
  let n = 0; let kaibega = 0; let tootajatega = 0;
  for (const rec of tulemus.values()) {
    if (rec.kaive == null && rec.tootajad == null) continue;
    n += 1;
    if (rec.kaive != null) kaibega += 1;
    if (rec.tootajad != null) tootajatega += 1;
    if (!out.write(JSON.stringify(rec) + '\n')) await once(out, 'drain');
  }
  out.end();
  await once(out, 'finish');

  const meta = existsSync(META_FILE) ? JSON.parse(readFileSync(META_FILE, 'utf8')) : {};
  meta.majandusaasta = {
    aastad: [...aastad], laaditud: new Date().toISOString(),
    yldandmed_url: lingid.yldandmed, kirjeid: n, kaibega, tootajatega,
  };
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(`financials.ndjson: ${n} kirjet — käive ${kaibega}, töötajad ${tootajatega}`);
}

if (process.argv[1]?.endsWith('registry-financials.mjs')) {
  main().catch((e) => { console.error('registry-financials nurjus:', e.message); process.exit(1); });
}
