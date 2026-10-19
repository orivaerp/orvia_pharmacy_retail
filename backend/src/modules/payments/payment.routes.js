import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { PERMISSIONS as P } from '../../constants/permissions.js';
import { assertBranchAllowed, branchScope, requireAny, requirePermission, requireTenant } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { canEncrypt, encrypt } from '../../utils/secretBox.js';
import { audit } from '../audit/audit.model.js';
import { hasFeature, requireFeature } from '../plans/plan.service.js';
import { PaymentSettings } from './payment-settings.model.js';
import { OnlinePayment } from './payment.model.js';
import * as rzp from './razorpay.js';

const router = Router();
router.use(requireTenant);

const canCollect = requirePermission(P.SALES_CREATE);
const canManage = requirePermission(P.USER_MANAGE);
const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');

// ---------------------------------------------------------------- collecting at the counter
router.get('/upi/config', canCollect, async (req, res) => {
  const creds = await rzp.credsForShop();
  const included = await hasFeature(req.user.tenantId, 'onlinePayments');
  // enabled = the shop has its own keys and the plan allows it; includedInPlan with no keys makes the counter explain how to connect Razorpay
  res.json({ enabled: Boolean(creds) && included, includedInPlan: included, hasOwnKeys: Boolean(creds), mode: creds ? rzp.modeOf(creds.keyId) : null });
});

// 1. open an order for the UPI part of a bill
router.post('/upi/orders', canCollect, requireFeature('onlinePayments'), validateBody(z.object({ branchId: objectId, amount: z.number().min(1).max(200_000) })), async (req, res) => {
  assertBranchAllowed(req, req.body.branchId);
  const creds = await rzp.credsForShop();
  const amountPaise = Math.round(req.body.amount * 100);
  const order = await rzp.createOrder(creds, { amountPaise, receipt: `orv-${Date.now().toString(36)}`, notes: { tenant: String(req.user.tenantId), branch: req.body.branchId } });
  await OnlinePayment.create({ branchId: req.body.branchId, orderId: order.id, amount: amountPaise / 100, createdBy: req.user.id });
  res.status(201).json({ orderId: order.id, keyId: creds.keyId, amountPaise });
});

// 1b. a QR on screen (nothing for the customer to open): create it, then poll until it is paid
const QR_MINUTES = 10;

router.post('/upi/qr', canCollect, requireFeature('onlinePayments'), validateBody(z.object({ branchId: objectId, amount: z.number().min(1).max(200_000) })), async (req, res) => {
  assertBranchAllowed(req, req.body.branchId);
  const creds = await rzp.credsForShop();
  if (!creds) throw ApiError.badRequest('Add your own Razorpay keys (Accounts > Payments) to collect UPI online.');
  const amountPaise = Math.round(req.body.amount * 100);
  const closeBy = Math.floor(Date.now() / 1000) + QR_MINUTES * 60;
  let qr;
  try {
    qr = await rzp.createQr(creds, { amountPaise, name: 'Orvia bill', description: 'Medicine bill', closeBy, notes: { tenant: String(req.user.tenantId), branch: req.body.branchId } });
  } catch (e) {
    if (e?.status === 400 || e?.status === 502) throw ApiError.conflict(`UPI QR is not available on this Razorpay account (${e.message}). Use "Other ways to pay" instead.`);
    throw e;
  }
  await OnlinePayment.create({ branchId: req.body.branchId, orderId: qr.id, kind: 'qr', amount: amountPaise / 100, createdBy: req.user.id });
  res.status(201).json({ qrId: qr.id, imageUrl: qr.image_url, amount: amountPaise / 100, expiresAt: new Date(closeBy * 1000) });
});

router.get('/upi/qr/:qrId', canCollect, async (req, res) => {
  const rec = await OnlinePayment.findOne({ orderId: req.params.qrId, kind: 'qr' });
  if (!rec) throw ApiError.notFound('QR not found');
  assertBranchAllowed(req, rec.branchId);
  if (rec.status !== 'created') return res.json({ status: 'paid', paymentId: rec.paymentId, amount: rec.amount });

  const creds = await rzp.credsForShop();
  if (!creds) throw ApiError.badRequest('Add your own Razorpay keys (Accounts > Payments) to collect UPI online.');
  const list = await rzp.fetchQrPayments(creds, rec.orderId);
  const paid = (list.items ?? []).find((p) => p.status === 'captured' && p.amount === Math.round(rec.amount * 100));
  if (!paid) return res.json({ status: 'waiting' });
  await OnlinePayment.updateOne({ _id: rec._id, status: 'created' }, { $set: { status: 'paid', paymentId: paid.id } });
  res.json({ status: 'paid', paymentId: paid.id, amount: rec.amount });
});

// the cashier gave up: close the QR so it cannot be paid later with no bill to go with it
router.post('/upi/qr/:qrId/close', canCollect, async (req, res) => {
  const rec = await OnlinePayment.findOne({ orderId: req.params.qrId, kind: 'qr' });
  if (!rec) throw ApiError.notFound('QR not found');
  assertBranchAllowed(req, rec.branchId);
  if (rec.status === 'created') {
    try {
      await rzp.closeQr(await rzp.credsForShop(), rec.orderId);
    } catch {
      /* already closed or expired: nothing more to do */
    }
  }
  res.json({ status: rec.status });
});

// 2. after Checkout succeeds: prove the payment is real before the bill is saved
router.post(
  '/upi/verify',
  canCollect,
  validateBody(z.object({ orderId: z.string().min(5).max(60), paymentId: z.string().min(5).max(60), signature: z.string().min(10).max(200) })),
  async (req, res) => {
    const { orderId, paymentId, signature } = req.body;
    const rec = await OnlinePayment.findOne({ orderId });
    if (!rec) throw ApiError.notFound('Payment order not found');
    assertBranchAllowed(req, rec.branchId);
    if (rec.status === 'used') throw ApiError.conflict('This payment is already attached to a bill');
    const creds = await rzp.credsForShop();
    if (!creds) throw ApiError.badRequest('Add your own Razorpay keys (Accounts > Payments) to collect UPI online.');
    if (!rzp.verifySignature(creds, orderId, paymentId, signature)) throw ApiError.badRequest('The payment could not be verified');

    // trust the gateway, not the browser: ask Razorpay what really happened
    let p = await rzp.fetchPayment(creds, paymentId);
    if (p.order_id !== orderId) throw ApiError.badRequest('This payment belongs to a different order');
    if (p.status === 'authorized') p = await rzp.capturePayment(creds, paymentId, p.amount);
    if (p.status !== 'captured') throw ApiError.badRequest('The payment was not completed');
    if (p.amount !== Math.round(rec.amount * 100)) throw ApiError.badRequest('The paid amount does not match the order');

    // the webhook may have recorded it first; that is fine
    if (rec.status === 'created') {
      rec.status = 'paid';
      rec.paymentId = paymentId;
      await rec.save();
    }
    res.json({ orderId, paymentId, amount: rec.amount });
  },
);

// ---------------------------------------------------------------- money received but never put on a bill
router.get('/upi/unclaimed', requireAny(P.USER_MANAGE, P.REPORTS_VIEW), async (req, res) => {
  const scope = branchScope(req);
  const rows = await OnlinePayment.find({ status: 'paid', updatedAt: { $lt: new Date(Date.now() - 10 * 60 * 1000) }, ...(scope && { branchId: { $in: scope } }) })
    .sort({ updatedAt: -1 })
    .limit(50)
    .populate('branchId', 'name')
    .lean();
  res.json(rows.map((r) => ({ _id: r._id, orderId: r.orderId, paymentId: r.paymentId, amount: r.amount, outlet: r.branchId?.name, at: r.updatedAt })));
});

// ---------------------------------------------------------------- the shop's own gateway keys
const view = async (req) => {
  const s = await PaymentSettings.findOne({ gateway: 'razorpay' });
  const keyId = s?.keyId ?? null;
  return {
    source: s ? 'shop' : 'none',
    keyId: keyId ? `${keyId.slice(0, 13)}••••` : null,
    mode: keyId ? rzp.modeOf(keyId) : null,
    hasWebhookSecret: Boolean(s?.webhookSecretEnc),
    webhookUrl: `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/webhooks/razorpay/${req.user.tenantId}`,
    canSaveKeys: canEncrypt(),
    updatedAt: s?.updatedAt ?? null,
  };
};

router.get('/settings', canManage, async (req, res) => res.json(await view(req)));

router.put(
  '/settings',
  canManage,
  validateBody(
    z.object({
      keyId: z.string().trim().regex(/^rzp_(test|live)_[A-Za-z0-9]{8,}$/, 'That does not look like a Razorpay Key ID (rzp_test_… or rzp_live_…)'),
      keySecret: z.string().trim().min(10).max(100),
      webhookSecret: z.string().trim().min(6).max(100).optional().or(z.literal('').transform(() => undefined)),
    }),
  ),
  async (req, res) => {
    if (!canEncrypt()) throw ApiError.badRequest('Saving payment keys is not enabled on this server (SETTINGS_ENCRYPTION_KEY is not set).');
    const { keyId, keySecret, webhookSecret } = req.body;
    await rzp.checkKeys({ keyId, keySecret }); // refuses keys Razorpay does not accept
    const update = { keyId, keySecretEnc: encrypt(keySecret), updatedBy: req.user.id };
    if (webhookSecret) update.webhookSecretEnc = encrypt(webhookSecret);
    await PaymentSettings.findOneAndUpdate({ gateway: 'razorpay' }, { $set: update, $setOnInsert: { gateway: 'razorpay' } }, { upsert: true, new: true });
    await audit(req, 'payments.keys.set', req.user.tenantId, { keyId, mode: rzp.modeOf(keyId) });
    res.json(await view(req));
  },
);

router.delete('/settings', canManage, async (req, res) => {
  await PaymentSettings.deleteOne({ gateway: 'razorpay' });
  await audit(req, 'payments.keys.remove', req.user.tenantId, {});
  res.json(await view(req));
});

export default router;
