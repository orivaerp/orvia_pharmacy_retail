import { z } from 'zod';
import { FORMS, MEDICINE_STATUSES, SCHEDULES } from './medicine.model.js';

// Works for JSON bodies and CSV rows alike: "" means "not given", lists may be "a;b" or ["a","b"].
const blank = (schema) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema);
// each item may be up to `max` characters (a salt entry in a composition can be long: strengths and all)
const list = (max = 120) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.split(/[;|]/).map((s) => s.trim()).filter(Boolean) : v ?? []),
    z.array(z.string().trim().min(1).max(max, `Each item can be up to ${max} characters`)),
  );
export const COMPOSITION_MAX = 250;
const lower = (e) => z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), e);
const upper = (e) => z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), e);

export const medicineSchema = z.object({
  name: z.string().trim().min(2).max(300),
  brand: blank(z.string().trim().max(100).optional()),
  composition: list(COMPOSITION_MAX).refine((a) => a.length > 0, 'At least one salt/composition is required'),
  strength: blank(z.string().trim().max(60).default('')),
  form: lower(z.enum(FORMS)),
  unitsPerPack: blank(z.coerce.number().int().min(1).default(1)),
  manufacturer: z.string().trim().min(1).max(120),
  hsn: z.string().trim().regex(/^\d{4,8}$/, 'HSN must be 4-8 digits'),
  gstPercent: z.coerce.number().refine((v) => [0, 5, 12, 18, 28].includes(v), 'GST must be 0, 5, 12, 18 or 28'),
  schedule: blank(upper(z.enum(SCHEDULES)).default('OTC')),
  category: blank(z.string().trim().max(60).default('')),
  barcodes: list(),
  externalCode: blank(z.string().trim().max(40).optional()),
  referenceMrp: blank(z.coerce.number().min(0).optional()),
  status: blank(lower(z.enum(MEDICINE_STATUSES)).default('verified')),
});

export const medicinePatchSchema = medicineSchema.partial();
