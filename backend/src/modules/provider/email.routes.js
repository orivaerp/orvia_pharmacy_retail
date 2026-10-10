import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { audit } from '../audit/audit.model.js';
import { EmailLog } from '../mail/email-log.model.js';
import { sendMail, smtpSummary } from '../mail/mailer.js';
import { testMail } from '../mail/templates.js';

/** Provider > Email: is mail set up, a test send, and what was sent recently. Super admin only. */
export const emailRouter = Router();
emailRouter.use(requirePermission(P.PLATFORM_USERS_MANAGE));

emailRouter.get('/', async (_req, res) => {
  const recent = await EmailLog.find().sort({ at: -1 }).limit(40).lean();
  res.json({ ...smtpSummary(), recent });
});

emailRouter.post('/test', validateBody(z.object({ to: z.email() })), async (req, res) => {
  const mail = testMail();
  const r = await sendMail({ to: req.body.to, subject: mail.subject, text: mail.text, html: mail.html, template: 'test' });
  await audit(req, 'email.test', undefined, { to: req.body.to, result: r.status });
  res.json(r);
});
