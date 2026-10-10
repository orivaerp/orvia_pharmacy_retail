import mongoose from 'mongoose';
import { tenantPlugin } from '../../plugins/tenantPlugin.js';

const oid = mongoose.Schema.Types.ObjectId;

/**
 * One batch counted on the shelf. `systemAtCount` is what Orvia held when the count was typed in; the correction applied later
 * is (counted - systemAtCount), added to whatever the batch holds then, so bills made while counting are not undone.
 */
const lineSchema = new mongoose.Schema(
  {
    batchId: { type: oid, ref: 'Batch', required: true },
    productId: { type: oid, ref: 'Product', required: true },
    name: String,
    batchNo: String,
    expiryDate: Date,
    unitsPerPack: { type: Number, default: 1 },
    purchaseRate: { type: Number, default: 0 }, // per pack, for putting a value on the difference
    mrp: Number,
    countedUnits: { type: Number, required: true, min: 0 },
    systemAtCount: { type: Number, required: true, min: 0 },
    countedAt: Date,
  },
  { _id: false },
);

/** A physical stock count of one outlet: count on the shelf (blind), review the differences, then apply the corrections. */
const stockCountSchema = new mongoose.Schema(
  {
    branchId: { type: oid, ref: 'Branch', required: true },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ['OPEN', 'REVIEW', 'APPLIED', 'CANCELLED'], default: 'OPEN' },
    lines: [lineSchema],
    startedBy: { type: oid, ref: 'User' },
    startedByName: String,
    submittedAt: Date,
    appliedAt: Date,
    appliedByName: String,
    uncountedAsZero: { type: Boolean, default: false },
    // frozen when applied, so the history stays readable
    summary: {
      counted: Number,
      changed: Number,
      shortUnits: Number,
      extraUnits: Number,
      shortValue: Number, // at cost
      extraValue: Number,
      uncountedWrittenOff: Number,
    },
    note: String,
  },
  { timestamps: true },
);
stockCountSchema.plugin(tenantPlugin);
stockCountSchema.index({ tenantId: 1, branchId: 1, createdAt: -1 });
export const StockCount = mongoose.model('StockCount', stockCountSchema);
