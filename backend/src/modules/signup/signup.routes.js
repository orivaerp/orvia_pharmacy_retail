import cors from 'cors';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { validateBody } from '../../middleware/validate.js';
import { settings } from '../settings/settings.service.js';
import { publicPlans, signup } from './signup.service.js';

/** The pricing list and self sign-up. No sign-in. */
const router = Router();

// the website (a different address) may read the plan list, so it can show the same prices
router.get('/plans', cors({ origin: '*' }), async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ plans: await publicPlans() });
});

// who runs the service, for the Terms and Privacy pages (and a website that shows the same)
router.get('/site', cors({ origin: '*' }), (_req, res) => {
  const s = settings();
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ companyName: s.companyName, address: s.companyAddress, supportEmail: s.supportEmail, supportPhone: s.supportPhone, grievanceName: s.grievanceName, grievanceEmail: s.grievanceEmail });
});

// one address may sign up only a few times an hour
const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: env.SIGNUP_RATE_LIMIT, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many sign-ups from this connection. Please try again in an hour.' } });

const body = z.object({
  shopName: z.string().trim().min(2, 'Enter the shop name').max(80),
  ownerName: z.string().trim().min(2, 'Enter your name').max(80),
  email: z.email('Enter a valid email address').max(120),
  phone: z.string().trim().min(10, 'Enter a 10-digit mobile number').max(20),
  city: z.string().trim().max(60).optional(),
  planCode: z.string().trim().min(1, 'Choose a plan').max(40),
  acceptTerms: z.literal(true, { error: 'Please accept the terms to continue' }),
  // a field real people never see: a bot that fills it in is dropped
  website: z.string().max(200).optional(),
});

router.post('/signup', limiter, validateBody(body), async (req, res) => {
  if (req.body.website) return res.status(201).json({ ok: true }); // a bot: act as if it worked, create nothing
  const r = await signup(req.body, { ip: req.ip });
  res.status(201).json({ ok: true, email: r.email, shopName: r.shopName, plan: r.plan, trialEndsAt: r.trialEndsAt });
});

export default router;
