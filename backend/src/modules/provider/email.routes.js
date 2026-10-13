import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { audit } from '../audit/audit.model.js';
import { env } from '../../config/env.js';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { EmailLog } from '../mail/email-log.model.js';
import { MailEvent, Suppression, suppress } from '../mail/suppression.js';
import { sendMail, smtpSummary } from '../mail/mailer.js';
import { testMail } from '../mail/templates.js';

/** Provider > Email: is mail set up, a test send, and what was sent recently. Super admin only. */
export const emailRouter = Router();
emailRouter.use(requirePermission(P.PLATFORM_USERS_MANAGE));

/**
 * How healthy the sending is, over the last 30 days. Amazon SES reviews an account at about 5% bounces or 0.1% complaints and can pause it at 10% / 0.5%.
 * The rates are against what Orvia handed to the mail server; only permanent bounces count (a full mailbox is not held against you).
 */
export async function mailHealth() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [sent, bounces, soft, complaints, suppressed] = await Promise.all([
    EmailLog.countDocuments({ status: 'sent', at: { $gte: since } }),
    MailEvent.countDocuments({ type: 'bounce', permanent: true, at: { $gte: since } }),
    MailEvent.countDocuments({ type: 'bounce', permanent: false, at: { $gte: since } }),
    MailEvent.countDocuments({ type: 'complaint', at: { $gte: since } }),
    Suppression.countDocuments(),
  ]);
  const pct = (n) => (sent ? Math.round((n / sent) * 10000) / 100 : 0);
  const bounceRate = pct(bounces);
  const complaintRate = pct(complaints);
  const status = bounceRate >= 5 || complaintRate >= 0.1 ? 'danger' : bounceRate >= 2 || complaintRate >= 0.05 ? 'watch' : 'ok';
  return { days: 30, sent, bounces, softBounces: soft, complaints, bounceRate, complaintRate, status, suppressed, enoughMail: sent >= 50 };
}

emailRouter.get('/', async (_req, res) => {
  const recent = await EmailLog.find().sort({ at: -1 }).limit(40).lean();
  const base = (env.PUBLIC_API_URL || '').replace(/\/$/, '');
  res.json({
    ...smtpSummary(),
    recent,
    health: await mailHealth(),
    webhook: { url: `${base}/api/v1/webhooks/ses${env.SES_WEBHOOK_TOKEN ? '?token=…' : ''}`, topicChecked: Boolean(env.SES_SNS_TOPIC_ARN), tokenSet: Boolean(env.SES_WEBHOOK_TOKEN) },
  });
});

emailRouter.get('/suppressed', async (req, res) => {
  const q = req.query.q?.toString().trim().toLowerCase();
  const filter = q ? { email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) } : {};
  res.json(await Suppression.find(filter).sort({ lastAt: -1 }).limit(200).lean());
});

emailRouter.post('/suppressed', validateBody(z.object({ email: z.email() })), async (req, res) => {
  await suppress(req.body.email, 'manual', 'added by hand');
  await audit(req, 'email.suppress', undefined, { email: req.body.email });
  res.status(201).json({ ok: true });
});

// Remove an address when it was a mistake (for example the person fixed their mailbox). It will be mailed again.
emailRouter.delete('/suppressed/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Not found');
  const gone = await Suppression.findByIdAndDelete(req.params.id);
  if (!gone) throw ApiError.notFound('Not found');
  await audit(req, 'email.unsuppress', undefined, { email: gone.email, was: gone.reason });
  res.json({ ok: true });
});

emailRouter.post('/test', validateBody(z.object({ to: z.email() })), async (req, res) => {
  const mail = testMail();
  const r = await sendMail({ to: req.body.to, subject: mail.subject, text: mail.text, html: mail.html, template: 'test' });
  await audit(req, 'email.test', undefined, { to: req.body.to, result: r.status });
  res.json(r);
});
