import mongoose from 'mongoose';

// What was sent, to whom and whether it worked. Never the message itself: invite and reset emails carry secret links.
const schema = new mongoose.Schema(
  {
    to: { type: String, required: true, lowercase: true },
    subject: String,
    template: String,
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    status: { type: String, enum: ['sent', 'failed', 'skipped'], required: true },
    error: String,
  },
  { timestamps: { createdAt: 'at', updatedAt: false } },
);
// emails older than 90 days are not needed
schema.index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const EmailLog = mongoose.model('EmailLog', schema);
