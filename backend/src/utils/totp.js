import crypto from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238: 6 digits, 30 seconds, SHA-1), the kind every authenticator app
 * (Google Authenticator, Microsoft Authenticator, Authy ...) understands.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function base32Encode(buf) {
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

export function base32Decode(text) {
  let bits = '';
  for (const c of text.replace(/=+$/, '').toUpperCase()) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new Error('Not a base32 secret');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));

const hotp = (secretBytes, counter) => {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secretBytes).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 1_000_000).padStart(6, '0');
};

export const stepNow = (at = Date.now()) => Math.floor(at / 1000 / STEP_SECONDS);

/** The code for a given moment (used by tests). */
export const codeAt = (secret, at = Date.now()) => hotp(base32Decode(secret), stepNow(at));

/**
 * Checks a code, allowing one step either side for clock drift. Returns the matching step, or null.
 * `afterStep` is the last step already used: a code can never be used twice, even inside its window.
 */
export function verifyTotp(secret, code, { at = Date.now(), afterStep = -1 } = {}) {
  const clean = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const key = base32Decode(secret);
  const now = stepNow(at);
  for (const step of [now, now - 1, now + 1]) {
    if (step <= afterStep) continue;
    const expected = Buffer.from(hotp(key, step));
    const given = Buffer.from(clean);
    if (crypto.timingSafeEqual(expected, given)) return step;
  }
  return null;
}

export const otpauthUrl = ({ secret, account, issuer }) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
