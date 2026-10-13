import crypto from 'node:crypto';
import express, { Router } from 'express';
import { env } from '../../config/env.js';
import { recordMailEvent } from './suppression.js';

/**
 * Amazon SES tells us about bounces and complaints through an SNS topic that posts to this address:
 *   POST /api/v1/webhooks/ses
 * Nothing is believed unless the message carries a valid Amazon signature: the certificate it names must come from sns.<region>.amazonaws.com
 * and must verify the message. The first message SNS sends (SubscriptionConfirmation) is confirmed by calling the address it gives, after the same checks.
 * Two optional guards in the environment: SES_SNS_TOPIC_ARN (only this topic is accepted) and SES_WEBHOOK_TOKEN (must be in the address as ?token=).
 */

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const certs = new Map();

const isSnsUrl = (u) => {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && SNS_HOST.test(url.hostname);
  } catch {
    return false;
  }
};

/** The text SNS signed: some fields, in a fixed order, each as "Name\nValue\n". */
export function stringToSign(m) {
  const fields = m.Type === 'Notification' ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'] : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return fields.filter((k) => m[k] !== undefined).map((k) => `${k}\n${m[k]}\n`).join('');
}

async function certificate(url, fetchCert) {
  if (!certs.has(url)) certs.set(url, await fetchCert(url));
  return certs.get(url);
}

const defaultFetchCert = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`certificate download failed (${r.status})`);
  return r.text();
};

/** True only when the message is signed by Amazon. `fetchCert` can be replaced in tests. */
export async function verifySns(m, fetchCert = defaultFetchCert) {
  if (!m || typeof m !== 'object' || !m.Signature || !m.SigningCertURL || !m.Type) return false;
  if (!isSnsUrl(m.SigningCertURL) || !m.SigningCertURL.endsWith('.pem')) return false;
  if (!['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'].includes(m.Type)) return false;
  const algo = m.SignatureVersion === '2' ? 'RSA-SHA256' : m.SignatureVersion === '1' ? 'RSA-SHA1' : null;
  if (!algo) return false;
  try {
    const pem = await certificate(m.SigningCertURL, fetchCert);
    return crypto.createVerify(algo).update(stringToSign(m), 'utf8').verify(pem, m.Signature, 'base64');
  } catch {
    return false;
  }
}

export function sesWebhook({ fetchCert, confirm } = {}) {
  const router = Router();
  // SNS posts JSON labelled text/plain, which the app's JSON reader skips
  router.post('/', express.text({ type: '*/*', limit: '256kb' }), async (req, res) => {
    if (env.SES_WEBHOOK_TOKEN && req.query.token !== env.SES_WEBHOOK_TOKEN) return res.status(403).json({ message: 'Not allowed' });
    let m;
    try {
      m = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json({ message: 'Not a valid message' });
    }
    if (!(await verifySns(m, fetchCert))) return res.status(403).json({ message: 'The signature could not be checked' });
    if (env.SES_SNS_TOPIC_ARN && m.TopicArn !== env.SES_SNS_TOPIC_ARN) return res.status(403).json({ message: 'This is not the expected topic' });

    if (m.Type === 'SubscriptionConfirmation') {
      if (!isSnsUrl(m.SubscribeURL)) return res.status(400).json({ message: 'Bad confirmation address' });
      try {
        await (confirm ?? ((u) => fetch(u, { signal: AbortSignal.timeout(8000) })))(m.SubscribeURL);
        console.log('[mail] SES notifications subscription confirmed');
      } catch (e) {
        console.error('[mail] could not confirm the SNS subscription:', e.message);
        return res.status(502).json({ message: 'Could not confirm' });
      }
      return res.json({ ok: true, confirmed: true });
    }
    if (m.Type === 'Notification') {
      let body;
      try {
        body = JSON.parse(m.Message);
      } catch {
        return res.json({ ok: true, ignored: true }); // a plain-text message (for example the test message from the SNS console)
      }
      const done = await recordMailEvent(body);
      if (done.length) console.log(`[mail] ${body.notificationType ?? body.eventType}: ${done.length} address(es) handled`);
      return res.json({ ok: true, handled: done.length });
    }
    res.json({ ok: true });
  });
  return router;
}
