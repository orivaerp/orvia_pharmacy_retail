import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { ApiError } from '../../utils/ApiError.js';
import { canEncrypt, decrypt, encrypt } from '../../utils/secretBox.js';
import { newSecret, otpauthUrl, verifyTotp } from '../../utils/totp.js';
import { sendNotice } from '../mail/account-mail.js';
import { User } from '../users/user.model.js';
import { platform2faRequired } from './twofactor.policy.js';

const ISSUER = 'Orvia';
const RECOVERY_COUNT = 8;
export const MAX_FAILS = 5;
export const LOCK_MINUTES = 10;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SECRET_FIELDS = '+twoFactor.secretEnc +twoFactor.pendingSecretEnc +twoFactor.recoveryHashes';

const load = async (userId) => {
  const user = await User.findById(userId).select(`+passwordHash ${SECRET_FIELDS}`);
  if (!user) throw ApiError.notFound('User not found');
  return user;
};

/** Eight single-use codes for when the phone is lost. Shown once; only their hashes are kept. */
function makeRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_COUNT }, () => {
    const raw = crypto.randomBytes(5).toString('hex'); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map((c) => sha(c)) };
}

export async function status(userId) {
  const user = await User.findById(userId).select('tenantId twoFactor.enabled twoFactor.enabledAt +twoFactor.recoveryHashes');
  if (!user) throw ApiError.notFound('User not found');
  return {
    enabled: Boolean(user.twoFactor?.enabled),
    enabledAt: user.twoFactor?.enabledAt ?? null,
    recoveryLeft: user.twoFactor?.recoveryHashes?.length ?? 0,
    required: !user.tenantId && platform2faRequired(),
    available: canEncrypt(),
  };
}

/** Step 1: make a secret and show it as a QR. It only counts once a code from the app proves it was scanned. */
export async function begin(userId) {
  if (!canEncrypt()) throw ApiError.badRequest('Two-step verification is not enabled on this server (SETTINGS_ENCRYPTION_KEY is not set).');
  const user = await load(userId);
  if (user.twoFactor?.enabled) throw ApiError.conflict('Two-step verification is already on. Turn it off first to set it up again.');
  const secret = newSecret();
  user.set('twoFactor.pendingSecretEnc', encrypt(secret));
  await user.save();
  const url = otpauthUrl({ secret, account: user.email, issuer: ISSUER });
  return { secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

/** Step 2: the first valid code turns it on and hands out the recovery codes (once). */
export async function enable(userId, code) {
  const user = await load(userId);
  if (user.twoFactor?.enabled) throw ApiError.conflict('Two-step verification is already on.');
  if (!user.twoFactor?.pendingSecretEnc) throw ApiError.badRequest('Start the setup first.');
  const secret = decrypt(user.twoFactor.pendingSecretEnc);
  const step = verifyTotp(secret, code);
  if (step === null) throw ApiError.badRequest('That code is not right. Check the time on your phone and try again.');
  const { codes, hashes } = makeRecoveryCodes();
  user.twoFactor = { enabled: true, secretEnc: encrypt(secret), pendingSecretEnc: undefined, recoveryHashes: hashes, enabledAt: new Date(), lastStep: step, failed: 0, lockedUntil: undefined };
  await user.save();
  return { recoveryCodes: codes };
}

/** Disabling or re-issuing recovery codes needs the password AND a current code, so a stolen session cannot do it. */
async function assertOwner(user, password, code) {
  if (!(await user.verifyPassword(password ?? ''))) throw ApiError.badRequest('The password is not right.');
  await assertCode(user, code);
}

/** Accepts an authenticator code or an unused recovery code. Counts failures and locks after too many. */
export async function assertCode(user, input) {
  const t = user.twoFactor ?? {};
  if (t.lockedUntil && t.lockedUntil > new Date()) throw ApiError.forbidden('Too many wrong codes. Try again in a few minutes.');

  const raw = String(input ?? '').trim();
  let ok = false;
  if (/^\d{3}\s?\d{3}$/.test(raw)) {
    const step = verifyTotp(decrypt(t.secretEnc), raw, { afterStep: t.lastStep ?? -1 });
    if (step !== null) {
      ok = true;
      user.set('twoFactor.lastStep', step);
    }
  } else if (raw) {
    const h = sha(raw.toLowerCase());
    if ((t.recoveryHashes ?? []).includes(h)) {
      ok = true;
      user.set('twoFactor.recoveryHashes', t.recoveryHashes.filter((x) => x !== h)); // single use
    }
  }

  if (ok) {
    user.set('twoFactor.failed', 0);
    user.set('twoFactor.lockedUntil', undefined);
    await user.save();
    return;
  }
  const failed = (t.failed ?? 0) + 1;
  user.set('twoFactor.failed', failed >= MAX_FAILS ? 0 : failed);
  if (failed >= MAX_FAILS) user.set('twoFactor.lockedUntil', new Date(Date.now() + LOCK_MINUTES * 60 * 1000));
  await user.save();
  throw ApiError.badRequest(failed >= MAX_FAILS ? `Too many wrong codes. Locked for ${LOCK_MINUTES} minutes.` : 'That code is not right.');
}

export async function disable(userId, { password, code }) {
  const user = await load(userId);
  if (!user.twoFactor?.enabled) throw ApiError.badRequest('Two-step verification is not on.');
  if (!user.tenantId && platform2faRequired()) throw ApiError.forbidden('Two-step verification is required for Orvia staff and cannot be turned off.');
  await assertOwner(user, password, code);
  user.twoFactor = { enabled: false };
  await user.save();
  await sendNotice(user, 'two-step verification was turned off on your account');
}

export async function newRecoveryCodes(userId, { password, code }) {
  const user = await load(userId);
  if (!user.twoFactor?.enabled) throw ApiError.badRequest('Two-step verification is not on.');
  await assertOwner(user, password, code);
  const { codes, hashes } = makeRecoveryCodes();
  user.set('twoFactor.recoveryHashes', hashes);
  await user.save();
  return { recoveryCodes: codes };
}

/** A super admin clears someone's 2FA (lost phone and recovery codes). They set it up again at next sign-in. */
export async function resetFor(targetId) {
  const user = await User.findByIdAndUpdate(targetId, { $set: { twoFactor: { enabled: false } } });
  if (user) await sendNotice(user, 'two-step verification was cleared on your account by an administrator');
}
