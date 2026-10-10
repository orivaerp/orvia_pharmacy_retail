import { HttpClient } from '@angular/common/http';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';
import { ORDER_STATUS } from './orders';

interface Detail {
  _id: string;
  number: string;
  status: 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';
  supplierName: string;
  supplier: { name: string; phone?: string; email?: string; contactPerson?: string } | null;
  branchName?: string;
  notes?: string;
  expectedOn?: string;
  createdAt: string;
  createdByName?: string;
  sentAt?: string;
  sentVia?: string;
  sentCount: number;
  closedAt?: string;
  closeReason?: string;
  closedByName?: string;
  packs: number;
  pendingPacks: number;
  estimate: number;
  lines: { productId: string; name: string; manufacturer?: string; packs: number; rate: number | null; receivedPacks: number; pendingPacks: number }[];
  purchases: { _id: string; number: string; invoiceNo: string; invoiceDate: string; totals: { grand: number } }[];
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const tenDigits = (v?: string) => {
  const d = String(v ?? '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? d : '';
};

/** One purchase order: send it, receive the goods against it, or close it. */
@Component({
  selector: 'app-order-detail',
  imports: [RouterLink, CurrencyPipe, DatePipe],
  template: `
    <a routerLink="/retail/purchase-orders" class="text-xs text-ink-soft hover:text-ink">&larr; Purchase orders</a>

    @if (error()) { <p role="alert" class="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-2 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (o(); as o) {
      <div class="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="flex items-center gap-2 text-xl font-medium tracking-tight sm:text-2xl">{{ o.number }} <span class="badge" [class]="status[o.status].cls">{{ status[o.status].label }}</span></h1>
          <p class="mt-0.5 text-xs text-ink-soft">To <b class="text-ink">{{ o.supplierName }}</b> for {{ o.branchName }} · written {{ o.createdAt | date: 'dd MMM yyyy' }}{{ o.createdByName ? ' by ' + o.createdByName : '' }}@if (o.expectedOn) { · wanted by {{ o.expectedOn | date: 'dd MMM yyyy' : 'UTC' }} }</p>
          @if (o.sentAt) { <p class="text-[11px] text-ink-soft">Sent {{ o.sentCount }} time{{ o.sentCount === 1 ? '' : 's' }}, last on {{ o.sentAt | date: 'dd MMM, HH:mm' }} ({{ o.sentVia }}).</p> }
          @if (o.closeReason) { <p class="text-[11px] text-ink-soft">{{ o.status === 'CANCELLED' ? 'Cancelled' : 'Closed' }} by {{ o.closedByName }} on {{ o.closedAt | date: 'dd MMM yyyy' }}: {{ o.closeReason }}</p> }
        </div>
        <div class="flex flex-wrap gap-2">
          @if (open(o) && canWrite()) {
            @if (o.status === 'DRAFT') { <a [routerLink]="['/retail/purchase-orders', o._id, 'edit']" class="btn btn-ghost">Change</a> }
            <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="whatsapp(o)">{{ o.sentCount ? 'Send again on WhatsApp' : 'Send on WhatsApp' }}</button>
            <button type="button" class="btn btn-ghost" [disabled]="busy() || !o.supplier?.email" [attr.title]="o.supplier?.email ? null : 'This supplier has no email address'" (click)="email(o)">Email to supplier</button>
            <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="print(o)">Print</button>
            <a [routerLink]="['/retail/purchases/new']" [queryParams]="{ order: o._id }" class="btn btn-primary">Receive goods</a>
          } @else { <button type="button" class="btn btn-ghost" (click)="print(o)">Print</button> }
        </div>
      </div>

      <section class="card mt-3">
        <div class="overflow-x-auto">
          <table class="w-full min-w-136 text-left">
            <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Product</th><th class="py-1.5 pr-3 text-right font-normal">Ordered</th><th class="py-1.5 pr-3 text-right font-normal">Received</th><th class="py-1.5 pr-3 text-right font-normal">Still to come</th><th class="py-1.5 text-right font-normal">Rate</th></tr></thead>
            <tbody>
              @for (l of o.lines; track l.productId) {
                <tr class="border-t border-line text-xs">
                  <td class="py-2 pr-3 font-medium">{{ l.name }}<div class="text-[11px] font-normal text-ink-soft">{{ l.manufacturer }}</div></td>
                  <td class="py-2 pr-3 text-right">{{ l.packs }}</td>
                  <td class="py-2 pr-3 text-right">{{ l.receivedPacks }}</td>
                  <td class="py-2 pr-3 text-right" [class]="l.pendingPacks && !open(o) ? 'text-red-700' : ''">{{ l.pendingPacks }}</td>
                  <td class="py-2 text-right">{{ l.rate !== null ? (l.rate | currency: 'INR' : 'symbol' : '1.2-2') : '-' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-xs text-ink-soft">{{ o.packs }} packs ordered, {{ o.pendingPacks }} still to come@if (o.estimate) { · about {{ o.estimate | currency: 'INR' : 'symbol' : '1.0-0' }} before GST }</p>
        @if (o.notes) { <p class="mt-1 text-xs">Note: {{ o.notes }}</p> }
      </section>

      @if (o.purchases.length) {
        <section class="card mt-3">
          <h2 class="text-sm font-medium">Invoices booked against this order</h2>
          <ul class="mt-1 divide-y divide-line text-xs">
            @for (p of o.purchases; track p._id) { <li class="flex justify-between py-1.5"><a [routerLink]="['/retail/purchases', p._id]" class="underline">{{ p.number }} · supplier invoice {{ p.invoiceNo }}</a><span>{{ p.invoiceDate | date: 'dd MMM yyyy' : 'UTC' }} · {{ p.totals.grand | currency: 'INR' : 'symbol' : '1.0-0' }}</span></li> }
          </ul>
        </section>
      }

      @if (open(o) && canWrite()) {
        <section class="card mt-3">
          <h2 class="text-sm font-medium">{{ o.status === 'PARTIAL' ? 'Not everything is coming?' : 'Changed your mind?' }}</h2>
          <div class="mt-2 flex flex-wrap items-end gap-2">
            <input class="field w-72 !py-1" maxlength="200" placeholder="Reason" aria-label="Reason" [value]="reason()" (input)="reason.set($any($event.target).value)" />
            @if (o.status === 'PARTIAL') {
              @if (canApprove()) { <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="close(o)">Close as short supplied</button> }
              <p class="text-[11px] text-ink-soft">Part of this order has arrived, so it cannot be cancelled. The owner or a manager can close it: the rest is no longer expected.</p>
            } @else { <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="cancel(o)">Cancel order</button> }
          </div>
        </section>
      }
    }
  `,
})
export class OrderDetail {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly url = `${environment.apiUrl}/purchase-orders`;

  readonly id = input.required<string>();
  protected readonly status = ORDER_STATUS;
  protected readonly o = signal<Detail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly reason = signal('');
  private shop = { name: '', phone: '' };

  constructor() {
    this.http.get<{ name: string; phone: string }>(`${environment.apiUrl}/shop`).subscribe({ next: (s) => (this.shop = s), error: () => undefined });
    effect(() => this.load(this.id()));
  }

  protected open(o: Detail) {
    return o.status === 'DRAFT' || o.status === 'SENT' || o.status === 'PARTIAL';
  }
  protected canWrite() {
    return this.auth.hasPermission('purchase.create');
  }
  protected canApprove() {
    return this.auth.hasPermission('purchase.approve');
  }

  private load(id: string) {
    this.http.get<Detail>(`${this.url}/${id}`).subscribe({ next: (o) => this.o.set(o), error: (e) => this.error.set(apiError(e)) });
  }

  /** the order as plain text, for WhatsApp */
  private text(o: Detail) {
    const date = o.expectedOn ? new Date(`${o.expectedOn}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';
    return [
      `Purchase order ${o.number} from ${this.shop.name || 'our pharmacy'}`,
      o.branchName ? `For: ${o.branchName}` : '',
      date ? `Wanted by: ${date}` : '',
      '',
      ...o.lines.map((l, i) => `${i + 1}. ${l.name}${l.manufacturer ? ' (' + l.manufacturer + ')' : ''}: ${l.packs} pack${l.packs === 1 ? '' : 's'}`),
      o.notes ? `\nNote: ${o.notes}` : '',
      '',
      'Please confirm availability and rates. Thank you.',
      this.shop.phone ? `Call us on ${this.shop.phone}.` : '',
    ]
      .filter((x, i, a) => x !== '' || (a[i - 1] !== '' && i > 0))
      .join('\n');
  }

  private act(path: string, body: unknown, done: string) {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.http.post(`${this.url}/${this.id()}/${path}`, body).subscribe({
      next: () => {
        this.busy.set(false);
        this.reason.set('');
        this.notice.set(done);
        this.load(this.id());
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected whatsapp(o: Detail) {
    let phone = tenDigits(o.supplier?.phone);
    if (!phone) {
      phone = tenDigits(prompt('This supplier has no phone number saved. WhatsApp number (10 digits):') ?? '');
      if (!phone) return;
    }
    window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(this.text(o))}`, '_blank', 'noopener');
    this.act('send', { via: 'whatsapp' }, 'WhatsApp opened with the order. Press send there; the order is marked as sent.');
  }

  protected email(o: Detail) {
    this.act('send', { via: 'email' }, `The order was emailed to ${o.supplier?.email}. Replies come to your email.`);
  }

  protected print(o: Detail) {
    const w = window.open('', '_blank', 'width=760,height=800');
    if (!w) return this.error.set('The print window was blocked. Allow pop-ups for this site.');
    const rows = o.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}${l.manufacturer ? `<br><small>${esc(l.manufacturer)}</small>` : ''}</td><td class="r">${l.packs}</td><td class="r">${l.rate !== null ? l.rate.toFixed(2) : ''}</td></tr>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.number)}</title><style>body{font:13px/1.5 system-ui,sans-serif;max-width:680px;margin:20px auto;color:#000}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:4px 6px;text-align:left;border-bottom:1px solid #999;vertical-align:top}.r{text-align:right}small{color:#444}@page{margin:12mm}</style></head><body>
<h1>${esc(this.shop.name || 'Purchase order')}</h1><p>${this.shop.phone ? 'Phone: ' + esc(this.shop.phone) : ''}</p>
<p><b>Purchase order ${esc(o.number)}</b> · ${new Date(o.createdAt).toLocaleDateString('en-IN')}<br>To: <b>${esc(o.supplierName)}</b>${o.supplier?.phone ? ' · ' + esc(o.supplier.phone) : ''}<br>Deliver to: ${esc(o.branchName)}${o.expectedOn ? `<br>Wanted by: ${esc(o.expectedOn)}` : ''}</p>
<table><tr><th>#</th><th>Medicine</th><th class="r">Packs</th><th class="r">Rate</th></tr>${rows}</table>
${o.notes ? `<p>Note: ${esc(o.notes)}</p>` : ''}<p style="margin-top:24px">Please confirm availability and rates.</p>
<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
    if (o.status === 'DRAFT' && this.canWrite()) this.act('send', { via: 'print' }, 'The order is marked as sent.');
  }

  protected cancel(o: Detail) {
    if (this.reason().trim().length < 3) return this.error.set('Please give a reason for cancelling.');
    if (!confirm(`Cancel order ${o.number}?`)) return;
    this.act('cancel', { reason: this.reason().trim() }, `${o.number} is cancelled.`);
  }

  protected close(o: Detail) {
    if (this.reason().trim().length < 3) return this.error.set('Please give a reason (for example: supplier is out of stock).');
    if (!confirm(`Close ${o.number}? The ${o.pendingPacks} packs still to come are no longer expected.`)) return;
    this.act('close', { reason: this.reason().trim() }, `${o.number} is closed.`);
  }
}
