// Mustandi koostaja. Põhimõte (23.09.2026): automaatika koostab, inimene vajutab "Saada".
// See moodul EI TOHI kunagi importida SMTP-d ega saatefunktsiooni – test/gate-mustand.mjs valvab.
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { composeHtml, composeText } from './mail.mjs';

export const FROM = { name: 'Gert Leisson', address: 'gert@leisson.eu' };

// Kliendikirja vaikeallkiri: ilma hinnakirja rea ja alareata (Rita otsus).
export const CLIENT_SIG = { prices: null, tagline: false };

export function draftMessageId(id) {
  return `<mustand-${id}@leisson.eu>`;
}

export async function buildDraftRaw(d) {
  const sig = { ...CLIENT_SIG, ...(d.allkiri || {}) };
  const messageId = draftMessageId(d.id);
  const raw = await new MailComposer({
    from: FROM,
    to: d.to,
    cc: d.cc || undefined,
    replyTo: FROM.address,
    subject: d.subject,
    messageId,
    text: composeText(d.body, sig),
    html: composeHtml(d.body, sig),
    headers: { 'X-Mailer': 'Leisson CRM (Orbit) – mustand' },
  }).compile().build();
  return { raw, messageId };
}
