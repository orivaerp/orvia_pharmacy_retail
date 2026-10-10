import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';

/**
 * Encrypts small secrets (a shop's payment gateway keys) before they go into the database.
 * AES-256-GCM; the key is SETTINGS_ENCRYPTION_KEY (64 hex characters) from the environment, never from the database.
 * Stored form: iv.tag.cipher (all base64).
 */
const key = () => {
  const k = env.SETTINGS_ENCRYPTION_KEY;
  if (!k || !/^[0-9a-fA-F]{64}$/.test(k)) {
    throw ApiError.badRequest('Saving payment keys is not enabled on this server (SETTINGS_ENCRYPTION_KEY is not set).');
  }
  return Buffer.from(k, 'hex');
};

export const canEncrypt = () => /^[0-9a-fA-F]{64}$/.test(env.SETTINGS_ENCRYPTION_KEY ?? '');

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(stored) {
  const [iv, tag, data] = String(stored).split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}
