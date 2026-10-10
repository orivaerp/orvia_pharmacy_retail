import mongoose from 'mongoose';

/**
 * One reason-based, time-limited, read-only look into a shop by a provider staff member.
 * Deliberately NOT tenant-plugin scoped: provider staff create these, and the shop's owner reads its own.
 * Rows are never edited by anyone except to count views and mark the end; nothing deletes them.
 */
const supportSessionSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: { type: String, required: true }, // kept so the shop still sees who it was
    reason: { type: String, required: true, trim: true, minlength: 10, maxlength: 300 },
    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    endedAt: Date,
    views: { type: Number, default: 0 },
    areas: [String], // which parts were opened: suppliers, purchases, stock ...
    lastViewAt: Date,
  },
  { timestamps: false },
);

export const SUPPORT_MINUTES = 30;
export const SupportSession = mongoose.model('SupportSession', supportSessionSchema);
