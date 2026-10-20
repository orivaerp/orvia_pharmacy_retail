import mongoose from 'mongoose';

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    status: { type: String, enum: ['trial', 'active', 'suspended'], default: 'active', index: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', index: true },
    trialEndsAt: Date,
    // billing: paid through periodEnd; graceUntil is a provider extension that stops a lock until then
    subscription: { startedAt: Date, periodEnd: Date, graceUntil: Date },
    // a product with no reorder level of its own counts as low at or below this many packs (0 = alert off)
    lowStockDefault: { type: Number, default: 5, min: 0 },
    extraOutlets: { type: Number, default: 0, min: 0 }, // granted by the provider on top of the plan's outlet limit
    // online UPI through the shop's own payment gateway: off for everyone until the provider switches it on for that shop
    onlineGateway: { type: Boolean, default: false },
    signupSource: { type: String, enum: ['provider', 'self'], default: 'provider' }, // who made this shop
    termsAcceptedAt: Date,
    suspendedAt: Date,
    suspendedReason: String,
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    drugLicenseNo: { type: String, trim: true },
    gstin: { type: String, trim: true, uppercase: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
  },
  { timestamps: true },
);

export const Tenant = mongoose.model('Tenant', tenantSchema);
