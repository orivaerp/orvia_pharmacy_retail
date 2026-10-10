import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { branchScope, requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../audit/audit.model.js';
import { User } from '../users/user.model.js';
import * as svc from './refill.service.js';

/** Regular customers whose medicines are running out, and reminding them. Anyone who bills can use it; reminding everyone at once is for owner and managers. */
const router = Router();
router.use(requireTenant);

const canUse = requirePermission(P.SALES_CREATE);
const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const num = (v, def, max) => Math.min(max, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : def));
const window = (q) => ({ ahead: num(q.ahead, 7, 60), late: num(q.late, 30, 180) });
const check = (id) => {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Customer not found');
};

router.get('/', canUse, async (req, res) => {
  const w = window(req.query);
  const [items, shop] = await Promise.all([svc.refillList({ ...w, branchScope: branchScope(req) }), svc.shopInfo()]);
  res.json({ items, total: items.length, emailable: items.filter((c) => c.canEmail).length, ...shop, ...w, remindEveryDays: svc.REMIND_EVERY_DAYS });
});

router.post('/dismiss', canUse, validateBody(z.object({ customerId: objectId, productId: objectId, boughtOn: z.string().min(8) })), async (req, res) => {
  await svc.dismiss(req.body, req.user.id);
  await audit(req, 'refill.dismiss', req.user.tenantId, { customerId: req.body.customerId, productId: req.body.productId });
  res.status(201).json({ ok: true });
});

// remind everyone with an email who has not been reminded this week (owner and managers: it contacts many people)
router.post('/remind-all', requirePermission(P.PURCHASE_APPROVE), async (req, res) => {
  const r = await svc.remindAll({ id: req.user.id }, { ...window(req.query), branchScope: branchScope(req) });
  await audit(req, 'refill.reminder.bulk', req.user.tenantId, { sent: r.sent, failed: r.failed });
  res.json(r);
});

router.post('/:customerId/remind', canUse, validateBody(z.object({ channel: z.enum(['email', 'whatsapp']) })), async (req, res) => {
  check(req.params.customerId);
  const me = await User.findById(req.user.id).select('name').lean();
  const r = await svc.remind({ id: req.user.id, name: me?.name }, req.params.customerId, req.body.channel, { list: await svc.refillList({ ...window(req.query), branchScope: branchScope(req) }) });
  await audit(req, 'refill.reminder', req.user.tenantId, { customerId: req.params.customerId, channel: req.body.channel, items: r.items });
  res.json(r);
});

export default router;
