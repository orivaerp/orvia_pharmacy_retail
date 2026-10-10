import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';
import { PurchaseDetail as Purchase, RetailApi } from '../retail-api.service';

@Component({
  selector: 'app-purchase-detail',
  imports: [CurrencyPipe, DatePipe, RouterLink],
  template: `
    <a routerLink="/retail/purchases" class="text-xs text-ink-soft hover:text-ink">&larr; Purchases</a>

    @if (error()) { <p role="alert" class="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-2 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (p(); as x) {
      <div class="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Invoice {{ x.invoiceNo }}</h1>
          <p class="mt-0.5 text-xs text-ink-soft">
            {{ x.number }} · <a [routerLink]="['/retail/suppliers', x.supplierId._id]" class="underline">{{ x.supplierId.name }}</a> ·
            received into {{ x.branchId?.name }} · {{ x.invoiceDate | date: 'dd MMM yyyy' : 'UTC' }}
            @if (x.dueDate) { · due {{ x.dueDate | date: 'dd MMM yyyy' : 'UTC' }} }
            @if (x.createdBy) { · booked by {{ x.createdBy.name }} }
            @if (x.orderId) { · against order <a [routerLink]="['/retail/purchase-orders', x.orderId]" class="underline">{{ x.orderNumber }}</a> }
          </p>
        </div>
        @if (canWrite) { <button type="button" class="btn btn-ghost" (click)="openReturn()">Return goods</button> }
      </div>

      <section class="card mt-3">
        <div class="overflow-x-auto">
          <table class="w-full min-w-176 text-left">
            <thead><tr class="text-[11px] text-ink-soft">
              <th class="py-1.5 pr-3 font-normal">Product</th><th class="py-1.5 pr-3 font-normal">Batch</th><th class="py-1.5 pr-3 font-normal">Expiry</th>
              <th class="py-1.5 pr-3 text-right font-normal">MRP</th><th class="py-1.5 pr-3 text-right font-normal">Rate</th><th class="py-1.5 pr-3 text-right font-normal">Packs</th>
              <th class="py-1.5 pr-3 text-right font-normal">Free</th><th class="py-1.5 pr-3 text-right font-normal">Disc</th><th class="py-1.5 pr-3 text-right font-normal">GST</th><th class="py-1.5 text-right font-normal">Amount</th>
            </tr></thead>
            <tbody>
              @for (l of x.lines; track $index) {
                <tr class="border-t border-line text-xs">
                  <td class="py-1.5 pr-3 font-medium">{{ l.name }}</td>
                  <td class="py-1.5 pr-3">{{ l.batchNo }}</td>
                  <td class="py-1.5 pr-3">{{ l.expiryDate | date: 'MMM yyyy' : 'UTC' }}</td>
                  <td class="py-1.5 pr-3 text-right">{{ l.mrp | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                  <td class="py-1.5 pr-3 text-right">{{ l.rate | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                  <td class="py-1.5 pr-3 text-right">{{ l.packs }}</td>
                  <td class="py-1.5 pr-3 text-right">{{ l.freePacks || '-' }}</td>
                  <td class="py-1.5 pr-3 text-right">{{ l.discountPct ? l.discountPct + '%' : '-' }}</td>
                  <td class="py-1.5 pr-3 text-right">{{ l.gstPercent }}%</td>
                  <td class="py-1.5 text-right font-medium">{{ l.total | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <dl class="mt-3 ml-auto grid w-64 grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 text-xs">
          <dt class="text-ink-soft">Taxable value</dt><dd class="text-right">{{ x.totals.taxable | currency: 'INR' : 'symbol' : '1.2-2' }}</dd>
          <dt class="text-ink-soft">GST</dt><dd class="text-right">{{ x.totals.gst | currency: 'INR' : 'symbol' : '1.2-2' }}</dd>
          <dt class="text-ink-soft">Round off</dt><dd class="text-right">{{ x.totals.roundOff | currency: 'INR' : 'symbol' : '1.2-2' }}</dd>
          <dt class="text-sm font-medium">Invoice total</dt><dd class="text-right text-sm font-medium">{{ x.totals.grand | currency: 'INR' : 'symbol' : '1.2-2' }}</dd>
        </dl>
        @if (x.notes) { <p class="mt-2 text-xs text-ink-soft">Notes: {{ x.notes }}</p> }
      </section>
    } @else if (!error()) {
      <p class="mt-6 text-xs text-ink-soft">Loading…</p>
    }

    @if (returning(); as x) {
      <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="returning.set(null)">
        <div class="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface-solid p-5 shadow-xl" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <h2 class="text-lg font-medium">Return goods to {{ x.supplierId.name }}</h2>
          <p class="text-xs text-ink-soft">Packs you send back leave {{ x.branchId?.name }}'s stock and reduce what you owe. Credit is worked out from the batch's cost plus GST.</p>
          @if (formError()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ formError() }}</p> }

          <ul class="mt-3 divide-y divide-line text-xs">
            @for (l of x.lines; track $index; let i = $index) {
              <li class="flex items-center justify-between gap-3 py-2">
                <span><b>{{ l.name }}</b><br /><span class="text-ink-soft">batch {{ l.batchNo }} · bought {{ l.packs + l.freePacks }} packs</span></span>
                <input type="number" min="0" step="1" class="field w-20" [attr.aria-label]="'Packs to return of ' + l.name" [value]="qty[i]" (input)="qty[i] = +$any($event.target).value" />
              </li>
            }
          </ul>

          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div class="sm:col-span-2"><label class="label" for="rt-reason">Reason *</label><input id="rt-reason" class="field" [value]="reason" (input)="reason = $any($event.target).value" placeholder="e.g. Damaged, near expiry, wrong item" /></div>
            <div><label class="label" for="rt-cn">Credit note no.</label><input id="rt-cn" class="field" [value]="creditNoteNo" (input)="creditNoteNo = $any($event.target).value" /></div>
            <div><label class="label" for="rt-date">Date *</label><input id="rt-date" type="date" class="field" [value]="returnedOn" (input)="returnedOn = $any($event.target).value" /></div>
          </div>

          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="btn btn-ghost" (click)="returning.set(null)">Cancel</button>
            <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="sendReturn()">{{ busy() ? 'Saving…' : 'Return these goods' }}</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class PurchaseDetailPage {
  private readonly api = inject(RetailApi);
  private readonly auth = inject(AuthService);

  /** route param `:id` */
  id = input.required<string>();

  protected readonly p = signal<Purchase | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly returning = signal<Purchase | null>(null);
  protected readonly busy = signal(false);

  protected qty: number[] = [];
  protected reason = '';
  protected creditNoteNo = '';
  protected returnedOn = new Date().toISOString().slice(0, 10);

  protected get canWrite() {
    return this.auth.hasPermission('purchase.create');
  }

  constructor() {
    effect(() => this.load(this.id()));
  }

  private load(id: string) {
    this.api.purchase(id).subscribe({
      next: (x) => this.p.set(x),
      error: (e) => this.error.set(apiError(e)),
    });
  }

  protected openReturn() {
    const x = this.p();
    if (!x) return;
    this.qty = x.lines.map(() => 0);
    this.reason = '';
    this.creditNoteNo = '';
    this.formError.set(null);
    this.returning.set(x);
  }

  protected sendReturn() {
    const x = this.returning();
    if (!x?.branchId) return;
    const lines = x.lines.map((l, i) => ({ batchId: l.batchId ?? '', packs: Math.floor(Number(this.qty[i]) || 0) })).filter((l) => l.packs > 0);
    if (!lines.length) return this.formError.set('Enter how many packs to return for at least one line.');
    if (lines.some((l) => !l.batchId)) return this.formError.set('A line has no batch to return from.');
    if (this.reason.trim().length < 3) return this.formError.set('Give a short reason (at least 3 characters).');

    this.busy.set(true);
    this.formError.set(null);
    this.api
      .createPurchaseReturn({ branchId: x.branchId._id, supplierId: x.supplierId._id, purchaseId: x._id, creditNoteNo: this.creditNoteNo.trim() || undefined, returnedOn: this.returnedOn, reason: this.reason.trim(), lines })
      .subscribe({
        next: (r) => {
          this.busy.set(false);
          this.returning.set(null);
          this.notice.set(`Return ${r.number} saved. ₹${r.total} credited to ${x.supplierId.name}.`);
        },
        error: (e) => {
          this.busy.set(false);
          this.formError.set(apiError(e));
        },
      });
  }
}
