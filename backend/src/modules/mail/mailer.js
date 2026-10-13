import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { EmailLog } from './email-log.model.js';
import { isSuppressed } from './suppression.js';

/**
 * Sends email over SMTP, built for Amazon SES (any SMTP provider works the same way).
 * Without SMTP settings nothing is sent: the attempt is logged as "skipped" and the app keeps working
 * (invite links are still shown on screen so they can be copied and sent by hand).
 *
 * Settings:
 *   SMTP_HOST, SMTP_PORT   the server, e.g. email-smtp.ap-south-1.amazonaws.com and 587 (587 = STARTTLS, 465 = SSL)
 *   SMTP_USER, SMTP_PASS   the SMTP credentials (for SES: made in the SES console, not an AWS access key)
 *   MAIL_FROM              the sender, e.g. Orvia <no-reply@yourdomain.com>. With SES it must be a verified identity (an address or a domain)
 *   MAIL_REPLY_TO          where a reply goes when the message does not name its own reply address
 * A message that sets its own reply address (a customer reminder replies to the member of staff who sent it) keeps that one.
 */
let transport;

/** The settings in use, worked out once from the environment. Never logged. */
export function mailSettings() {
  const user = env.SMTP_USER || undefined;
  const pass = env.SMTP_PASS || undefined;
  const port = env.SMTP_PORT;
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465; // 465 is SSL from the first byte
  // the sender must be given: the login is not a sender address (an SES SMTP user name is not an email address)
  const from = env.MAIL_FROM?.trim() || undefined;
  return { host: env.SMTP_HOST || undefined, port, secure, user, pass, from, replyTo: env.MAIL_REPLY_TO?.trim() || undefined };
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
    await EmailLog.create({ ...base, status: 'skipped', error: 'Email is not set up on this server (SMTP_HOST and MAIL_FROM).' }).catch(() => undefined);
    if (env.NODE_ENV !== 'production') console.log(`[mail] not sent (no SMTP configured): "${subject}" to ${to}`);
    return { sent: false, status: 'skipped', error: 'Email is not set up on this server.' };
  }
  // an address that bounced for good or complained is never mailed again: that is what gets a mail account paused
  if (await isSuppressed(to).catch(() => false)) {
    const error = 'This address bounced or marked an earlier email as spam, so Orvia does not send to it. Check the address.';
    await EmailLog.create({ ...base, status: 'suppressed', error }).catch(() => undefined);
    return { sent: false, status: 'suppressed', error };
  }
  try {
    const s = mailSettings();
    // the address stays ours (the verified sender); only the name shown can be the shop's
    const address = s.from.match(/<([^>]+)>/)?.[1] ?? s.from;
    await getTransport().sendMail({ from: fromName ? { name: fromName, address } : s.from, replyTo: replyTo || s.replyTo || undefined, to, subject, text, html });
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
  const reply = String(e?.response ?? e?.message ?? '');
  if (e?.code === 'EAUTH' || code === 535) return 'The mail server refused the login. Check SMTP_USER and SMTP_PASS (for Amazon SES these are the SMTP credentials, not your AWS access key) and that SMTP_HOST is the SES region you made them in.';
  if (/not verified/i.test(reply)) return 'Amazon SES says an address is not verified: the sender in MAIL_FROM must be verified, and while your SES account is in the sandbox the recipient must be verified too.';
  if (/throttl|maximum sending rate|daily message quota/i.test(reply) || code === 454) return 'Amazon SES is limiting how fast or how much mail can be sent. Try again in a little while, or ask AWS to raise the sending limits.';
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
    replyTo: s.replyTo ?? null,
  };
}
