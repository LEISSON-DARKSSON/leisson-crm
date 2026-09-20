#!/usr/bin/env node
// Äriregistri üldandmed -> data/registry/contacts.ndjson
//
// Allikas: ettevotja_rekvisiidid__yldandmed.json.zip (230 MB pakitult, üle
// 3 GB lahti pakitult, uueneb IGA PÄEV). Seda faili EI PANDA kettale — see
// käib voona läbi ja kettale jõuab ainult see, mida CRM kasutab:
//   sidevahendid        -> e-post, telefon, veebiaadress (ettevõtte enda
//                          registrile esitatud, kehtivad ehk lopp_kpv = null)
//   teatatud_tegevusalad-> EMTAK põhitegevusala (segmenteerimine)
//   info_majandusaasta_aruannetest.tootajate_arv -> töötajate arv
//
// Mõõdetud kate (20.09.2026, Pärnu maakonna 18 343 aktiivset ettevõtet):
//   e-post 97,8 % · telefon 55 % · töötajate arv 77 % · VEEBIAADRESS 5,5 %.
// Just seepärast EI ASENDA see meie enda sihtmärgiotsingut: registris ei ole
// veebilehte, ja ilma veebileheta ei ole mõõdetud leidu ega müügiargumenti.
//
// ⚠ Registrist saadud e-post EI OLE sama päritoluga mis ettevõtte lehelt
// korjatud aadress ja OSA neist on isikuandmed (omaniku või raamatupidaja
// nimeline aadress). Kasutus ainult kontrollitud alusel: kirjete juurde
// märgitakse allikas, saatmine käib endiselt outbound-värava ja
// need_evidence kaudu. See fail EI OLE kampaanianimekiri.
//
// Kasutus:  npm run registry:enrich  [--maakond=Pärnu]
import { mkdirSync, createWriteStream, createReadStream, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import { fetchZipEntry, unzipFirstEntry, lines } from '../lib/zipstream.mjs';
import { REGISTRY_DIR, CONTACTS_FILE, META_FILE } from '../lib/registry.mjs';

export const YLDANDMED_URL = 'https://avaandmed.ariregister.rik.ee/sites/default/files/avaandmed/ettevotja_rekvisiidid__yldandmed.json.zip';

const EMAIL_LIIK = /^"liik":"EMAIL"/;
const TEL_LIIK = /^"liik":"(MOB|TELEFON)"/;
const WWW_LIIK = /^"liik":"WWW"/;

function vaartus(line) {
  const i = line.indexOf(':');
  if (i < 0) return null;
  let v = line.slice(i + 1).trim().replace(/,$/, '');
  if (v === 'null') return null;
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v;
}

// Reapõhine skanner. Fail on trükitud taandega, üks väli rea kohta — seepärast
// ei ole vaja 3 GB JSON-i mällu parsida. Kirje algab real "ariregistri_kood".
export function looSkanner(emit) {
  let cur = null;
  let ootavKontakt = null;   // {tyyp, sisu} — kehtivus selgub alles lopp_kpv realt
  let ootavEmtak = null;     // {kood, nimi}
  let ootavAasta = null;

  const lopeta = () => {
    if (!cur) return;
    const on = cur.email.length || cur.tel.length || cur.www.length || cur.emtak || cur.tootajad != null;
    if (on) emit(cur);
    cur = null;
  };

  return {
    rida(raw) {
      const s = raw.trim();
      if (s.startsWith('"ariregistri_kood"')) {
        lopeta();
        const k = vaartus(s);
        cur = { kood: Number(k), email: [], tel: [], www: [], emtak: null, emtak_nimi: null, tootajad: null, tootajad_aasta: null };
        ootavKontakt = null; ootavEmtak = null; ootavAasta = null;
        return;
      }
      if (!cur) return;

      if (EMAIL_LIIK.test(s)) { ootavKontakt = { tyyp: 'email' }; return; }
      if (TEL_LIIK.test(s)) { ootavKontakt = { tyyp: 'tel' }; return; }
      if (WWW_LIIK.test(s)) { ootavKontakt = { tyyp: 'www' }; return; }
      if (ootavKontakt && s.startsWith('"sisu"')) { ootavKontakt.sisu = vaartus(s); return; }
      if (ootavKontakt && s.startsWith('"lopp_kpv"')) {
        // lopp_kpv = null tähendab KEHTIV. Lõppenud sidevahendit ei salvesta.
        if (ootavKontakt.sisu && vaartus(s) === null) {
          const list = cur[ootavKontakt.tyyp];
          if (!list.includes(ootavKontakt.sisu)) list.push(ootavKontakt.sisu);
        }
        ootavKontakt = null;
        return;
      }

      if (s.startsWith('"emtak_kood"')) { ootavEmtak = { kood: vaartus(s), nimi: null }; return; }
      if (ootavEmtak && s.startsWith('"emtak_tekstina"')) { ootavEmtak.nimi = vaartus(s); return; }
      if (ootavEmtak && s.startsWith('"on_pohitegevusala"')) {
        if (s.includes('true')) { cur.emtak = ootavEmtak.kood; cur.emtak_nimi = ootavEmtak.nimi; }
        else if (!cur.emtak) { cur.emtak = ootavEmtak.kood; cur.emtak_nimi = ootavEmtak.nimi; }
        ootavEmtak = null;
        return;
      }

      if (s.startsWith('"majandusaasta_perioodi_lopp_kpv"')) {
        const v = vaartus(s);
        const m = v && v.match(/(\d{4})$/);
        ootavAasta = m ? Number(m[1]) : null;
        return;
      }
      if (s.startsWith('"tootajate_arv"')) {
        const v = vaartus(s);
        const n = v == null ? null : Number(v);
        if (n != null && Number.isFinite(n) && (cur.tootajad_aasta == null || (ootavAasta || 0) >= cur.tootajad_aasta)) {
          cur.tootajad = n;
          cur.tootajad_aasta = ootavAasta;
        }
      }
    },
    lopeta,
  };
}

async function main() {
  const failArg = process.argv.find((a) => a.startsWith('--fail='));
  mkdirSync(REGISTRY_DIR, { recursive: true });

  let stream; let lastModified = null;
  if (failArg) {
    stream = unzipFirstEntry(createReadStream(failArg.slice('--fail='.length)));
  } else {
    const r = await fetchZipEntry(YLDANDMED_URL);
    stream = r.stream; lastModified = r.lastModified;
    process.stderr.write(`Laen ${(r.total / 1048576).toFixed(0)} MB voona (viimati muudetud: ${lastModified})\n`);
  }

  const out = createWriteStream(CONTACTS_FILE);
  let kirjeid = 0; let emailiga = 0; let teliga = 0; let wwwga = 0; let tootajatega = 0;
  let ootel = null;
  const skanner = looSkanner((rec) => {
    kirjeid += 1;
    if (rec.email.length) emailiga += 1;
    if (rec.tel.length) teliga += 1;
    if (rec.www.length) wwwga += 1;
    if (rec.tootajad != null) tootajatega += 1;
    ootel = JSON.stringify(rec) + '\n';
  });

  let loetud = 0;
  for await (const line of lines(stream)) {
    skanner.rida(line);
    if (ootel) { const chunk = ootel; ootel = null; if (!out.write(chunk)) await once(out, 'drain'); }
    loetud += 1;
    if (loetud % 5000000 === 0) process.stderr.write(`\r  ${(loetud / 1e6).toFixed(0)} M rida, ${kirjeid} kirjet   `);
  }
  skanner.lopeta();
  if (ootel) out.write(ootel);
  out.end();
  await once(out, 'finish');
  process.stderr.write('\r');

  const meta = existsSync(META_FILE) ? JSON.parse(readFileSync(META_FILE, 'utf8')) : {};
  meta.yldandmed = {
    url: failArg || YLDANDMED_URL,
    laaditud: new Date().toISOString(),
    fail_muudetud: lastModified,
    kirjeid, emailiga, teliga, wwwga, tootajatega,
  };
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(`contacts.ndjson: ${kirjeid} kirjet — e-post ${emailiga}, tel ${teliga}, www ${wwwga}, töötajate arv ${tootajatega}`);
}

if (process.argv[1]?.endsWith('registry-enrich.mjs')) {
  main().catch((e) => { console.error('registry-enrich nurjus:', e.message); process.exit(1); });
}
