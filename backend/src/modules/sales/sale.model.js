import mongoose from 'mongoose';
import { tenantPlugin } from '../../plugins/tenantPlugin.js';

const oid = mongoose.Schema.Types.ObjectId;

export const PAY_MODES = ['CASH', 'UPI', 'CARD', 'CREDIT'];

// One bill line is one batch: a product sold from two batches shows as two lines (each has its own expiry and MRP).
const lineSchema = new mongoose.Schema(
  {
    productId: { type: oid, ref: 'Product', required: true },
    batchId: { type: oid, ref: 'Batch', required: true },
    name: { type: String, required: true },
    schedule: { type: String, default: 'OTC' },
    hsn: String,
    batchNo: { type: String, required: true },
    expiryDate: { type: Date, required: true },
    unitsPerPack: { type: Number, default: 1 },
    units: { type: Number, required: true, min: 1 }, // sold, in units
    returnedUnits: { type: Number, default: 0 },
    mrp: { type: Number, required: true }, // per pack, GST included
    discountPct: { type: Number, default: 0 },
    gstPercent: { type: Number, default: 0 },
    gross: { type: Number, required: true }, // units x MRP/pack, GST included
    discount: { type: Number, default: 0 },
    taxable: { type: Number, required: true },
    gst: { type: Number, required: true },
    total: { type: Number, required: true }, // gross - discount
    // what the units cost the shop (purchase rate of the batch, before GST), fixed when the bill is made; costKnown is false when the batch had no purchase rate
    cost: Number,
    costKnown: Boolean,
  },
  { _id: false },
);

const saleSchema = new mongoose.Schema(
  {
    number: { type: String, required: true },
    branchId: { type: oid, ref: 'Branch', required: true, index: true },
    customerId: { type: oid, ref: 'Customer', index: true },
    customerName: { type: String, trim: true },
    customerPhone: { type: String, trim: true },
    // required by law for Schedule H / H1 sales
    prescriber: {
      doctorName: String,
      regNo: String,
      patientName: String,
      patientAge: Number,
      address: String,
    },
    lines: { type: [lineSchema], required: true },
    totals: {
      gross: Number,
      discount: Number,
      taxable: Number,
      gst: Number,
      roundOff: Number,
      grand: Number,
    },
    payments: [{ _id: false, mode: { type: String, enum: PAY_MODES, required: true }, amount: { type: Number, required: true, min: 0 }, reference: String, gateway: String, orderId: String, paymentId: String }],
    status: { type: String, enum: ['COMPLETED', 'RETURNED', 'CANCELLED'], default: 'COMPLETED' },
    // a cancelled bill keeps its number; its stock went back and every part of the payment was refunded
    // the secret in the link the customer gets (WhatsApp); no token = the bill is not shared
    shareToken: { type: String },
    cancelledAt: Date,
    cancelReason: String,
    cancelledByName: String,
    soldBy: { type: oid, ref: 'User' },
    soldByName: String,
  },
  { timestamps: true },
);
saleSchema.plugin(tenantPlugin);
saleSchema.index({ tenantId: 1, number: 1 }, { unique: true });
saleSchema.index({ shareToken: 1 }, { unique: true, partialFilterExpression: { shareToken: { $type: 'string' } } });
saleSchema.index({ tenantId: 1, branchId: 1, createdAt: -1 });
export const Sale = mongoose.model('Sale', saleSchema);

const returnSchema = new mongoose.Schema(
  {
    number: { type: String, required: true },
    saleId: { type: oid, ref: 'Sale', required: true, index: true },
    saleNumber: String,
    customerId: { type: oid, ref: 'Customer', index: true },
    branchId: { type: oid, ref: 'Branch', required: true },
    reason: { type: String, trim: true },
    lines: [{ _id: false, batchId: oid, name: String, batchNo: String, units: Number, refund: Number }],
    refund: { type: Number, required: true },
    refundMode: { type: String, enum: PAY_MODES, default: 'CASH' },
    // set when the money goes back to the customer's UPI through Razorpay
    gatewayRefund: {
      paymentId: String,
      refundId: String,
      amount: Number,
      status: { type: String, enum: ['requested', 'pending', 'processed', 'failed'] },
      error: String,
      updatedAt: Date,
    },
    createdBy: { type: oid, ref: 'User' },
  },
  { timestamps: true },
);
returnSchema.index({ 'gatewayRefund.refundId': 1 }, { sparse: true });
returnSchema.plugin(tenantPlugin);
returnSchema.index({ tenantId: 1, number: 1 }, { unique: true });
export const SaleReturn = mongoose.model('SaleReturn', returnSchema);

// A bill put on hold at the counter (customer stepped away). No stock is taken until it is billed.
const holdSchema = new mongoose.Schema(
  {
    branchId: { type: oid, ref: 'Branch', required: true, index: true },
    heldBy: { type: oid, ref: 'User' },
    heldByName: String,
    label: { type: String, trim: true },
    customerName: { type: String, trim: true },
    customerPhone: { type: String, trim: true },
    prescriber: { doctorName: String, regNo: String, patientName: String, patientAge: Number, address: String },
    lines: [{ _id: false, productId: { type: oid, required: true }, name: String, batchId: oid, packs: Number, loose: Number, discountPct: Number }],
  },
  { timestamps: true },
);
holdSchema.plugin(tenantPlugin);
export const HeldBill = mongoose.model('HeldBill', holdSchema);
