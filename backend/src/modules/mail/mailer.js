import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { EmailLog } from './email-log.model.js';

/**
 * Sends email over SMTP (works with GoDaddy/Secureserver, Gmail, Zoho, Brevo, Amazon SES, any provider).
 * Without SMTP settings nothing is sent: the attempt is logged as "skipped" and the app keeps working
 * (invite links are still shown on screen so they can be copied and sent by hand).
 *
 * Settings, with the older names accepted as well:
 *   SMTP_HOST, SMTP_PORT           the server (587 = STARTTLS, 465 = SSL)
 *   SMTP_USER or EMAIL_USER        the login (also the sender address unless MAIL_FROM is set)
 *   SMTP_PASS or EMAIL_PASS        the password
 *   MAIL_FROM                      full sender, e.g. Orvia <no-reply@yourdomain.com>
 *   EMAIL_FROM_NAME                just the display name; the address is then EMAIL_USER
 */
let transport;

/** The settings in use, worked out once from the environment. Never logged. */
export function mailSettings() {
  const user = env.SMTP_USER || env.EMAIL_USER || undefined;
  const pass = env.SMTP_PASS || env.EMAIL_PASS || undefined;
  const port = env.SMTP_PORT;
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465; // 465 is SSL from the first byte
  const from = env.MAIL_FROM || (user ? `${env.EMAIL_FROM_NAME || env.COMPANY_NAME || 'Orvia'} <${user}>` : undefined);
  return { host: env.SMTP_HOST || undefined, port, secure, user, pass, from };
}

export const isConfigured = () => {
  const s = mailSettings();
  return Boolean(s.host && s.from);
};

const isLocal = (host) => ['127.0.0.1', 'localhost', '::1'].includes(host);

function getTransport() {
  if (!transport) {
    const s = mailSettings();
    transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      // on a normal (non-SSL) port the password must only ever travel over TLS; a plain local test server is the exception
      requireTLS: !s.secure && !isLocal(s.host) && s.port !== 25,
      auth: s.user && s.pass ? { user: s.user, pass: s.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transport;
}

/** Sends one email. Never throws: returns { sent, status, error } and writes a log row (without the message body). */
export async function sendMail({ to, subject, text, html, template, tenantId, fromName, replyTo }) {
  const base = { to, subject, template, tenantId: tenantId ?? undefined };
  if (!isConfigured()) {
    await EmailLog.create({ ...base, status: 'skipped', error: 'Email is not set up on this server (SMTP_HOST and a sender).' }).catch(() => undefined);
    if (env.NODE_ENV !== 'production') console.log(`[mail] not sent (no SMTP configured): "${subject}" to ${to}`);
    return { sent: false, status: 'skipped', error: 'Email is not set up on this server.' };
  }
  try {
    const from = mailSettings().from;
    // the address stays ours (the mailbox we log in with); only the name shown can be the shop's
    const address = from.match(/<([^>]+)>/)?.[1] ?? from;
    await getTransport().sendMail({ from: fromName ? { name: fromName, address } : from, replyTo: replyTo || undefined, to, subject, text, html });
    await EmailLog.create({ ...base, status: 'sent' }).catch(() => undefined);
    return { sent: true, status: 'sent' };
  } catch (e) {
    const error = friendlyError(e);
    await EmailLog.create({ ...base, status: 'failed', error }).catch(() => undefined);
    console.error('[mail] send failed:', error);
    return { sent: false, status: 'failed', error };
  }
}

/** A short, safe reason (never contains the password). */
function friendlyError(e) {
  const code = e?.responseCode;
  if (e?.code === 'EAUTH' || code === 535) return 'The mail server refused the login. Check the email address and password.';
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || e?.code === 'ESOCKET' || e?.code === 'ECONNECTION') return `Could not reach the mail server (${e.code}). Check the host and port.`;
  if (e?.code === 'EENVELOPE' || (code >= 550 && code < 560)) return `The mail server rejected the message: ${String(e.response ?? e.message).slice(0, 160)}`;
  return String(e?.message ?? e).slice(0, 200);
}

/** For the provider's Email page. The password is never exposed. */
export function smtpSummary() {
  const s = mailSettings();
  return {
    configured: isConfigured(),
    host: s.host ?? null,
    port: s.port,
    secure: s.secure,
    user: s.user ? s.user.replace(/^(.{2}).*(@.*)?$/, (_m, a, b) => `${a}•••${b ?? ''}`) : null,
    from: s.from ?? null,
  };
}
