import { Router } from 'express';
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { runWithTenant } from '../../plugins/tenantContext.js';
import { decrypt } from '../../utils/secretBox.js';
import { PaymentSettings } from './payment-settings.model.js';
import { SaleReturn } from '../sales/sale.model.js';
import { Invoice } from '../billing/invoice.model.js';
import { markPaid } from '../billing/billing.service.js';
import { OnlinePayment } from './payment.model.js';
import { verifyWebhook } from './razorpay.js';

/**
 * Razorpay calls these when a payment is captured, even if the browser that started it was closed.
 *   /webhooks/razorpay/:tenantId   a shop with its own keys (its own webhook secret)
 *   /webhooks/razorpay             the platform's keys from the environment
 * The call is only believed if its signature matches. It only moves an order from "created" to "paid";
 * it never makes a bill by itself, so a lost browser leaves an "unclaimed payment" the owner can see.
 */
const router = Router();

async function settle(tenantId, event) {
  const entity = event?.payload?.payment?.entity;
  const orderId = entity?.order_id ?? event?.payload?.qr_code?.entity?.id; // a QR payment has no order, the QR code id stands in
  if (!orderId || !entity?.id) return;
  // Orvia's own invoices are paid to the platform account, so they come in on the platform webhook
  if (!tenantId) {
    const inv = await Invoice.findOne({ razorpayOrderId: orderId, status: 'issued' });
    if (inv && entity.amount === Math.round(inv.total * 100)) {
      await markPaid(inv._id, { method: 'razorpay', razorpayPaymentId: entity.id });
      return;
    }
  }
  const apply = async (scopedOptions) => {
    const rec = await OnlinePayment.findOne({ orderId }).setOptions(scopedOptions);
    if (!rec || rec.status !== 'created' || entity.amount !== Math.round(rec.amount * 100)) return;
    await OnlinePayment.updateOne({ _id: rec._id, status: 'created' }, { $set: { status: 'paid', paymentId: entity.id } }).setOptions(scopedOptions);
  };
  if (tenantId) await runWithTenant(tenantId, async () => await apply({}));
  else await apply({ skipTenant: true });
}

/** refund.processed / refund.failed: keep the return's UPI refund status in step with Razorpay. */
async function settleRefund(tenantId, event) {
  const rf = event?.payload?.refund?.entity;
  if (!rf?.id) return;
  const status = event.event === 'refund.processed' ? 'processed' : 'failed';
  const apply = async (opts) => {
    await SaleReturn.updateOne(
      { 'gatewayRefund.refundId': rf.id, 'gatewayRefund.status': { $in: ['pending', 'requested'] } },
      { $set: { 'gatewayRefund.status': status, 'gatewayRefund.updatedAt': new Date(), ...(status === 'failed' && { 'gatewayRefund.error': 'Razorpay could not complete the refund.' }) } },
    ).setOptions(opts);
  };
  if (tenantId) await runWithTenant(tenantId, async () => await apply({}));
  else await apply({ skipTenant: true });
}

async function handle(req, res, tenantId) {
  const signature = req.get('x-razorpay-signature');
  let secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (tenantId) {
    if (!mongoose.isValidObjectId(tenantId)) return res.status(404).json({ message: 'Not found' });
    const s = await runWithTenant(tenantId, async () => await PaymentSettings.findOne({ gateway: 'razorpay' }));
    secret = s?.webhookSecretEnc ? decrypt(s.webhookSecretEnc) : undefined;
  }
  if (!verifyWebhook(secret, req.rawBody, signature)) return res.status(400).json({ message: 'Invalid signature' });

  const event = req.body;
  if (['payment.captured', 'order.paid', 'qr_code.credited'].includes(event?.event)) await settle(tenantId, event);
  if (['refund.processed', 'refund.failed'].includes(event?.event)) await settleRefund(tenantId, event);
  return res.json({ ok: true });
}

router.post('/razorpay', (req, res, next) => handle(req, res, null).catch(next));
router.post('/razorpay/:tenantId', (req, res, next) => handle(req, res, req.params.tenantId).catch(next));

export default router;
