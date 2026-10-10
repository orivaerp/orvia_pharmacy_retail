import mongoose from 'mongoose';
import { tenantPlugin } from '../../plugins/tenantPlugin.js';

// An outlet (branch) of a shop. Compliance fields are per premises and optional until bills are printed.
const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    phone: { type: String, trim: true },
    drugLicenseNo: { type: String, trim: true },
    drugLicenseValidTill: Date,
    gstin: { type: String, trim: true, uppercase: true },
    pharmacistName: { type: String, trim: true },
    pharmacistRegNo: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

branchSchema.plugin(tenantPlugin);
branchSchema.index({ tenantId: 1, code: 1 }, { unique: true });

export const Branch = mongoose.model('Branch', branchSchema);
