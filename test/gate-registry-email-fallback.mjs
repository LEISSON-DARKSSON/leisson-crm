// agent/registry-website-fallback.mjs + lib/db.mjs seed() e-posti täitmine —
// lisatud 20.09.2026, kui Gert palus automatiseerida käsitsi kaks korda
// tehtud töö (11/12 ettevõtte e-posti leidmine nende endi veebilehelt).
//
// See värav ei tee ÜHTEGI võrgupäringut — ainult puhas otsustusloogika ja
// süntees-DB, nagu iga teine test:offline värav. Reegel, mida kontrollime:
// "vale on halvem kui puuduv" — KINDEL ainult täpselt ühe oma-domeeni
// vaste korral, kõik muu jääb kirjutamata.
import assert from 'node:assert/strict';
import { registrableDomain, isJunkEmail, extractCandidates, decide } from '../agent/registry-website-fallback.mjs';
import { open, seed } from '../lib/db.mjs';

// ---------------------------------------------------------- registrableDomain
assert.equal(registrableDomain('https://www.gridraven.com/company/contact'), 'gridraven.com');
assert.equal(registrableDomain('claw.gridraven.com'), 'gridraven.com');
assert.equal(registrableDomain('uus.pivarootsimois.ee'), 'pivarootsimois.ee');
assert.equal(registrableDomain('https://[not-a-valid-host'), null, 'vigane URL ei tohi visata, vaid tagastab null');
console.log('PASS email-fallback: registrableDomain normaliseerib alamdomeenid ja www');

// -------------------------------------------------------------- isJunkEmail
assert.equal(isJunkEmail('noreply@gridraven.com'), true);
assert.equal(isJunkEmail('info@sentry.io'), true, 'kolmanda osapoole jälgimisteenus, mitte ettevõtte enda kontakt');
assert.equal(isJunkEmail('you@example.com'), true, 'levinud platseholder');
assert.equal(isJunkEmail('photo@2x.png'), true, 'pildifaili nimi, mitte e-post');
assert.equal(isJunkEmail('georg@gridraven.com'), false);
console.log('PASS email-fallback: isJunkEmail filtreerib platseholderid ja kolmandad osapooled');

// ------------------------------------------------------------ extractCandidates
{
  const html = `<html><body><footer><a href="mailto:georg@gridraven.com">Kirjuta meile</a>
    <script>var sentry="crash@sentry.io"</script></footer></body></html>`;
  assert.deepEqual(extractCandidates(html), ['georg@gridraven.com'], 'mailto leitakse, sentry.io jäetakse kõrvale');
}
{
  const html = `<p>Küsimused? Kirjuta info@firma.ee või helista.</p>`;
  assert.deepEqual(extractCandidates(html), ['info@firma.ee'], 'vabateksti e-post ilma mailto lingita leitakse');
}
console.log('PASS email-fallback: extractCandidates kogub mailto ja vabateksti, filtreerib prügi');

// -------------------------------------------------------------------- decide
assert.deepEqual(decide([], 'firma.ee'), { status: 'puudub', email: null, reason: 'ühtegi e-posti ei leitud' });
assert.equal(decide(['info@firma.ee'], 'firma.ee').status, 'kindel', 'üks vaste enda domeenilt on kindel');
assert.equal(decide(['info@firma.ee'], 'firma.ee').email, 'info@firma.ee');
assert.equal(decide(['a@firma.ee', 'b@firma.ee'], 'firma.ee').status, 'ebakindel', 'kaks erinevat vastet enda domeenilt ei tohi ise valida');
assert.equal(decide(['sauemois@hiteh.ee'], 'pivarootsimois.ee').status, 'ebakindel', 'ainult võõralt domeenilt leitud aadressi ei tohi kirjutada (Pivarootsi juhtum)');
console.log('PASS email-fallback: decide on KINDEL ainult ühe oma-domeeni vaste korral, muidu ebakindel');

// ---------------------------------------------------- lib/db.mjs seed() e-post
// Registreid puudutav osa: kui seed-fail leiab e-posti juba baasis oleva
// ettevõtte jaoks, peab see baasi jõudma (INSERT ON CONFLICT DO NOTHING
// iseenesest seda ei tee) — täpselt sama parandus, mis regcode'il juba on.
{
  const db = open({ dbPath: ':memory:' });
  db.prepare("INSERT INTO companies(id,name,status,listid,updated) VALUES('x','Firma X','ootel','parnu',?)").run(new Date().toISOString());
  assert.equal(db.prepare('SELECT email FROM companies WHERE id=?').get('x').email, null);

  // Fikstuurikaust laheb AJUTISSE kausta, mitte repo sisse. Varem kirjutas see
  // varav failid `test/fixtures-email-fallback/` alla ja koristas need rmSync-iga.
  // Monteeritud kettal (Cowork VM) on kustutamine keelatud, seega rmSync viskas
  // EPERM-i PARAST seda, kui koik neli vaidet olid labitud: varav oli igavesti
  // punane pohjusel, millel ei ole koodiga mingit pistmist, ja see opetab
  // varavajooksja tulemust eirama. Ajutine kaust on ka niikuinii oigem koht -
  // katkenud jooks ei jata repo sisse rooptaid.
  const { mkdirSync, writeFileSync, rmSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, sep } = await import('node:path');
  const dirPath = mkdtempSync(join(tmpdir(), 'crm-email-fallback-')) + sep;
  writeFileSync(dirPath + 'parnu.json', JSON.stringify({ companies: [{ id: 'x', name: 'Firma X', email: 'info@firma-x.ee', listid: 'parnu' }] }));
  writeFileSync(dirPath + 'plaan.json', JSON.stringify({ companies: [] }));
  writeFileSync(dirPath + 'parnu2.json', JSON.stringify({ companies: [] }));

  seed(db, { seedDir: dirPath });
  assert.equal(db.prepare('SELECT email FROM companies WHERE id=?').get('x').email, 'info@firma-x.ee', 'seed() täidab olemasoleva rea tühja e-posti');

  db.prepare("UPDATE companies SET email='kasitsi@parandatud.ee' WHERE id='x'").run();
  writeFileSync(dirPath + 'parnu.json', JSON.stringify({ companies: [{ id: 'x', name: 'Firma X', email: 'teine@firma-x.ee', listid: 'parnu' }] }));
  seed(db, { seedDir: dirPath });
  assert.equal(db.prepare('SELECT email FROM companies WHERE id=?').get('x').email, 'kasitsi@parandatud.ee', 'seed() EI kirjuta üle juba olemasolevat (ka käsitsi parandatud) e-posti');

  // Ajutise kausta koristamine ei tohi VARAVAT maha votta, kui keskkond ei luba
  // kustutada - vaited on selleks hetkeks juba labitud.
  try { rmSync(dirPath, { recursive: true, force: true }); } catch { /* ajutine kaust jaab OS-i hooleks */ }
  db.close();
}
console.log('PASS email-fallback: lib/db.mjs seed() täidab tühja e-posti, aga ei kirjuta olemasolevat üle');
