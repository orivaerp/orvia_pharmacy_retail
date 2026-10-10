import mongoose from 'mongoose';
import { tenantPlugin } from '../../plugins/tenantPlugin.js';

const oid = mongoose.Schema.Types.ObjectId;

/** "Do not remind this customer about this medicine again": for one purchase. A newer purchase of it starts reminders again. */
const refillDismissalSchema = new mongoose.Schema(
  {
    customerId: { type: oid, ref: 'Customer', required: true },
    productId: { type: oid, ref: 'Product', required: true },
    boughtOn: { type: Date, required: true }, // the purchase it was set aside for
    createdBy: { type: oid, ref: 'User' },
  },
  { timestamps: true },
);
refillDismissalSchema.plugin(tenantPlugin);
refillDismissalSchema.index({ tenantId: 1, customerId: 1, productId: 1, boughtOn: 1 }, { unique: true });
export const RefillDismissal = mongoose.model('RefillDismissal', refillDismissalSchema);
