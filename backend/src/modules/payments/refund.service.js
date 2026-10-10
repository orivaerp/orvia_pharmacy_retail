import { SaleReturn } from '../sales/sale.model.js';
import * as rzp from './razorpay.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The part of a bill that was collected through Razorpay (the only part that can go back the same way). */
export const gatewayPayment = (sale) => sale.payments?.find((p) => p.mode === 'UPI' && p.paymentId && p.gateway === 'razorpay') ?? null;

/** How much of that payment can still be sent back. Failed refunds do not count: that money never left. */
export async function gatewayRemaining(saleId, payment, session) {
  const q = SaleReturn.aggregate([
    { $match: { saleId, 'gatewayRefund.paymentId': payment.paymentId, 'gatewayRefund.status': { $ne: 'failed' } } },
    { $group: { _id: null, sent: { $sum: '$gatewayRefund.amount' } } },
  ]);
  if (session) q.session(session);
  const sent = (await q)[0]?.sent ?? 0;
  return r2(payment.amount - sent);
}

const statusOf = (rf) => (rf.status === 'processed' ? 'processed' : rf.status === 'failed' ? 'failed' : 'pending');

/**
 * Sends a recorded return's refund to Razorpay. Safe to call again after a failure: if an earlier attempt did reach
 * Razorpay (found by the return number in its notes) that refund is adopted instead of creating a second one.
 * Never throws: the outcome is saved on the return so the cashier sees it and can retry.
 */
export async function sendRefund(ret) {
  const g = ret.gatewayRefund;
  try {
    const creds = await rzp.credsForShop();
    if (!creds) throw new Error('Online payments are not set up for this shop.');

    let existing = null;
    try {
      existing = (await rzp.listRefunds(creds, g.paymentId)).items?.find((r) => r.notes?.orvia_return === ret.number && r.status !== 'failed') ?? null;
    } catch {
      /* cannot look: go on and try to create it */
    }
    const rf =
      existing ??
      (await rzp.refundPayment(creds, g.paymentId, {
        amountPaise: Math.round(g.amount * 100),
        notes: { orvia_return: ret.number, orvia_sale: ret.saleNumber },
        receipt: ret.number,
      }));
    g.refundId = rf.id;
    g.status = statusOf(rf);
    g.error = g.status === 'failed' ? 'Razorpay could not complete the refund.' : undefined;
  } catch (e) {
    g.status = 'failed';
    g.error = e?.message ?? 'The refund could not be sent.';
  }
  g.updatedAt = new Date();
  ret.markModified('gatewayRefund');
  await ret.save();
  return ret;
}
