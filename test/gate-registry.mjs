import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/env.mjs';
import { loadAllSeedCompanies } from '../lib/seed-dedupe.mjs';
import {
  normalizeRegName, splitCsvLine, domeenist, mikroettevotja,
  loadSeedProfile, META_FILE, MIKRO_TOOTAJAD_MAX, MIKRO_KAIVE_MAX,
} from '../lib/registry.mjs';
import { parseLihtandmedRida, kontrolliPais } from '../agent/registry-sync.mjs';
import { looSkanner } from '../agent/registry-enrich.mjs';
import { leiaLingidHtmlist } from '../agent/registry-financials.mjs';

// Värav koosneb kahest osast.
//
// A) PARSIMISLOOGIKA — jookseb ALATI, ilma võrgu ja ilma andmefailideta.
//    Avaandmete failid on suured ja kaugel; kui nende lugemine vaikselt
//    katki läheb, peab see siin välja tulema, mitte kuu aja pärast vales
//    kirjas.
//
// B) ANDMEKONTROLL — jookseb siis, kui data/registry/seed-profiil.json on
//    olemas (npm run registry:sync && npm run registry:backfill). ERAND:
//    TTJA õigusväide on kohustuslik kontroll. Kui korpuses on kiri, mis
//    viitab ligipääsetavuse seadusele, aga registriandmeid ei ole, siis
//    värav PEATUB — väidet, mida ei saa kontrollida, ei tohi saata.

// ---------------------------------------------------------------- A) parsimine
{
  // Lihtandmete CSV-s on neli rida, kus aadressiväli sisaldab ise semikoolonit.
  const f = splitCsvLine('Aiandusühistu ORAVA;80050012;Mittetulundusühing;;;R;Registrisse kantud;07.10.1998;;"postiaadress: Sõle 51-69; asukoht:";8599;Türisalu küla, Harku vald, Harju maakond;;;;;');
  assert.equal(f[0], 'Aiandusühistu ORAVA');
  assert.equal(f[1], '80050012');
  assert.equal(f[9], 'postiaadress: Sõle 51-69; asukoht:', 'jutumärkides semikoolon ei tohi veergu lõhkuda');
  assert.equal(f[11], 'Türisalu küla, Harku vald, Harju maakond');
  console.log('PASS registry: CSV jutumärkides semikoolon');
}

{
  const rec = parseLihtandmedRida('007 Autohaus osaühing;11694365;Osaühing;;EE101335276;R;Registrisse kantud;30.07.2009;;Turu tn 34;8151;Tartu linn, Tartu linn, Tartu maakond;51004;3047590;;Tartu maakond, Tartu linn, Tartu linn, Turu tn 34;https://ariregister.rik.ee/est/company/11694365');
  assert.equal(rec.kood, 11694365);
  assert.equal(rec.kmkr, 'EE101335276');
  assert.equal(rec.staatus, 'R');
  assert.equal(rec.norm, '007 autohaus', 'õiguslik vorm peab nimest maha tulema');
  assert.equal(parseLihtandmedRida('mingi;mitte-numbriline;rida'), null);
  console.log('PASS registry: lihtandmete rea parsimine');
}

{
  // Vaikne veerunihe on selle andmestiku kõige kallim võimalik viga: kood
  // läheks nime kohale ja kõik hilisemad vasted oleksid rämps. Päise kontroll
  // peatab jooksu kohe.
  assert.doesNotThrow(() => kontrolliPais('﻿nimi;ariregistri_kood;ettevotja_oiguslik_vorm;x'));
  assert.throws(() => kontrolliPais('ariregistri_kood;nimi;ettevotja_oiguslik_vorm'), /veerud on muutunud/);
  console.log('PASS registry: päise kontroll püüab veerunihke');
}

{
  // Registri normaliseerija EI TOHI eemaldada üldsõnu (erinevalt
  // lib/seed-dedupe.mjs omast) — "Pärnu Vesi" on terve ärinimi, mitte müra.
  assert.equal(normalizeRegName('aktsiaselts PÄRNU VESI'), 'parnu vesi');
  assert.equal(normalizeRegName('OÜ Hotell Vana Maja'), 'hotell vana maja');
  assert.equal(normalizeRegName('Hotell Vana Maja OÜ'), 'hotell vana maja', 'vorm ees või taga annab sama tüve');
  console.log('PASS registry: nime normaliseerimine');
}

{
  const read = [];
  const skanner = looSkanner((rec) => read.push(rec));
  // Fikstuur jäljendab päris faili kuju: üks väli rea kohta, taandega.
  // Just sellel kujul skanner töötab — kui RIK kunagi trükikuju muudab,
  // kukub see test, mitte vaikselt tühi contacts.ndjson.
  const rec = (obj, taane = '                ') => {
    const read = ['            {'];
    const kirjed = Object.entries(obj);
    kirjed.forEach(([k, v], i) => {
      const val = v === null ? 'null' : (typeof v === 'boolean' || typeof v === 'number' ? String(v) : JSON.stringify(v));
      read.push(`${taane}"${k}":${val}${i < kirjed.length - 1 ? ',' : ''}`);
    });
    read.push('            },');
    return read;
  };
  const fixture = [
    '[', '    {',
    '        "ariregistri_kood":11111111,',
    '        "nimi":"Test OÜ",',
    '        "yldandmed":{',
    '            "staatus":"R",',
    '            "arinimed":[',
    ...rec({ kirje_id: 1, sisu: 'Test OÜ', lopp_kpv: null }),
    '            ],',
    '            "teatatud_tegevusalad":[',
    ...rec({ kirje_id: 2, emtak_kood: '12345', emtak_tekstina: 'Kõrvaltegevus', on_pohitegevusala: false }),
    ...rec({ kirje_id: 3, emtak_kood: '55101', emtak_tekstina: 'Hotellid', on_pohitegevusala: true }),
    '            ],',
    '            "info_majandusaasta_aruannetest":[',
    ...rec({ kirje_id: 4, majandusaasta_perioodi_lopp_kpv: '31.12.2024', tootajate_arv: '7' }),
    ...rec({ kirje_id: 5, majandusaasta_perioodi_lopp_kpv: '31.12.2025', tootajate_arv: '9' }),
    '            ],',
    '            "sidevahendid":[',
    ...rec({ kirje_id: 6, liik: 'EMAIL', liik_tekstina: 'Elektronposti aadress', sisu: 'vana@test.ee', lopp_kpv: '01.01.2020' }),
    ...rec({ kirje_id: 7, liik: 'EMAIL', liik_tekstina: 'Elektronposti aadress', sisu: 'info@test.ee', lopp_kpv: null }),
    ...rec({ kirje_id: 8, liik: 'MOB', liik_tekstina: 'Mobiiltelefon', sisu: '+372 5000000', lopp_kpv: null }),
    ...rec({ kirje_id: 9, liik: 'WWW', liik_tekstina: 'Interneti WWW aadress', sisu: 'https://test.ee', lopp_kpv: null }),
    '            ]', '        }', '    },', '    {',
    '        "ariregistri_kood":22222222,',
    '        "nimi":"Tühi OÜ",',
    '        "yldandmed":{',
    '            "staatus":"R"',
    '        }', '    }', ']',
  ];
  for (const l of fixture) skanner.rida(l);
  skanner.lopeta();

  assert.equal(read.length, 1, 'ilma ühegi kontaktita kirjet ei salvestata');
  const r = read[0];
  assert.equal(r.kood, 11111111);
  assert.deepEqual(r.email, ['info@test.ee'], 'lõppenud (lopp_kpv != null) sidevahendit ei tohi salvestada');
  assert.deepEqual(r.tel, ['+372 5000000']);
  assert.deepEqual(r.www, ['https://test.ee']);
  assert.equal(r.emtak, '55101', 'põhitegevusala peab võitma kõrvaltegevusala');
  assert.equal(r.tootajad, 9, 'töötajate arv tuleb VIIMASEST aruandest');
  assert.equal(r.tootajad_aasta, 2025);
  console.log('PASS registry: üldandmete voogskanner');
}

{
  // Regressioon 20.09.2026: sama failinimi on lehel kaks korda — viitena
  // (/sites/default/files/...) ja nähtava tekstina. Ilma teekonna-eelistuseta
  // valis skript paljas failinime ja sai 404.
  const html = '<a href="/sites/default/files/1.aruannete_yldandmed_kuni_31082026.zip">1.aruannete_yldandmed_kuni_31082026.zip</a>'
    + '<a href="/sites/default/files/4.2024_aruannete_elemendid_kuni_31082026.zip">4.2024_aruannete_elemendid_kuni_31082026.zip</a>';
  const l = leiaLingidHtmlist(html);
  assert.ok(l.yldandmed.includes('/sites/default/files/'), 'üldandmete link peab sisaldama teekonda');
  assert.ok(l.aastad['2024'].includes('/sites/default/files/'), 'aasta link peab sisaldama teekonda');
  console.log('PASS registry: avaandmete lehe linkide leidmine (404-regressioon)');
}

{
  assert.equal(domeenist('hedon@hedonspa.com'), 'hedonspa.com');
  assert.equal(domeenist('https://www.hedonspa.com/broneeri?a=1'), 'hedonspa.com');
  assert.equal(domeenist('keegi@gmail.com'), null, 'tasuta postkast ei ole identiteedivõti');
  assert.equal(domeenist(null), null);
  console.log('PASS registry: domeeni tuletamine');
}

{
  const fin = (kood, tootajad, kaive) => new Map([[String(kood), { kood, aasta: 2025, tootajad, kaive }]]);
  const a = mikroettevotja(1, { financials: fin(1, 9, 1_900_000) });
  assert.equal(a.teada, true); assert.equal(a.mikro, true);
  const b = mikroettevotja(1, { financials: fin(1, 84, 5_508_984) });
  assert.equal(b.mikro, false);
  // Endla-juhtum: sihtasutus, käive avaandmetes puudu, aga 90 töötajat
  // ületab läve niikuinii -> vastus on KINDEL, mitte teadmata.
  const c = mikroettevotja(1, { financials: fin(1, 90, null) });
  assert.equal(c.teada, true); assert.equal(c.mikro, false);
  const d = mikroettevotja(1, { financials: fin(1, 2, null) });
  assert.equal(d.teada, false, 'alla läve töötajad + tundmatu käive = ei tea');
  const e = mikroettevotja(1, { financials: fin(1, null, 3_000_000) });
  assert.equal(e.teada, true); assert.equal(e.mikro, false);
  assert.equal(mikroettevotja(999, {}).teada, false);
  assert.equal(MIKRO_TOOTAJAD_MAX, 10);
  assert.equal(MIKRO_KAIVE_MAX, 2_000_000);
  console.log('PASS registry: TTJA mikroettevõtja lävi');
}

// ------------------------------------------------------------- B) andmekontroll
// Kirjad, mis viitavad ligipääsetavuse SEADUSELE (mitte lihtsalt heale
// tavale). Mikroettevõtja erand: alla 10 töötaja JA kuni 2 M€ käive.
const OIGUSVAIDE = /TTJA|ligipääsetavuse seadus|toodete ja teenuste ligipääsetavuse|28\.06\.2025|juunist 2025/i;

const koik = loadAllSeedCompanies();
const oigusvaitega = koik.filter((c) => OIGUSVAIDE.test([c.body, c.angle, c.subject, c.finding, c.why].filter(Boolean).join(' ')));
const profiil = loadSeedProfile();

if (!profiil) {
  assert.equal(oigusvaitega.length, 0,
    `Korpuses on ${oigusvaitega.length} ligipääsetavuse SEADUSELE viitavat kirja (${oigusvaitega.map((c) => c.id).join(', ')}), `
    + 'aga data/registry/seed-profiil.json puudub — mikroettevõtja erandit ei saa kontrollida. '
    + 'Jooksuta: npm run registry:sync && npm run registry:enrich && npm run registry:financials && npm run registry:backfill');
  console.log('INFO registry: registriandmeid ei ole (npm run registry:sync) — andmekontroll jäi vahele, õigusväiteid korpuses ei ole.');
} else {
  const ettevotted = profiil.ettevotted || {};
  const kustutatud = [];
  const likvideerimisel = [];
  const tundmatud = [];
  for (const [kood, p] of Object.entries(ettevotted)) {
    if (!p.staatus) tundmatud.push(`${p.seed_id} (${kood})`);
    else if (p.staatus === 'K') kustutatud.push(`${p.seed_id} (${kood})`);
    else if (p.staatus !== 'R') likvideerimisel.push(`${p.seed_id} (${kood}, staatus ${p.staatus})`);
  }
  assert.equal(tundmatud.length, 0, 'Seed-korpuses on registrikood, mida registris ei ole: ' + tundmatud.join(', '));
  assert.equal(kustutatud.length, 0, 'Seed-korpuses on registrist KUSTUTATUD ettevõtteid — neile ei saadeta kirju: ' + kustutatud.join(', '));
  if (likvideerimisel.length) console.log(`HOIATUS registry: ${likvideerimisel.length} sihtmärki ei ole staatuses R: ${likvideerimisel.join(', ')}`);

  const vead = [];
  for (const c of oigusvaitega) {
    if (!c.regcode) { vead.push(`${c.id} (${c.name}) — registrikood puudub, mikroettevõtja erandit ei saa kontrollida`); continue; }
    const p = ettevotted[String(c.regcode)];
    if (!p) { vead.push(`${c.id} — kood ${c.regcode} ei ole seed-profiilis (jooksuta registry:backfill uuesti)`); continue; }
    if (!p.mikro_teada) { vead.push(`${c.id} (${p.reg_nimi || c.name}) — töötajate arv/käive teadmata, õigusväidet ei saa kinnitada`); continue; }
    if (p.mikro) vead.push(`${c.id} (${p.reg_nimi || c.name}) ON mikroettevõtja (${p.tootajad} töötajat, käive ${p.kaive} €) — ligipääsetavuse seaduse erand kehtib, seda väidet ei tohi kirjas kasutada`);
  }
  assert.equal(vead.length, 0, 'TTJA/ligipääsetavuse õigusväide ei ole kaetud:\n  - ' + vead.join('\n  - '));

  const kaetud = Object.values(ettevotted).filter((p) => p.mikro_teada).length;
  console.log(`PASS registry: ${Object.keys(ettevotted).length} sihtmärki registris, ${kaetud} töötajate/käibe andmega, ${oigusvaitega.length} õigusväitega kirja kaetud.`);

  if (existsSync(META_FILE)) {
    const meta = JSON.parse(readFileSync(META_FILE, 'utf8'));
    const vanus = meta.laaditud ? (Date.now() - Date.parse(meta.laaditud)) / 86400000 : null;
    if (vanus != null && vanus > 14) console.log(`HOIATUS registry: avaandmed on ${vanus.toFixed(0)} päeva vanad — npm run registry:sync (fail uueneb iga päev).`);
  }
}
