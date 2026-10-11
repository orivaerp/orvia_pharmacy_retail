import mongoose from 'mongoose';

// Feature flags a plan can switch on. Checked server-side with requireFeature().
export const FEATURES = Object.freeze(['multiOutlet', 'onlinePayments', 'gstReports', 'barcodeBilling', 'apiAccess']);

const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    price: { type: Number, default: 0, min: 0 },
    cycle: { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
    trialDays: { type: Number, default: 0, min: 0 },
    maxOutlets: { type: Number, default: 1, min: 1 }, // null = unlimited
    maxUsers: { type: Number, default: null, min: 1 }, // null = unlimited
    maxProducts: { type: Number, default: null, min: 1 }, // null = unlimited
    maxBillsPerMonth: { type: Number, default: null, min: 1 }, // null = unlimited; counted per calendar month in India time
    features: [{ type: String, enum: FEATURES }],
    isActive: { type: Boolean, default: true },
    // shown on the website's pricing and the sign-up page (only active plans are ever offered)
    publicSignup: { type: Boolean, default: true },
    tagline: { type: String, trim: true, maxlength: 120 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Plan = mongoose.model('Plan', planSchema);

/** Placeholder plans (names/prices are examples). Edit them from the provider panel. */
export const DEFAULT_PLANS = [
  { code: 'trial', name: 'Trial', price: 0, trialDays: 14, maxOutlets: 1, maxUsers: 3, features: [], sortOrder: 1 },
  { code: 'basic', name: 'Basic', price: 999, maxOutlets: 1, maxUsers: 5, features: ['barcodeBilling'], sortOrder: 2 },
  { code: 'pro', name: 'Pro', price: 2499, maxOutlets: 3, maxUsers: 15, features: ['barcodeBilling', 'multiOutlet', 'onlinePayments', 'gstReports'], sortOrder: 3 },
  { code: 'enterprise', name: 'Enterprise', price: 7999, maxOutlets: null, maxUsers: null, features: [...FEATURES], sortOrder: 4 },
];
