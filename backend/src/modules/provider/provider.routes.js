import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { requirePermission, requirePlatform } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { AuditLog, audit } from '../audit/audit.model.js';
import { FEATURES, Plan } from '../plans/plan.model.js';
import * as tenants from '../tenants/tenant.service.js';
import { supportRouter } from '../support/support.routes.js';
import { outletRequestsRouter, shopOutletsRouter } from '../branches/outlet-admin.routes.js';
import { medicineRouter, requestRouter } from '../medicines/medicine.routes.js';
import { Tenant } from '../tenants/tenant.model.js';
import { User } from '../users/user.model.js';
import { providerBillingRouter } from '../billing/billing.routes.js';
import { emailRouter } from './email.routes.js';
import { platformUsersRouter } from './platform-users.routes.js';
import { getDashboardStats } from './stats.service.js';

const router = Router();

// Everything under /provider is for platform staff only.
router.use(requirePlatform);

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const optionalText = z.string().trim().max(200).optional().or(z.literal('').transform(() => undefined));

const createShopSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,29}$/, 'Use 2-30 letters, numbers or dashes').optional().or(z.literal('').transform(() => undefined)),
  planId: objectId,
  ownerName: z.string().trim().min(2).max(120),
  ownerEmail: z.email().transform((e) => e.toLowerCase()),
  drugLicenseNo: optionalText,
  gstin: optionalText,
  phone: optionalText,
  address: optionalText,
});

const updateShopSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  drugLicenseNo: optionalText,
  gstin: optionalText,
  phone: optionalText,
  address: optionalText,
});

const planBody = z.object({
  name: z.string().trim().min(2).max(60),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/, 'Use 2-30 letters, numbers or dashes'),
  price: z.number().min(0),
  cycle: z.enum(['monthly', 'yearly']),
  trialDays: z.number().int().min(0).max(365),
  maxOutlets: z.number().int().min(1).nullable(),
  maxUsers: z.number().int().min(1).nullable(),
  maxProducts: z.number().int().min(1).nullable().default(null),
  maxBillsPerMonth: z.number().int().min(1).nullable().default(null),
  features: z.array(z.enum(FEATURES)),
  isActive: z.boolean(),
  publicSignup: z.boolean().default(true),
  tagline: z.string().trim().max(120).optional(),
  sortOrder: z.number().int(),
});

// ---- overview -------------------------------------------------------------
router.get('/dashboard/stats', requirePermission(P.TENANT_VIEW), async (_req, res) => {
  res.json(await getDashboardStats());
});

// ---- shops (tenants) ------------------------------------------------------
router.get('/tenants', requirePermission(P.TENANT_VIEW), async (req, res) => {
  const { q, status, planId } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  if (planId && !mongoose.isValidObjectId(planId)) throw ApiError.badRequest('Invalid plan filter');
  res.json(await tenants.listTenants({ q: q?.toString(), status: status?.toString(), planId: planId?.toString(), page, limit }));
});

router.post('/tenants', requirePermission(P.TENANT_MANAGE), validateBody(createShopSchema), async (req, res) => {
  const { tenant, inviteUrl, emailSent } = await tenants.createTenant(req.body);
  await audit(req, 'tenant.create', tenant._id, { name: tenant.name, code: tenant.code });
  res.status(201).json({ tenant, inviteUrl, emailSent });
});

router.get('/tenants/:id', requirePermission(P.TENANT_VIEW), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Shop not found');
  res.json(await tenants.getTenantDetail(req.params.id));
});

router.patch('/tenants/:id', requirePermission(P.TENANT_MANAGE), validateBody(updateShopSchema), async (req, res) => {
  const tenant = await tenants.updateTenant(req.params.id, req.body);
  await audit(req, 'tenant.update', tenant._id, req.body);
  res.json(tenant);
});

router.post('/tenants/:id/suspend', requirePermission(P.TENANT_MANAGE), validateBody(z.object({ reason: z.string().trim().min(3).max(300) })), async (req, res) => {
  const tenant = await tenants.suspendTenant(req.params.id, req.body.reason);
  await audit(req, 'tenant.suspend', tenant._id, { reason: req.body.reason });
  res.json(tenant);
});

router.post('/tenants/:id/activate', requirePermission(P.TENANT_MANAGE), async (req, res) => {
  const tenant = await tenants.activateTenant(req.params.id);
  await audit(req, 'tenant.activate', tenant._id);
  res.json(tenant);
});

router.post('/tenants/:id/change-plan', requirePermission(P.TENANT_MANAGE), validateBody(z.object({ planId: objectId })), async (req, res) => {
  const tenant = await tenants.changePlan(req.params.id, req.body.planId);
  await audit(req, 'tenant.change_plan', tenant._id, { planId: req.body.planId });
  res.json(tenant);
});

router.post('/tenants/:id/reinvite', requirePermission(P.TENANT_MANAGE), async (req, res) => {
  const { inviteUrl, emailSent } = await tenants.reinviteOwner(req.params.id);
  await audit(req, 'tenant.reinvite', req.params.id);
  res.json({ inviteUrl, emailSent });
});

// ---- plans ----------------------------------------------------------------
router.get('/plans', requirePermission(P.TENANT_VIEW), async (_req, res) => {
  res.json(await Plan.find().sort({ sortOrder: 1, price: 1 }));
});

router.post('/plans', requirePermission(P.PLAN_MANAGE), validateBody(planBody), async (req, res) => {
  if (await Plan.exists({ code: req.body.code })) throw ApiError.conflict(`Plan code "${req.body.code}" already exists`);
  const plan = await Plan.create(req.body);
  await audit(req, 'plan.create', undefined, { code: plan.code });
  res.status(201).json(plan);
});

router.patch('/plans/:id', requirePermission(P.PLAN_MANAGE), validateBody(planBody.partial()), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw ApiError.notFound('Plan not found');
  const plan = await Plan.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!plan) throw ApiError.notFound('Plan not found');
  await audit(req, 'plan.update', undefined, { code: plan.code, changes: Object.keys(req.body) });
  res.json(plan);
});

// ---- outlets of a shop + outlet requests ------------------------------
router.use('/', shopOutletsRouter);
router.use('/outlet-requests', outletRequestsRouter);

// ---- support: reason-based, time-limited, read-only look into a shop ----
router.use('/', supportRouter);

// ---- medicine master catalog + shop requests ----------------------------
router.use('/platform-users', platformUsersRouter);
router.use('/billing', providerBillingRouter);
router.use('/email', emailRouter);
router.use('/medicines', medicineRouter);
router.use('/medicine-requests', requestRouter);

// ---- audit log ------------------------------------------------------------
// groups of actions, by the first part of the action name (e.g. "sale.create" is in "sale")
const AUDIT_AREAS = {
  shops: ['tenant'],
  plans: ['plan'],
  medicines: ['medicine'],
  outlets: ['outlet'],
  staff: ['staff'],
  stock: ['stock'],
  purchasing: ['purchase', 'supplier'],
  sales: ['sale'],
  payments: ['payments'],
  support: ['support'],
  team: ['platformuser', 'auth'],
  billing: ['billing'],
};
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/audit-logs', requirePermission(P.AUDIT_VIEW), async (req, res) => {
  const q = req.query;
  const filter = {};
  const area = AUDIT_AREAS[q.area?.toString() ?? ''];
  if (area) filter.action = new RegExp(`^(${area.join('|')})\\.`);
  if (q.action) filter.action = q.action.toString();
  if (q.tenantId && mongoose.isValidObjectId(q.tenantId)) filter.tenantId = q.tenantId.toString();
  if (q.from || q.to) {
    filter.at = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.from ?? '')) filter.at.$gte = new Date(`${q.from}T00:00:00+05:30`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.to ?? '')) filter.at.$lte = new Date(`${q.to}T23:59:59.999+05:30`);
  }
  // free text: who did it, which shop, or the action name
  const text = q.q?.toString().trim();
  if (text) {
    const rx = new RegExp(escapeRx(text), 'i');
    const [people, shops] = await Promise.all([
      User.find({ $or: [{ name: rx }, { email: rx }] }).select('_id').limit(200).lean(),
      Tenant.find({ $or: [{ name: rx }, { code: rx }] }).select('_id').limit(200).lean(),
    ]);
    filter.$and = [...(filter.$and ?? []), { $or: [{ actorId: { $in: people.map((u) => u._id) } }, { tenantId: { $in: shops.map((t) => t._id) } }, { action: rx }] }];
  }

  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(1000, Math.max(1, Number(q.limit) || 50));
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).populate('actorId', 'name email tenantId').populate('tenantId', 'name code').lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({
    items: rows.map((r) => ({
      _id: r._id,
      at: r.at,
      action: r.action,
      actor: r.actorId ? { name: r.actorId.name, email: r.actorId.email, platform: !r.actorId.tenantId } : null,
      shop: r.tenantId ? { _id: r.tenantId._id, name: r.tenantId.name, code: r.tenantId.code } : null,
      meta: r.meta ?? null,
      ip: r.ip ?? null,
    })),
    total,
    page,
    limit,
  });
});

export default router;
