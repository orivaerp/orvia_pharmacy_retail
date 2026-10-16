import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { CatalogItem, Product } from '../shared/models/medicine';
import { Limits, Outlet, OutletInput, OutletRequest } from '../shared/models/outlet';
import { Page } from '../shared/utils/api';

export type { Outlet };

export interface StaffUser {
  _id: string;
  name: string;
  email: string;
  role: string;
  branchIds: string[];
  isActive: boolean;
  lastLoginAt?: string;
}

export interface Supplier {
  _id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  drugLicenseNo?: string;
  address?: string;
  city?: string;
  state?: string;
  creditDays: number;
  openingBalance: number;
  notes?: string;
  isActive: boolean;
  /** what the shop owes this supplier now (list and statement only) */
  outstanding?: number;
  invoices?: number;
  lastInvoiceDate?: string | null;
}

export type SupplierInput = Partial<Omit<Supplier, '_id' | 'isActive' | 'outstanding' | 'invoices' | 'lastInvoiceDate'>> & { name: string };

export interface StatementEntry {
  kind: 'PURCHASE' | 'PAYMENT' | 'RETURN';
  id: string;
  date: string;
  ref: string;
  number?: string;
  dueDate?: string;
  note?: string;
  amount: number;
  balance: number;
}

export interface PurchaseTotals {
  gross: number;
  discount: number;
  taxable: number;
  gst: number;
  roundOff: number;
  grand: number;
}

export interface PurchaseRow {
  _id: string;
  number: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate?: string;
  supplierId: string;
  supplierName: string;
  branchId: { name: string } | null;
  totals: PurchaseTotals;
}

export interface PurchaseLine {
  productId: string;
  batchId?: string;
  name: string;
  batchNo: string;
  expiryDate: string;
  mrp: number;
  rate: number;
  discountPct: number;
  gstPercent: number;
  packs: number;
  freePacks: number;
  taxable: number;
  gst: number;
  total: number;
}

export interface PurchaseDetail extends Omit<PurchaseRow, 'supplierId' | 'branchId'> {
  lines: PurchaseLine[];
  notes?: string;
  orderId?: string;
  orderNumber?: string;
  branchId: { _id: string; name: string; code: string } | null;
  supplierId: { _id: string; name: string; gstin?: string; phone?: string };
  createdBy?: { name: string };
}

export interface PurchaseInput {
  branchId: string;
  supplierId: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate?: string;
  notes?: string;
  /** the purchase order this invoice is booked against */
  orderId?: string;
  lines: { productId: string; batchNo: string; expiry: string; mrp: number; rate: number; packs: number; freePacks: number; discountPct: number; gstPercent: number }[];
}

export interface SupportAccess {
  _id: string;
  by: string;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  active: boolean;
  views: number;
  areas: string[];
}

export const STAFF_ROLES: { id: string; label: string; hint: string }[] = [
  { id: 'branch_manager', label: 'Branch manager', hint: 'Runs an outlet: stock, purchases, sales, reports' },
  { id: 'pharmacist', label: 'Pharmacist', hint: 'Sells, including prescription (Schedule H) items' },
  { id: 'cashier', label: 'Cashier', hint: 'Billing only' },
  { id: 'store_keeper', label: 'Store keeper', hint: 'Stock entry and products' },
  { id: 'accountant', label: 'Accountant', hint: 'Reports' },
];

export interface CustomProduct {
  name: string;
  brand?: string;
  barcode?: string;
  referenceMrp?: number;
  composition: string[];
  strength: string;
  form: string;
  unitsPerPack: number;
  manufacturer: string;
  gstPercent: number;
  schedule: string;
  suggest: boolean;
}

export interface ProductSettings {
  reorderLevel?: number;
  maxLevel?: number;
  location?: string;
  looseSelling?: boolean;
  refillDays?: number;
  isActive?: boolean;
}

export interface StockRow {
  productId: string;
  name: string;
  composition: string[];
  manufacturer: string;
  form?: string;
  strength?: string;
  schedule: string;
  gstPercent: number;
  unitsPerPack: number;
  reorderLevel: number;
  /** what the low-stock alert really uses: the product's own level, else the shop default */
  reorderEffective: number;
  units: number;
  packs: number;
  loose: number;
  batches: number;
  nearestExpiry: string | null;
  stockStatus: 'out' | 'low' | 'ok';
  expiryStatus: 'expired' | 'soon' | 'ok' | null;
}

export interface BatchRow {
  _id: string;
  batchNo: string;
  expiryDate: string;
  mrp: number;
  purchaseRate: number;
  packs: number;
  loose: number;
  unitsPerPack: number;
  expiryStatus: 'expired' | 'soon' | 'ok';
  branchId: { _id: string; name: string; code: string } | null;
}

export interface LedgerRow {
  _id: string;
  at: string;
  type: 'OPENING' | 'PURCHASE' | 'SALE' | 'RETURN' | 'ADJUST' | 'TRANSFER_IN' | 'TRANSFER_OUT';
  product: string;
  batchNo?: string;
  expiryDate?: string;
  outlet?: string;
  units: number;
  packs: number;
  reason?: string;
  note?: string;
  reference?: string;
  supplierName?: string;
  transferId?: string;
  by?: string;
}

export interface StockEntryLine {
  productId: string;
  batchNo: string;
  expiry: string; // YYYY-MM
  mrp: number;
  purchaseRate: number;
  packs: number;
}

export interface StockEntry {
  branchId: string;
  type: 'OPENING' | 'PURCHASE';
  supplierName?: string;
  reference?: string;
  lines: StockEntryLine[];
}

@Injectable({ providedIn: 'root' })
export class RetailApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/products`;

  private params(filters: Record<string, string | number | undefined>) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') p = p.set(k, String(v));
    return p;
  }

  products(filters: { q?: string; page?: number; limit?: number }) {
    return this.http.get<Page<Product>>(this.base, { params: this.params(filters) });
  }

  catalog(filters: { q?: string; form?: string; page?: number; limit?: number }) {
    return this.http.get<Page<CatalogItem>>(`${this.base}/catalog`, { params: this.params(filters) });
  }

  addFromCatalog(medicineIds: string[]) {
    return this.http.post<{ added: number; alreadyHad: number; unavailable: number }>(`${this.base}/from-master`, { medicineIds });
  }

  createCustom(body: CustomProduct) {
    return this.http.post<Product & { suggested: boolean }>(`${this.base}/custom`, body);
  }

  updateSettings(id: string, body: ProductSettings) {
    return this.http.patch<Product>(`${this.base}/${id}`, body);
  }

  // ---- outlets and stock ----
  outlets() {
    return this.http.get<Outlet[]>(`${environment.apiUrl}/branches`);
  }

  outletUsage() {
    return this.http.get<Limits & { pendingRequest: { count: number; note?: string; at: string } | null }>(`${environment.apiUrl}/branches/usage`);
  }

  createOutlet(body: OutletInput) {
    return this.http.post<Outlet>(`${environment.apiUrl}/branches`, body);
  }

  updateOutlet(id: string, body: Partial<OutletInput>) {
    return this.http.patch<Outlet>(`${environment.apiUrl}/branches/${id}`, body);
  }

  setOutletActive(id: string, active: boolean) {
    return this.http.post<Outlet>(`${environment.apiUrl}/branches/${id}/${active ? 'activate' : 'deactivate'}`, {});
  }

  requestOutlets(count: number, note: string) {
    return this.http.post<OutletRequest>(`${environment.apiUrl}/branches/requests`, { count, note: note || undefined });
  }

  outletRequests() {
    return this.http.get<OutletRequest[]>(`${environment.apiUrl}/branches/requests`);
  }

  orderList(branchId: string) {
    return this.http.get<{ items: OrderRow[] }>(`${environment.apiUrl}/stock/order-list`, { params: branchId ? new HttpParams().set('branchId', branchId) : new HttpParams() });
  }

  lowStockDefault() {
    return this.http.get<{ packs: number }>(`${environment.apiUrl}/stock/alert-default`);
  }

  setLowStockDefault(packs: number) {
    return this.http.put<{ packs: number }>(`${environment.apiUrl}/stock/alert-default`, { packs });
  }

  stockSummary(filters: { branchId?: string; q?: string; filter?: string; page?: number; limit?: number }) {
    return this.http.get<Page<StockRow>>(`${environment.apiUrl}/stock/summary`, { params: this.params(filters) });
  }

  batches(productId: string, branchId?: string) {
    return this.http.get<BatchRow[]>(`${environment.apiUrl}/stock/batches`, { params: this.params({ productId, branchId }) });
  }

  createStockEntry(body: StockEntry) {
    return this.http.post<{ branch: { name: string }; lines: { name: string; batchNo: string; packs: number; units: number }[] }>(
      `${environment.apiUrl}/stock/entries`,
      body,
    );
  }

  // ---- staff ----
  staff() {
    return this.http.get<StaffUser[]>(`${environment.apiUrl}/users`);
  }

  addStaff(body: { name: string; email: string; role: string; branchIds: string[] }) {
    return this.http.post<{ user: StaffUser; inviteUrl: string; emailSent?: boolean }>(`${environment.apiUrl}/users`, body);
  }

  updateStaff(id: string, body: { name?: string; role?: string; branchIds?: string[] }) {
    return this.http.patch<StaffUser>(`${environment.apiUrl}/users/${id}`, body);
  }

  setStaffActive(id: string, active: boolean) {
    return this.http.post<StaffUser>(`${environment.apiUrl}/users/${id}/${active ? 'activate' : 'deactivate'}`, {});
  }

  reinviteStaff(id: string) {
    return this.http.post<{ inviteUrl: string; emailSent?: boolean }>(`${environment.apiUrl}/users/${id}/reinvite`, {});
  }

  // ---- catalog extras ----
  substitutes(medicineId: string) {
    return this.http.get<CatalogItem[]>(`${this.base}/catalog/${medicineId}/substitutes`);
  }

  saveBarcode(productId: string, barcode: string) {
    return this.http.post<Product>(`${this.base}/${productId}/barcode`, { barcode });
  }

  generateBarcode(productId: string) {
    return this.http.post<Product>(`${this.base}/${productId}/barcode/generate`, {});
  }

  removeBarcode(productId: string, barcode: string) {
    return this.http.delete<Product>(`${this.base}/${productId}/barcode`, { params: { barcode } });
  }

  // ---- adjustments, transfers, history ----
  adjustStock(body: { branchId: string; reason: string; note?: string; lines: { batchId: string; packs: number }[] }) {
    return this.http.post<{ branch: { name: string }; lines: { batchNo: string; packs: number; left: number }[] }>(`${environment.apiUrl}/stock/adjustments`, body);
  }

  transferStock(body: { fromBranchId: string; toBranchId: string; note?: string; lines: { batchId: string; packs: number }[] }) {
    return this.http.post<{ from: string; to: string; lines: { batchNo: string; packs: number }[] }>(`${environment.apiUrl}/stock/transfers`, body);
  }

  ledger(filters: { type?: string; branchId?: string; productId?: string; limit?: number }) {
    return this.http.get<LedgerRow[]>(`${environment.apiUrl}/stock/ledger`, { params: this.params(filters) });
  }

  // ---- suppliers and purchases ----
  suppliers(filters: { q?: string; active?: boolean } = {}) {
    return this.http.get<Supplier[]>(`${environment.apiUrl}/suppliers`, { params: this.params({ q: filters.q, active: filters.active ? 'true' : undefined }) });
  }

  supplierStatement(id: string) {
    return this.http.get<{ supplier: Supplier; openingBalance: number; outstanding: number; entries: StatementEntry[] }>(`${environment.apiUrl}/suppliers/${id}`);
  }

  createSupplier(body: SupplierInput) {
    return this.http.post<Supplier>(`${environment.apiUrl}/suppliers`, body);
  }

  updateSupplier(id: string, body: Partial<SupplierInput> & { isActive?: boolean }) {
    return this.http.patch<Supplier>(`${environment.apiUrl}/suppliers/${id}`, body);
  }

  paySupplier(id: string, body: { amount: number; paidOn: string; mode: string; reference?: string; note?: string; branchId?: string }) {
    return this.http.post(`${environment.apiUrl}/suppliers/${id}/payments`, body);
  }

  purchases(filters: { supplierId?: string; branchId?: string; q?: string; from?: string; to?: string; page?: number; limit?: number }) {
    return this.http.get<Page<PurchaseRow>>(`${environment.apiUrl}/purchases`, { params: this.params(filters) });
  }

  purchase(id: string) {
    return this.http.get<PurchaseDetail>(`${environment.apiUrl}/purchases/${id}`);
  }

  createPurchase(body: PurchaseInput) {
    return this.http.post<{ _id: string; number: string; totals: PurchaseTotals }>(`${environment.apiUrl}/purchases`, body);
  }

  createPurchaseReturn(body: { branchId: string; supplierId: string; purchaseId?: string; creditNoteNo?: string; returnedOn: string; reason: string; lines: { batchId: string; packs: number }[] }) {
    return this.http.post<{ number: string; total: number }>(`${environment.apiUrl}/purchase-returns`, body);
  }

  supportAccess() {
    return this.http.get<SupportAccess[]>(`${environment.apiUrl}/support-access`);
  }
}

export interface OrderRow {
  productId: string;
  name: string;
  manufacturer: string;
  packs: number;
  status: 'out' | 'low';
  reorderAt: number;
  maxLevel: number;
  suggested: number;
  soldLast30: number;
  supplierId: string | null;
  supplierName: string | null;
  lastRate: number | null;
}
