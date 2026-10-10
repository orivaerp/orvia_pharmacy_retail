export interface Outlet {
  _id: string;
  name: string;
  code: string;
  isActive: boolean;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  drugLicenseNo?: string;
  drugLicenseValidTill?: string | null;
  gstin?: string;
  pharmacistName?: string;
  pharmacistRegNo?: string;
  /** shown on the Outlets page */
  stockUnits?: number;
  stockProducts?: number;
  staff?: number;
}

/** What the outlet form sends. Empty strings mean "not given" (or "clear it" when editing). */
export interface OutletInput {
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  drugLicenseNo: string;
  drugLicenseValidTill: string;
  gstin: string;
  pharmacistName: string;
  pharmacistRegNo: string;
}

export interface Limits {
  plan: { name: string; maxOutlets: number | null } | null;
  extraOutlets: number;
  outlets: { used: number; limit: number | null };
  users: { used: number; limit: number | null };
}

export interface OutletRequest {
  _id: string;
  count: number;
  note?: string;
  status: 'pending' | 'approved' | 'rejected';
  grantedCount?: number;
  reviewNote?: string;
  createdAt: string;
}
