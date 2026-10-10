import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { PERMISSIONS as P, STAFF_ROLES } from '../../constants/permissions.js';
import { requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../audit/audit.model.js';
import * as staff from './user.service.js';

const router = Router();
router.use(requireTenant);

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const checkId = (id) => {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('User not found');
};

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().transform((e) => e.toLowerCase()),
  role: z.enum(STAFF_ROLES),
  branchIds: z.array(objectId).min(1, 'Choose at least one outlet').max(50),
});
const updateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(STAFF_ROLES).optional(),
  branchIds: z.array(objectId).min(1, 'Choose at least one outlet').max(50).optional(),
});

router.get('/', requirePermission(P.USER_VIEW), async (req, res) => {
  res.json(await staff.listStaff(req.user.tenantId));
});

router.post('/', requirePermission(P.USER_MANAGE), validateBody(createSchema), async (req, res) => {
  const result = await staff.createStaff(req.user.tenantId, req.body);
  await audit(req, 'staff.create', req.user.tenantId, { email: result.user.email, role: result.user.role });
  res.status(201).json(result);
});

router.patch('/:id', requirePermission(P.USER_MANAGE), validateBody(updateSchema), async (req, res) => {
  checkId(req.params.id);
  const user = await staff.updateStaff(req.user.tenantId, req.params.id, req.body);
  await audit(req, 'staff.update', req.user.tenantId, { email: user.email, changes: Object.keys(req.body) });
  res.json(user);
});

router.post('/:id/deactivate', requirePermission(P.USER_MANAGE), async (req, res) => {
  checkId(req.params.id);
  const user = await staff.setStaffActive(req.user.tenantId, req.user.id, req.params.id, false);
  await audit(req, 'staff.deactivate', req.user.tenantId, { email: user.email });
  res.json(user);
});

router.post('/:id/activate', requirePermission(P.USER_MANAGE), async (req, res) => {
  checkId(req.params.id);
  const user = await staff.setStaffActive(req.user.tenantId, req.user.id, req.params.id, true);
  await audit(req, 'staff.activate', req.user.tenantId, { email: user.email });
  res.json(user);
});

router.post('/:id/reinvite', requirePermission(P.USER_MANAGE), async (req, res) => {
  checkId(req.params.id);
  const { inviteUrl, emailSent } = await staff.reinviteStaff(req.user.tenantId, req.params.id);
  await audit(req, 'staff.reinvite', req.user.tenantId, {});
  res.json({ inviteUrl, emailSent });
});

export default router;
