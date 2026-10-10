import { ApiError } from '../../utils/ApiError.js';
import { currentTenantId } from '../../plugins/tenantContext.js';
import { assertWithinLimit, getUsage, effectiveLimit } from '../plans/plan.service.js';
import { Batch } from '../stock/stock.model.js';
import { Tenant } from '../tenants/tenant.model.js';
import { User } from '../users/user.model.js';
import { Branch } from './branch.model.js';
import { cleanBranchData } from './branch.schema.js';

// All functions here run inside a tenant context (a shop user's request, or runWithTenant for the provider).

/** Outlets with a little context: units in stock and number of staff assigned. */
export async function listBranches() {
  const tenantId = currentTenantId();
  const [branches, stock, staff] = await Promise.all([
    Branch.find().sort({ isActive: -1, name: 1 }).lean(),
    Batch.aggregate([{ $match: { quantity: { $gt: 0 } } }, { $group: { _id: '$branchId', units: { $sum: '$quantity' }, products: { $addToSet: '$productId' } } }]),
    User.find({ tenantId, isActive: true }).select('branchIds').lean(),
  ]);
  const stockBy = new Map(stock.map((s) => [String(s._id), s]));
  return branches.map((b) => ({
    ...b,
    stockUnits: stockBy.get(String(b._id))?.units ?? 0,
    stockProducts: stockBy.get(String(b._id))?.products.length ?? 0,
    staff: staff.filter((u) => u.branchIds?.some((id) => String(id) === String(b._id))).length,
  }));
}

export async function createBranch(tenantId, data) {
  await assertWithinLimit(tenantId, 'outlets');
  if (await Branch.exists({ code: data.code })) throw ApiError.conflict(`Outlet code "${data.code}" is already used in this shop`);
  const branch = await Branch.create(cleanBranchData(data));

  // two requests at the same moment could both pass the check above: re-count and undo if we went over
  const tenant = await Tenant.findById(tenantId).populate('planId');
  const limit = effectiveLimit(tenant?.planId, tenant, 'outlets');
  if (limit != null && (await getUsage(tenantId)).outlets > limit) {
    await Branch.deleteOne({ _id: branch._id });
    throw ApiError.forbidden(`Your ${tenant.planId.name} plan allows ${limit} outlet${limit === 1 ? '' : 's'}. Upgrade your plan to add more.`);
  }
  return branch;
}

export async function updateBranch(id, patch) {
  const branch = await Branch.findByIdAndUpdate(id, cleanBranchData(patch), { new: true, runValidators: true });
  if (!branch) throw ApiError.notFound('Outlet not found');
  return branch;
}

/** An outlet can be closed only when it holds no stock, and a shop always keeps at least one active outlet. */
export async function deactivateBranch(id) {
  const branch = await Branch.findById(id);
  if (!branch) throw ApiError.notFound('Outlet not found');
  if (!branch.isActive) throw ApiError.conflict('Outlet is already inactive');

  if ((await Branch.countDocuments({ isActive: true })) <= 1) throw ApiError.conflict('You need at least one active outlet');

  const [held] = await Batch.aggregate([{ $match: { branchId: branch._id, quantity: { $gt: 0 } } }, { $group: { _id: null, units: { $sum: '$quantity' }, batches: { $sum: 1 } } }]);
  if (held) throw ApiError.conflict(`This outlet still has stock (${held.batches} batch${held.batches === 1 ? '' : 'es'}). Transfer it or write it off first.`);

  branch.isActive = false;
  return branch.save();
}

export async function activateBranch(id, tenantId) {
  const branch = await Branch.findById(id);
  if (!branch) throw ApiError.notFound('Outlet not found');
  if (branch.isActive) throw ApiError.conflict('Outlet is already active');
  await assertWithinLimit(tenantId, 'outlets');
  branch.isActive = true;
  return branch.save();
}
