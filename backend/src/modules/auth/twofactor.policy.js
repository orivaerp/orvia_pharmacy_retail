import { env } from '../../config/env.js';
import { canEncrypt } from '../../utils/secretBox.js';

/**
 * Orvia staff (platform users) must use two-step verification. On by default in production, off in development
 * (set REQUIRE_PLATFORM_2FA=true/false to override). If the server cannot store secrets (no SETTINGS_ENCRYPTION_KEY)
 * the rule is not enforced, otherwise nobody could ever set it up and everyone would be locked out.
 */
export function platform2faRequired() {
  const asked = env.REQUIRE_PLATFORM_2FA ? env.REQUIRE_PLATFORM_2FA === 'true' : env.NODE_ENV === 'production';
  return asked && canEncrypt();
}
