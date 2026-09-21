// VARAV: alusdokumentide tekstiks-saamine ei tohi vaikselt ara kukkuda.
//
// MIKS SEE VARAV OLEMAS ON (mõõdetud 21.09.2026, hange 315437 TTJA):
// `npm run hanked:dokumendid -- --ref=315437` laadis alla 9 faili ja luges neist
// tekstiks NULL tükki, sest spawnSync('pdftotext') sai ENOENT-i — kuigi masinas
// OLI pdftotext (xpdf 4.00, C:\Program Files\Git\mingw64\bin all). Tagajärg oli
// vaikne: rollid / kaive_noue / quality_weight jäid baasis NULL, verdikt jäi
// KAALU (skoor 45), kuigi alusdokumentides oli blokeeriv nõue (doktorikraad või
// doktorantuuris õppimise staatus) ja õige vastus oli JÄTA. Inimene luges need
// PDF-id lõpuks käsitsi. Täpselt see kordumine on siin kinni keeratud.
//
// Värav on TEADLIKULT masinasõltuv: ta nõuab, et SELLES masinas, kus radar
// jookseb, leiaks kood pdftotext-i üles. Kui ta ei leia, ei ole see „keskkonna
// eripära“ vaid katkine radar.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { leiaPdftotext, onPdftotext, failiTekst, failidTekstiks } from '../agent/hanked-docs.mjs';

const FIKSTUUR = join(import.meta.dirname, 'fixtures', 'pdftotext-proov.pdf');

// 1. Binaar peab leiduma. Kui see kukub, on parandus üks kahest:
//    PDFTOTEXT=<täistee> keskkonda, või binaar PATH-i.
{
  const tee = leiaPdftotext();
  assert.ok(tee, 'pdftotext jäi leidmata — sea PDFTOTEXT=<täistee> või lisa binaar PATH-i. '
    + 'Ilma temata jäävad KÕIK hanke nõuded lugemata ja verdikt on vale.');
  assert.equal(onPdftotext(), true, 'onPdftotext() ei nõustu leiaPdftotext()-iga');
}

// 2. PDFTOTEXT keskkonnamuutuja peab olema ülimuslik ja vale tee ei tohi
//    binaari leidmist katki teha (kandidaadid jätkuvad).
{
  const vale = leiaPdftotext({ env: { PDFTOTEXT: 'C:\\ei\\ole\\olemas\\pdftotext.exe' } });
  assert.ok(vale, 'vale PDFTOTEXT väärtus lõpetas otsingu — ta peab olema esimene kandidaat, mitte ainus');
  assert.ok(!String(vale).includes('ei\\ole\\olemas'), 'olematu tee tuli tagasi kehtiva binaarina');
}

// 3. Paris PDF peab andma parist teksti. See on see samm, mis 315437 puhul
//    vaikselt nulli andis.
{
  assert.ok(existsSync(FIKSTUUR), 'fikstuur puudub: ' + FIKSTUUR);
  const r = failiTekst(FIKSTUUR);
  assert.equal(r.pohjus, null, 'fikstuur ei jõudnud tekstini: ' + r.pohjus);
  assert.ok(r.tekst && r.tekst.includes('MARKER-PDFTOTEXT-TOOTAB'),
    'fikstuuri tekstist ei leitud markerit — pdftotext jooksis, aga väljund on tühi või vigane');
  // Just see sõna otsustas 315437 verdikti; kui ta ei jõua tekstini, on
  // isikupõhine kvalifikatsioonivärav lugemata.
  assert.ok(/[Dd]oktorikraad/.test(r.tekst), 'fikstuuri sisu ei ole oodatud kujul');
}

// 4. failidTekstiks EI TOHI vaikselt tuhja anda: kui binaari ei ole, peab iga
//    fail saama nahtava pohjuse ja lipp `pdftotext` peab olema false.
{
  const vastus = failidTekstiks([{ nimi: 'proov.pdf', tee: FIKSTUUR }], { pdftotext: false });
  assert.equal(vastus.pdftotext, false, 'pdftotext lipp peab olema TÕEVÄÄRTUS false (baas + vaade loevad seda)');
  assert.equal(vastus.tekstid.length, 0);
  assert.equal(vastus.tekstita.length, 1);
  assert.match(vastus.tekstita[0].pohjus, /pdftotext puudub/,
    'puuduva binaari korral peab põhjus olema nähtav, mitte tühi tekst');
}

// 5. Onnestunud jooksu korral on lipp TOEVAARTUS true ja taistee eraldi valjal.
//    Boolean on siin leping baasi (`docs_leiud.pdftotext`) ja vaatega
//    (`dok.pdftotext === false`) — teetekst sinna kohta ei tohi sattuda.
{
  const vastus = failidTekstiks([{ nimi: 'proov.pdf', tee: FIKSTUUR }]);
  assert.equal(vastus.pdftotext, true);
  assert.equal(typeof vastus.pdftotext, 'boolean', 'lipp ei tohi olla tee-string');
  assert.ok(vastus.pdftotextTee, 'täistee peab olema eraldi väljal pdftotextTee');
  assert.equal(vastus.tekstita.length, 0, 'ükski fail ei tohiks jääda tekstita: ' + JSON.stringify(vastus.tekstita));
}

console.log('OK gate-hanked-docs-tekst: pdftotext leitud (' + leiaPdftotext() + '), fikstuur jõuab tekstini, puuduv binaar on nähtav');
