import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { assertBranchAllowed, branchScope, requireAny, requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../audit/audit.model.js';
import * as svc from './purchase.service.js';

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const checkId = (id, what = 'Record') => {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound(`${what} not found`);
};
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-07');
const text = (max) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));
const paging = (q) => ({ page: Math.max(1, Number(q.page) || 1), limit: Math.min(50, Math.max(1, Number(q.limit) || 20)) });

// people who book purchases can also look; accountants (reports) can look but not change
const canView = requireAny(P.PURCHASE_CREATE, P.REPORTS_VIEW);
const canWrite = requirePermission(P.PURCHASE_CREATE);

// ============================================================ /suppliers
export const supplierRouter = Router();
supplierRouter.use(requireTenant);

const supplierSchema = z.object({
  name: z.string().trim().min(2).max(120),
  contactPerson: text(80),
  phone: text(20),
  email: z.union([z.email(), z.literal('')]).optional().transform((v) => v || undefined),
  gstin: z.string().trim().toUpperCase().regex(/^([0-9A-Z]{15})?$/, 'GSTIN must be 15 characters').optional().transform((v) => v || undefined),
  drugLicenseNo: text(60),
  address: text(200),
  city: text(80),
  state: text(80),
  creditDays: z.number().int().min(0).max(365).default(0),
  openingBalance: z.number().min(-10_000_000).max(10_000_000).default(0),
  notes: text(300),
});

supplierRouter.get('/', canView, async (req, res) => {
  res.json(await svc.listSuppliers({ q: req.query.q?.toString(), active: req.query.active?.toString() }));
});

supplierRouter.post('/', canWrite, validateBody(supplierSchema), async (req, res) => {
  const s = await svc.createSupplier(req.body);
  await audit(req, 'supplier.create', req.user.tenantId, { name: s.name });
  res.status(201).json(s);
});

supplierRouter.get('/:id', canView, async (req, res) => {
  checkId(req.params.id, 'Supplier');
  res.json(await svc.supplierLedger(req.params.id));
});

supplierRouter.patch('/:id', canWrite, validateBody(supplierSchema.partial().extend({ isActive: z.boolean().optional() }), { onlyGiven: true }), async (req, res) => {
  checkId(req.params.id, 'Supplier');
  const s = await svc.updateSupplier(req.params.id, req.body);
  await audit(req, 'supplier.update', req.user.tenantId, { name: s.name, changes: Object.keys(req.body) });
  res.json(s);
});

// paying a supplier is a money decision: owners and managers (purchase.approve)
supplierRouter.post(
  '/:id/payments',
  requirePermission(P.PURCHASE_APPROVE),
  validateBody(z.object({ amount: z.number().min(0.01).max(100_000_000), paidOn: day, mode: z.enum(['CASH', 'UPI', 'BANK', 'CHEQUE', 'OTHER']).default('BANK'), reference: text(60), note: text(200), branchId: z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid outlet').optional() })),
  async (req, res) => {
    checkId(req.params.id, 'Supplier');
    if (req.body.branchId) assertBranchAllowed(req, req.body.branchId);
    const p = await svc.recordPayment(req.user.id, req.params.id, req.body);
    await audit(req, 'supplier.payment', req.user.tenantId, { supplierId: req.params.id, amount: p.amount });
    res.status(201).json(p);
  },
);

// ============================================================ /purchases
export const purchaseRouter = Router();
purchaseRouter.use(requireTenant);

const purchaseSchema = z.object({
  branchId: objectId,
  supplierId: objectId,
  invoiceNo: z.string().trim().min(1).max(40),
  invoiceDate: day,
  dueDate: day.optional().or(z.literal('').transform(() => undefined)),
  notes: text(300),
  orderId: objectId.optional(),
  lines: z
    .array(
      z.object({
        productId: objectId,
        batchNo: z.string().trim().min(1).max(30),
        expiry: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expiry must be a month like 2027-08'),
        mrp: z.number().gt(0).max(10_000_000),
        rate: z.number().min(0).max(10_000_000),
        packs: z.number().int().min(1).max(100_000),
        freePacks: z.number().int().min(0).max(100_000).default(0),
        discountPct: z.number().min(0).max(100).default(0),
        gstPercent: z.number().refine((v) => [0, 5, 12, 18, 28].includes(v), 'GST must be 0, 5, 12, 18 or 28').optional(),
      }),
    )
    .min(1, 'Add at least one product')
    .max(200),
});

purchaseRouter.get('/', canView, async (req, res) => {
  const { supplierId, branchId, q, from, to } = req.query;
  if (supplierId) checkId(supplierId, 'Supplier');
  if (branchId) {
    checkId(branchId, 'Outlet');
    assertBranchAllowed(req, branchId);
  }
  res.json(await svc.listPurchases({ supplierId: supplierId?.toString(), branchId: branchId?.toString(), branchIds: branchScope(req), q: q?.toString(), from: from?.toString(), to: to?.toString(), ...paging(req.query) }));
});

purchaseRouter.post('/', canWrite, validateBody(purchaseSchema), async (req, res) => {
  assertBranchAllowed(req, req.body.branchId);
  const p = await svc.createPurchase(req.user, req.body);
  await audit(req, 'purchase.create', req.user.tenantId, { number: p.number, invoiceNo: p.invoiceNo, grand: p.totals.grand, order: p.orderNumber });
  res.status(201).json(p);
});

purchaseRouter.get('/:id', canView, async (req, res) => {
  checkId(req.params.id, 'Purchase');
  const p = await svc.getPurchase(req.params.id);
  assertBranchAllowed(req, p.branchId?._id ?? p.branchId);
  res.json(p);
});

// ============================================================ /purchase-returns
export const returnRouter = Router();
returnRouter.use(requireTenant);

returnRouter.get('/', canView, async (req, res) => {
  const supplierId = req.query.supplierId?.toString();
  if (supplierId) checkId(supplierId, 'Supplier');
  res.json(await svc.listReturns({ supplierId, branchIds: branchScope(req) }));
});

returnRouter.post(
  '/',
  canWrite,
  validateBody(
    z.object({
      branchId: objectId,
      supplierId: objectId,
      purchaseId: objectId.optional(),
      creditNoteNo: text(40),
      returnedOn: day,
      reason: z.string().trim().min(3, 'Give a reason').max(200),
      lines: z.array(z.object({ batchId: objectId, packs: z.number().int().min(1).max(100_000) })).min(1).max(100),
    }),
  ),
  async (req, res) => {
    assertBranchAllowed(req, req.body.branchId);
    const r = await svc.createPurchaseReturn(req.user, req.body);
    await audit(req, 'purchase.return', req.user.tenantId, { number: r.number, total: r.total });
    res.status(201).json(r);
  },
);
