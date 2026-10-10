import mongoose from 'mongoose';
import { tenantPlugin } from '../../plugins/tenantPlugin.js';

/**
 * One online (UPI) collection. created: order opened, paid: gateway confirmed the money, used: attached to a bill.
 * A payment can be attached to one bill only (unique paymentId), so the same money can never pay two bills.
 */
const schema = new mongoose.Schema(
  {
    gateway: { type: String, default: 'razorpay' },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    orderId: { type: String, required: true }, // the gateway order id, or the QR code id when kind is qr
    kind: { type: String, enum: ['checkout', 'qr'], default: 'checkout' },
    paymentId: String,
    amount: { type: Number, required: true }, // rupees
    status: { type: String, enum: ['created', 'paid', 'used'], default: 'created' },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
schema.plugin(tenantPlugin);
schema.index({ tenantId: 1, orderId: 1 }, { unique: true });
schema.index({ paymentId: 1 }, { unique: true, partialFilterExpression: { paymentId: { $type: 'string' } } });

export const OnlinePayment = mongoose.model('OnlinePayment', schema);
