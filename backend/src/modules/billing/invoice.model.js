import mongoose from 'mongoose';

const oid = mongoose.Schema.Types.ObjectId;

// A running number for the whole platform (not per shop): INV-2026-000001
const counterSchema = new mongoose.Schema({ key: { type: String, required: true, unique: true }, seq: { type: Number, default: 0 } });
const PlatformCounter = mongoose.model('PlatformCounter', counterSchema);

export async function nextInvoiceNumber(now = new Date()) {
  const year = now.getFullYear();
  const c = await PlatformCounter.findOneAndUpdate({ key: `invoice-${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `INV-${year}-${String(c.seq).padStart(6, '0')}`;
}

/**
 * What Orvia bills a shop for its subscription. Invoices belong to the platform, not to the shop's own data,
 * so this model is not tenant-scoped: every shop-side query must name its tenantId.
 * Money is never edited: a wrong invoice is voided and a new one is issued.
 */
const invoiceSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    tenantId: { type: oid, ref: 'Tenant', required: true, index: true },
    tenantName: String, // as it was when issued
    planId: { type: oid, ref: 'Plan' },
    planName: String,
    cycle: { type: String, enum: ['monthly', 'yearly'], required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    amount: { type: Number, required: true }, // before GST
    gstPercent: { type: Number, default: 18 },
    gst: { type: Number, required: true },
    total: { type: Number, required: true },
    status: { type: String, enum: ['issued', 'paid', 'void'], default: 'issued', index: true },
    issuedAt: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    paidAt: Date,
    method: { type: String, enum: ['razorpay', 'bank', 'cash', 'upi', 'other'] },
    reference: String,
    razorpayOrderId: { type: String, index: true, sparse: true },
    razorpayPaymentId: String,
    voidReason: String,
    remindersSent: { type: Number, default: 0 },
    lastReminderAt: Date,
    markedBy: { type: oid, ref: 'User' },
  },
  { timestamps: true },
);
// one live invoice per shop per period (a voided one can be replaced)
invoiceSchema.index({ tenantId: 1, periodStart: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['issued', 'paid'] } } });
invoiceSchema.index({ razorpayPaymentId: 1 }, { unique: true, sparse: true });

export const Invoice = mongoose.model('Invoice', invoiceSchema);
