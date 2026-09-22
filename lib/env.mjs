import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function rawEnv() {
  const f = process.env.CRM_ENV_PATH || join(ROOT, '.env');
  if (!existsSync(f)) {
    throw new Error(process.env.CRM_ENV_PATH
      ? 'CRM_ENV_PATH osutab olematule failile: ' + f
      : '.env puudub. Käivita esmalt: npm run setup');
  }
  const out = {};
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/**
 * Mitme konto tugi. .env kuju:
 *   ACCOUNTS=gert,leisson
 *   ACC_GERT_USER=gert@leisson.eu
 *   ACC_GERT_PASS=...
 *   ACC_GERT_NAME=Gert Leisson
 * Vanem ühe konto kuju (MAIL_USER/MAIL_PASS) töötab edasi ja saab id "gert".
 */
export function loadEnv() {
  const e = rawEnv();
  const hosts = {
    imapHost: e.IMAP_HOST || 'imap.zone.eu',
    imapPort: Number(e.IMAP_PORT || 993),
    smtpHost: e.SMTP_HOST || 'smtp.zone.eu',
    smtpPort: Number(e.SMTP_PORT || 465),
  };
  const ids = (e.ACCOUNTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const accounts = [];

  for (const id of ids) {
    const K = id.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const user = e[`ACC_${K}_USER`];
    const pass = e[`ACC_${K}_PASS`];
    if (!user || !pass) continue;
    accounts.push({
      id,
      user,
      pass,
      name: e[`ACC_${K}_NAME`] || 'Gert Leisson',
      label: e[`ACC_${K}_LABEL`] || user,
      imapHost: e[`ACC_${K}_IMAP_HOST`] || hosts.imapHost,
      imapPort: Number(e[`ACC_${K}_IMAP_PORT`] || hosts.imapPort),
      smtpHost: e[`ACC_${K}_SMTP_HOST`] || hosts.smtpHost,
      smtpPort: Number(e[`ACC_${K}_SMTP_PORT`] || hosts.smtpPort),
    });
  }

  if (!accounts.length && e.MAIL_USER && e.MAIL_PASS) {
    accounts.push({
      id: 'gert',
      user: e.MAIL_USER,
      pass: e.MAIL_PASS,
      name: e.MAIL_FROM_NAME || 'Gert Leisson',
      label: e.MAIL_USER,
      ...hosts,
    });
  }

  if (!accounts.length) {
    throw new Error('.env-is ei ole ühtegi kontot. Käivita: npm run setup');
  }

  return {
    accounts,
    selfEmails: String(process.env.CRM_SELF_EMAILS || e.CRM_SELF_EMAILS || '').split(',').map(a=>a.trim().toLowerCase()).filter(Boolean),
    defaultAccount: accounts.find(a => a.user.toLowerCase() === 'gert@leisson.eu')?.id || null,
    port: Number(process.env.CRM_PORT || e.CRM_PORT || 4310),
    pollMinutes: Number(process.env.POLL_MINUTES || e.POLL_MINUTES || 5),
    // Agendikihi eelarve. Keskkonnamuutuja voidab .env-i, et uhekordne
    // ulepiiri jooks (nt win\vastus.cmd 6) ei nouaks faili muutmist.
    agentDailyUsd: Number(process.env.AGENT_DAILY_USD || e.AGENT_DAILY_USD || 3),
    agentMaxDrafts: Number(process.env.AGENT_MAX_DRAFTS || e.AGENT_MAX_DRAFTS || 3),
    ...hosts,
  };
}

export function account(cfg, id) {
  const a = cfg.accounts.find((x) => x.id === (id || cfg.defaultAccount));
  if (!a) throw new Error(`Tundmatu konto: ${id}`);
  return a;
}
