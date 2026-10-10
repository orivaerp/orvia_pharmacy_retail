import mongoose from 'mongoose';
import { FORMS } from './medicine.model.js';

// A shop's suggestion for a medicine that is missing from the master catalog.
// Not tenant-plugin scoped: provider staff read these across all shops.
const requestSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, // the shop's private product, linked once approved
    name: { type: String, required: true, trim: true },
    brand: { type: String, trim: true },
    barcode: { type: String, trim: true },
    referenceMrp: Number,
    composition: { type: String, trim: true },
    strength: { type: String, trim: true, default: '' },
    form: { type: String, enum: FORMS, default: 'tablet' },
    manufacturer: { type: String, trim: true },
    gstPercent: Number,
    schedule: String,
    notes: { type: String, trim: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'merged'], default: 'pending', index: true },
    medicineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Medicine' }, // set on approve / merge
    reviewNote: String,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
  },
  { timestamps: true },
);

export const MedicineRequest = mongoose.model('MedicineRequest', requestSchema);
