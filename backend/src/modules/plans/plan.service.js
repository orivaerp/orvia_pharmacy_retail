import { ApiError } from '../../utils/ApiError.js';
import { Branch } from '../branches/branch.model.js';
import { Product } from '../products/product.model.js';
import { Sale } from '../sales/sale.model.js';
import { Tenant } from '../tenants/tenant.model.js';
import { User } from '../users/user.model.js';
import { DEFAULT_PLANS, Plan } from './plan.model.js';

/** Inserts the placeholder plans if none exist yet. Safe to call repeatedly. */
export async function ensureDefaultPlans() {
  if (await Plan.estimatedDocumentCount()) return;
  await Plan.insertMany(DEFAULT_PLANS);
}

/** Current usage of a shop, counted straight from the data (no cached counters to drift). */
/** First moment of this calendar month in India time. */
export function monthStartIst(now = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  return new Date(`${ymd.slice(0, 8)}01T00:00:00+05:30`);
}

export async function getUsage(tenantId) {
  const [outlets, users, products, bills] = await Promise.all([
    Branch.countDocuments({ tenantId, isActive: true }).setOptions({ skipTenant: true }),
    User.countDocuments({ tenantId, isActive: true }),
    Product.countDocuments({ tenantId }).setOptions({ skipTenant: true }),
    Sale.countDocuments({ tenantId, createdAt: { $gte: monthStartIst() } }).setOptions({ skipTenant: true }),
  ]);
  return { outlets, users, products, bills };
}

const LIMITS = {
  outlets: { field: 'maxOutlets', label: 'outlet', extra: 'extraOutlets' },
  users: { field: 'maxUsers', label: 'user' },
  products: { field: 'maxProducts', label: 'product' },
  bills: { field: 'maxBillsPerMonth', label: 'bill', per: ' a month' },
};

/** Effective limit for one resource: plan limit plus any extras the provider granted. null = unlimited. */
export function effectiveLimit(plan, tenant, resource) {
  const { field, extra } = LIMITS[resource];
  const base = plan?.[field];
  if (base == null) return null;
  return base + (extra ? (tenant?.[extra] ?? 0) : 0);
}

export async function getLimits(tenantId) {
  const tenant = await Tenant.findById(tenantId).populate('planId');
  const usage = await getUsage(tenantId);
  return {
    plan: tenant?.planId ? { name: tenant.planId.name, maxOutlets: tenant.planId.maxOutlets } : null,
    extraOutlets: tenant?.extraOutlets ?? 0,
    outlets: { used: usage.outlets, limit: effectiveLimit(tenant?.planId, tenant, 'outlets') },
    users: { used: usage.users, limit: effectiveLimit(tenant?.planId, tenant, 'users') },
    products: { used: usage.products, limit: effectiveLimit(tenant?.planId, tenant, 'products') },
    bills: { used: usage.bills, limit: effectiveLimit(tenant?.planId, tenant, 'bills') },
    features: tenant?.planId?.features ?? [],
  };
}

/** Throws 403 when adding `adding` more of `resource` would exceed the shop's plan. Call before creating it. */
export async function assertWithinLimit(tenantId, resource, adding = 1) {
  const tenant = await Tenant.findById(tenantId).populate('planId');
  const plan = tenant?.planId;
  if (!plan) return; // no plan assigned: nothing to enforce
  const { label, per = '' } = LIMITS[resource];
  const max = effectiveLimit(plan, tenant, resource);
  if (max == null) return; // unlimited
  const usage = await getUsage(tenantId);
  if (usage[resource] + adding > max) {
    const room = Math.max(0, max - usage[resource]);
    throw ApiError.forbidden(
      adding > 1 && room > 0
        ? `Your ${plan.name} plan allows ${max} ${label}s${per}. You can add ${room} more, not ${adding}. Upgrade your plan to add more.`
        : `Your ${plan.name} plan allows ${max} ${label}${max === 1 ? '' : 's'}${per}, and you have used ${usage[resource]}. Upgrade your plan to add more.`,
    );
  }
}

/** Does this shop's plan include the feature? */
export async function hasFeature(tenantId, feature) {
  const tenant = await Tenant.findById(tenantId).populate('planId');
  return Boolean(tenant?.planId?.features?.includes(feature));
}

/** Route guard: only shops whose plan includes the feature may use the route. */
export const requireFeature = (feature) => async (req, _res, next) => {
  const tenant = await Tenant.findById(req.user.tenantId).populate('planId');
  if (tenant?.planId?.features?.includes(feature)) return next();
  next(ApiError.forbidden('This feature is not included in your plan.'));
};
