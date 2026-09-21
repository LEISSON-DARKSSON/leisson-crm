#!/usr/bin/env node
// VABATAHTLIK RISTKONTROLL: Node'i parseAward vs Pythoni rhr_parse.py, sama
// fikstuuri peal, väljade kaupa.
//
// EI OLE VÄRAVAAHELAS ega test/ kaustas, ja see on TAHTLIK: Python ja lxml ei ole
// igal masinal (Linux VM-is ei ole, CI-s ei ole), ja riigihanked/ on .gitignore'is.
// Ahelasse pandud kontroll, mis pool masinatest vahele jääb, õpetab väravaid eirama.
// Ahela pool on test/gate-pariteet.mjs — see EI vaja võrku ega Pythonit.
//
// Kasutus:  node tools/pariteet-python.mjs     (npm run pariteet:python)
//           RHR_JUUR=/tee/juurde node tools/pariteet-python.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { splitNotices, parseAward } from '../lib/eforms.mjs';
import { JUUR, REPO, FIKSTUUR } from './pariteet-uuenda.mjs';

// ---------------------------------------------------------------------------
// TEADLIKUD LAHKNEVUSED.
//
// Iga kirje kannab põhjendust. Need EI OLE vead — need on kohad, kus meie lugeja
// teeb MEELEGA midagi muud, sest tema väljund läheb otse baasiveergu ja inimese
// ette, Pythoni oma aga vaheformaati (JSONL -> hilisem analüüs). Kõik kolm on
// ülesandes 6 päris augustikuu faili peal mõõdetud, mitte oletatud.
// ---------------------------------------------------------------------------
export const TEADLIKUD = new Map([
  ['amount', 'Python loeb AINULT efac:NoticeResult/cbc:TotalAmount (`rec[\'total\']`).'
    + ' Meie liidame TotalAmount\'i puudumisel VÕITNUD pakkumuste summad. Mõõdetud'
    + ' augustis: 192 teatel oli ainult pakkumuse summa, ehk Python annaks seal null.'],
  ['tenders', 'Python tagastab KÕIK statistikaväärtused massiivina (`results[].stats`)'
    + ' ega vali. Meie valime ühe arvu, sest ta läheb baasi INTEGER-veergu; valik ja'
    + ' selle tee on nähtav väljas `tenders_allikas`.'],
  ['title', 'Meie normaliseerime reavahetused ja korduvad tühikud üheks tühikuks'
    + ' (tekst() lib/eforms.mjs-is), Python teeb ainult .strip(). Mitmerealine'
    + ' cbc:Name annab seetõttu eri sõne.'],
  ['ref', 'Python tagastab cac:ProcurementProject/cbc:ID TERVIKUNA (\'313192-0000\'),'
    + ' meie lõikame sidekriipsu kohalt hanke viitenumbri (\'313192\') — CRM-i'
    + ' hanke_lepingud võti on viitenumber, mitte osa-ID.'],
  ['winner', 'Python võtab organisatsiooni nime ESIMESEST cbc:Name\'ist, meie eelistame'
    + ' languageID="EST" oma (nimiEst). Meie väljund läheb otse inimese ette, seega'
    + ' ingliskeelne nimi oleks vale kuju; Pythoni oma on vaheformaat.'],
  ['buyer', 'Sama mis `winner`: EST-eelistus vs Pythoni esimene cbc:Name.'],
]);

// ---------------------------------------------------------------------------

function leiaOendfail() {
  const juured = [process.env.RHR_JUUR, REPO, join(REPO, '..', '..')].filter(Boolean);
  for (const j of juured) {
    const p = join(j, 'riigihanked', 'rhr_tools', 'rhr_parse.py');
    if (existsSync(p)) return p;
  }
  return null;
}

function leiaPython() {
  const kandidaadid = process.platform === 'win32'
    ? [['python', []], ['py', ['-3']], ['python3', []]]
    : [['python3', []], ['python', []]];
  for (const [cmd, eel] of kandidaadid) {
    const r = spawnSync(cmd, [...eel, '-c', 'import lxml, sys; print(lxml.__name__)'], {
      encoding: 'utf8', windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    if (r.status === 0) return { cmd, eel };
    if (r.status !== null && r.error === undefined) {
      // Python on olemas, aga import kukkus — ütleme selle välja.
      return { cmd, eel, viga: (r.stderr || '').trim().split('\n').pop() };
    }
  }
  return null;
}

// VÕRRELDAKSE TOORELT. Tühikute normaliseerimine enne võrdlust oleks mugav, aga ta
// PEIDAB ÄRA täpselt selle lahknevuse, mis on nimekirjas kirje `title` all (meie
// tekst() surub reavahetused kokku, Pythoni .strip() mitte). Peidetud lahknevus ei ole
// pariteet.

/**
 * Pythoni JSONL-kirjest meie väljakuju.
 *
 * See on PROJEKTSIOON võrreldavasse kujju, mitte väljundi muutmine. Kaks kohta, kus
 * Pythoni kuju on rikkam ja me valime võrdluseks vastava tüki (need EI OLE seetõttu
 * lahknevuste nimekirjas — nimekirja kuuluvad kohad, kus SAMA asja kohta tuleb ERI
 * vastus, mitte kohad, kus üks pool annab rohkem):
 *   - cpv: Python annab pea- + lisaklassifikaatorid massiivina; võrdleme PEAMIST;
 *   - winners: Python annab kõik osade võitjad koos summadega; võrdleme ESIMEST
 *     ja koguarvu, nagu teeb ka meie parseAward.
 * Puhas funktsioon — testitav ilma Pythonita.
 */
export function pythonistValjad(rec) {
  const res = Array.isArray(rec.results) ? rec.results : [];
  const voitjad = [];
  for (const r of res) for (const w of (r.winners || [])) {
    if (w && w.name && !voitjad.some((x) => x.name === w.name)) voitjad.push(w);
  }
  const koodid = [...new Set(res.map((r) => r.status).filter(Boolean))];
  return {
    notice_id: rec.notice_id ?? null,
    folder: rec.folder ?? null,
    date: rec.date || null,
    ref: rec.ref ?? null,
    title: rec.title ?? null,
    nature: rec.nature ?? null,
    cpv: Array.isArray(rec.cpv) ? (rec.cpv[0] ?? null) : (rec.cpv ?? null),
    menetlus: rec.procedure ?? null,
    buyer: rec.buyer ?? null,
    buyer_reg: rec.buyer_reg ?? null,
    winner: voitjad[0]?.name ?? null,
    winner_reg: voitjad[0]?.reg ?? null,
    winner_size: voitjad[0]?.size ?? null,
    winner_arv: voitjad.length,
    osi: res.length || null,
    tulemus: koodid.length === 0 ? null : (koodid.length === 1 ? koodid[0] : 'segu'),
    amount: rec.total ?? null,
    tenders: res.length ? (res[0].stats ?? null) : null,
  };
}

export const VALJAD = ['notice_id', 'folder', 'date', 'ref', 'title', 'nature', 'cpv',
  'menetlus', 'buyer', 'buyer_reg', 'winner', 'winner_reg', 'winner_size',
  'winner_arv', 'osi', 'tulemus', 'amount', 'tenders'];

/** Võrdlus ilma Pythonita: [{i, ref, vali, node, python, teadlik}] */
export function vordle(nodeRead, pyRead) {
  const out = [];
  const n = Math.max(nodeRead.length, pyRead.length);
  for (let i = 0; i < n; i++) {
    const a = nodeRead[i], b = pyRead[i];
    if (!a || !b) {
      out.push({ i, ref: a?.ref ?? b?.ref ?? null, vali: '(teade puudub)',
        node: a ? 'on' : 'PUUDUB', python: b ? 'on' : 'PUUDUB', teadlik: false });
      continue;
    }
    for (const v of VALJAD) {
      const x = a[v] ?? null;
      const y = b[v] ?? null;
      if (JSON.stringify(x) === JSON.stringify(y)) continue;
      out.push({ i, ref: a.ref, vali: v, node: x, python: y, teadlik: TEADLIKUD.has(v) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

function main() {
  const oend = leiaOendfail();
  if (!oend) {
    console.log('VAHELE JÄETUD: riigihanked/rhr_tools/rhr_parse.py ei ole sellel masinal.');
    console.log('  riigihanked/ on repo .gitignore\'is — kaust elab ainult peakoopias.');
    console.log('  Osuta käsitsi:  RHR_JUUR=/tee/kausta/kohal node tools/pariteet-python.mjs');
    console.log('  See EI OLE viga: väravaahela pool on test/gate-pariteet.mjs, mis ei vaja Pythonit.');
    return 0;
  }
  const py = leiaPython();
  if (!py) {
    console.log('VAHELE JÄETUD: Pythonit ei leitud (proovitud: python, py -3, python3).');
    console.log('  See EI OLE viga: ristkontroll on vabatahtlik.');
    return 0;
  }
  if (py.viga) {
    console.log(`VAHELE JÄETUD: ${py.cmd} on olemas, aga lxml puudub.`);
    console.log(`  ${py.viga}`);
    console.log('  Paigalda:  ' + py.cmd + ' -m pip install lxml');
    console.log('  See EI OLE viga: ristkontroll on vabatahtlik.');
    return 0;
  }

  const fikstuur = join(JUUR, FIKSTUUR);
  console.log(`Python   : ${py.cmd} ${py.eel.join(' ')}`.trim());
  console.log(`Õendfail : ${oend}`);
  console.log(`Fikstuur : ${fikstuur}\n`);

  const r = spawnSync(py.cmd, [...py.eel, oend, fikstuur, 'award'], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (r.status !== 0) {
    console.error('Pythoni jooks kukkus (väljumiskood ' + r.status + '):');
    console.error(r.stderr || '(tühi veavoog)');
    return 1;
  }
  if (r.stderr && r.stderr.trim()) console.error('Pythoni veavoog:\n' + r.stderr.trim() + '\n');

  const pyRead = r.stdout.split('\n').filter((x) => x.trim()).map((x) => pythonistValjad(JSON.parse(x)));
  const xml = readFileSync(fikstuur, 'utf8');
  const nodeRead = splitNotices(xml, 'ContractAwardNotice').map(parseAward);
  console.log(`Node: ${nodeRead.length} teadet · Python: ${pyRead.length} teadet\n`);

  const lahk = vordle(nodeRead, pyRead);
  const teadlikud = lahk.filter((x) => x.teadlik);
  const teadmata = lahk.filter((x) => !x.teadlik);

  const loe = (list) => {
    const kaart = new Map();
    for (const x of list) kaart.set(x.vali, (kaart.get(x.vali) || 0) + 1);
    return [...kaart].sort((a, b) => b[1] - a[1]);
  };

  console.log('TEADLIKUD LAHKNEVUSED (ei ole viga):');
  if (!teadlikud.length) console.log('  (ühtegi)');
  for (const [vali, n] of loe(teadlikud)) {
    console.log(`  ${vali} — ${n} teatel ${nodeRead.length}-st`);
    console.log(`    ${TEADLIKUD.get(vali)}`);
    for (const x of teadlikud.filter((y) => y.vali === vali).slice(0, 3)) {
      console.log(`    #${x.i} ref ${x.ref}: node=${JSON.stringify(x.node)} python=${JSON.stringify(x.python)}`);
    }
  }
  // Teadlik lahknevus, mida päris andmete peal EI TULNUD ette — nimekiri võib olla
  // aegunud. Ütleme selle välja, et keegi ei arvaks, et kate on suurem kui ta on.
  const nagemata = [...TEADLIKUD.keys()].filter((v) => !teadlikud.some((x) => x.vali === v));
  if (nagemata.length) {
    console.log(`\n  NB: nimekirjas on lahknevusi, mida selle fikstuuri peal ette ei tulnud:`
      + ` ${nagemata.join(', ')}.`);
    console.log('  Kas fikstuur ei kata neid, või on lahknevus kadunud ja kirje aegunud.');
  }

  console.log('\nTEADMATA LAHKNEVUSED (need on vead):');
  if (!teadmata.length) {
    console.log('  (ühtegi)');
  } else {
    for (const [vali, n] of loe(teadmata)) console.log(`  ${vali} — ${n} teatel`);
    for (const x of teadmata.slice(0, 40)) {
      console.log(`  #${x.i} ref ${x.ref} väli "${x.vali}": node=${JSON.stringify(x.node)} python=${JSON.stringify(x.python)}`);
    }
    if (teadmata.length > 40) console.log(`  ... ja veel ${teadmata.length - 40}`);
  }

  console.log(`\nKokku: ${teadlikud.length} teadlikku · ${teadmata.length} teadmata`);
  if (teadmata.length) {
    console.log('\nTeadmata lahknevus tähendab ÜHTE KAHEST: kas Node\'i pool triivis ära,');
    console.log('või on lahknevus teadlik ja kuulub tools/pariteet-python.mjs nimekirja');
    console.log('TEADLIKUD koos põhjendusega. Vaikselt vahele jätta ei tohi kumbagi.');
    return 1;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
