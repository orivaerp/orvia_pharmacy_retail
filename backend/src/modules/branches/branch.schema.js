import { z } from 'zod';

const text = (max) => z.string().trim().max(max).optional();

const compliance = {
  address: text(200),
  city: text(80),
  state: text(80),
  pincode: z.string().trim().regex(/^(\d{6})?$/, 'Pincode must be 6 digits').optional(),
  phone: text(20),
  drugLicenseNo: text(60),
  drugLicenseValidTill: z.string().trim().refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Enter a valid date').optional(),
  gstin: z.string().trim().toUpperCase().regex(/^([0-9A-Z]{15})?$/, 'GSTIN must be 15 characters').optional(),
  pharmacistName: text(80),
  pharmacistRegNo: text(40),
};

export const branchCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, 'Use 2-12 letters, numbers or dashes'),
  ...compliance,
});

// the code identifies the outlet everywhere (bills, reports), so it cannot change after creation
export const branchUpdateSchema = z.object({ name: z.string().trim().min(2).max(80).optional(), ...compliance });

/** "" from a form means "clear it". */
export function cleanBranchData(data) {
  const out = { ...data };
  if ('drugLicenseValidTill' in out) out.drugLicenseValidTill = out.drugLicenseValidTill ? new Date(out.drugLicenseValidTill) : null;
  return out;
}
