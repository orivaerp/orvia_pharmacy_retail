import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { decrypt } from '../../utils/secretBox.js';
import { PaymentSettings } from './payment-settings.model.js';

/**
 * Razorpay adapter. Everything gateway-specific lives here so another gateway can be added beside it later.
 * Keys come from the shop's own saved settings when it has them, otherwise from the server environment.
 */
const API = 'https://api.razorpay.com/v1';

/** @typedef {{ keyId: string, keySecret: string, webhookSecret?: string, source: 'shop' | 'platform' }} Creds */

export const modeOf = (keyId) => (String(keyId).startsWith('rzp_live_') ? 'live' : 'test');

/**
 * The shop's OWN Razorpay keys (call inside the tenant context), or null while the shop has not added any.
 * The money from a customer always goes to the shop's account, never to Orvia's: Orvia's keys (platformCreds) are only for the shop's subscription invoices.
 */
export async function credsForShop() {
  const s = await PaymentSettings.findOne({ gateway: 'razorpay' });
  if (!s) return null;
  return { keyId: s.keyId, keySecret: decrypt(s.keySecretEnc), webhookSecret: s.webhookSecretEnc ? decrypt(s.webhookSecretEnc) : undefined, source: 'shop' };
}

export function platformCreds() {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return null;
  return { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET, source: 'platform' };
}

async function call(creds, method, path, body) {
  if (!creds) throw ApiError.badRequest('Add your own Razorpay keys (Accounts > Payments) to collect UPI online.');
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { authorization: 'Basic ' + Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64'), 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(502, 'Could not reach the payment gateway. Please try again.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status === 401 ? 400 : 502, res.status === 401 ? 'Razorpay rejected these keys.' : (json?.error?.description ?? 'The payment gateway refused the request.'));
    err.gatewayStatus = res.status;
    throw err;
  }
  return json;
}

/** Creates a payment order. `amountPaise` is an integer number of paise. */
export const createOrder = (creds, { amountPaise, receipt, notes }) => call(creds, 'POST', '/orders', { amount: amountPaise, currency: 'INR', receipt, notes });

export const fetchPayment = (creds, paymentId) => call(creds, 'GET', `/payments/${encodeURIComponent(paymentId)}`);

export const capturePayment = (creds, paymentId, amountPaise) => call(creds, 'POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency: 'INR' });

/** A single-use QR for a fixed amount. The customer scans it with any UPI app; no Checkout window is needed. */
export const createQr = (creds, { amountPaise, name, description, closeBy, notes }) =>
  call(creds, 'POST', '/payments/qr_codes', { type: 'upi_qr', name, usage: 'single_use', fixed_amount: true, payment_amount: amountPaise, description, close_by: closeBy, notes });

export const fetchQrPayments = (creds, qrId) => call(creds, 'GET', `/payments/qr_codes/${encodeURIComponent(qrId)}/payments`);

export const closeQr = (creds, qrId) => call(creds, 'POST', `/payments/qr_codes/${encodeURIComponent(qrId)}/close`);

/** Sends money back to the customer's UPI. The refund id and status come back; "pending" settles later. */
export const refundPayment = (creds, paymentId, { amountPaise, notes, receipt }) =>
  call(creds, 'POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, speed: 'normal', notes, receipt });

export const listRefunds = (creds, paymentId) => call(creds, 'GET', `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`);

/** A cheap read that proves a pair of keys is accepted by Razorpay. */
export const checkKeys = (creds) => call(creds, 'GET', '/orders?count=1');

const hmac = (secret, data) => crypto.createHmac('sha256', secret ?? '').update(data).digest('hex');
const same = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Checks the signature Razorpay Checkout returns, proving the payment belongs to this order. */
export const verifySignature = (creds, orderId, paymentId, signature) => same(hmac(creds.keySecret, `${orderId}|${paymentId}`), signature);

/** Checks a webhook call really came from Razorpay (HMAC of the raw body with the webhook secret). */
export const verifyWebhook = (secret, rawBody, signature) => Boolean(secret) && Buffer.isBuffer(rawBody) && same(hmac(secret, rawBody), signature);
