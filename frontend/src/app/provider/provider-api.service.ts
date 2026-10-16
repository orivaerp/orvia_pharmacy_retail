import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { Medicine, Product } from '../shared/models/medicine';
import { Limits, Outlet, OutletInput } from '../shared/models/outlet';
import { Page, apiError } from '../shared/utils/api';

export { apiError };
export type { Page };

export type ShopStatus = 'trial' | 'active' | 'suspended';

export interface Plan {
  _id: string;
  name: string;
  code: string;
  price: number;
  cycle: 'monthly' | 'yearly';
  trialDays: number;
  maxOutlets: number | null;
  maxUsers: number | null;
  maxProducts?: number | null;
  maxBillsPerMonth?: number | null;
  features: string[];
  isActive: boolean;
  /** shown on the website's pricing and the sign-up page */
  publicSignup?: boolean;
  tagline?: string;
  sortOrder: number;
}

export interface Shop {
  _id: string;
  name: string;
  code: string;
  status: ShopStatus;
  planId: Pick<Plan, '_id' | 'name' | 'code'> | null;
  ownerUserId: { name: string; email: string } | null;
  trialEndsAt?: string;
  extraOutlets?: number;
  outlets?: { used: number; limit: number | null };
  suspendedReason?: string;
  drugLicenseNo?: string;
  gstin?: string;
  phone?: string;
  address?: string;
  createdAt: string;
}

export interface ShopDetail {
  tenant: Omit<Shop, 'planId'> & { planId: Plan | null };
  usage: { outlets: number; users: number };
  users: { _id: string; name: string; email: string; role: string; isActive: boolean; lastLoginAt?: string }[];
}

export interface NewShop {
  name: string;
  code?: string;
  planId: string;
  ownerName: string;
  ownerEmail: string;
  drugLicenseNo?: string;
  gstin?: string;
  phone?: string;
  address?: string;
}

export interface DashboardStats {
  totals: { shops: number; active: number; trial: number; suspended: number; trialsEnding: number; mrr: number; outlets: number; pendingOutletRequests: number };
  planSplit: { label: string; value: number }[];
  signups: { labels: string[]; values: number[] };
  recent: (Pick<Shop, '_id' | 'name' | 'code' | 'status' | 'createdAt'> & { planId: { name: string } | null })[];
}

export type MedicinePayload = Omit<Medicine, '_id' | 'source' | 'version'>;

export interface ImportResult {
  dryRun: boolean;
  profile: { id: string; label: string; defaults: { manufacturer: string; hsn: string; gstPercent: number }; importedAs: string } | null;
  totalRows: number;
  toCreate: number;
  created: number;
  duplicates: { row: number; name?: string; reason: string }[];
  errors: { row: number; name?: string; message: string }[];
}

export interface MedicineRequest {
  _id: string;
  name: string;
  brand?: string;
  barcode?: string;
  referenceMrp?: number;
  composition?: string;
  strength: string;
  form: string;
  manufacturer?: string;
  gstPercent?: number;
  schedule?: string;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected' | 'merged';
  reviewNote?: string;
  createdAt: string;
  tenantId: { name: string; code: string } | null;
  requestedBy: { name: string; email: string } | null;
  medicineId: { name: string; strength: string; manufacturer: string } | null;
}

export interface ProviderOutletRequest {
  _id: string;
  count: number;
  note?: string;
  status: 'pending' | 'approved' | 'rejected';
  grantedCount?: number;
  reviewNote?: string;
  createdAt: string;
  tenantId: { _id: string; name: string; code: string; extraOutlets: number } | null;
  requestedBy: { name: string; email: string } | null;
  limits: Limits | null;
}

export interface SupportSessionInfo {
  sessionId: string;
  tenantId: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  views: number;
}

export const FEATURE_LABELS: Record<string, string> = {
  multiOutlet: 'Multiple outlets',
  onlinePayments: 'Online payments',
  gstReports: 'GST reports',
  barcodeBilling: 'Barcode billing',
  apiAccess: 'API access (not available yet)',
};

@Injectable({ providedIn: 'root' })
export class ProviderApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/provider`;

  stats() {
    return this.http.get<DashboardStats>(`${this.base}/dashboard/stats`);
  }

  shops(filters: { q?: string; status?: string; planId?: string; page?: number; limit?: number }) {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') params = params.set(k, String(v));
    return this.http.get<Page<Shop>>(`${this.base}/tenants`, { params });
  }

  shop(id: string) {
    return this.http.get<ShopDetail>(`${this.base}/tenants/${id}`);
  }

  createShop(body: NewShop) {
    return this.http.post<{ tenant: Shop; inviteUrl: string; emailSent?: boolean }>(`${this.base}/tenants`, body);
  }

  updateShop(id: string, body: Partial<Pick<Shop, 'name' | 'drugLicenseNo' | 'gstin' | 'phone' | 'address'>>) {
    return this.http.patch<Shop>(`${this.base}/tenants/${id}`, body);
  }

  suspend(id: string, reason: string) {
    return this.http.post<Shop>(`${this.base}/tenants/${id}/suspend`, { reason });
  }

  activate(id: string) {
    return this.http.post<Shop>(`${this.base}/tenants/${id}/activate`, {});
  }

  changePlan(id: string, planId: string) {
    return this.http.post<Shop>(`${this.base}/tenants/${id}/change-plan`, { planId });
  }

  reinvite(id: string) {
    return this.http.post<{ inviteUrl: string; emailSent?: boolean }>(`${this.base}/tenants/${id}/reinvite`, {});
  }

  plans() {
    return this.http.get<Plan[]>(`${this.base}/plans`);
  }

  createPlan(body: Omit<Plan, '_id'>) {
    return this.http.post<Plan>(`${this.base}/plans`, body);
  }

  updatePlan(id: string, body: Partial<Omit<Plan, '_id'>>) {
    return this.http.patch<Plan>(`${this.base}/plans/${id}`, body);
  }

  // ---- a shop's outlets, limits and outlet requests ----
  shopOutlets(id: string) {
    return this.http.get<{ outlets: Outlet[]; limits: Limits }>(`${this.base}/tenants/${id}/outlets`);
  }

  addShopOutlet(id: string, body: OutletInput) {
    return this.http.post<Outlet>(`${this.base}/tenants/${id}/outlets`, body);
  }

  setShopOutletActive(id: string, branchId: string, active: boolean) {
    return this.http.post<Outlet>(`${this.base}/tenants/${id}/outlets/${branchId}/${active ? 'activate' : 'deactivate'}`, {});
  }

  setExtraOutlets(id: string, extraOutlets: number) {
    return this.http.patch<Limits>(`${this.base}/tenants/${id}/limits`, { extraOutlets });
  }

  outletRequests(status: string) {
    return this.http.get<ProviderOutletRequest[]>(`${this.base}/outlet-requests`, { params: { status } });
  }

  approveOutletRequest(id: string, granted: number, note: string) {
    return this.http.post(`${this.base}/outlet-requests/${id}/approve`, { granted, note: note || undefined });
  }

  rejectOutletRequest(id: string, note: string) {
    return this.http.post(`${this.base}/outlet-requests/${id}/reject`, { note });
  }

  // ---- medicine master catalog ----
  medicines(filters: { q?: string; form?: string; status?: string; schedule?: string; manufacturer?: string; page?: number; limit?: number }) {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') params = params.set(k, String(v));
    return this.http.get<Page<Medicine>>(`${this.base}/medicines`, { params });
  }

  createMedicine(body: MedicinePayload) {
    return this.http.post<Medicine>(`${this.base}/medicines`, body);
  }

  updateMedicine(id: string, body: Partial<MedicinePayload>) {
    return this.http.patch<Medicine>(`${this.base}/medicines/${id}`, body);
  }

  importMedicines(csv: string, dryRun: boolean, defaults?: { manufacturer?: string; hsn?: string; gstPercent?: number }) {
    return this.http.post<ImportResult>(`${this.base}/medicines/import`, { csv, dryRun, defaults });
  }

  medicineSubstitutes(id: string) {
    return this.http.get<Medicine[]>(`${this.base}/medicines/${id}/substitutes`);
  }

  /** The catalog as a CSV file (the same columns Import CSV reads), narrowed by the same filters as the list. */
  exportMedicines(filters: { q?: string; form?: string; status?: string; schedule?: string; manufacturer?: string }) {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') params = params.set(k, String(v));
    return this.http.get(`${this.base}/medicines/export`, { params, responseType: 'blob' });
  }

  manufacturers(q: string) {
    return this.http.get<{ name: string; count: number }[]>(`${this.base}/medicines/manufacturers`, { params: q ? { q } : {} });
  }

  bulkMedicineStatus(body: { status: 'verified' | 'pending' | 'inactive'; ids?: string[]; filter?: { q?: string; form?: string; status?: string; manufacturer?: string } }) {
    return this.http.post<{ matched: number; updated: number }>(`${this.base}/medicines/bulk-status`, body);
  }

  // ---- shop requests for missing medicines ----
  requests(status: string, page = 1) {
    return this.http.get<Page<MedicineRequest>>(`${this.base}/medicine-requests`, { params: { status, page, limit: 20 } });
  }

  approveRequest(id: string, body: MedicinePayload) {
    return this.http.post(`${this.base}/medicine-requests/${id}/approve`, body);
  }

  mergeRequest(id: string, medicineId: string) {
    return this.http.post(`${this.base}/medicine-requests/${id}/merge`, { medicineId });
  }

  rejectRequest(id: string, note: string) {
    return this.http.post(`${this.base}/medicine-requests/${id}/reject`, { note });
  }

  // ---- support: reason-based, read-only look into a shop ----
  startSupport(shopId: string, reason: string) {
    return this.http.post<{ sessionId: string; expiresAt: string; shop: string }>(`${this.base}/tenants/${shopId}/support-sessions`, { reason });
  }

  supportInfo(sid: string) {
    return this.http.get<SupportSessionInfo>(`${this.base}/support/${sid}`);
  }

  endSupport(sid: string) {
    return this.http.post(`${this.base}/support/${sid}/end`, {});
  }

  supportGet<T>(sid: string, what: string, params: Record<string, string | number> = {}) {
    return this.http.get<T>(`${this.base}/support/${sid}/${what}`, { params });
  }
}
