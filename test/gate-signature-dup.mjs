import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadAllSeedCompanies } from '../lib/seed-dedupe.mjs';
import { open } from '../lib/db.mjs';
import { ROOT } from '../lib/env.mjs';
import { LOOBUMISRIDA } from '../lib/sendgate.mjs';

// See varav kaitseb 20.09.2026 leitud vea kordumise eest: kirja keha (body) sisaldas
// loppu kasitsi kirjutatud mini-allkirja ("Gert\ngert@leisson.eu" voi pikem
// "Gert Leisson\nLEISSON OU * 16952932\ngert@leisson.eu"), mis composeHtml/
// composeText (lib/mail.mjs) saatmisel AUTOMAATSELT lisatava buildSignature()
// (lib/signature.mjs) allkirja ETTE dubleeris -- kiri naitas kaks jarjestikust
// "Gert / gert@leisson.eu" rida (nahtud "Kontrolli saadetavat kirja" eelvaates,
// Osauhing Akvedukt naitel). Auditist selgus 10 vigast kirja elavas
// andmebaasis (koik seisuga 'ootel', ukski polnud veel saadetud) ja 27
// seed-korpuses. See on klass viga (sama muster kui gate-letter-hours.mjs
// kaitseb) -- kasitsi kirjutatud sisu, mis lahku laheb voi dubleerib
// automaatset allikat. Vt crm/win/tmp/fix-signature-dup.mjs ja
// crm/win/tmp/fix-signature-dup-seed.mjs (parandused 20.09.2026).
//
// Reegel: body ei tohi KUNAGI sisaldada "gert@leisson.eu" -- see lisatakse
// saatmisel eraldi (buildSignature()). Ainus lubatud erand on ESS 103-1
// loobumisrida (LOOBUMISRIDA, sendgate.mjs), mis nouab omaette tuvastatavat
// saatja identiteeti ja on juba korrektselt signatuuri JARGI paigutatud
// (vt lib/mail.mjs splitLoobumisrida()).
const HANDSIGN_RE = /\bGert\b[\s\S]{0,40}gert@leisson\.eu\s*$/i;
const EMAIL_RE = /gert@leisson\.eu/i;

function findDuplicates(rows) {
  const bad = [];
  for (const r of rows) {
    if (!r.body) continue;
    const body = String(r.body);
    if (!EMAIL_RE.test(body)) continue;
    if (body.trimEnd().endsWith(LOOBUMISRIDA.trim())) continue; // legitiimne opt-out rida
    if (HANDSIGN_RE.test(body)) bad.push({ id: r.id, name: r.name, file: r._file });
  }
  return bad;
}

// seed/*.json ja data/crm.sqlite on .gitignore'is (privaatne muugiandmestik) --
// CI-s ja varskes kloonis neid ei ole, korpusekontroll jaab siis vahele
// (nagu gate-letter-hours.mjs ja gate-seed-dedupe.mjs puhul).
const seedCompanies = loadAllSeedCompanies();
if (seedCompanies.length === 0) {
  console.log('INFO signature-dup: seed/*.json puuduvad (CI voi varske kloon) -- seed-korpuse kontroll jai vahele.');
} else {
  const bad = findDuplicates(seedCompanies);
  assert.equal(bad.length, 0,
    `Seed-korpuses on ${bad.length} kirja, kus body sisaldab kasitsi kirjutatud allkirja, mis dubleerib automaatset: ` +
    bad.map((b) => `${b.id} (${b.file})`).join('; '));
  console.log(`PASS signature-dup (seed): ${seedCompanies.length} kirjet kontrollitud, 0 dublit.`);
}

const dbPath = join(ROOT, 'data', 'crm.sqlite');
if (!existsSync(dbPath)) {
  console.log('INFO signature-dup: data/crm.sqlite puudub (CI voi varske kloon) -- elava andmebaasi kontroll jai vahele.');
} else {
  const db = open({ dbPath });
  const rows = db.prepare("SELECT id, name, body FROM companies WHERE body IS NOT NULL AND body != ''").all();
  db.close();
  const bad = findDuplicates(rows);
  assert.equal(bad.length, 0,
    `Elavas andmebaasis on ${bad.length} kirja, kus body sisaldab kasitsi kirjutatud allkirja, mis dubleerib automaatset: ` +
    bad.map((b) => b.id).join('; '));
  console.log(`PASS signature-dup (db): ${rows.length} kirjet kontrollitud, 0 dublit.`);
}

// REGRESSIOONITEST, jookseb ALATI (ka CI-s ilma seed/db-ta), sest tema kaitseb
// tuvastusloogikat ennast, mitte konkreetset andmeseisu.
{
  const ok = { id: 'gate-oige', name: 'Oige OU', body: 'Sisuline kiri ilma allkirjata lopus.' };
  const badShort = { id: 'gate-vale-luhike', name: 'Vale OU', body: 'Sisu.\n\nGert\ngert@leisson.eu' };
  const badLong = { id: 'gate-vale-pikk', name: 'Vale2 OU', body: 'Sisu.\n\nGert Leisson\nLEISSON OÜ · 16952932\ngert@leisson.eu' };
  const withOptOut = {
    id: 'gate-loobumine',
    name: 'Loobumine OU',
    body: `Sisuline kiri.\n\n${LOOBUMISRIDA}`,
  };
  const noEmail = { id: 'gate-ilma-postita', name: 'Ilma OU', body: 'Kirjutan Gert Leissonile homme.' };

  const res = findDuplicates([ok, badShort, badLong, withOptOut, noEmail]);
  const ids = res.map((r) => r.id);
  assert.deepEqual(ids, ['gate-vale-luhike', 'gate-vale-pikk'],
    'Tuvastusloogika peab leidma tapselt kaks dublit (luhike ja pikk kasitsi allkiri) ega tohi loomata valehaireid oige kirja, ESS loobumisrea ega e-postita mainimise puhul.');
  console.log('PASS signature-dup reg-test: tuvastusloogika leiab tapselt oodatud dublid.');
}
