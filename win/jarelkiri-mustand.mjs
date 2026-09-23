#!/usr/bin/env node
// node win/jarelkiri-mustand.mjs [--kirjuta] [--tana=YYYY-MM-DD]
// Käib läbi mustandid/*.json, millel on "jarg" (järelkiri). Loeb IMAP-ist AINULT:
// kas algkiri on saadetud (Sent), kas saaja on vastanud (INBOX), kas mustand juba ootab.
// Kui tööpäevi on piisavalt ja vastust pole -> paneb järelkirja Drafts-kausta.
// MITTE KUNAGI ei saada. Windowsi ülesanne "Leisson CRM jarelkiri-mustand" jookseb tööpäeviti.
import { readFileSync, readdirSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { checkDraft } from '../lib/draft-gate.mjs';
import { buildDraftRaw, draftMessageId } from '../lib/draft.mjs';
import { otsus } from '../lib/jarelkiri-otsus.mjs';

const args = process.argv.slice(2);
const write = args.includes('--kirjuta');
const tanaArg = args.find((a) => a.startsWith('--tana='))?.slice(7);
const tana = tanaArg ? new Date(`${tanaArg}T09:00:00+03:00`) : new Date();
const DIR = 'mustandid';
const addr = (s) => (/<([^<>]+)>$/.exec(String(s).trim())?.[1] || String(s)).trim();
const lae = (id) => JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8'));
mkdirSync(DIR, { recursive: true });
const logi = (s) => { console.log(s); appendFileSync(join(DIR, '.jarelkiri.log'), `${new Date().toISOString()} ${s}\n`); };

const { imapFind, appendToDrafts } = await import('../lib/mail.mjs');
const acc = 'gert';
const loodud = [];
let vigu = 0;

for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
  const d = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  if (!d.jarg) continue;
  try {
    const alg = lae(d.jarg.algne);
    const sent = (await imapFind(acc, 'sent', { to: addr(alg.to), subject: alg.subject }))[0] || null;
    const vastus = sent ? (await imapFind(acc, 'inbox', { from: d.jarg.vastusAadressilt || addr(alg.to), since: new Date(sent.date) })).length > 0 : false;
    const jubaSaadetud = sent ? (await imapFind(acc, 'sent', { to: addr(d.to), subject: d.subject })).length > 0 : false;
    const jubaMustandis = (await imapFind(acc, 'drafts', { header: { 'message-id': draftMessageId(d.id) } })).length > 0;
    const o = otsus({ saadetud: sent ? new Date(sent.date) : null, vastus, jubaSaadetud, jubaMustandis, vaja: d.jarg.toopaevi, tana });
    if (!o.tee) { logi(`– ${d.id}: ${o.pohjus}`); continue; }
    const g = checkDraft(d);
    if (!g.ok) { vigu++; logi(`✗ ${d.id}: värav – ${g.errors.join('; ')}`); continue; }
    if (!write) { logi(`→ ${d.id}: ${o.pohjus} – koostaks mustandi (kuivkäik)`); continue; }
    const { raw, messageId } = await buildDraftRaw({ ...d, inReplyTo: sent.messageId });
    const r = await appendToDrafts(acc, raw, messageId);
    if (!r.ok) { vigu++; logi(`✗ ${d.id}: ${r.reason}`); continue; }
    logi(`✓ ${d.id}: ${o.pohjus} – mustand kaustas "${r.box}", vajuta ise "Saada"`);
    if (!r.skipped) loodud.push(`${d.id} -> ${addr(d.to)}`);
  } catch (e) { vigu++; logi(`✗ ${d.id}: ${e.message}`); }
}

// Teavitus Windowsi teadete alas, et mustand ootab (parim katse, ei kuku).
if (loodud.length && process.platform === 'win32') {
  const txt = `Järelkirja mustand ootab: ${loodud.join(', ')}`.replace(/'/g, '');
  const ps = `Add-Type -AssemblyName System.Windows.Forms; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.Visible=$true; $n.ShowBalloonTip(15000,'Leisson CRM','${txt}',[System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep 16; $n.Dispose()`;
  try { spawn('powershell.exe', ['-NoProfile', '-Command', ps], { detached: true, stdio: 'ignore' }).unref(); } catch {}
}
process.exitCode = vigu ? 1 : 0;
