import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { assertBranchAllowed, requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../audit/audit.model.js';
import { User } from '../users/user.model.js';
import { StockCount } from './stock-count.model.js';
import * as svc from './stock-count.service.js';

/** Physical stock count. Counting needs inventory.adjust; applying the corrections (which change stock and its value) needs purchase.approve. */
const router = Router();
router.use(requireTenant);

const counter = requirePermission(P.INVENTORY_ADJUST);
const approver = requirePermission(P.PURCHASE_APPROVE);
const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const nameOf = async (req) => ({ id: req.user.id, name: (await User.findById(req.user.id).select('name').lean())?.name ?? '' });

/** The count must be one the user may work on (its outlet). */
async function mine(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Stock count not found');
  const c = await StockCount.findById(req.params.id).select('branchId name').lean();
  if (!c) throw ApiError.notFound('Stock count not found');
  assertBranchAllowed(req, c.branchId);
  return c;
}

router.get('/', counter, async (req, res) => {
  const branchId = req.query.branchId?.toString();
  if (!branchId || !mongoose.isValidObjectId(branchId)) throw ApiError.badRequest('Choose an outlet');
  assertBranchAllowed(req, branchId);
  res.json({ current: await svc.current(branchId), history: await svc.list(branchId) });
});

router.post('/', counter, validateBody(z.object({ branchId: objectId, name: z.string().trim().max(80).optional() })), async (req, res) => {
  assertBranchAllowed(req, req.body.branchId);
  const c = await svc.startCount(await nameOf(req), req.body);
  await audit(req, 'stockcount.start', req.user.tenantId, { name: c.name });
  res.status(201).json(c);
});

router.get('/:id/sheet', counter, async (req, res) => {
  await mine(req);
  res.json(await svc.sheet(req.params.id));
});

router.put('/:id/lines', counter, validateBody(z.object({ batchId: objectId, packs: z.number().int().min(0).max(1_000_000).default(0), loose: z.number().int().min(0).max(100_000).default(0) })), async (req, res) => {
  await mine(req);
  res.json(await svc.saveLine(req.params.id, req.body));
});

router.delete('/:id/lines/:batchId', counter, async (req, res) => {
  await mine(req);
  if (!mongoose.isValidObjectId(req.params.batchId)) throw ApiError.notFound('Batch not found');
  res.json(await svc.saveLine(req.params.id, { batchId: req.params.batchId, clear: true }));
});

router.post('/:id/submit', counter, async (req, res) => {
  const c = await mine(req);
  const r = await svc.submit(req.params.id);
  await audit(req, 'stockcount.submit', req.user.tenantId, { name: c.name, counted: r.counted });
  res.json(r);
});

router.post('/:id/reopen', counter, async (req, res) => {
  await mine(req);
  res.json(await svc.reopen(req.params.id));
});

router.post('/:id/cancel', counter, async (req, res) => {
  const c = await mine(req);
  const r = await svc.cancel(req.params.id);
  await audit(req, 'stockcount.cancel', req.user.tenantId, { name: c.name });
  res.json(r);
});

// the differences are money (stock valued at cost): owner and managers only
router.get('/:id/review', approver, async (req, res) => {
  await mine(req);
  res.json(await svc.review(req.params.id));
});

router.post('/:id/apply', approver, validateBody(z.object({ uncountedAsZero: z.boolean().default(false), note: z.string().trim().max(200).optional() })), async (req, res) => {
  const c = await mine(req);
  const r = await svc.apply(await nameOf(req), req.params.id, req.body);
  await audit(req, 'stockcount.apply', req.user.tenantId, { name: c.name, ...r.summary, uncountedAsZero: req.body.uncountedAsZero });
  res.json(r);
});

export default router;
