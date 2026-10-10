import { Router } from 'express';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { DEFAULT_ROLES, PERMISSIONS as P, SCOPES } from '../../constants/permissions.js';
import { requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { audit } from '../audit/audit.model.js';
import { createInvite } from '../auth/invite.model.js';
import { resetFor } from '../auth/twofactor.service.js';
import { User } from '../users/user.model.js';

/** Orvia's own staff (users with no shop). Only a super admin manages them. */
export const platformUsersRouter = Router();
platformUsersRouter.use(requirePermission(P.PLATFORM_USERS_MANAGE));

export const PLATFORM_ROLES = Object.entries(DEFAULT_ROLES)
  .filter(([, def]) => def.scope === SCOPES.PLATFORM)
  .map(([role]) => role);

const view = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  role: u.role,
  isActive: u.isActive,
  twoFactorEnabled: Boolean(u.twoFactor?.enabled),
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

const find = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('User not found');
  const u = await User.findOne({ _id: id, tenantId: null });
  if (!u) throw ApiError.notFound('User not found');
  return u;
};

/** There must always be at least one active super admin, or nobody could manage the platform. */
async function assertAnotherSuperAdmin(excludingId) {
  const others = await User.countDocuments({ tenantId: null, role: 'super_admin', isActive: true, _id: { $ne: excludingId } });
  if (!others) throw ApiError.conflict('There must be at least one active super admin.');
}

const roleSchema = z.enum(PLATFORM_ROLES);

platformUsersRouter.get('/', async (_req, res) => {
  const users = await User.find({ tenantId: null }).sort({ isActive: -1, role: 1, name: 1 });
  res.json({ users: users.map(view), roles: PLATFORM_ROLES });
});

platformUsersRouter.post(
  '/',
  validateBody(z.object({ name: z.string().trim().min(2).max(80), email: z.email().transform((e) => e.toLowerCase()), role: roleSchema })),
  async (req, res) => {
    if (await User.exists({ tenantId: null, email: req.body.email })) throw ApiError.conflict('An Orvia user with this email already exists');
    const user = await User.create({
      tenantId: null,
      name: req.body.name,
      email: req.body.email,
      role: req.body.role,
      // unusable until the person sets their own through the invite link
      passwordHash: await User.hashPassword(crypto.randomBytes(24).toString('hex')),
    });
    const invite = await createInvite(user);
    await audit(req, 'platformuser.create', undefined, { email: user.email, role: user.role });
    res.status(201).json({ user: view(user), inviteUrl: invite.url, emailSent: invite.emailSent });
  },
);

platformUsersRouter.patch('/:id', validateBody(z.object({ name: z.string().trim().min(2).max(80).optional(), role: roleSchema.optional() }), { onlyGiven: true }), async (req, res) => {
  const user = await find(req.params.id);
  const isSelf = String(user._id) === String(req.user.id);
  if (req.body.role && req.body.role !== user.role) {
    if (isSelf) throw ApiError.conflict('You cannot change your own role.');
    if (user.role === 'super_admin' && user.isActive) await assertAnotherSuperAdmin(user._id);
  }
  const before = { role: user.role, name: user.name };
  Object.assign(user, req.body);
  await user.save();
  await audit(req, 'platformuser.update', undefined, { email: user.email, from: before, to: { role: user.role, name: user.name } });
  res.json(view(user));
});

platformUsersRouter.post('/:id/deactivate', async (req, res) => {
  const user = await find(req.params.id);
  if (String(user._id) === String(req.user.id)) throw ApiError.conflict('You cannot deactivate your own account.');
  if (user.role === 'super_admin' && user.isActive) await assertAnotherSuperAdmin(user._id);
  user.isActive = false;
  await user.save();
  await audit(req, 'platformuser.deactivate', undefined, { email: user.email });
  res.json(view(user));
});

platformUsersRouter.post('/:id/activate', async (req, res) => {
  const user = await find(req.params.id);
  user.isActive = true;
  await user.save();
  await audit(req, 'platformuser.activate', undefined, { email: user.email });
  res.json(view(user));
});

// a fresh "set your password" link (also the way to reset a forgotten password)
platformUsersRouter.post('/:id/reinvite', async (req, res) => {
  const user = await find(req.params.id);
  const invite = await createInvite(user);
  await audit(req, 'platformuser.reinvite', undefined, { email: user.email });
  res.json({ inviteUrl: invite.url, emailSent: invite.emailSent });
});

// lost phone and recovery codes: clear two-step verification; they set it up again at next sign-in
platformUsersRouter.post('/:id/reset-2fa', async (req, res) => {
  const user = await find(req.params.id);
  await resetFor(user._id);
  await audit(req, 'platformuser.reset_2fa', undefined, { email: user.email });
  res.json({ ok: true });
});
