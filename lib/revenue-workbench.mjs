import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.mjs';

const EXPECTED_SCHEMA = 'leisson-business-prospect-web-evidence-v1';
const SALES_MAILBOX = 'gert@leisson.eu';
const DEFAULT_SOURCE = join(ROOT, 'data', 'business-prospect-web-evidence.json');

const text = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const list = (value) => Array.isArray(value) ? value : [];

function safeHttps(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

function safeDraft(value) {
  if (!value || typeof value !== 'object') return null;
  const from = text(value.from, 200).toLowerCase();
  const to = text(value.to, 320);
  const subject = text(value.subject, 500);
  const body = text(value.body, 12000);
  const blocked = value.approved !== false || value.scheduled !== false || value.sendable !== false;
  if (from !== SALES_MAILBOX || blocked || !to || !subject || !body) return null;
  return { from: SALES_MAILBOX, to, subject, body, approved: false, scheduled: false, sendable: false };
}

function unavailable(reason) {
  return {
    available: false,
    source: 'private_local_evidence',
    mailbox: SALES_MAILBOX,
    prospects: [],
    summary: { businesses: 0, confirmedBuyers: 0, reviewOnlyDrafts: 0, sent: 0, scheduled: 0 },
    reason,
  };
}

export function loadRevenueWorkbench(sourcePath = DEFAULT_SOURCE) {
  let raw;
  try { raw = JSON.parse(readFileSync(sourcePath, 'utf8')); }
  catch { return unavailable('Müügitöölaua kohalik tõendifail puudub või ei ole loetav.'); }

  if (raw?.schemaVersion !== EXPECTED_SCHEMA) return unavailable('Müügitöölaua tõendifaili versioon ei ole toetatud.');
  if (String(raw?.controls?.mailbox || '').toLowerCase() !== SALES_MAILBOX) return unavailable('Müügitöölaua postkast ei ole gert@leisson.eu.');
  if (raw?.controls?.gmailUsed !== false || raw?.controls?.emailsSent !== 0 || raw?.controls?.approved !== false || raw?.controls?.sendable !== false) {
    return unavailable('Müügitöölaua ohutuspiirid ei vasta kinnitamata müügiuuringule.');
  }

  const ordered = new Map(list(raw.businessFindings).map((row) => [row?.companyId, row]));
  const rows = [...list(raw.recommendationOrder).map((id) => ordered.get(id)).filter(Boolean)];
  for (const row of ordered.values()) if (!rows.includes(row)) rows.push(row);

  const prospects = rows.map((row) => ({
    companyId: text(row.companyId, 180),
    company: text(row.company, 300),
    crmStatus: text(row.crmStatus, 80),
    priority: text(row.priority, 1200),
    officialUrl: safeHttps(row.officialUrl),
    email: text(row?.contact?.publicEmail || row?.contact?.crmEmail, 320),
    contactVerification: text(row?.contact?.verification, 800),
    outreachPermission: text(row?.contact?.outreachPermission, 500),
    currentNeedConfirmed: row.currentNeedConfirmed === true,
    receivedInterest: row.receivedInterest === true,
    observations: list(row.observations).slice(0, 8).map((item) => ({
      id: text(item?.id, 80),
      statement: text(item?.statement, 3000),
      notProven: text(item?.notProven, 1800),
    })),
    questions: list(row.improvementQuestions).slice(0, 6).map((item) => ({
      question: text(item?.question, 1800),
      nextVerification: text(item?.nextVerification, 2400),
    })),
    nextAction: text(row.nextAction, 2400),
    draft: safeDraft(row.reviewOnlyDraft),
    draftOmissionReason: text(row.draftOmissionReason, 1200),
  })).filter((row) => row.companyId && row.company);

  const draftCount = prospects.filter((row) => row.draft).length;
  return {
    available: true,
    source: 'private_local_evidence',
    schemaVersion: EXPECTED_SCHEMA,
    mailbox: SALES_MAILBOX,
    generatedAt: text(raw.completedAt || raw.generatedAt, 80),
    prospects,
    summary: {
      businesses: prospects.length,
      confirmedBuyers: prospects.filter((row) => row.currentNeedConfirmed && row.receivedInterest).length,
      reviewOnlyDrafts: draftCount,
      sent: 0,
      scheduled: 0,
    },
    limitations: list(raw.limits).slice(0, 8).map((item) => text(item, 1800)).filter(Boolean),
  };
}
