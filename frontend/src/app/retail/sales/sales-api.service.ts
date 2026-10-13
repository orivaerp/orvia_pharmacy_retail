import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { Page } from '../../shared/utils/api';

export type PayMode = 'CASH' | 'UPI' | 'CARD' | 'CREDIT';
export const PAY_MODES: { id: PayMode; label: string }[] = [
  { id: 'CASH', label: 'Cash' },
  { id: 'UPI', label: 'UPI' },
  { id: 'CARD', label: 'Card' },
  { id: 'CREDIT', label: 'On credit' },
];

export interface SaleBatch {
  _id: string;
  batchNo: string;
  expiryDate: string;
  mrp: number;
  units: number;
}

export interface SaleItem {
  productId: string;
  name: string;
  composition: string[];
  manufacturer: string;
  schedule: string;
  gstPercent: number;
  unitsPerPack: number;
  looseSelling: boolean;
  barcodeMatch: boolean;
  units: number;
  mrp: number;
  batches: SaleBatch[];
}

export interface SaleLine {
  productId: string;
  batchId: string;
  name: string;
  schedule: string;
  batchNo: string;
  expiryDate: string;
  unitsPerPack: number;
  units: number;
  returnedUnits: number;
  mrp: number;
  discountPct: number;
  gstPercent: number;
  gross: number;
  discount: number;
  taxable: number;
  gst: number;
  total: number;
}

export interface SaleTotals {
  gross: number;
  discount: number;
  taxable: number;
  gst: number;
  roundOff: number;
  grand: number;
}

export interface Prescriber {
  doctorName?: string;
  regNo?: string;
  patientName?: string;
  patientAge?: number;
  address?: string;
}

export interface SaleRow {
  _id: string;
  number: string;
  createdAt: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  branchId: { _id: string; name: string; code: string } | null;
  totals: SaleTotals;
  payments: { mode: PayMode; amount: number }[];
  status: 'COMPLETED' | 'RETURNED' | 'CANCELLED';
  soldByName?: string;
  /** B2B when the customer has a GSTIN; interState means the tax is IGST */
  supplyType?: 'B2C' | 'B2B';
  buyerGstin?: string;
  interState?: boolean;
  cancelReason?: string;
  cancelledByName?: string;
  cancelledAt?: string;
}

/** What is needed to send a customer the link to their bill. */
export interface ShareInfo {
  url: string;
  number: string;
  date: string;
  total: number;
  customerName: string;
  phone: string;
  shopName: string;
  shopPhone: string;
}

export interface SaleDetail extends SaleRow {
  /** a link to this bill has been given to the customer */
  shared?: boolean;
  lines: SaleLine[];
  prescriber?: Prescriber;
  branchId: { _id: string; name: string; code: string; address?: string; city?: string; state?: string; pincode?: string; phone?: string; gstin?: string; drugLicenseNo?: string; pharmacistName?: string; pharmacistRegNo?: string } | null;
  shop?: { name: string; address?: string; phone?: string; gstin?: string; drugLicenseNo?: string } | null;
  /** the part of this bill paid through Razorpay, and how much of it can still go back to the customer's UPI */
  gateway?: { paymentId: string; amount: number; remaining: number } | null;
  returns: {
    _id: string;
    number: string;
    createdAt: string;
    reason: string;
    refund: number;
    refundMode: PayMode;
    lines: { name: string; batchNo: string; units: number; refund: number }[];
    gatewayRefund?: { status?: 'requested' | 'pending' | 'processed' | 'failed'; error?: string; amount?: number };
  }[];
}

export interface SaleInput {
  branchId: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  prescriber?: Prescriber;
  lines: { productId: string; batchId?: string; packs: number; loose?: number; discountPct: number }[];
  payments: { mode: PayMode; amount: number; orderId?: string }[];
}

export interface UpiOrder {
  orderId: string;
  keyId: string;
  amountPaise: number;
}

export interface DashboardData {
  sales: {
    today: number;
    changePct: number | null;
    billsToday: number;
    month: number;
    billsMonth: number;
    week: { date: string; label: string; value: number }[];
    byMode: { mode: PayMode; value: number }[];
    recent: { _id: string; number: string; customerName?: string; items: number; firstItem?: string; modes: PayMode[]; total: number; status: string; outlet?: string; createdAt: string }[];
  } | null;
  stock: { products: number; inStock: number; low: number; out: number; expiring30: number; expired: number } | null;
}

export interface HeldBill {
  _id: string;
  label?: string;
  customerName?: string;
  customerPhone?: string;
  heldByName?: string;
  createdAt: string;
  prescriber?: Prescriber;
  lines: { productId: string; name?: string; batchId?: string; packs: number; loose?: number; discountPct: number }[];
}

@Injectable({ providedIn: 'root' })
export class SalesApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/sales`;

  dashboard(branchId: string) {
    return this.http.get<DashboardData>(`${this.url}/dashboard`, { params: branchId ? new HttpParams().set('branchId', branchId) : new HttpParams() });
  }

  upiEnabled() {
    return this.http.get<{ enabled: boolean }>(`${environment.apiUrl}/payments/upi/config`);
  }

  upiOrder(branchId: string, amount: number) {
    return this.http.post<UpiOrder>(`${environment.apiUrl}/payments/upi/orders`, { branchId, amount });
  }

  upiQr(branchId: string, amount: number) {
    return this.http.post<{ qrId: string; imageUrl: string; amount: number; expiresAt: string }>(`${environment.apiUrl}/payments/upi/qr`, { branchId, amount });
  }

  upiQrStatus(qrId: string) {
    return this.http.get<{ status: 'waiting' | 'paid'; paymentId?: string; amount?: number }>(`${environment.apiUrl}/payments/upi/qr/${qrId}`);
  }

  upiQrClose(qrId: string) {
    return this.http.post<{ status: string }>(`${environment.apiUrl}/payments/upi/qr/${qrId}/close`, {});
  }

  upiVerify(body: { orderId: string; paymentId: string; signature: string }) {
    return this.http.post<{ orderId: string; paymentId: string; amount: number }>(`${environment.apiUrl}/payments/upi/verify`, body);
  }

  holds(branchId: string) {
    return this.http.get<HeldBill[]>(`${this.url}/holds`, { params: new HttpParams().set('branchId', branchId) });
  }

  hold(body: Omit<HeldBill, '_id' | 'createdAt' | 'heldByName'> & { branchId: string }) {
    return this.http.post<HeldBill>(`${this.url}/holds`, body);
  }

  discardHold(id: string) {
    return this.http.delete<{ ok: boolean }>(`${this.url}/holds/${id}`);
  }

  search(branchId: string, q: string) {
    return this.http.get<SaleItem[]>(`${this.url}/search`, { params: new HttpParams().set('branchId', branchId).set('q', q) });
  }

  create(body: SaleInput) {
    return this.http.post<{ _id: string; number: string; totals: SaleTotals }>(this.url, body);
  }

  list(f: { branchId?: string; q?: string; from?: string; to?: string; page?: number }) {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v) params = params.set(k, String(v));
    return this.http.get<Page<SaleRow>>(this.url, { params });
  }

  listForCustomer(customerId: string) {
    return this.http.get<Page<SaleRow>>(this.url, { params: new HttpParams().set('customerId', customerId).set('limit', 50) });
  }

  get(id: string) {
    return this.http.get<SaleDetail>(`${this.url}/${id}`);
  }

  returnItems(id: string, body: { reason: string; refundMode: PayMode | 'GATEWAY'; lines: { batchId: string; units: number }[] }) {
    return this.http.post<{ number: string; refund: number; gatewayRefund?: { status?: string; error?: string } }>(`${this.url}/${id}/returns`, body);
  }

  share(id: string) {
    return this.http.post<ShareInfo>(`${this.url}/${id}/share`, {});
  }

  unshare(id: string) {
    return this.http.delete<{ shared: boolean }>(`${this.url}/${id}/share`);
  }

  cancel(id: string, reason: string) {
    return this.http.post<{ number: string; returns: { number: string; refund: number; refundMode: string; gatewayRefund?: { status?: string; error?: string } }[] }>(`${this.url}/${id}/cancel`, { reason });
  }

  retryRefund(saleId: string, returnId: string) {
    return this.http.post<{ gatewayRefund?: { status?: string; error?: string } }>(`${this.url}/${saleId}/returns/${returnId}/retry-refund`, {});
  }
}
