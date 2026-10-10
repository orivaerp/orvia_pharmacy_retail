import mongoose from 'mongoose';
import { tenantPlugin } from '../../plugins/tenantPlugin.js';

/**
 * A shop's own payment gateway keys, so UPI money goes to the shop's own account.
 * Secrets are stored encrypted (see utils/secretBox.js) and are never returned by the API.
 */
const schema = new mongoose.Schema(
  {
    gateway: { type: String, default: 'razorpay' },
    keyId: { type: String, required: true, trim: true },
    keySecretEnc: { type: String, required: true },
    webhookSecretEnc: String,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
schema.plugin(tenantPlugin);
schema.index({ tenantId: 1, gateway: 1 }, { unique: true });

export const PaymentSettings = mongoose.model('PaymentSettings', schema);
