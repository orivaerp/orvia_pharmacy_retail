import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/tokens.js';
import { runWithTenant } from '../plugins/tenantContext.js';
import { permissionsForRole } from '../constants/permissions.js';
import { Tenant } from '../modules/tenants/tenant.model.js';
import { billingState } from '../modules/billing/billing.state.js';
import { platform2faRequired } from '../modules/auth/twofactor.policy.js';
import { User } from '../modules/users/user.model.js';

/** Verifies the JWT, attaches req.user and opens the tenant context for the rest of the request. */
export function authenticate(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(ApiError.unauthorized('Missing access token'));

  try {
    const claims = verifyAccessToken(token);
    req.user = {
      id: claims.sub,
      role: claims.role,
      tenantId: claims.tenantId ?? null,
      permissions: claims.permissions ?? [],
      branchIds: claims.branchIds ?? [],
    };
  } catch {
    return next(ApiError.unauthorized('Invalid or expired access token'));
  }

  runWithTenant(req.user.tenantId, next);
}

/** Requires every listed permission. */
export const requirePermission = (...needed) => (req, _res, next) => {
  const has = new Set(req.user?.permissions);
  return needed.every((p) => has.has(p)) ? next() : next(ApiError.forbidden('Insufficient permissions'));
};

/** Requires at least one of the listed permissions. */
export const requireAny = (...options) => (req, _res, next) => {
  const has = new Set(req.user?.permissions);
  return options.some((p) => has.has(p)) ? next() : next(ApiError.forbidden('Insufficient permissions'));
};

/** Routes that only make sense inside a shop (tenant). */
export function requireTenant(req, _res, next) {
  return req.user?.tenantId ? next() : next(ApiError.forbidden('Tenant context required'));
}

/** Routes only platform (service provider) staff may use. */
export function requirePlatform(req, _res, next) {
  return req.user?.tenantId ? next(ApiError.forbidden('Platform access only')) : next();
}

/**
 * For shop users, on every request: the shop must not be suspended, and the user must still be active.
 * Role and outlets are re-read from the database, so changes (a new role, a closed account, different
 * outlets) apply immediately instead of waiting for the token to expire.
 */
export async function requireActiveTenant(req, _res, next) {
  if (!req.user.tenantId) {
    // Orvia staff: a deactivated account or a changed role takes effect at once, and two-step verification can be required
    const staff = await User.findOne({ _id: req.user.id, tenantId: null }).select('role isActive twoFactor.enabled');
    if (!staff || !staff.isActive) return next(ApiError.unauthorized('This account is no longer active'));
    req.user.role = staff.role;
    req.user.permissions = permissionsForRole(staff.role);
    if (platform2faRequired() && !staff.twoFactor?.enabled) return next(ApiError.forbidden('Set up two-step verification to continue.'));
    return next();
  }
  const [tenant, user] = await Promise.all([
    Tenant.findById(req.user.tenantId).select('status trialEndsAt subscription'),
    User.findOne({ _id: req.user.id, tenantId: req.user.tenantId }).select('role branchIds isActive'),
  ]);
  if (!tenant || tenant.status === 'suspended') return next(ApiError.forbidden('This shop account is suspended'));
  if (!user || !user.isActive) return next(ApiError.unauthorized('This account is no longer active'));
  // subscription over: reading and paying still work, changing things does not
  if (billingState(tenant).state === 'locked' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !/^\/api\/v1\/(billing|auth)(\/|$)/.test(req.originalUrl.split('?')[0])) {
    return next(new ApiError(402, "Your subscription has ended, so changes are switched off. You can still see everything. Ask the shop owner to pay the invoice under Billing."));
  }
  req.user.role = user.role;
  req.user.permissions = permissionsForRole(user.role);
  req.user.branchIds = user.branchIds.map(String);
  next();
}

/**
 * Outlets this user may work in: null = all (the owner and anyone with no restriction),
 * otherwise the list of outlet ids they are assigned to.
 */
export const branchScope = (req) => (req.user?.branchIds?.length ? req.user.branchIds : null);

/** Throws unless the user may work in this outlet. */
export function assertBranchAllowed(req, branchId) {
  const scope = branchScope(req);
  if (scope && !scope.includes(String(branchId))) throw ApiError.forbidden('You do not have access to this outlet');
}
