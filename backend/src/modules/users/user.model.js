import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { DEFAULT_ROLES } from '../../constants/permissions.js';

// Users span both levels: platform staff have tenantId = null, shop staff belong to one tenant.
// Because of that this model is NOT wrapped by the tenant plugin; always scope by tenantId explicitly.
const userSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.keys(DEFAULT_ROLES), required: true },
    branchIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
    passwordChangedAt: Date, // sessions started before this are refused at refresh
    // two-step verification (authenticator app). Secrets are encrypted and never selected by default.
    twoFactor: {
      enabled: { type: Boolean, default: false },
      secretEnc: { type: String, select: false },
      pendingSecretEnc: { type: String, select: false },
      recoveryHashes: { type: [String], select: false },
      enabledAt: Date,
      lastStep: Number, // the last authenticator code step used: a code works once
      failed: { type: Number, default: 0 },
      lockedUntil: Date,
    },
  },
  { timestamps: true },
);

userSchema.index({ tenantId: 1, email: 1 }, { unique: true });

userSchema.statics.hashPassword = (plain) => bcrypt.hash(plain, 12);
userSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

export const User = mongoose.model('User', userSchema);
