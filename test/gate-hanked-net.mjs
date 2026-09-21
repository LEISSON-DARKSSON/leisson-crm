// Vorgulugeja varav. Leitud ulesande 13 mootmisel: hanked-history allalaadimine
// jai Windowsis (Node 25.6.1) rippuma ULE 9 MINUTI, kuigi AEGUMINE oli 5 minutit.
// `AbortSignal.timeout` anti `fetch`-ile, aga keha loeti eraldi `res.text()`-iga
// ja seisma jaanud keha lugemist signaal seal katki ei teinud.
//
// Tagajarg oleks olnud vaikne: kuine Task Scheduleri jooks rippuks igavesti ja
// jargmine teataks "kaib juba - jai vahele". Ajalugu ei uueneks enam kunagi.
//
// Koik testid kasutavad KOHALIKKU serverit (127.0.0.1) - RHR-i ei koputata.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { laeTekst, VorguViga } from '../lib/hanked-net.mjs';

let tehtud = 0;
const check = async (nimi, f) => { await f(); tehtud++; console.log('  ok ' + nimi); };

// Server, mis kaitub etteantud viisil. Tagastab {url, sulge}.
function server(kaitumine) {
  return new Promise((res) => {
    const s = createServer(kaitumine);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      res({ url: 'http://127.0.0.1:' + port + '/', sulge: () => new Promise((r) => s.close(r)), s });
    });
  });
}

await check('terve vastus loetakse tervikuna, ka tukkidena', async () => {
  const osa = 'Ü'.repeat(10000); // mitmebaidine mark tuki piiril
  const { url, sulge } = await server((req, res) => {
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.write(osa); res.write(osa); res.end(osa);
  });
  const t = await laeTekst(url, { aegumine: 5000 });
  assert.equal(t.length, 30000, 'kogu keha peab kohale jouma');
  assert.equal(t, osa + osa + osa, 'UTF-8 mark ei tohi tuki piiril katki minna');
  await sulge();
});

await check('rippuv keha aegub - SEE ON SEE VIGA, mida varav valvab', async () => {
  // Pais tuleb kohe, keha jaab seisma. Tapselt see, mis Windowsis juhtus.
  const { url, sulge, s } = await server((req, res) => {
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.write('<OPEN-DATA>'); // ja siis mitte midagi
  });
  const algus = Date.now();
  await assert.rejects(
    () => laeTekst(url, { aegumine: 600, seisuAeg: 300, silt: 'Kuu 2026-08' }),
    (e) => {
      assert.ok(e instanceof VorguViga, 'viga peab olema VorguViga, sai ' + e.name);
      assert.match(e.message, /^Kuu 2026-08: /, 'silt peab teates olema: ' + e.message);
      assert.equal(e.aegus, true, 'aegumine peab olema margitud');
      assert.ok(!/[A-Z][a-z]+Error|aborted|terminated/.test(e.message.replace(/^Kuu[^—]*—\s*/, ''))
        || /katkes|seisis|aegus|ei saadud|rippuma/.test(e.message),
        'teade peab olema eestikeelne: ' + e.message);
      return true;
    });
  const kulus = Date.now() - algus;
  assert.ok(kulus < 2500, 'aegumine peab PARISELT rakenduma, kulus ' + kulus + ' ms');
  s.closeAllConnections?.();
  await sulge();
});

await check('aeglane aga liikuv voog EI aegu enne koguaega', async () => {
  const { url, sulge } = await server((req, res) => {
    res.writeHead(200, {});
    let n = 0;
    const t = setInterval(() => {
      res.write('x'.repeat(100));
      if (++n === 6) { clearInterval(t); res.end(); }
    }, 60); // iga 60 ms uus bait - seisuvalve (300 ms) ei tohi vallanduda
  });
  const t = await laeTekst(url, { aegumine: 5000, seisuAeg: 300 });
  assert.equal(t.length, 600, 'aeglane, aga liikuv voog peab kohale jouma');
  await sulge();
});

await check('mitte-200 annab eestikeelse vea ja koodi, keha ei jaa lahti', async () => {
  const { url, sulge } = await server((req, res) => {
    res.writeHead(502, { 'content-type': 'text/html' });
    res.end('<html>Bad Gateway</html>');
  });
  await assert.rejects(() => laeTekst(url, { aegumine: 2000, silt: 'Kuu 2026-08' }), (e) => {
    assert.equal(e.kood, 502);
    assert.match(e.message, /Kuu 2026-08: RHR vastas 502/);
    return true;
  });
  await sulge();
});

await check('olematu host annab eestikeelse vea, mitte toore ENOTFOUND-i', async () => {
  await assert.rejects(
    () => laeTekst('http://127.0.0.1:1/', { aegumine: 2000, silt: 'Kuu 2026-08' }),
    (e) => {
      assert.ok(e instanceof VorguViga);
      assert.match(e.message, /^Kuu 2026-08: vastust ei saadud — /);
      return true;
    });
});

await check('taimerid ei hoia protsessi elus', async () => {
  // Kui taimereid ei unref'itaks, ei valjuks see protsess kunagi ise.
  const { url, sulge } = await server((req, res) => { res.writeHead(200, {}); res.end('ok'); });
  await laeTekst(url, { aegumine: 3600000 }); // tund aega, aga voog lopeb kohe
  await sulge();
  const lahti = (process.getActiveResourcesInfo?.() || []).filter((r) => r === 'Timeout');
  assert.equal(lahti.length, 0, 'lahtiseid Timeout-ressursse ei tohi jaada: ' + lahti.length);
});

await check('kova taimer paastab ka siis, kui katkestamine EI MOJU', async () => {
  // See on kiht 3 ja ta on olemas just selle parast, et Windowsis (Node 25.6.1)
  // ei katkestanud signaal seisma jaanud keha lugemist. Matkime tapselt seda:
  // fetchFn, mis ei lahene KUNAGI ja ignoreerib signaali taielikult.
  const algus = Date.now();
  await assert.rejects(
    () => laeTekst('http://127.0.0.1:1/', {
      aegumine: 400, seisuAeg: 200, silt: 'Kuu 2026-08',
      fetchFn: () => new Promise(() => {}),   // ei lahene, ei kuula signaali
    }),
    (e) => {
      assert.ok(e instanceof VorguViga, 'viga peab olema VorguViga, sai ' + e.name);
      assert.match(e.message, /jäi rippuma ja katkestamine ei mõjunud/,
        'teade peab utlema, MIS juhtus: ' + e.message);
      assert.equal(e.aegus, true);
      return true;
    });
  const kulus = Date.now() - algus;
  assert.ok(kulus >= 400 && kulus < 2000,
    'kova taimer peab rakenduma aegumine+seisuAeg jarel, kulus ' + kulus + ' ms');
});

console.log('PASS hanked-net: ' + tehtud + ' kontrolli');
