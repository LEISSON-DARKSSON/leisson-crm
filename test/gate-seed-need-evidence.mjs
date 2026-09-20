import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open, seed } from '../lib/db.mjs';

// See varav kaitseb 20.09.2026 leitud vea kordumise eest: iga uue ettevotte
// need_evidence oli seed()-i kaudu lisatuna VAIKIMISI tuhi, mis blokeeris
// lib/outbound.mjs currentSource()-i kaudu KOIKI saatmisi (uksik- ja
// kampaaniakirjad uhtemoodi) veateatega "Lisa esmalt kontakti pohjendus voi
// kliendi kinnitatud vajadus" - ja keegi ei marganud, sest viga ilmnes alles
// saatmiskatsel, mitte importimisel. 128-st CRM-i ettevottest ei olnud UHELGI
// need_evidence taidetud. Parandus: seed() tuletab need_evidence finding-
// valjast, kui seda ei ole eraldi antud - vt lib/db.mjs ins.run().

const seedDir = mkdtempSync(join(tmpdir(), 'leisson-crm-seed-evidence-'));
try {
  writeFileSync(join(seedDir, 'parnu2.json'), JSON.stringify({
    companies: [
      { id: 'gate-ilma-pohjenduseta', name: 'Ilma Pohjenduseta OU', finding: 'Avaleht 5 MB, CLS 0,3, pealkiri puudub.' },
      { id: 'gate-oma-pohjendusega', name: 'Oma Pohjendusega OU', finding: 'Uldine leid.', need_evidence: 'Klient kuines ise, et vorm ei toota.' },
      { id: 'gate-ilma-leiuta', name: 'Ilma Leiuta OU' },
    ],
  }));

  const db = open({ dbPath: ':memory:' });
  const result = seed(db, { seedDir });
  assert.equal(result.inserted, 3, 'koik kolm testkirjet peavad sisenema');

  const rows = Object.fromEntries(
    db.prepare("SELECT id, need_evidence, finding FROM companies WHERE id LIKE 'gate-%'").all().map(r => [r.id, r]),
  );

  assert.equal(rows['gate-ilma-pohjenduseta'].need_evidence, rows['gate-ilma-pohjenduseta'].finding,
    'kui need_evidence puudub, peab see tulema finding-valjalt (mitte jaama tuhjaks ja blokeerima saatmist)');
  assert.equal(rows['gate-oma-pohjendusega'].need_evidence, 'Klient kuines ise, et vorm ei toota.',
    'kui seed-JSON annab need_evidence otse, ei tohi finding seda ule kirjutada');
  assert.equal(rows['gate-ilma-leiuta'].need_evidence, null,
    'kui ei finding ega need_evidence ole antud, jaab valjund NULL, mitte tuhi string - vale positiivne oleks halvem kui tuvastatav puudus');

  db.close();
  console.log('PASS seed() tuletab need_evidence finding-valjast, kui seda otse ei antud (3 kontrolli)');
} finally {
  rmSync(seedDir, { recursive: true, force: true });
}
