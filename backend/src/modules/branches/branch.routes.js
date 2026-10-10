import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { branchScope, requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../audit/audit.model.js';
import { getLimits } from '../plans/plan.service.js';
import { branchCreateSchema, branchUpdateSchema } from './branch.schema.js';
import * as outlets from './branch.service.js';
import { OutletRequest } from './outlet-request.model.js';

const router = Router();
router.use(requireTenant);

const checkId = (id) => {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Outlet not found');
};

// No tenantId filter is written in the outlet queries: the tenant plugin adds it.
router.get('/', requirePermission(P.BRANCH_VIEW), async (_req, res) => {
  const scope = branchScope(_req);
  const all = await outlets.listBranches();
  res.json(scope ? all.filter((o) => scope.includes(String(o._id))) : all);
});

// how many outlets the plan allows, how many are used, and whether a request is already waiting
router.get('/usage', requirePermission(P.BRANCH_VIEW), async (req, res) => {
  const [limits, pending] = await Promise.all([getLimits(req.user.tenantId), OutletRequest.findOne({ tenantId: req.user.tenantId, status: 'pending' })]);
  res.json({ ...limits, pendingRequest: pending ? { count: pending.count, note: pending.note, at: pending.createdAt } : null });
});

// ---- asking the provider for more outlets ----
router.get('/requests', requirePermission(P.BRANCH_MANAGE), async (req, res) => {
  res.json(await OutletRequest.find({ tenantId: req.user.tenantId }).sort({ createdAt: -1 }).limit(20));
});

const requestSchema = z.object({ count: z.number().int().min(1).max(20), note: z.string().trim().max(300).optional() });
router.post('/requests', requirePermission(P.BRANCH_MANAGE), validateBody(requestSchema), async (req, res) => {
  if (await OutletRequest.exists({ tenantId: req.user.tenantId, status: 'pending' })) {
    throw ApiError.conflict('You already have a pending request. Please wait for the provider to respond.');
  }
  const request = await OutletRequest.create({ tenantId: req.user.tenantId, requestedBy: req.user.id, ...req.body });
  await audit(req, 'outlet.request', req.user.tenantId, { count: req.body.count });
  res.status(201).json(request);
});

// ---- outlets ----
router.post('/', requirePermission(P.BRANCH_MANAGE), validateBody(branchCreateSchema), async (req, res) => {
  const branch = await outlets.createBranch(req.user.tenantId, req.body);
  await audit(req, 'outlet.create', req.user.tenantId, { name: branch.name, code: branch.code });
  res.status(201).json(branch);
});

router.patch('/:id', requirePermission(P.BRANCH_MANAGE), validateBody(branchUpdateSchema), async (req, res) => {
  checkId(req.params.id);
  const branch = await outlets.updateBranch(req.params.id, req.body);
  await audit(req, 'outlet.update', req.user.tenantId, { code: branch.code, changes: Object.keys(req.body) });
  res.json(branch);
});

router.post('/:id/deactivate', requirePermission(P.BRANCH_MANAGE), async (req, res) => {
  checkId(req.params.id);
  const branch = await outlets.deactivateBranch(req.params.id);
  await audit(req, 'outlet.deactivate', req.user.tenantId, { code: branch.code });
  res.json(branch);
});

router.post('/:id/activate', requirePermission(P.BRANCH_MANAGE), async (req, res) => {
  checkId(req.params.id);
  const branch = await outlets.activateBranch(req.params.id, req.user.tenantId);
  await audit(req, 'outlet.activate', req.user.tenantId, { code: branch.code });
  res.json(branch);
});

export default router;
