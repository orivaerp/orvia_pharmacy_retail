import mongoose from 'mongoose';
import { tenantPlugin } from '../../plugins/tenantPlugin.js';
import { FORMS, SCHEDULES } from '../medicines/medicine.model.js';

/**
 * A shop's inventory item. Either linked to the master catalog (masterId set: medicine facts are
 * read from the master, so a fix there reaches every shop) or a private custom product that
 * carries its own facts until the provider approves it into the catalog.
 */
const productSchema = new mongoose.Schema(
  {
    masterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine', default: null },
    isCustom: { type: Boolean, default: false },

    // own facts: only used by custom products
    name: { type: String, trim: true },
    brand: { type: String, trim: true },
    referenceMrp: { type: Number, min: 0 },
    composition: [{ type: String, trim: true }],
    strength: { type: String, trim: true },
    form: { type: String, enum: FORMS },
    unitsPerPack: { type: Number, min: 1, default: 1 },
    manufacturer: { type: String, trim: true },
    hsn: { type: String, trim: true },
    gstPercent: { type: Number, enum: [0, 5, 12, 18, 28] },
    schedule: { type: String, enum: SCHEDULES },
    barcodes: [{ type: String, trim: true }],

    // shop's own settings (apply to both kinds)
    reorderLevel: { type: Number, min: 0, default: 0 },
    maxLevel: { type: Number, min: 0, default: 0 }, // packs to stock up to when ordering (0 = not set)
    location: { type: String, trim: true, default: '' },
    looseSelling: { type: Boolean, default: false },
    // a regular medicine (sugar, BP ...): how many days ONE pack lasts a customer. 0 = no refill reminder.
    refillDays: { type: Number, min: 0, max: 365, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

productSchema.plugin(tenantPlugin);
// one product per master medicine per shop
productSchema.index({ tenantId: 1, masterId: 1 }, { unique: true, partialFilterExpression: { masterId: { $type: 'objectId' } } });
productSchema.index({ tenantId: 1, name: 1 });

export const Product = mongoose.model('Product', productSchema);

const FACT_FIELDS = ['name', 'composition', 'strength', 'form', 'unitsPerPack', 'manufacturer', 'hsn', 'gstPercent', 'schedule'];

/** Flattens a product (with its master populated) into what the UI needs. */
export function toView(product) {
  const master = product.masterId && typeof product.masterId === 'object' && product.masterId.name ? product.masterId : null;
  const facts = Object.fromEntries(FACT_FIELDS.map((f) => [f, (master ?? product)[f]]));
  return {
    _id: product._id,
    masterId: master?._id ?? product.masterId ?? null,
    isCustom: !master,
    category: master?.category ?? '',
    brand: (master ?? product).brand ?? '',
    referenceMrp: (master ?? product).referenceMrp,
    ...facts,
    // barcodes: the catalog's, plus any this shop scanned and saved for the product
    barcodes: [...new Set([...(master?.barcodes ?? []), ...(product.barcodes ?? [])])],
    ownBarcodes: product.barcodes ?? [], // the ones this shop saved (the shop may remove these; the catalog's it may not)
    reorderLevel: product.reorderLevel,
    maxLevel: product.maxLevel ?? 0,
    location: product.location,
    looseSelling: product.looseSelling,
    refillDays: product.refillDays ?? 0,
    isActive: product.isActive,
    createdAt: product.createdAt,
  };
}
