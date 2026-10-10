import crypto from 'node:crypto';
import { ApiError } from '../../utils/ApiError.js';
import { createInvite } from '../auth/invite.model.js';
import { Branch } from '../branches/branch.model.js';
import { assertWithinLimit } from '../plans/plan.service.js';
import { User } from './user.model.js';

// Shop staff management. Users are not tenant-plugin scoped (the provider has users too), so every query here names the tenant.

const view = (u) => ({
  _id: u._id,
  name: u.name,
  email: u.email,
  role: u.role,
  branchIds: (u.branchIds ?? []).map(String),
  isActive: u.isActive,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

/** Outlets must exist in this shop and be active; staff must have at least one. */
async function checkBranches(tenantId, branchIds) {
  if (!branchIds?.length) throw ApiError.badRequest('Choose at least one outlet for this staff member');
  const found = await Branch.find({ _id: { $in: branchIds }, isActive: true }).setOptions({ skipTenant: true }).where({ tenantId }).select('_id').lean();
  if (found.length !== new Set(branchIds).size) throw ApiError.badRequest('One of the chosen outlets is not available');
}

export async function listStaff(tenantId) {
  const users = await User.find({ tenantId }).sort({ isActive: -1, role: 1, name: 1 });
  return users.map(view);
}

export async function createStaff(tenantId, input) {
  if (await User.exists({ tenantId, email: input.email })) throw ApiError.conflict('A user with this email already exists in your shop');
  await checkBranches(tenantId, input.branchIds);
  await assertWithinLimit(tenantId, 'users');

  const user = await User.create({
    tenantId,
    name: input.name,
    email: input.email,
    role: input.role,
    branchIds: input.branchIds,
    // starts with an unusable random password; the person sets their own through the invite link
    passwordHash: await User.hashPassword(crypto.randomBytes(24).toString('hex')),
  });
  const invite = await createInvite(user);
  return { user: view(user), inviteUrl: invite.url, emailSent: invite.emailSent };
}

async function getStaff(tenantId, id) {
  const user = await User.findOne({ _id: id, tenantId });
  if (!user) throw ApiError.notFound('User not found');
  if (user.role === 'shop_owner') throw ApiError.forbidden('The shop owner account can only be changed by the provider');
  return user;
}

export async function updateStaff(tenantId, id, patch) {
  const user = await getStaff(tenantId, id);
  if (patch.branchIds) await checkBranches(tenantId, patch.branchIds);
  Object.assign(user, patch);
  await user.save();
  return view(user);
}

export async function setStaffActive(tenantId, actorId, id, active) {
  const user = await getStaff(tenantId, id);
  if (String(user._id) === String(actorId)) throw ApiError.conflict('You cannot deactivate your own account');
  if (active && !user.isActive) await assertWithinLimit(tenantId, 'users');
  user.isActive = active;
  await user.save();
  return view(user);
}

/** A fresh "set your password" link (also the way to reset a forgotten password). */
export async function reinviteStaff(tenantId, id) {
  const user = await getStaff(tenantId, id);
  const invite = await createInvite(user);
  return { inviteUrl: invite.url, emailSent: invite.emailSent };
}
