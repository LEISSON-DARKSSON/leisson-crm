// E-posti HTML-allkiri, genereeritud Orbit tokenitest (packages/orbit-tokens/orbit.tokens.json).
// E-postis ei tööta CSS-muutujad ega välised fondid -> token väärtused lahendatakse siin ehitusajal
// ja kirjutatakse inline-stiilidena. Kasutame DAY-režiimi värve, sest kirjakliendid on valgel põhjal.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.mjs';
import { logoEmail } from './logo.mjs';

const TOKENS = join(ROOT, '..', 'packages', 'orbit-tokens', 'orbit.tokens.json');

function loadTokens() {
  return JSON.parse(readFileSync(TOKENS, 'utf8'));
}

// {primitive.gray.50} -> väärtus
function deref(tokens, value) {
  let v = value;
  let guard = 0;
  while (typeof v === 'string' && v.startsWith('{') && v.endsWith('}') && guard++ < 8) {
    const path = v.slice(1, -1).split('.');
    let node = tokens;
    for (const seg of path) node = node?.[seg];
    v = node?.$value ?? node;
  }
  return v;
}

function dayColor(tokens, name) {
  const t = tokens.color[name];
  const mode = t?.$extensions?.['eu.leisson.orbit']?.modes?.day ?? t?.$value;
  return deref(tokens, mode);
}

// rgba(0,0,0,a) valgel põhjal -> kindel hex (Outlook ei kuva rgba't usaldusväärselt)
function flattenOnWhite(rgba) {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(rgba || '');
  if (!m) return rgba;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const mix = (c) => Math.round(c * a + 255 * (1 - a));
  const hex = (c) => c.toString(16).padStart(2, '0');
  return `#${hex(mix(r))}${hex(mix(g))}${hex(mix(b))}`;
}

export function buildSignature(opts = {}) {
  const tokens = loadTokens();
  const T = {
    canvas: dayColor(tokens, 'canvas'),
    ink: dayColor(tokens, 'ink'),
    ink2: flattenOnWhite(dayColor(tokens, 'ink-2')),
    ink3: flattenOnWhite(dayColor(tokens, 'ink-3')),
    hairline: flattenOnWhite(dayColor(tokens, 'hairline')),
    hairlineStrong: flattenOnWhite(dayColor(tokens, 'hairline-strong')),
    signal: dayColor(tokens, 'signal'),
    display: tokens.font.display.$value.map((f) => (f.includes(' ') ? `'${f}'` : f)).join(', '),
    body: tokens.font.body.$value.map((f) => (f.includes(' ') ? `'${f}'` : f)).join(', '),
    data: tokens.font.data.$value.map((f) => (f.includes(' ') ? `'${f}'` : f)).join(', '),
    s2: tokens.space['2'].$value,
    s3: tokens.space['3'].$value,
    s4: tokens.space['4'].$value,
    wBlack: tokens.font.weight.black.$value,
    wBold: tokens.font.weight.bold.$value,
    wRegular: tokens.font.weight.regular.$value,
  };

  const p = {
    name: opts.name || 'Gert Leisson',
    role: opts.role || 'Asutaja ja süsteemiarhitekt',
    org: opts.org || 'Leisson Creative',
    legal: opts.legal || 'LEISSON OÜ · 16952932',
    email: opts.email || 'gert@leisson.eu',
    site: opts.site || 'leisson.eu',
    prices: opts.prices || 'leisson.eu/et/prices',
    strip: opts.strip || 'Veebikiirus · ligipääsetavus · disainisüsteemid',
    ...opts,
  };

  const mono = (size, color, extra = '') =>
    `font-family:${T.data};font-size:${size}px;line-height:1.45;color:${color};${extra}`;

  const html = `<!-- LEISSON CREATIVE / Orbit e-posti allkiri. Genereeritud orbit.tokens.json-ist. Ära muuda käsitsi. -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:${T.canvas};">
  <tr>
    <td style="padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:460px;">
        <tr>
          <td style="padding:0 0 ${T.s2} 0;">
            ${logoEmail({ display: T.display, mono: T.data, ink: T.ink, ink3: T.ink3 })}
          </td>
        </tr>
        <tr>
          <td style="padding:0;border-top:1px solid ${T.hairlineStrong};line-height:0;font-size:0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:${T.s3} 0 0 0;">
            <div style="font-family:${T.body};font-weight:${T.wBold};font-size:16px;line-height:1.3;letter-spacing:0.01em;color:${T.ink};">${p.name}</div>
            <div style="${mono(12, T.ink2, 'letter-spacing:0.08em;padding-top:2px;')}">${p.role}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:${T.s3} 0 0 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td style="${mono(12, T.ink3, 'letter-spacing:0.12em;text-transform:uppercase;padding:0 12px 3px 0;white-space:nowrap;')}">E-post</td>
                <td style="padding:0 0 3px 0;"><a href="mailto:${p.email}" style="${mono(13, T.signal, 'text-decoration:none;')}">${p.email}</a></td>
              </tr>
              <tr>
                <td style="${mono(12, T.ink3, 'letter-spacing:0.12em;text-transform:uppercase;padding:0 12px 3px 0;white-space:nowrap;')}">Veeb</td>
                <td style="padding:0 0 3px 0;"><a href="https://www.${p.site}" style="${mono(13, T.signal, 'text-decoration:none;')}">${p.site}</a></td>
              </tr>
              <tr>
                <td style="${mono(12, T.ink3, 'letter-spacing:0.12em;text-transform:uppercase;padding:0 12px 3px 0;white-space:nowrap;')}">Hinnakiri</td>
                <td style="padding:0 0 3px 0;"><a href="https://www.${p.prices}" style="${mono(13, T.signal, 'text-decoration:none;')}">${p.prices}</a></td>
              </tr>
              <tr>
                <td style="${mono(12, T.ink3, 'letter-spacing:0.12em;text-transform:uppercase;padding:0 12px 0 0;white-space:nowrap;')}">Ettevõte</td>
                <td style="${mono(13, T.ink2)}">${p.legal}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:${T.s3} 0 0 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">
              <tr>
                <td style="padding:0;border-top:1px solid ${T.hairline};line-height:0;font-size:0;">&nbsp;</td>
              </tr>
              <tr>
                <td style="${mono(12, T.ink3, `letter-spacing:0.08em;padding:${T.s2} 0 0 0;`)}">${p.strip}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

  const text = `--\n${p.name}\n${p.role} · ${p.org}\n${p.legal}\n${p.email} · ${p.site} · ${p.prices}`;

  return { html, text, tokens: T };
}

export function previewPage() {
  const { html } = buildSignature();
  return `<!doctype html>
<html lang="et"><head><meta charset="utf-8"><title>Orbit e-posti allkiri</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;700&family=Barlow+Condensed:wght@400;800&family=IBM+Plex+Mono:wght@400&display=swap">
<style>
  body{margin:0;background:#5A5A5F;font-family:Barlow,Arial,sans-serif;padding:48px 24px}
  .sheet{max-width:720px;margin:0 auto;background:#fff;padding:40px;border-radius:4px}
  h1{font-family:'Barlow Condensed',Arial,sans-serif;font-size:28px;margin:0 0 4px;letter-spacing:.005em}
  p.note{font-family:'IBM Plex Mono',monospace;font-size:12px;color:rgba(0,0,0,.55);margin:0 0 28px;letter-spacing:.08em}
  .frame{border:1px dashed #E0E0E0;padding:24px;margin-bottom:28px}
  pre{font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.5;background:#F0F0FA;padding:16px;overflow:auto;white-space:pre-wrap;word-break:break-all;color:#1A1A1E}
</style></head>
<body><div class="sheet">
  <h1>Orbit e-posti allkiri</h1>
  <p class="note">GENEREERITUD ORBIT.TOKENS.JSON-IST · DAY-REŽIIM</p>
  <div class="frame">${html}</div>
  <h1>HTML kleepimiseks</h1>
  <p class="note">KOPEERI JA KLEEBI ZONE WEBMAILI VÕI OUTLOOKI ALLKIRJAVÄLJALE</p>
  <pre>${html.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>
</div></body></html>`;
}

if (process.argv.includes('--write')) {
  const { html, text } = buildSignature();
  mkdirSync(join(ROOT, 'signature'), {recursive:true});
  writeFileSync(join(ROOT, 'signature', 'leisson-signature.html'), html + '\n');
  writeFileSync(join(ROOT, 'signature', 'leisson-signature.txt'), text + '\n');
  writeFileSync(join(ROOT, 'signature', 'preview.html'), previewPage());
  console.log('Kirjutatud: signature/leisson-signature.html, .txt, preview.html');
}
