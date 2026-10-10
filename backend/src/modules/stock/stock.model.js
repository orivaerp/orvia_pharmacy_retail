import mongoose from 'mongoose';
import { tenantPlugin } from '../../plugins/tenantPlugin.js';

/**
 * Quantities are stored in UNITS (a tablet, a bottle ...), the smallest thing that can be sold.
 * Stock is entered and shown in packs (strips, bottles); packs x unitsPerPack = units. This keeps loose selling
 * possible later without changing stored data.
 */

// One physical lot of a product in one outlet. `quantity` is a cache of the ledger sum for that batch.
const batchSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    batchNo: { type: String, required: true, trim: true, uppercase: true },
    expiryDate: { type: Date, required: true },
    mrp: { type: Number, required: true, min: 0 },
    purchaseRate: { type: Number, default: 0, min: 0 }, // per pack, latest purchase
    unitsPerPack: { type: Number, default: 1, min: 1 },
    quantity: { type: Number, default: 0, min: 0 }, // units; can never go negative
  },
  { timestamps: true },
);
batchSchema.plugin(tenantPlugin);
batchSchema.index({ tenantId: 1, productId: 1, branchId: 1, batchNo: 1 }, { unique: true });
batchSchema.index({ tenantId: 1, branchId: 1, expiryDate: 1 });

export const Batch = mongoose.model('Batch', batchSchema);

/** Why stock is adjusted. "out" reasons only reduce stock, "in" only add, "both" either way. */
export const ADJUST_REASONS = {
  BREAKAGE: 'out',
  EXPIRED: 'out',
  DAMAGED: 'out',
  LOSS: 'out',
  FOUND: 'in',
  COUNT_CORRECTION: 'both',
  OTHER: 'both', // needs a note
};

export const LEDGER_TYPES = ['OPENING', 'PURCHASE', 'PURCHASE_RETURN', 'SALE', 'RETURN', 'ADJUST', 'TRANSFER_IN', 'TRANSFER_OUT'];

// Append-only record of every stock movement. Current stock can always be rebuilt from this.
const ledgerSchema = new mongoose.Schema(
  {
    type: { type: String, enum: LEDGER_TYPES, required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    qty: { type: Number, required: true }, // units, + in / - out
    unitsPerPack: { type: Number, default: 1 },
    purchaseRate: Number,
    mrp: Number,
    reference: { type: String, trim: true }, // supplier invoice no. etc.
    supplierName: { type: String, trim: true },
    note: { type: String, trim: true },
    reason: { type: String, trim: true }, // why an adjustment was made
    transferId: { type: String, index: true }, // ties the OUT and IN rows of one transfer together
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: 'at', updatedAt: false } },
);
ledgerSchema.plugin(tenantPlugin);

const FORBIDDEN = ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'];
for (const op of FORBIDDEN) {
  ledgerSchema.pre(op, function () {
    throw new Error('The stock ledger is append-only: add a correcting entry instead of changing history');
  });
}

export const StockLedger = mongoose.model('StockLedger', ledgerSchema);

/** Last moment of the given month (stock is entered as MM/YYYY and is valid through that month). */
export function endOfMonth(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
}
