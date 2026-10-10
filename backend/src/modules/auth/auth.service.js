import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { permissionsForRole } from '../../constants/permissions.js';
import { ApiError } from '../../utils/ApiError.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/tokens.js';
import { Tenant } from '../tenants/tenant.model.js';
import { sendNotice } from '../mail/account-mail.js';
import { Invite, createInvite, hashToken } from './invite.model.js';
import { User } from '../users/user.model.js';
import { platform2faRequired } from './twofactor.policy.js';
import { assertCode } from './twofactor.service.js';

const INVALID = 'Invalid email or password';

function buildSession(user) {
  const permissions = permissionsForRole(user.role);
  const tenantId = user.tenantId ? String(user.tenantId) : null;
  const branchIds = (user.branchIds ?? []).map(String); // empty = all outlets (the owner)
  const claims = { sub: String(user._id), role: user.role, tenantId, permissions, branchIds };
  return {
    accessToken: signAccessToken(claims),
    refreshToken: signRefreshToken({ sub: claims.sub }),
    user: {
      id: claims.sub,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId,
      permissions,
      branchIds,
      twoFactorEnabled: Boolean(user.twoFactor?.enabled),
      // Orvia staff without two-step verification may only open the security page until it is set up
      mustSetup2fa: !tenantId && platform2faRequired() && !user.twoFactor?.enabled,
    },
  };
}

// Dev-only: say WHY a login failed in the server log (the API response stays generic).
const reject = (reason, email) => {
  if (env.NODE_ENV !== 'production') console.warn(`[login] rejected for "${email}": ${reason}`);
  return ApiError.unauthorized(INVALID);
};

async function assertShopActive(tenantId) {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant || tenant.status === 'suspended') throw ApiError.forbidden('This shop account is suspended');
}

/**
 * Shop code is optional. Without it we look the email up across all shops and platform staff and keep
 * the accounts whose password matches. One match logs in; several (same email + password in more than
 * one shop) means the user must say which shop. Ambiguity is only revealed after the password matched,
 * so this cannot be used to discover which shops an email belongs to.
 */
async function findLoginUser({ email, password, shopCode }) {
  const lower = email.toLowerCase();

  if (shopCode) {
    const tenant = await Tenant.findOne({ code: shopCode.toLowerCase() });
    if (!tenant) throw reject(`no shop with code "${shopCode}"`, email);
    const user = await User.findOne({ tenantId: tenant._id, email: lower }).select('+passwordHash');
    if (!user) throw reject(`no user with this email in shop "${shopCode}"`, email);
    if (!user.isActive) throw reject('user is deactivated', email);
    if (!(await user.verifyPassword(password))) throw reject('wrong password', email);
    return user;
  }

  const candidates = await User.find({ email: lower, isActive: true }).select('+passwordHash');
  if (!candidates.length) throw reject('no active user with this email', email);

  const matches = [];
  for (const u of candidates) if (await u.verifyPassword(password)) matches.push(u);
  if (!matches.length) throw reject('wrong password', email);
  if (matches.length > 1) {
    throw ApiError.conflict('This email is registered with more than one shop. Please enter your shop code.');
  }
  return matches[0];
}

// A short-lived "password was right, now prove the code" ticket. Signed with a different secret so it can never be used as an access token.
const challengeSecret = () => `${env.JWT_ACCESS_SECRET}:2fa`;
const signChallenge = (userId) => jwt.sign({ sub: String(userId), typ: '2fa' }, challengeSecret(), { expiresIn: '5m' });

export async function login(credentials) {
  const user = await findLoginUser(credentials);
  if (user.tenantId) await assertShopActive(user.tenantId);

  if (user.twoFactor?.enabled) return { twoFactorRequired: true, challenge: signChallenge(user._id) };

  user.lastLoginAt = new Date();
  await user.save();
  return buildSession(user);
}

/** Second step of a sign-in: the authenticator (or a recovery) code. */
export async function loginTwoFactor({ challenge, code }) {
  let claims;
  try {
    claims = jwt.verify(challenge, challengeSecret());
    if (claims.typ !== '2fa') throw new Error('wrong type');
  } catch {
    throw ApiError.unauthorized('This sign-in has expired. Please enter your password again.');
  }
  const user = await User.findById(claims.sub).select('+twoFactor.secretEnc +twoFactor.recoveryHashes');
  if (!user || !user.isActive || !user.twoFactor?.enabled) throw ApiError.unauthorized('This sign-in has expired. Please enter your password again.');
  if (user.tenantId) await assertShopActive(user.tenantId);

  await assertCode(user, code); // throws on a wrong code and locks after too many

  user.lastLoginAt = new Date();
  await user.save();
  return buildSession(user);
}

/**
 * "Forgot password": emails a 1-hour reset link to every active account with this email (an email can belong to
 * more than one shop). It always looks the same from outside, so it cannot be used to find out who has an account.
 */
export async function forgotPassword({ email, shopCode }) {
  const filter = { email: email.toLowerCase(), isActive: true };
  if (shopCode) {
    const tenant = await Tenant.findOne({ code: shopCode.toLowerCase() });
    if (!tenant) return;
    filter.tenantId = tenant._id;
  }
  for (const user of await User.find(filter)) {
    if (user.tenantId) {
      const tenant = await Tenant.findById(user.tenantId).select('status');
      if (!tenant || tenant.status === 'suspended') continue;
    }
    await createInvite(user, { reset: true });
  }
}

export async function refresh(refreshToken) {
  let claims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }
  const user = await User.findById(claims.sub);
  if (!user || !user.isActive) throw ApiError.unauthorized('Account not available');
  // a password change ends every older session (a stolen refresh token stops working)
  if (user.passwordChangedAt && claims.iat * 1000 + 1000 < user.passwordChangedAt.getTime()) throw ApiError.unauthorized('Your password was changed. Please sign in again.');
  return buildSession(user);
}

export async function me(userId) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User not found');
  return buildSession(user).user;
}

async function findOpenInvite(token) {
  const invite = await Invite.findOne({ tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } });
  if (!invite) throw ApiError.badRequest('This invite link is invalid or has expired. Ask your provider for a new one.');
  return invite;
}

/** Details shown on the "set your password" page. */
export async function inspectInvite(token) {
  const invite = await findOpenInvite(token);
  const [user, tenant] = await Promise.all([User.findById(invite.userId), invite.tenantId ? Tenant.findById(invite.tenantId) : null]);
  if (!user) throw ApiError.badRequest('This invite link is invalid or has expired. Ask your provider for a new one.');
  return { name: user.name, email: user.email, shopName: tenant?.name ?? null };
}

/** Sets the user's password from an invite link and signs them in. */
export async function acceptInvite(token, password) {
  const invite = await findOpenInvite(token);
  const user = await User.findById(invite.userId).select('+passwordHash');
  if (!user || !user.isActive) throw ApiError.badRequest('This invite link is invalid or has expired. Ask your provider for a new one.');
  if (user.tenantId) await assertShopActive(user.tenantId);

  const hadAccount = Boolean(user.lastLoginAt);
  const needsCode = Boolean(user.twoFactor?.enabled);
  user.passwordHash = await User.hashPassword(password);
  user.passwordChangedAt = new Date();
  if (!needsCode) user.lastLoginAt = new Date();
  await user.save();
  invite.usedAt = new Date();
  await invite.save();
  if (hadAccount) await sendNotice(user, 'your password was changed');
  // an emailed link must not skip two-step verification: they sign in again with password + code
  if (needsCode) return { passwordSet: true, twoFactorRequired: true };
  return buildSession(user);
}
