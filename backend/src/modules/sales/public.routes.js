import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { publicBill } from './sale.service.js';

/** The page a customer opens from a WhatsApp link. No sign-in: the long random token in the address is the key. */
const router = Router();

// a customer opens a link a few times; a script guessing tokens gets stopped quickly
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });

router.get('/bills/:token', limiter, async (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.json(await publicBill(req.params.token));
});

export default router;
