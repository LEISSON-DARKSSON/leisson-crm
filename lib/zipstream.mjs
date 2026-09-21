// Voogesitav ZIP-lahtipakkija ilma ühegi välise sõltuvuseta.
//
// Äriregistri avaandmed on ühe kirjega ZIP-failid, millest suurim
// (ettevotja_rekvisiidid__yldandmed.json.zip, 230 MB) pakib lahti üle 3 GB
// JSON-iks. Seda EI TOHI kettale ega mällu tervikuna panna — seepärast
// loeme voona: HTTP-vastus -> ZIP local file header vahele jätta ->
// zlib.createInflateRaw -> readline. Kettale jõuab ainult see kitsas
// väljavõte, mida CRM päriselt kasutab (vt agent/registry-*.mjs).
//
// ZIP local file header (PKWARE APPNOTE 4.3.7):
//   0..3   allkiri 0x04034b50
//   8..9   pakkimismeetod (8 = deflate)
//   26..27 failinime pikkus
//   28..29 lisavälja pikkus
//   andmed algavad baidist 30 + nimi + lisaväli
// Kuna kirjeid on täpselt üks, ei ole keskkataloogi vaja lugeda.
import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { createInflateRaw } from 'node:zlib';
import { createInterface } from 'node:readline';

const LOCAL_SIG = 0x04034b50;
const METHOD_DEFLATE = 8;
const METHOD_STORE = 0;

// Võtab toorest ZIP-voost esimese kirje andmed ja tagastab lahtipakitud voo.
export function unzipFirstEntry(src, onProgress) {
  const out = createInflateRaw();
  let head = Buffer.alloc(0);
  let headerDone = false;
  let stored = false;
  let seen = 0;

  const pass = (chunk) => {
    if (!out.write(chunk)) src.pause();
  };

  src.on('data', (chunk) => {
    seen += chunk.length;
    if (onProgress) onProgress(seen);
    if (headerDone) { pass(chunk); return; }
    head = head.length ? Buffer.concat([head, chunk]) : Buffer.from(chunk);
    if (head.length < 30) return;
    if (head.readUInt32LE(0) !== LOCAL_SIG) {
      src.destroy(); out.destroy(new Error('See ei ole ZIP-fail (puudub local file header).'));
      return;
    }
    const method = head.readUInt16LE(8);
    if (method !== METHOD_DEFLATE && method !== METHOD_STORE) {
      src.destroy(); out.destroy(new Error('Tundmatu ZIP-pakkimismeetod: ' + method));
      return;
    }
    stored = method === METHOD_STORE;
    const start = 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    if (head.length < start) return;
    headerDone = true;
    const rest = head.subarray(start);
    head = Buffer.alloc(0);
    if (stored) {
      // Pakkimata (STORE) kirjet inflateRaw lahti ei paki. Äriregistri failid
      // on alati deflate; kui see kunagi muutub, lõpetame selge veaga, mitte
      // vaikse katkise vooga.
      src.destroy();
      out.destroy(new Error('Pakkimata (STORE) ZIP-kirjet see lugeja ei toeta.'));
      return;
    }
    if (rest.length) pass(rest);
  });

  out.on('drain', () => src.resume());
  src.on('end', () => out.end());
  src.on('error', (e) => out.destroy(e));
  return out;
}

// Laeb URL-i ja tagastab lahtipakitud voo. Ei kirjuta midagi kettale.
export async function fetchZipEntry(url, { timeoutMs = 30 * 60 * 1000, onProgress } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const res = await fetch(url, { signal: ac.signal });
  if (!res.ok) { clearTimeout(timer); throw new Error(`HTTP ${res.status} — ${url}`); }
  const total = Number(res.headers.get('content-length') || 0);
  const lastModified = res.headers.get('last-modified') || null;
  const src = Readable.fromWeb(res.body);
  src.once('close', () => clearTimeout(timer));
  return { stream: unzipFirstEntry(src, onProgress), total, lastModified };
}

// Sama kohaliku faili pealt — kasutab test/gate-registry.mjs sünteetilise
// fikstuuri peal, et parsimisloogika oleks testitud ILMA võrguta.
export function readZipEntryFile(path) {
  return unzipFirstEntry(createReadStream(path));
}

export function lines(stream) {
  return createInterface({ input: stream, crlfDelay: Infinity });
}

// Inimloetav edenemisnäit pikkade allalaadimiste juurde (stderr, mitte stdout,
// et torustik jääks puhtaks).
export function progressReporter(label, total) {
  let last = 0;
  return (seen) => {
    if (seen - last < 8 * 1024 * 1024) return;
    last = seen;
    const mb = (seen / 1048576).toFixed(0);
    const pct = total ? ` (${((seen / total) * 100).toFixed(0)}%)` : '';
    process.stderr.write(`\r${label}: ${mb} MB${pct}   `);
  };
}
