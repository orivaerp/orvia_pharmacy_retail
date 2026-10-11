import crypto from 'node:crypto';
import { ApiError } from '../../utils/ApiError.js';
import { runWithTenant } from '../../plugins/tenantContext.js';
import { createInvite } from '../auth/invite.model.js';
import { Plan } from '../plans/plan.model.js';
import { effectiveLimit, getUsage } from '../plans/plan.service.js';
import { User } from '../users/user.model.js';
import { Branch } from '../branches/branch.model.js';
import { Tenant } from './tenant.model.js';

const DAY = 24 * 60 * 60 * 1000;

const slugify = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'shop';

async function uniqueCode(base) {
  let code = base;
  for (let i = 2; await Tenant.exists({ code }); i++) code = `${base}-${i}`;
  return code;
}

/** Status a shop should have for a plan: trial plans start a trial, paid plans are active. */
function lifecycleFor(plan) {
  return plan.trialDays > 0
    ? { status: 'trial', trialEndsAt: new Date(Date.now() + plan.trialDays * DAY) }
    : { status: 'active', trialEndsAt: null };
}

async function activePlan(planId) {
  const plan = await Plan.findById(planId);
  if (!plan || !plan.isActive) throw ApiError.badRequest('Selected plan is not available');
  return plan;
}

export async function listTenants({ q, status, planId, page = 1, limit = 10 }) {
  const filter = {};
  if (status) filter.status = status;
  if (planId) filter.planId = planId;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { code: rx }, { gstin: rx }];
  }
  const [found, total] = await Promise.all([
    Tenant.find(filter).populate('planId', 'name code maxOutlets').populate('ownerUserId', 'name email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Tenant.countDocuments(filter),
  ]);
  // active outlets per shop on this page (raw collection: this is a cross-shop read, so the tenant plugin must not apply)
  const counts = await Branch.collection
    .aggregate([{ $match: { tenantId: { $in: found.map((t) => t._id) }, isActive: true } }, { $group: { _id: '$tenantId', n: { $sum: 1 } } }])
    .toArray();
  const used = new Map(counts.map((c) => [String(c._id), c.n]));
  const items = found.map((t) => {
    const base = t.planId?.maxOutlets;
    return { ...t.toObject(), outlets: { used: used.get(String(t._id)) ?? 0, limit: base == null ? null : base + (t.extraOutlets ?? 0) } };
  });
  return { items, total, page, limit };
}

export async function getTenantDetail(id) {
  const tenant = await Tenant.findById(id).populate('planId').populate('ownerUserId', 'name email');
  if (!tenant) throw ApiError.notFound('Shop not found');
  const [usage, users] = await Promise.all([
    getUsage(tenant._id),
    User.find({ tenantId: tenant._id }).select('name email role isActive lastLoginAt').sort({ createdAt: 1 }).limit(50),
  ]);
  return { tenant, usage, users };
}

/** `opts.trialDays` starts a trial of that length on the chosen plan, whatever the plan itself says (used by self sign-up). */
export async function createTenant(input, opts = {}) {
  const plan = await activePlan(input.planId);

  const code = input.code ? input.code.toLowerCase() : await uniqueCode(slugify(input.name));
  if (await Tenant.exists({ code })) throw ApiError.conflict(`Shop code "${code}" is already taken`);

  const tenant = await Tenant.create({
    name: input.name,
    code,
    planId: plan._id,
    drugLicenseNo: input.drugLicenseNo,
    gstin: input.gstin,
    phone: input.phone,
    address: input.address,
    ...lifecycleFor(opts.trialDays > 0 ? { ...plan.toObject(), trialDays: opts.trialDays } : plan),
    // a paid plan with no trial is invoiced straight away (the job issues it, with the usual grace to pay)
    ...(plan.price > 0 && !plan.trialDays && !(opts.trialDays > 0) ? { subscription: { startedAt: new Date(), periodEnd: new Date() } } : {}),
    ...(input.signupSource && { signupSource: input.signupSource }),
    ...(input.termsAcceptedAt && { termsAcceptedAt: input.termsAcceptedAt }),
  });

  try {
    await runWithTenant(tenant._id, () => Branch.create({ name: 'Main Outlet', code: 'MAIN' }));
    // Owner starts with an unusable random password; they set their own via the invite link.
    const owner = await User.create({
      tenantId: tenant._id,
      name: input.ownerName,
      email: input.ownerEmail,
      role: 'shop_owner',
      passwordHash: await User.hashPassword(crypto.randomBytes(24).toString('hex')),
    });
    tenant.ownerUserId = owner._id;
    await tenant.save();
    const invite = await createInvite(owner);
    return { tenant, inviteUrl: invite.url, emailSent: invite.emailSent };
  } catch (err) {
    // keep the database clean if any step after creating the shop fails
    await Promise.all([
      Tenant.deleteOne({ _id: tenant._id }),
      Branch.deleteMany({ tenantId: tenant._id }).setOptions({ skipTenant: true }),
      User.deleteMany({ tenantId: tenant._id }),
    ]);
    throw err;
  }
}

export async function updateTenant(id, patch) {
  const tenant = await Tenant.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
  if (!tenant) throw ApiError.notFound('Shop not found');
  return tenant;
}

export async function suspendTenant(id, reason) {
  const tenant = await Tenant.findById(id);
  if (!tenant) throw ApiError.notFound('Shop not found');
  if (tenant.status === 'suspended') throw ApiError.conflict('Shop is already suspended');
  Object.assign(tenant, { status: 'suspended', suspendedAt: new Date(), suspendedReason: reason });
  return tenant.save();
}

export async function activateTenant(id) {
  const tenant = await Tenant.findById(id);
  if (!tenant) throw ApiError.notFound('Shop not found');
  if (tenant.status !== 'suspended') throw ApiError.conflict('Shop is not suspended');
  const onTrial = tenant.trialEndsAt && tenant.trialEndsAt > new Date();
  Object.assign(tenant, { status: onTrial ? 'trial' : 'active', suspendedAt: null, suspendedReason: null });
  return tenant.save();
}

/** Switch plans. Refuses a downgrade the shop's current usage would not fit into. */
export async function changePlan(id, planId) {
  const tenant = await Tenant.findById(id);
  if (!tenant) throw ApiError.notFound('Shop not found');
  const plan = await activePlan(planId);

  const usage = await getUsage(tenant._id);
  const problems = [];
  const outletLimit = effectiveLimit(plan, tenant, 'outlets');
  if (outletLimit != null && usage.outlets > outletLimit) problems.push(`${usage.outlets} outlets (limit ${outletLimit})`);
  if (plan.maxUsers != null && usage.users > plan.maxUsers) problems.push(`${usage.users} users (limit ${plan.maxUsers})`);
  if (plan.maxProducts != null && usage.products > plan.maxProducts) problems.push(`${usage.products} products (limit ${plan.maxProducts})`);
  if (problems.length) throw ApiError.conflict(`Cannot move to ${plan.name}: shop currently has ${problems.join(' and ')}. Reduce usage first.`);

  tenant.planId = plan._id;
  if (tenant.status !== 'suspended') {
    const wasTrial = tenant.status === 'trial';
    const trialEnd = tenant.trialEndsAt;
    Object.assign(tenant, lifecycleFor(plan));
    // a free plan has no paid period: forget the old one, or the shop would be locked when it ran out
    if (plan.price <= 0) tenant.set('subscription.periodEnd', null);
    // leaving a trial for a paid plan: the days of the trial that are left still count, then the first invoice is due
    if (wasTrial && tenant.status === 'active' && plan.price > 0) {
      tenant.set('subscription.startedAt', new Date());
      tenant.set('subscription.periodEnd', trialEnd ?? new Date());
    }
  }
  return tenant.save();
}

/** Fresh "set password" link for the shop owner (also works as an owner password reset). */
export async function reinviteOwner(id) {
  const tenant = await Tenant.findById(id);
  if (!tenant?.ownerUserId) throw ApiError.notFound('Shop owner not found');
  const owner = await User.findById(tenant.ownerUserId);
  if (!owner) throw ApiError.notFound('Shop owner not found');
  const invite = await createInvite(owner);
  return { inviteUrl: invite.url, emailSent: invite.emailSent };
}
