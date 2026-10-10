import { requireFeature } from '../plans/plan.service.js';
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { assertBranchAllowed, branchScope, requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../audit/audit.model.js';
import { Tenant } from '../tenants/tenant.model.js';
import { getLowStockDefault } from './low-stock.js';
import { ADJUST_REASONS, LEDGER_TYPES } from './stock.model.js';
import { orderList } from './order-list.service.js';
import * as stock from './stock.service.js';

const router = Router();
router.use(requireTenant);

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const money = z.number().min(0).max(10_000_000);

const entrySchema = z.object({
  branchId: objectId,
  type: z.enum(['OPENING', 'PURCHASE']),
  supplierName: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  reference: z.string().trim().max(60).optional().or(z.literal('').transform(() => undefined)),
  lines: z
    .array(
      z.object({
        productId: objectId,
        batchNo: z.string().trim().min(1).max(30),
        expiry: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expiry must be a month like 2027-08'),
        mrp: money.refine((v) => v > 0, 'MRP must be more than 0'),
        purchaseRate: money,
        packs: z.number().int().min(1).max(100_000),
      }),
    )
    .min(1, 'Add at least one product line')
    .max(100),
});

// receive stock (opening balance or purchase) into an outlet
// products to order, with suggested packs and the usual supplier
router.get('/order-list', requirePermission(P.INVENTORY_VIEW), async (req, res) => {
  const branchId = req.query.branchId?.toString();
  if (branchId) {
    if (!mongoose.isValidObjectId(branchId)) throw ApiError.notFound('Outlet not found');
    assertBranchAllowed(req, branchId);
  }
  res.json(await orderList({ branchId, branchIds: branchScope(req) }));
});

// the shop-wide default for "low stock" (packs); a product's own reorder level overrides it
router.get('/alert-default', requirePermission(P.INVENTORY_VIEW), async (_req, res) => res.json({ packs: await getLowStockDefault() }));

router.put('/alert-default', requirePermission(P.PRODUCT_MANAGE), validateBody(z.object({ packs: z.number().int().min(0).max(100000) })), async (req, res) => {
  await Tenant.updateOne({ _id: req.user.tenantId }, { $set: { lowStockDefault: req.body.packs } });
  await audit(req, 'stock.alert_default', req.user.tenantId, { packs: req.body.packs });
  res.json({ packs: req.body.packs });
});

router.post('/entries', requirePermission(P.INVENTORY_ADJUST), validateBody(entrySchema), async (req, res) => {
  assertBranchAllowed(req, req.body.branchId);
  const result = await stock.createStockEntry(req.user, req.body);
  await audit(req, 'stock.entry', req.user.tenantId, { outlet: result.branch.name, type: req.body.type, lines: result.lines.length, reference: req.body.reference });
  res.status(201).json(result);
});

const adjustmentSchema = z.object({
  branchId: objectId,
  reason: z.enum(Object.keys(ADJUST_REASONS)),
  note: z.string().trim().max(300).optional().or(z.literal('').transform(() => undefined)),
  lines: z
    .array(z.object({ batchId: objectId, packs: z.number().int().refine((n) => n !== 0, 'Enter how many packs to add or remove') }))
    .min(1)
    .max(50),
});

// write off or correct stock of existing batches (breakage, expiry, count correction ...)
router.post('/adjustments', requirePermission(P.INVENTORY_ADJUST), validateBody(adjustmentSchema), async (req, res) => {
  assertBranchAllowed(req, req.body.branchId);
  const result = await stock.createAdjustment(req.user, req.body);
  await audit(req, 'stock.adjust', req.user.tenantId, { outlet: result.branch.name, reason: req.body.reason, lines: result.lines.length });
  res.status(201).json(result);
});

const transferSchema = z.object({
  fromBranchId: objectId,
  toBranchId: objectId,
  note: z.string().trim().max(300).optional().or(z.literal('').transform(() => undefined)),
  lines: z.array(z.object({ batchId: objectId, packs: z.number().int().min(1).max(100_000) })).min(1).max(50),
});

// move batches from one outlet to another (you must work in the source outlet)
router.post('/transfers', requirePermission(P.INVENTORY_ADJUST), requireFeature('multiOutlet'), validateBody(transferSchema), async (req, res) => {
  assertBranchAllowed(req, req.body.fromBranchId);
  const result = await stock.createTransfer(req.user, req.body);
  await audit(req, 'stock.transfer', req.user.tenantId, { from: result.from, to: result.to, lines: result.lines.length });
  res.status(201).json(result);
});

// stock per product (+ low stock / expiry flags)
router.get('/summary', requirePermission(P.INVENTORY_VIEW), async (req, res) => {
  const { branchId, q, filter } = req.query;
  if (branchId && !mongoose.isValidObjectId(branchId)) throw ApiError.badRequest('Invalid outlet');
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  if (branchId) assertBranchAllowed(req, branchId);
  res.json(await stock.stockSummary({ branchId: branchId?.toString(), branchIds: branchScope(req), q: q?.toString(), filter: filter?.toString(), page, limit }));
});

// batches of one product, earliest expiry first
router.get('/batches', requirePermission(P.INVENTORY_VIEW), async (req, res) => {
  const { productId, branchId } = req.query;
  if (!productId || !mongoose.isValidObjectId(productId)) throw ApiError.badRequest('productId is required');
  if (branchId && !mongoose.isValidObjectId(branchId)) throw ApiError.badRequest('Invalid outlet');
  if (branchId) assertBranchAllowed(req, branchId);
  res.json(await stock.productBatches(productId.toString(), branchId?.toString(), branchScope(req)));
});

// movement history (entries, sales, adjustments, transfers)
router.get('/ledger', requirePermission(P.INVENTORY_VIEW), async (req, res) => {
  const { productId, type, branchId } = req.query;
  if (productId && !mongoose.isValidObjectId(productId)) throw ApiError.badRequest('Invalid product');
  if (branchId && !mongoose.isValidObjectId(branchId)) throw ApiError.badRequest('Invalid outlet');
  if (type && !LEDGER_TYPES.includes(type.toString())) throw ApiError.badRequest('Invalid movement type');
  if (branchId) assertBranchAllowed(req, branchId);
  res.json(
    await stock.recentLedger({
      productId: productId?.toString(),
      type: type?.toString(),
      branchId: branchId?.toString(),
      branchIds: branchScope(req),
      limit: Math.min(200, Number(req.query.limit) || 50),
    }),
  );
});

export default router;
