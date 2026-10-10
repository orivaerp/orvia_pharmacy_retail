import mongoose from 'mongoose';
import { tenantPlugin } from '../../plugins/tenantPlugin.js';

const oid = mongoose.Schema.Types.ObjectId;

export const ORDER_STATUSES = ['DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED'];

const lineSchema = new mongoose.Schema(
  {
    productId: { type: oid, ref: 'Product', required: true },
    name: { type: String, required: true }, // kept as written so an old order stays readable
    manufacturer: String,
    packs: { type: Number, required: true, min: 1 }, // ordered
    rate: { type: Number, min: 0 }, // the rate expected per pack, before GST (optional)
    receivedPacks: { type: Number, default: 0, min: 0 }, // arrived so far (billed and free packs)
  },
  { _id: false },
);

/**
 * A purchase order: what the shop asked a supplier to send. It moves DRAFT, SENT, then PARTIAL or RECEIVED as supplier invoices
 * are booked against it (Purchases > New purchase from the order). A short supply can be CLOSED; an order nothing came for can be CANCELLED.
 */
const orderSchema = new mongoose.Schema(
  {
    number: { type: String, required: true },
    supplierId: { type: oid, ref: 'Supplier', required: true, index: true },
    supplierName: String,
    branchId: { type: oid, ref: 'Branch', required: true, index: true }, // the outlet the goods are for
    status: { type: String, enum: ORDER_STATUSES, default: 'DRAFT', index: true },
    lines: { type: [lineSchema], validate: [(l) => l.length > 0, 'An order needs at least one product'] },
    notes: { type: String, trim: true },
    expectedOn: String, // YYYY-MM-DD, when the shop hopes it arrives
    sentAt: Date,
    sentVia: String,
    sentCount: { type: Number, default: 0 },
    purchaseIds: [{ type: oid, ref: 'Purchase' }],
    closedAt: Date,
    closeReason: String,
    closedByName: String,
    createdBy: { type: oid, ref: 'User' },
    createdByName: String,
  },
  { timestamps: true },
);
orderSchema.plugin(tenantPlugin);
orderSchema.index({ tenantId: 1, number: 1 }, { unique: true });
orderSchema.index({ tenantId: 1, createdAt: -1 });
export const PurchaseOrder = mongoose.model('PurchaseOrder', orderSchema);
