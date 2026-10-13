import { settings } from '../settings/settings.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { Branch } from '../branches/branch.model.js';
import { auditEvent } from '../audit/audit.model.js';
import { Invite } from '../auth/invite.model.js';
import { Plan } from '../plans/plan.model.js';
import { Tenant } from '../tenants/tenant.model.js';
import { createTenant } from '../tenants/tenant.service.js';
import { User } from '../users/user.model.js';

/**
 * The trial a plan gives: its own number of days if the provider set one, otherwise the sign-up default (SIGNUP_TRIAL_DAYS, 14)
 * for a paid plan. A free plan has no trial: it is simply free.
 */
export const trialDaysFor = (plan) => (plan.trialDays > 0 ? plan.trialDays : plan.price > 0 ? settings().signupTrialDays : 0);

const view = (p) => ({
  code: p.code,
  name: p.name,
  tagline: p.tagline ?? '',
  price: p.price,
  cycle: p.cycle,
  gstPercent: settings().billingGstPercent, // the price is before GST
  trialDays: trialDaysFor(p),
  maxOutlets: p.maxOutlets,
  maxUsers: p.maxUsers,
  maxProducts: p.maxProducts,
  maxBillsPerMonth: p.maxBillsPerMonth,
  features: p.features,
});

/** The plans to show on the website and on the sign-up page: active ones the provider chose to offer, in the provider's order. */
export async function publicPlans() {
  const plans = await Plan.find({ isActive: true, publicSignup: { $ne: false } }).sort({ sortOrder: 1, price: 1 }).lean();
  return plans.map(view);
}

const tenDigits = (v) => {
  const d = String(v ?? '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? d : '';
};

/**
 * Makes a shop on a free trial of the chosen plan, and emails the owner a link to set a password.
 * The link goes ONLY to that email, never back to the browser, so nobody can take over a shop by typing someone else's address.
 * One trial per email address and per phone number.
 */
export async function signup(input, { ip } = {}) {
  const plan = await Plan.findOne({ code: input.planCode.toLowerCase(), isActive: true, publicSignup: { $ne: false } });
  if (!plan) throw ApiError.badRequest('That plan is not available. Please choose another.');
  const email = input.email.toLowerCase();
  const phone = tenDigits(input.phone);
  if (!phone) throw ApiError.badRequest('Enter a 10-digit mobile number.');
  if (await User.exists({ email })) throw ApiError.conflict('This email is already registered. Sign in, or use "Forgot password" if you do not remember the password.');
  if (await Tenant.exists({ phone })) throw ApiError.conflict('A shop with this mobile number is already registered. Sign in, or contact us if this is a mistake.');

  const now = new Date();
  const { tenant, emailSent } = await createTenant(
    { name: input.shopName, planId: plan._id, ownerName: input.ownerName, ownerEmail: email, phone, address: input.city || undefined, signupSource: 'self', termsAcceptedAt: now },
    { trialDays: trialDaysFor(plan) },
  );

  if (!emailSent) {
    // the owner could never set a password, so do not leave an orphan shop behind
    await Promise.all([
      Invite.deleteMany({ tenantId: tenant._id }),
      Branch.deleteMany({ tenantId: tenant._id }).setOptions({ skipTenant: true }),
      User.deleteMany({ tenantId: tenant._id }),
      Tenant.deleteOne({ _id: tenant._id }),
    ]);
    throw new ApiError(503, 'We could not send the email to set your password. Please check the address and try again in a few minutes.');
  }
  await auditEvent({ action: 'tenant.signup', tenantId: tenant._id, meta: { plan: plan.code, trialDays: trialDaysFor(plan), shop: tenant.name }, ip });
  return { email, shopName: tenant.name, plan: view(plan), trialEndsAt: tenant.trialEndsAt };
}
