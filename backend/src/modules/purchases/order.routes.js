import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { assertBranchAllowed, branchScope, requireAny, requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../audit/audit.model.js';
import { User } from '../users/user.model.js';
import * as svc from './order.service.js';

/** Purchase orders: what the shop asks a supplier to send. Writing and sending them is for whoever buys (purchase.create). */
const router = Router();
router.use(requireTenant);

const canView = requireAny(P.PURCHASE_CREATE, P.REPORTS_VIEW);
const canWrite = requirePermission(P.PURCHASE_CREATE);
const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');
const lines = z
  .array(z.object({ productId: objectId, packs: z.number().int().min(1).max(100_000), rate: z.number().min(0).max(10_000_000).optional() }))
  .min(1, 'Add at least one product')
  .max(200);
const body = z.object({
  supplierId: objectId,
  branchId: objectId,
  lines,
  notes: z.string().trim().max(300).optional(),
  expectedOn: day.optional().or(z.literal('').transform(() => undefined)),
});

const me = async (req) => ({ id: req.user.id, name: (await User.findById(req.user.id).select('name').lean())?.name ?? '' });
const check = (id) => {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Purchase order not found');
};
/** The order must be one for an outlet this user may work in. */
async function mine(req) {
  check(req.params.id);
  const o = await svc.getOrder(req.params.id);
  assertBranchAllowed(req, o.branchId);
  return o;
}

router.get('/', canView, async (req, res) => {
  const { status, supplierId, branchId, q } = req.query;
  if (supplierId && !mongoose.isValidObjectId(supplierId)) throw ApiError.notFound('Supplier not found');
  if (branchId) {
    if (!mongoose.isValidObjectId(branchId)) throw ApiError.notFound('Outlet not found');
    assertBranchAllowed(req, branchId);
  }
  res.json(await svc.listOrders({ status: status?.toString(), supplierId: supplierId?.toString(), branchId: branchId?.toString(), branchIds: branchScope(req), q: q?.toString(), page: Math.max(1, Number(req.query.page) || 1), limit: 20 }));
});

router.post('/', canWrite, validateBody(body), async (req, res) => {
  assertBranchAllowed(req, req.body.branchId);
  const o = await svc.createOrder(await me(req), req.body);
  await audit(req, 'purchaseorder.create', req.user.tenantId, { number: o.number, supplier: o.supplierName, items: o.lines.length });
  res.status(201).json(o);
});

router.get('/:id', canView, async (req, res) => res.json(await mine(req)));

router.patch('/:id', canWrite, validateBody(body.partial()), async (req, res) => {
  await mine(req);
  if (req.body.branchId) assertBranchAllowed(req, req.body.branchId);
  const o = await svc.updateOrder(req.params.id, req.body);
  await audit(req, 'purchaseorder.update', req.user.tenantId, { number: o.number });
  res.json(o);
});

router.post('/:id/send', canWrite, validateBody(z.object({ via: z.enum(['email', 'whatsapp', 'print']) })), async (req, res) => {
  const before = await mine(req);
  const r = await svc.sendOrder(await me(req), req.params.id, req.body.via);
  await audit(req, 'purchaseorder.send', req.user.tenantId, { number: before.number, supplier: before.supplierName, via: req.body.via });
  res.json(r);
});

router.post('/:id/cancel', canWrite, validateBody(z.object({ reason: z.string().trim().min(3, 'Give a reason').max(200) })), async (req, res) => {
  const before = await mine(req);
  const r = await svc.cancelOrder(await me(req), req.params.id, req.body.reason, { canCancelSent: req.user.permissions.includes(P.PURCHASE_APPROVE) });
  await audit(req, 'purchaseorder.cancel', req.user.tenantId, { number: before.number, reason: req.body.reason });
  res.json(r);
});

router.post('/:id/close', requirePermission(P.PURCHASE_APPROVE), validateBody(z.object({ reason: z.string().trim().min(3, 'Give a reason').max(200) })), async (req, res) => {
  const before = await mine(req);
  const r = await svc.closeOrder(await me(req), req.params.id, req.body.reason);
  await audit(req, 'purchaseorder.close', req.user.tenantId, { number: before.number, reason: req.body.reason });
  res.json(r);
});

export default router;
