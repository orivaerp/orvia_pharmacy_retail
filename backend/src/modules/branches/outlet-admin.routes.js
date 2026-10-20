import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { runWithTenant } from '../../plugins/tenantContext.js';
import { audit } from '../audit/audit.model.js';
import { getLimits } from '../plans/plan.service.js';
import { Tenant } from '../tenants/tenant.model.js';
import { branchCreateSchema, branchUpdateSchema } from './branch.schema.js';
import * as outlets from './branch.service.js';
import { OutletRequest } from './outlet-request.model.js';

const checkId = (id, what = 'Shop') => {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound(`${what} not found`);
};

async function requireTenantDoc(id) {
  checkId(id);
  const tenant = await Tenant.findById(id);
  if (!tenant) throw ApiError.notFound('Shop not found');
  return tenant;
}

// ---- /provider/tenants/:id/outlets ... (mounted at "/" of the provider router) ----
export const shopOutletsRouter = Router();

shopOutletsRouter.get('/tenants/:id/outlets', requirePermission(P.TENANT_VIEW), async (req, res) => {
  const tenant = await requireTenantDoc(req.params.id);
  const [list, limits] = await Promise.all([runWithTenant(tenant._id, () => outlets.listBranches()), getLimits(tenant._id)]);
  res.json({ outlets: list, limits });
});

// support case: the provider adds an outlet for the shop (the shop's limit still applies; raise it first if needed)
shopOutletsRouter.post('/tenants/:id/outlets', requirePermission(P.TENANT_MANAGE), validateBody(branchCreateSchema), async (req, res) => {
  const tenant = await requireTenantDoc(req.params.id);
  const branch = await runWithTenant(tenant._id, () => outlets.createBranch(tenant._id, req.body));
  await audit(req, 'outlet.create.by_provider', tenant._id, { name: branch.name, code: branch.code });
  res.status(201).json(branch);
});

shopOutletsRouter.patch('/tenants/:id/outlets/:branchId', requirePermission(P.TENANT_MANAGE), validateBody(branchUpdateSchema), async (req, res) => {
  const tenant = await requireTenantDoc(req.params.id);
  checkId(req.params.branchId, 'Outlet');
  const branch = await runWithTenant(tenant._id, () => outlets.updateBranch(req.params.branchId, req.body));
  await audit(req, 'outlet.update.by_provider', tenant._id, { code: branch.code });
  res.json(branch);
});

shopOutletsRouter.post('/tenants/:id/outlets/:branchId/deactivate', requirePermission(P.TENANT_MANAGE), async (req, res) => {
  const tenant = await requireTenantDoc(req.params.id);
  checkId(req.params.branchId, 'Outlet');
  const branch = await runWithTenant(tenant._id, () => outlets.deactivateBranch(req.params.branchId));
  await audit(req, 'outlet.deactivate.by_provider', tenant._id, { code: branch.code });
  res.json(branch);
});

shopOutletsRouter.post('/tenants/:id/outlets/:branchId/activate', requirePermission(P.TENANT_MANAGE), async (req, res) => {
  const tenant = await requireTenantDoc(req.params.id);
  checkId(req.params.branchId, 'Outlet');
  const branch = await runWithTenant(tenant._id, () => outlets.activateBranch(req.params.branchId, tenant._id));
  await audit(req, 'outlet.activate.by_provider', tenant._id, { code: branch.code });
  res.json(branch);
});

// extra outlets on top of the plan (cannot drop below what the shop already uses)
shopOutletsRouter.patch('/tenants/:id/limits', requirePermission(P.TENANT_MANAGE), validateBody(z.object({ extraOutlets: z.number().int().min(0).max(100) })), async (req, res) => {
  const tenant = await requireTenantDoc(req.params.id);
  const before = tenant.extraOutlets ?? 0;
  tenant.extraOutlets = req.body.extraOutlets;
  const limits = await (async () => {
    await tenant.save();
    return getLimits(tenant._id);
  })();
  if (limits.outlets.limit != null && limits.outlets.used > limits.outlets.limit) {
    tenant.extraOutlets = before; // would leave the shop over its limit: undo
    await tenant.save();
    throw ApiError.conflict(`The shop already uses ${limits.outlets.used} outlets. Deactivate some first, or keep more extra outlets.`);
  }
  await audit(req, 'tenant.limits', tenant._id, { extraOutlets: { from: before, to: req.body.extraOutlets } });
  res.json(limits);
});

// online UPI through the shop's own payment gateway: off for every shop until the provider switches it on here
shopOutletsRouter.patch('/tenants/:id/gateway', requirePermission(P.TENANT_MANAGE), validateBody(z.object({ enabled: z.boolean() })), async (req, res) => {
  const tenant = await requireTenantDoc(req.params.id);
  const before = Boolean(tenant.onlineGateway);
  tenant.onlineGateway = req.body.enabled;
  await tenant.save();
  await audit(req, 'tenant.gateway', tenant._id, { from: before, to: req.body.enabled });
  res.json({ onlineGateway: tenant.onlineGateway });
});

// ---- /provider/outlet-requests ----
export const outletRequestsRouter = Router();

outletRequestsRouter.get('/', requirePermission(P.TENANT_VIEW), async (req, res) => {
  const status = req.query.status?.toString() || 'pending';
  const filter = status === 'all' ? {} : { status };
  const items = await OutletRequest.find(filter).populate('tenantId', 'name code extraOutlets planId').populate('requestedBy', 'name email').sort({ createdAt: -1 }).limit(100).lean();
  // show each shop's current usage next to its request
  const withLimits = await Promise.all(items.map(async (r) => ({ ...r, limits: r.tenantId ? await getLimits(r.tenantId._id) : null })));
  res.json(withLimits);
});

async function getPending(id) {
  checkId(id, 'Request');
  const request = await OutletRequest.findById(id);
  if (!request) throw ApiError.notFound('Request not found');
  if (request.status !== 'pending') throw ApiError.conflict(`This request was already ${request.status}`);
  return request;
}

// approve: grants extra outlets (default: what was asked; the provider may grant fewer)
outletRequestsRouter.post('/:id/approve', requirePermission(P.TENANT_MANAGE), validateBody(z.object({ granted: z.number().int().min(1).max(20).optional(), note: z.string().trim().max(300).optional() })), async (req, res) => {
  const request = await getPending(req.params.id);
  const granted = req.body.granted ?? request.count;
  await Tenant.updateOne({ _id: request.tenantId }, { $inc: { extraOutlets: granted } });
  Object.assign(request, { status: 'approved', grantedCount: granted, reviewNote: req.body.note, handledBy: req.user.id, handledAt: new Date() });
  await request.save();
  await audit(req, 'outlet.request.approve', request.tenantId, { granted });
  res.json(request);
});

outletRequestsRouter.post('/:id/reject', requirePermission(P.TENANT_MANAGE), validateBody(z.object({ note: z.string().trim().min(3).max(300) })), async (req, res) => {
  const request = await getPending(req.params.id);
  Object.assign(request, { status: 'rejected', reviewNote: req.body.note, handledBy: req.user.id, handledAt: new Date() });
  await request.save();
  await audit(req, 'outlet.request.reject', request.tenantId, { note: req.body.note });
  res.json(request);
});
