import mongoose from 'mongoose';

// A shop asking the provider for more outlets than its plan allows.
// Not tenant-plugin scoped: provider staff read these across all shops (shop routes filter by tenantId themselves).
const requestSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    count: { type: Number, required: true, min: 1, max: 20 },
    note: { type: String, trim: true, maxlength: 300 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    grantedCount: Number,
    reviewNote: String,
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    handledAt: Date,
  },
  { timestamps: true },
);

export const OutletRequest = mongoose.model('OutletRequest', requestSchema);
