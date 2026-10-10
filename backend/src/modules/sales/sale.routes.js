import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { assertBranchAllowed, branchScope, requireAny, requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../audit/audit.model.js';
import { hasFeature } from '../plans/plan.service.js';
import { HeldBill, PAY_MODES } from './sale.model.js';
import { User } from '../users/user.model.js';
import { dashboard } from './dashboard.service.js';
import * as svc from './sale.service.js';

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const text = (max) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));

const router = Router();
router.use(requireTenant);

const canSell = requirePermission(P.SALES_CREATE);
const canView = requireAny(P.SALES_CREATE, P.REPORTS_VIEW);

const saleSchema = z.object({
  branchId: objectId,
  customerId: objectId.optional(),
  customerName: text(80),
  customerPhone: text(20),
  prescriber: z
    .object({ doctorName: text(80), regNo: text(40), patientName: text(80), patientAge: z.number().int().min(0).max(130).optional(), address: text(200) })
    .optional(),
  lines: z
    .array(
      z.object({
        productId: objectId,
        batchId: objectId.optional(),
        packs: z.number().int().min(0).max(10_000),
        loose: z.number().int().min(0).max(10_000).optional(),
        discountPct: z.number().min(0).max(100).default(0),
      }),
    )
    .min(1, 'Add at least one item')
    .max(100),
  payments: z.array(z.object({ mode: z.enum(PAY_MODES), amount: z.number().min(0).max(10_000_000), reference: text(60), orderId: z.string().max(60).optional() })).min(1),
});

// numbers for the owner's dashboard; each group is only included if the caller may see it
router.get('/dashboard', requireAny(P.SALES_CREATE, P.REPORTS_VIEW, P.INVENTORY_VIEW), async (req, res) => {
  const branchId = req.query.branchId?.toString();
  if (branchId) {
    if (!mongoose.isValidObjectId(branchId)) throw ApiError.notFound('Outlet not found');
    assertBranchAllowed(req, branchId);
  }
  const can = (p) => req.user.permissions.includes(p);
  res.json(await dashboard({ branchId, branchIds: branchScope(req), parts: { sales: can(P.SALES_CREATE) || can(P.REPORTS_VIEW), stock: can(P.INVENTORY_VIEW) } }));
});

// ---- bills on hold (before /:id so "holds" is not read as an id)
const holdSchema = z.object({
  branchId: objectId,
  label: text(60),
  customerName: text(80),
  customerPhone: text(20),
  prescriber: saleSchema.shape.prescriber,
  lines: z
    .array(z.object({ productId: objectId, name: text(200), batchId: objectId.optional(), packs: z.number().int().min(0).max(10_000), loose: z.number().int().min(0).max(10_000).optional(), discountPct: z.number().min(0).max(100).default(0) }))
    .min(1)
    .max(100),
});

router.get('/holds', canSell, async (req, res) => {
  const branchId = req.query.branchId?.toString();
  if (!branchId || !mongoose.isValidObjectId(branchId)) throw ApiError.badRequest('Choose an outlet');
  assertBranchAllowed(req, branchId);
  res.json(await HeldBill.find({ branchId }).sort({ createdAt: -1 }).limit(30).lean());
});

router.post('/holds', canSell, validateBody(holdSchema), async (req, res) => {
  assertBranchAllowed(req, req.body.branchId);
  if ((await HeldBill.countDocuments({ branchId: req.body.branchId })) >= 20) throw ApiError.conflict('This outlet already has 20 bills on hold. Finish or discard some first.');
  const me = await User.findById(req.user.id).select('name').lean();
  res.status(201).json(await HeldBill.create({ ...req.body, heldBy: req.user.id, heldByName: me?.name }));
});

router.delete('/holds/:id', canSell, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Held bill not found');
  const h = await HeldBill.findById(req.params.id);
  if (!h) throw ApiError.notFound('Held bill not found');
  assertBranchAllowed(req, h.branchId);
  await h.deleteOne();
  res.json({ ok: true });
});

router.get('/search', canSell, async (req, res) => {
  const branchId = req.query.branchId?.toString();
  if (!branchId || !mongoose.isValidObjectId(branchId)) throw ApiError.badRequest('Choose an outlet');
  assertBranchAllowed(req, branchId);
  // scanning a barcode to find the product is part of the barcode billing feature; searching by name always works
  res.json(await svc.searchForSale({ branchId, q: req.query.q?.toString(), barcodes: await hasFeature(req.user.tenantId, 'barcodeBilling') }));
});

router.get('/', canView, async (req, res) => {
  const branchId = req.query.branchId?.toString();
  if (branchId) {
    if (!mongoose.isValidObjectId(branchId)) throw ApiError.notFound('Outlet not found');
    assertBranchAllowed(req, branchId);
  }
  res.json(
    await svc.listSales({
      branchId,
      branchIds: branchScope(req),
      customerId: mongoose.isValidObjectId(req.query.customerId) ? req.query.customerId.toString() : undefined,
      q: req.query.q?.toString(),
      from: req.query.from?.toString(),
      to: req.query.to?.toString(),
      page: Math.max(1, Number(req.query.page) || 1),
      limit: Math.min(50, Math.max(1, Number(req.query.limit) || 20)),
    }),
  );
});

router.post('/', canSell, validateBody(saleSchema), async (req, res) => {
  assertBranchAllowed(req, req.body.branchId);
  const sale = await svc.createSale(req.user, req.body);
  await audit(req, 'sale.create', req.user.tenantId, { number: sale.number, grand: sale.totals.grand });
  res.status(201).json(sale);
});

router.get('/:id', canView, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Bill not found');
  const sale = await svc.getSale(req.params.id);
  assertBranchAllowed(req, sale.branchId?._id ?? sale.branchId);
  res.json(sale);
});

// refunds are a money decision: managers and owners
router.post(
  '/:id/returns',
  requirePermission(P.PURCHASE_APPROVE),
  validateBody(
    z.object({
      reason: z.string().trim().min(3, 'Give a reason').max(200),
      // GATEWAY = send it back to the customer's UPI through Razorpay (only for a bill paid that way)
      refundMode: z.enum([...PAY_MODES, 'GATEWAY']).default('CASH'),
      lines: z.array(z.object({ batchId: objectId, units: z.number().int().min(1).max(100_000) })).min(1),
    }),
  ),
  async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Bill not found');
    const sale = await svc.getSale(req.params.id);
    assertBranchAllowed(req, sale.branchId?._id ?? sale.branchId);
    const r = await svc.createSaleReturn(req.user, req.params.id, req.body);
    await audit(req, 'sale.return', req.user.tenantId, { number: r.number, sale: r.saleNumber, refund: r.refund, ...(r.gatewayRefund?.status && { upiRefund: r.gatewayRefund.status }) });
    res.status(201).json(r);
  },
);

// the link a customer gets on WhatsApp (anyone who can bill can send it; turning it off is for owner and managers)
router.post('/:id/share', canSell, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Bill not found');
  const sale = await svc.getSale(req.params.id);
  assertBranchAllowed(req, sale.branchId?._id ?? sale.branchId);
  const r = await svc.shareBill(req.params.id);
  await audit(req, 'sale.share', req.user.tenantId, { number: r.number });
  res.json(r);
});

router.delete('/:id/share', requirePermission(P.PURCHASE_APPROVE), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Bill not found');
  const sale = await svc.getSale(req.params.id);
  assertBranchAllowed(req, sale.branchId?._id ?? sale.branchId);
  await svc.stopSharing(req.params.id);
  await audit(req, 'sale.unshare', req.user.tenantId, { number: sale.number });
  res.json({ shared: false });
});

// cancel a whole bill made by mistake (owner and managers, like returns)
router.post('/:id/cancel', requirePermission(P.PURCHASE_APPROVE), validateBody(z.object({ reason: z.string().trim().min(3, 'Give a reason').max(200) })), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Bill not found');
  const sale = await svc.getSale(req.params.id);
  assertBranchAllowed(req, sale.branchId?._id ?? sale.branchId);
  const me = await User.findById(req.user.id).select('name').lean();
  const r = await svc.cancelSale({ id: req.user.id, name: me?.name ?? '' }, req.params.id, req.body);
  await audit(req, 'sale.cancel', req.user.tenantId, { number: r.number, reason: req.body.reason, refunds: r.returns.map((x) => `${x.refundMode} ${x.refund}`).join(', ') });
  res.json(r);
});

// try a UPI refund again after it failed
router.post('/:id/returns/:returnId/retry-refund', requirePermission(P.PURCHASE_APPROVE), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.returnId)) throw ApiError.notFound('Refund not found');
  const sale = await svc.getSale(req.params.id);
  assertBranchAllowed(req, sale.branchId?._id ?? sale.branchId);
  const r = await svc.retryGatewayRefund(req.params.id, req.params.returnId);
  await audit(req, 'sale.refund.retry', req.user.tenantId, { number: r.number, status: r.gatewayRefund.status });
  res.json(r);
});

export default router;
