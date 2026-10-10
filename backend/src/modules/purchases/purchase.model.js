import mongoose from 'mongoose';
import { tenantPlugin } from '../../plugins/tenantPlugin.js';

const oid = mongoose.Schema.Types.ObjectId;

// ---- numbering: PUR-000001, PRN-000001 ... one running number per shop and kind ----
const counterSchema = new mongoose.Schema({ key: { type: String, required: true }, seq: { type: Number, default: 0 } });
counterSchema.plugin(tenantPlugin);
counterSchema.index({ tenantId: 1, key: 1 }, { unique: true });
export const Counter = mongoose.model('Counter', counterSchema);

/** Next number for this shop. Call inside the same transaction as the document that uses it. */
export async function nextNumber(session, key, prefix) {
  const c = await Counter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { upsert: true, new: true, session });
  return `${prefix}-${String(c.seq).padStart(6, '0')}`;
}

// ---- suppliers ----
const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    contactPerson: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    gstin: { type: String, trim: true, uppercase: true },
    drugLicenseNo: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    creditDays: { type: Number, default: 0, min: 0 },
    openingBalance: { type: Number, default: 0 }, // owed to the supplier when the shop started using Orvia
    notes: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
supplierSchema.plugin(tenantPlugin);
supplierSchema.index({ tenantId: 1, name: 1 });
export const Supplier = mongoose.model('Supplier', supplierSchema);

// ---- purchase invoices (they also receive the stock) ----
const lineSchema = new mongoose.Schema(
  {
    productId: { type: oid, ref: 'Product', required: true },
    batchId: { type: oid, ref: 'Batch' },
    name: String, // product name at the time, so old invoices stay readable
    batchNo: { type: String, required: true },
    expiryDate: Date,
    mrp: Number,
    rate: Number, // per pack, before discount and GST
    discountPct: { type: Number, default: 0 },
    gstPercent: Number,
    packs: Number, // billed packs
    freePacks: { type: Number, default: 0 }, // received free, not billed
    taxable: Number,
    gst: Number,
    total: Number,
  },
  { _id: false },
);

const purchaseSchema = new mongoose.Schema(
  {
    number: { type: String, required: true },
    branchId: { type: oid, ref: 'Branch', required: true, index: true },
    supplierId: { type: oid, ref: 'Supplier', required: true, index: true },
    supplierName: String,
    invoiceNo: { type: String, required: true, trim: true },
    invoiceDate: { type: Date, required: true },
    dueDate: Date,
    lines: [lineSchema],
    totals: { gross: Number, discount: Number, taxable: Number, gst: Number, roundOff: Number, grand: Number },
    notes: { type: String, trim: true },
    orderId: { type: oid, ref: 'PurchaseOrder' }, // the purchase order this invoice was booked against
    orderNumber: String,
    createdBy: { type: oid, ref: 'User' },
  },
  { timestamps: true },
);
purchaseSchema.plugin(tenantPlugin);
purchaseSchema.index({ tenantId: 1, number: 1 }, { unique: true });
purchaseSchema.index({ tenantId: 1, supplierId: 1, invoiceNo: 1 }, { unique: true }); // the same supplier invoice cannot be booked twice
purchaseSchema.index({ tenantId: 1, invoiceDate: -1 });
export const Purchase = mongoose.model('Purchase', purchaseSchema);

// ---- money paid to a supplier ----
const paymentSchema = new mongoose.Schema(
  {
    supplierId: { type: oid, ref: 'Supplier', required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    paidOn: { type: Date, required: true },
    mode: { type: String, enum: ['CASH', 'UPI', 'BANK', 'CHEQUE', 'OTHER'], default: 'BANK' },
    reference: { type: String, trim: true },
    note: { type: String, trim: true },
    branchId: { type: oid, ref: 'Branch' }, // the outlet whose drawer the cash came from (matters for cash payments)
    createdBy: { type: oid, ref: 'User' },
  },
  { timestamps: true },
);
paymentSchema.plugin(tenantPlugin);
export const SupplierPayment = mongoose.model('SupplierPayment', paymentSchema);

// ---- stock sent back to a supplier (a debit note: reduces what the shop owes) ----
const returnSchema = new mongoose.Schema(
  {
    number: { type: String, required: true },
    branchId: { type: oid, ref: 'Branch', required: true, index: true },
    supplierId: { type: oid, ref: 'Supplier', required: true, index: true },
    supplierName: String,
    purchaseId: { type: oid, ref: 'Purchase' },
    creditNoteNo: { type: String, trim: true },
    returnedOn: { type: Date, required: true },
    reason: { type: String, trim: true },
    lines: [
      new mongoose.Schema(
        { productId: oid, batchId: oid, name: String, batchNo: String, packs: Number, rate: Number, gstPercent: Number, amount: Number, gst: Number, total: Number },
        { _id: false },
      ),
    ],
    total: { type: Number, required: true },
    createdBy: { type: oid, ref: 'User' },
  },
  { timestamps: true },
);
returnSchema.plugin(tenantPlugin);
returnSchema.index({ tenantId: 1, number: 1 }, { unique: true });
export const PurchaseReturn = mongoose.model('PurchaseReturn', returnSchema);
