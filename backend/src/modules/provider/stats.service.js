import { Branch } from '../branches/branch.model.js';
import { OutletRequest } from '../branches/outlet-request.model.js';
import { Plan } from '../plans/plan.model.js';
import { Tenant } from '../tenants/tenant.model.js';

const DAY = 24 * 60 * 60 * 1000;

/** Everything the provider Overview needs, in one call. */
export async function getDashboardStats() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 6 * DAY);
  weekAgo.setHours(0, 0, 0, 0);

  const [byStatus, trialsEnding, plans, tenants, recent, outlets, pendingOutletRequests] = await Promise.all([
    Tenant.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Tenant.countDocuments({ status: 'trial', trialEndsAt: { $lte: new Date(now.getTime() + 7 * DAY) } }),
    Plan.find().lean(),
    Tenant.find().select('planId status createdAt').lean(),
    Tenant.find().populate('planId', 'name').sort({ createdAt: -1 }).limit(5).select('name code status createdAt planId'),
    Branch.collection.countDocuments({ isActive: true }),
    OutletRequest.countDocuments({ status: 'pending' }),
  ]);

  const count = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
  const planById = new Map(plans.map((p) => [String(p._id), p]));

  // monthly recurring revenue: paying (active) shops only, yearly plans spread over 12 months
  const mrr = tenants
    .filter((t) => t.status === 'active')
    .reduce((sum, t) => {
      const p = planById.get(String(t.planId));
      return sum + (p ? (p.cycle === 'yearly' ? p.price / 12 : p.price) : 0);
    }, 0);

  // shops per plan, as whole-number percentages
  const perPlan = new Map();
  for (const t of tenants) perPlan.set(String(t.planId), (perPlan.get(String(t.planId)) ?? 0) + 1);
  const planSplit = [...perPlan.entries()]
    .map(([id, n]) => ({ label: planById.get(id)?.name ?? 'No plan', value: Math.round((n / (tenants.length || 1)) * 100), order: planById.get(id)?.sortOrder ?? 99 }))
    .sort((a, b) => a.order - b.order)
    .map(({ label, value }) => ({ label, value }));

  // new shops per day for the last 7 days
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekAgo.getTime() + i * DAY));
  const signups = {
    labels: days.map((d) => d.toLocaleDateString('en-US', { weekday: 'short' })),
    values: days.map((d) => tenants.filter((t) => t.createdAt >= d && t.createdAt < new Date(d.getTime() + DAY)).length),
  };

  return {
    totals: {
      shops: tenants.length,
      active: count.active ?? 0,
      trial: count.trial ?? 0,
      suspended: count.suspended ?? 0,
      trialsEnding,
      mrr: Math.round(mrr),
      outlets,
      pendingOutletRequests,
    },
    planSplit,
    signups,
    recent,
  };
}
