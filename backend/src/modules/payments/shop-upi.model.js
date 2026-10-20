import mongoose from 'mongoose';
import { tenantPlugin } from '../../plugins/tenantPlugin.js';

/** The shop's own UPI ID and/or its printed QR picture: money goes straight to the shop's bank, the cashier confirms it by eye. */
const schema = new mongoose.Schema(
  {
    upiId: { type: String, trim: true, lowercase: true },
    payeeName: { type: String, trim: true, maxlength: 80 },
    qrImage: String, // a small PNG/JPEG as a data: URL
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
schema.plugin(tenantPlugin);

export const ShopUpi = mongoose.model('ShopUpi', schema);
