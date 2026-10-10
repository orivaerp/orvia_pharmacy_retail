import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticate } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { auditEvent } from '../audit/audit.model.js';
import * as service from './auth.service.js';
import * as twofa from './twofactor.service.js';

const router = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: env.LOGIN_RATE_LIMIT, standardHeaders: true, legacyHeaders: false });

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  shopCode: z.string().trim().optional(),
});
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

router.post('/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
  let result;
  try {
    result = await service.login(req.body);
  } catch (e) {
    if (e.status === 401) await auditEvent({ action: 'auth.login.failed', meta: { email: req.body.email.toLowerCase() }, ip: req.ip });
    throw e;
  }
  if (!result.twoFactorRequired) await auditEvent({ actorId: result.user.id, action: 'auth.login', tenantId: result.user.tenantId, ip: req.ip });
  res.json(result);
});

// second step of a sign-in
// "Forgot password": always answers the same way
router.post('/forgot', loginLimiter, validateBody(z.object({ email: z.email(), shopCode: z.string().trim().optional() })), async (req, res) => {
  await service.forgotPassword(req.body);
  await auditEvent({ action: 'auth.password.reset_requested', meta: { email: req.body.email.toLowerCase() }, ip: req.ip });
  res.json({ ok: true, message: 'If that email belongs to an account, a reset link is on its way.' });
});

router.post('/login/2fa', loginLimiter, validateBody(z.object({ challenge: z.string().min(20), code: z.string().min(6).max(20) })), async (req, res) => {
  let result;
  try {
    result = await service.loginTwoFactor(req.body);
  } catch (e) {
    if (e.status === 400 || e.status === 403) await auditEvent({ action: 'auth.2fa.failed', meta: { reason: e.message }, ip: req.ip });
    throw e;
  }
  await auditEvent({ actorId: result.user.id, action: 'auth.login', tenantId: result.user.tenantId, meta: { twoFactor: true }, ip: req.ip });
  res.json(result);
});

const acceptSchema = z.object({ token: z.string().min(20), password: z.string().min(8, 'Password must be at least 8 characters').max(100) });

router.get('/invite/:token', async (req, res) => {
  res.json(await service.inspectInvite(req.params.token));
});

router.post('/invite/accept', loginLimiter, validateBody(acceptSchema), async (req, res) => {
  res.json(await service.acceptInvite(req.body.token, req.body.password));
});

router.post('/refresh', validateBody(refreshSchema), async (req, res) => {
  res.json(await service.refresh(req.body.refreshToken));
});

router.get('/me', authenticate, async (req, res) => {
  res.json(await service.me(req.user.id));
});

// ---- two-step verification, for the signed-in user (any shop or Orvia user)
router.get('/2fa/status', authenticate, async (req, res) => res.json(await twofa.status(req.user.id)));

router.post('/2fa/setup', authenticate, loginLimiter, async (req, res) => res.json(await twofa.begin(req.user.id)));

router.post('/2fa/enable', authenticate, loginLimiter, validateBody(z.object({ code: z.string().min(6).max(10) })), async (req, res) => {
  const r = await twofa.enable(req.user.id, req.body.code);
  await auditEvent({ actorId: req.user.id, action: 'auth.2fa.enabled', tenantId: req.user.tenantId, ip: req.ip });
  res.json(r);
});

const proof = z.object({ password: z.string().min(1), code: z.string().min(6).max(20) });

router.post('/2fa/disable', authenticate, loginLimiter, validateBody(proof), async (req, res) => {
  await twofa.disable(req.user.id, req.body);
  await auditEvent({ actorId: req.user.id, action: 'auth.2fa.disabled', tenantId: req.user.tenantId, ip: req.ip });
  res.json({ ok: true });
});

router.post('/2fa/recovery-codes', authenticate, loginLimiter, validateBody(proof), async (req, res) => {
  const r = await twofa.newRecoveryCodes(req.user.id, req.body);
  await auditEvent({ actorId: req.user.id, action: 'auth.2fa.recovery_codes', tenantId: req.user.tenantId, ip: req.ip });
  res.json(r);
});

export default router;
