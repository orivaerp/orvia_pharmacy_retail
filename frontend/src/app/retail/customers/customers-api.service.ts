import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface Customer {
  _id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  creditLimit: number;
  openingBalance: number;
  isActive: boolean;
  createdAt: string;
  /** what they owe the shop now (udhaar) */
  owes: number;
  bills: number;
  spent: number;
  lastVisit: string | null;
  lastReminderAt?: string | null;
  remindersSent?: number;
}

export interface CustomerPick {
  _id: string;
  name: string;
  phone: string;
  creditLimit: number;
  owes: number;
}

export interface StatementEntry {
  kind: 'OPENING' | 'CREDIT_SALE' | 'PAYMENT' | 'RETURN';
  id: string;
  date: string;
  ref: string;
  note?: string;
  by?: string;
  amount: number;
  balance: number;
}

export interface CustomerInput {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  creditLimit?: number;
  openingBalance?: number;
}

@Injectable({ providedIn: 'root' })
export class CustomersApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/customers`;

  list(f: { q?: string; filter?: string; page?: number }) {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v) params = params.set(k, String(v));
    return this.http.get<{ items: Customer[]; total: number; page: number; limit: number; totalDue: number; remindable?: number; shopName?: string }>(this.url, { params });
  }

  search(q: string) {
    return this.http.get<CustomerPick[]>(`${this.url}/search`, { params: new HttpParams().set('q', q) });
  }

  get(id: string) {
    return this.http.get<{ customer: Customer; statement: StatementEntry[]; shop: { name: string; phone: string } }>(`${this.url}/${id}`);
  }

  create(body: CustomerInput) {
    return this.http.post<Customer>(this.url, body);
  }

  update(id: string, body: Partial<CustomerInput> & { isActive?: boolean }) {
    return this.http.patch<Customer>(`${this.url}/${id}`, body);
  }

  remind(id: string) {
    return this.http.post<{ sentTo: string; owes: number }>(`${this.url}/${id}/remind`, {});
  }

  remindAll() {
    return this.http.post<{ sent: number; noEmail: number; recent: number; failed: number; failures: string[] }>(`${this.url}/remind-all`, {});
  }

  receive(id: string, body: { amount: number; receivedOn: string; mode: string; reference?: string; note?: string; branchId?: string }) {
    return this.http.post<{ amount: number }>(`${this.url}/${id}/payments`, body);
  }
}

/** A WhatsApp link with the reminder already typed. It opens the owner's own WhatsApp; nothing is sent until they press send there. */
export function whatsappReminder(shopName: string, name: string, phone: string, owes: number): string | null {
  if (!phone) return null;
  const text = `Hello ${name}, this is a reminder from ${shopName || 'our pharmacy'}: ₹${owes.toLocaleString('en-IN', { maximumFractionDigits: 2 })} is pending. Please pay when you can. Thank you.`;
  return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
}
