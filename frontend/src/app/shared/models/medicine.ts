export const FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'injection', 'ointment', 'cream', 'gel', 'drops', 'inhaler', 'powder', 'sachet', 'lotion', 'spray', 'other'] as const;
export const SCHEDULES = ['OTC', 'H', 'H1', 'X', 'NDPS'] as const;
export const GST_RATES = [0, 5, 12, 18, 28] as const;

export type MedicineStatus = 'verified' | 'pending' | 'inactive';

/** Entry in the platform's master catalog. */
export interface Medicine {
  _id: string;
  name: string;
  brand?: string;
  composition: string[];
  strength: string;
  form: string;
  unitsPerPack: number;
  manufacturer: string;
  hsn: string;
  gstPercent: number;
  schedule: string;
  category: string;
  barcodes: string[];
  externalCode?: string;
  referenceMrp?: number;
  status: MedicineStatus;
  source: string;
  version: number;
}

export type CatalogItem = Medicine & { added: boolean };

/** A shop's inventory item (master facts already merged in by the API). */
export interface Product {
  _id: string;
  masterId: string | null;
  isCustom: boolean;
  name: string;
  brand?: string;
  category: string;
  composition: string[];
  strength: string;
  form: string;
  unitsPerPack: number;
  manufacturer: string;
  hsn: string;
  gstPercent: number;
  schedule: string;
  barcodes: string[];
  /** the barcodes this shop saved itself (removable); the rest come from the catalog */
  ownBarcodes?: string[];
  referenceMrp?: number;
  reorderLevel: number;
  maxLevel?: number;
  /** days one pack lasts a regular customer (0 = no refill reminder) */
  refillDays?: number;
  location: string;
  looseSelling: boolean;
  isActive: boolean;
  createdAt: string;
}

export const SCHEDULE_CLASS: Record<string, string> = {
  OTC: 'bg-tone-lime',
  H: 'bg-tone-lavender',
  H1: 'bg-tone-rose',
  X: 'bg-tone-rose',
  NDPS: 'bg-tone-rose',
};
