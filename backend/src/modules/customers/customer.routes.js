import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { assertBranchAllowed, requireAny, requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../audit/audit.model.js';
import { User } from '../users/user.model.js';
import { isValidGstin } from '../../utils/gst.js';
import * as svc from './customer.service.js';

const router = Router();
router.use(requireTenant);

// people at the counter manage customers; accountants (reports) can look
const canWrite = requirePermission(P.SALES_CREATE);
const canView = requireAny(P.SALES_CREATE, P.REPORTS_VIEW);
const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const text = (max) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-08');
const check = (id) => {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Customer not found');
};

const customerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: text(20),
  email: z.union([z.email(), z.literal('')]).optional().transform((v) => v || undefined),
  address: text(200),
  gstin: z.string().trim().toUpperCase().optional().or(z.literal('').transform(() => undefined)).refine((v) => !v || isValidGstin(v), 'This is not a valid GSTIN'),
  city: text(60),
  pincode: z.string().trim().regex(/^(\d{6})?$/, 'Pincode must be 6 digits').optional().transform((v) => v || undefined),
  notes: text(300),
  creditLimit: z.number().min(0).max(10_000_000).default(0),
  openingBalance: z.number().min(-10_000_000).max(10_000_000).default(0),
});

router.get('/search', canWrite, async (req, res) => res.json(await svc.searchCustomers(req.query.q?.toString())));

router.get('/', canView, async (req, res) => {
  res.json(
    await svc.listCustomers({
      q: req.query.q?.toString(),
      filter: req.query.filter?.toString(),
      page: Math.max(1, Number(req.query.page) || 1),
      limit: Math.min(50, Math.max(1, Number(req.query.limit) || 20)),
    }),
  );
});

router.post('/', canWrite, validateBody(customerSchema), async (req, res) => {
  const c = await svc.createCustomer(req.user, req.body);
  await audit(req, 'customer.create', req.user.tenantId, { name: c.name });
  res.status(201).json(c);
});

router.get('/:id', canView, async (req, res) => {
  check(req.params.id);
  res.json(await svc.customerDetail(req.params.id));
});

router.patch('/:id', canWrite, validateBody(customerSchema.partial().extend({ isActive: z.boolean().optional() }), { onlyGiven: true }), async (req, res) => {
  check(req.params.id);
  const c = await svc.updateCustomer(req.params.id, req.body);
  await audit(req, 'customer.update', req.user.tenantId, { name: c.name, changes: Object.keys(req.body) });
  res.json(c);
});

// remind everyone who owes (owner and managers: it contacts many people at once)
router.post('/remind-all', requirePermission(P.PURCHASE_APPROVE), async (req, res) => {
  const r = await svc.remindAll(req.user);
  await audit(req, 'customer.reminder.bulk', req.user.tenantId, { sent: r.sent, failed: r.failed });
  res.json(r);
});

router.post('/:id/remind', canWrite, async (req, res) => {
  check(req.params.id);
  const r = await svc.remindCustomer(req.user, req.params.id);
  await audit(req, 'customer.reminder', req.user.tenantId, { customerId: req.params.id, owes: r.owes });
  res.json(r);
});

// money received against udhaar
router.post(
  '/:id/payments',
  canWrite,
  validateBody(z.object({ amount: z.number().min(0.01).max(10_000_000), receivedOn: day, mode: z.enum(['CASH', 'UPI', 'CARD', 'BANK', 'OTHER']).default('CASH'), reference: text(60), note: text(200), branchId: objectId.optional() })),
  async (req, res) => {
    check(req.params.id);
    if (req.body.branchId) assertBranchAllowed(req, req.body.branchId);
    const me = await User.findById(req.user.id).select('name').lean();
    const p = await svc.receivePayment(req.user, req.params.id, req.body, me?.name);
    await audit(req, 'customer.payment', req.user.tenantId, { customerId: req.params.id, amount: p.amount, mode: p.mode });
    res.status(201).json(p);
  },
);

export default router;
