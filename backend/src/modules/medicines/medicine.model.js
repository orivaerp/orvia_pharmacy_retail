import mongoose from 'mongoose';

export const FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'injection', 'ointment', 'cream', 'gel', 'drops', 'inhaler', 'powder', 'sachet', 'lotion', 'spray', 'other'];
export const SCHEDULES = ['OTC', 'H', 'H1', 'X', 'NDPS'];
export const MEDICINE_STATUSES = ['verified', 'pending', 'inactive'];

/** Same medicine = same name + strength + form + manufacturer (case/space-insensitive). */
export const dedupeKey = (m) => {
  const base = [m.name, m.strength, m.form, m.manufacturer].map((s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
  // a supplier's own product code tells apart items that share a name (e.g. bandage sizes)
  return m.externalCode ? `${base}|#${String(m.externalCode).toLowerCase().trim()}` : base;
};

// Platform-owned catalog shared by every shop. Deliberately has no tenantId.
const medicineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    brand: { type: String, trim: true },
    composition: [{ type: String, trim: true }],
    strength: { type: String, trim: true, default: '' },
    form: { type: String, enum: FORMS, required: true },
    unitsPerPack: { type: Number, default: 1, min: 1 },
    manufacturer: { type: String, required: true, trim: true },
    hsn: { type: String, required: true, trim: true },
    gstPercent: { type: Number, required: true, enum: [0, 5, 12, 18, 28] },
    schedule: { type: String, enum: SCHEDULES, default: 'OTC' },
    category: { type: String, trim: true, default: '' },
    barcodes: [{ type: String, trim: true }],
    saltKey: { type: String, index: true }, // same salts + strength + form = substitutes
    externalCode: { type: String, trim: true, index: true }, // the supplier's own product code
    referenceMrp: { type: Number, min: 0 }, // a list price for reference only; real MRP is per batch
    status: { type: String, enum: MEDICINE_STATUSES, default: 'verified', index: true },
    source: { type: String, enum: ['manual', 'import', 'request', 'sample'], default: 'manual' },
    dedupeKey: { type: String, required: true, unique: true },
    version: { type: Number, default: 1 },
  },
  { timestamps: true },
);

// A barcode may belong to one medicine only.
medicineSchema.index({ barcodes: 1 }, { unique: true, partialFilterExpression: { barcodes: { $type: 'string' } } });

export const Medicine = mongoose.model('Medicine', medicineSchema);
