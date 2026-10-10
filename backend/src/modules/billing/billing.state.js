import { env } from '../../config/env.js';

const DAY = 24 * 60 * 60 * 1000;
export const WARN_DAYS = 7; // start warning (and issue the next invoice) this long before the period ends
export const TRIAL_GRACE_DAYS = 3;

/** Adds one billing cycle to a date. */
export function addCycle(date, cycle) {
  const d = new Date(date);
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/**
 * Where a shop stands, worked out from its dates every time (nothing is stored that could drift):
 *   trial       inside its free trial
 *   active      paid up (or on a free plan)
 *   due_soon    trial or period ends within 7 days
 *   grace       the period ended but the shop can still work; pay soon
 *   locked      grace is over: the shop can look at its data but not change it, until it pays
 *   suspended   switched off by Orvia
 * `endsAt` is when the current trial/period ends, `lockAt` when it locks.
 */
export function billingState(tenant, now = new Date()) {
  if (!tenant || tenant.status === 'suspended') return { state: 'suspended' };
  const override = tenant.subscription?.graceUntil ? new Date(tenant.subscription.graceUntil) : null;
  const graceDays = tenant.status === 'trial' ? TRIAL_GRACE_DAYS : env.BILLING_GRACE_DAYS;
  const endsAt = tenant.status === 'trial' ? (tenant.trialEndsAt ? new Date(tenant.trialEndsAt) : null) : tenant.subscription?.periodEnd ? new Date(tenant.subscription.periodEnd) : null;

  if (!endsAt) return { state: 'active', endsAt: null, lockAt: null, daysLeft: null }; // a free plan, or not billed yet
  const daysLeft = Math.ceil((endsAt - now) / DAY);

  if (endsAt > now) {
    const state = tenant.status === 'trial' ? (daysLeft <= WARN_DAYS ? 'due_soon' : 'trial') : daysLeft <= WARN_DAYS ? 'due_soon' : 'active';
    return { state, trial: tenant.status === 'trial', endsAt, lockAt: new Date(Math.max(endsAt.getTime() + graceDays * DAY, override?.getTime() ?? 0)), daysLeft };
  }
  const lockAt = new Date(Math.max(endsAt.getTime() + graceDays * DAY, override?.getTime() ?? 0));
  return { state: now <= lockAt ? 'grace' : 'locked', trial: tenant.status === 'trial', endsAt, lockAt, daysLeft };
}
