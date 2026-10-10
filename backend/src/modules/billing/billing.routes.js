import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../audit/audit.model.js';
import { Plan } from '../plans/plan.model.js';
import { Tenant } from '../tenants/tenant.model.js';
import * as svc from './billing.service.js';
import { Invoice } from './invoice.model.js';

const oidOk = (id) => mongoose.isValidObjectId(id);

// ============================================================ shop side: /billing
export const shopBillingRouter = Router();
shopBillingRouter.use(requireTenant);

// anyone in the shop: the small status the banner needs
shopBillingRouter.get('/status', async (req, res) => res.json(await svc.statusFor(req.user.tenantId)));

// the owner: plan, usage, invoices
const owner = requirePermission(P.BILLING_MANAGE);
shopBillingRouter.get('/', owner, async (req, res) => res.json(await svc.shopBilling(req.user.tenantId)));

const mine = async (req) => {
  if (!oidOk(req.params.id)) throw ApiError.notFound('Invoice not found');
  const inv = await Invoice.findOne({ _id: req.params.id, tenantId: req.user.tenantId });
  if (!inv) throw ApiError.notFound('Invoice not found');
  return inv;
};

shopBillingRouter.get('/invoices/:id', owner, async (req, res) => {
  const inv = await mine(req);
  const tenant = await Tenant.findById(req.user.tenantId).select('name address gstin phone drugLicenseNo').lean();
  res.json({ invoice: inv, shop: tenant, company: svc.companyInfo() });
});

shopBillingRouter.post('/invoices/:id/pay-order', owner, async (req, res) => res.status(201).json(await svc.startOnlinePayment(await mine(req))));

shopBillingRouter.post(
  '/invoices/:id/verify',
  owner,
  validateBody(z.object({ orderId: z.string().min(5).max(60), paymentId: z.string().min(5).max(60), signature: z.string().min(10).max(200) })),
  async (req, res) => {
    const inv = await svc.verifyOnlinePayment(await mine(req), req.body);
    res.json({ status: inv.status, number: inv.number });
  },
);

// ============================================================ provider side: /provider/billing
export const providerBillingRouter = Router();
const admin = requirePermission(P.BILLING_ADMIN);
providerBillingRouter.use(admin);

providerBillingRouter.get('/', async (req, res) => {
  res.json(
    await svc.providerOverview({
      status: req.query.status?.toString(),
      tenantId: oidOk(req.query.tenantId) ? req.query.tenantId.toString() : undefined,
      page: Math.max(1, Number(req.query.page) || 1),
    }),
  );
});

providerBillingRouter.post('/run', async (req, res) => {
  const r = await svc.runBillingCycle();
  await audit(req, 'billing.run', undefined, r);
  res.json(r);
});

// one shop: its state and invoices
providerBillingRouter.get('/tenants/:id', async (req, res) => {
  if (!oidOk(req.params.id)) throw ApiError.notFound('Shop not found');
  const tenant = await Tenant.findById(req.params.id).select('status trialEndsAt subscription');
  const { billingState } = await import('./billing.state.js');
  res.json({ state: billingState(tenant), invoices: await Invoice.find({ tenantId: req.params.id }).sort({ periodStart: -1 }).limit(24).lean() });
});

// issue the next invoice now instead of waiting for the daily run
providerBillingRouter.post('/tenants/:id/invoice', async (req, res) => {
  if (!oidOk(req.params.id)) throw ApiError.notFound('Shop not found');
  const tenant = await Tenant.findById(req.params.id);
  const plan = tenant && (await Plan.findById(tenant.planId));
  if (!tenant || !plan) throw ApiError.notFound('Shop or plan not found');
  if (plan.price <= 0) throw ApiError.badRequest('This shop is on a free plan: nothing to bill.');
  const start = tenant.status === 'trial' ? tenant.trialEndsAt : tenant.subscription?.periodEnd;
  if (!start) throw ApiError.badRequest('This shop has no billing period yet. Run the billing job first.');
  const inv = await svc.issueInvoice(tenant, plan, { periodStart: start });
  if (!inv) throw ApiError.conflict('An invoice already exists for the shop\'s next period.');
  await audit(req, 'billing.invoice.manual', tenant._id, { number: inv.number });
  res.status(201).json(inv);
});

const invoiceOf = async (req) => {
  if (!oidOk(req.params.id)) throw ApiError.notFound('Invoice not found');
  const inv = await Invoice.findById(req.params.id);
  if (!inv) throw ApiError.notFound('Invoice not found');
  return inv;
};

// money arrived another way (bank transfer, cash ...)
providerBillingRouter.post(
  '/invoices/:id/mark-paid',
  validateBody(z.object({ method: z.enum(['bank', 'cash', 'upi', 'other']), reference: z.string().trim().max(80).optional(), paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })),
  async (req, res) => {
    const inv = await invoiceOf(req);
    const done = await svc.markPaid(inv._id, { method: req.body.method, reference: req.body.reference, paidOn: req.body.paidOn ? new Date(`${req.body.paidOn}T00:00:00+05:30`) : undefined, by: req.user.id });
    if (!done) throw ApiError.conflict('This invoice is already paid or voided.');
    res.json(done);
  },
);

providerBillingRouter.post('/invoices/:id/void', validateBody(z.object({ reason: z.string().trim().min(3).max(200) })), async (req, res) => {
  const inv = await invoiceOf(req);
  if (inv.status !== 'issued') throw ApiError.conflict('Only an unpaid invoice can be voided.');
  inv.status = 'void';
  inv.voidReason = req.body.reason;
  await inv.save();
  await audit(req, 'billing.invoice.void', inv.tenantId, { number: inv.number, reason: req.body.reason });
  res.json(inv);
});

// give a shop more time (a trial that needs longer, or a paying shop that is late)
providerBillingRouter.post('/tenants/:id/extend', validateBody(z.object({ days: z.number().int().min(1).max(90), reason: z.string().trim().min(3).max(200) })), async (req, res) => {
  if (!oidOk(req.params.id)) throw ApiError.notFound('Shop not found');
  res.json(await svc.extendShop(req.params.id, req.body.days, req.body.reason, req.user.id));
});
