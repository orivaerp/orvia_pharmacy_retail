import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';
import { RetailApi, StatementEntry, Supplier } from '../retail-api.service';

const KIND: Record<string, { label: string; cls: string }> = {
  PURCHASE: { label: 'Invoice', cls: 'bg-tone-lavender' },
  PAYMENT: { label: 'Payment', cls: 'bg-tone-lime' },
  RETURN: { label: 'Return', cls: 'bg-tone-teal' },
};

@Component({
  selector: 'app-supplier-detail',
  imports: [CurrencyPipe, DatePipe, RouterLink],
  template: `
    <a routerLink="/retail/suppliers" class="text-xs text-ink-soft hover:text-ink">&larr; Suppliers</a>

    @if (error()) { <p role="alert" class="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-2 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (supplier(); as s) {
      <div class="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-xl font-medium tracking-tight sm:text-2xl">{{ s.name }} @if (!s.isActive) { <span class="badge bg-chip">inactive</span> }</h1>
          <p class="mt-0.5 text-xs text-ink-soft">
            {{ [s.contactPerson, s.phone, s.email].filter(hasText).join(' · ') || 'No contact details' }}<br />
            GSTIN {{ s.gstin || '-' }} · Drug licence {{ s.drugLicenseNo || '-' }} · Credit {{ s.creditDays }} days
          </p>
        </div>
        <div class="flex gap-2">
          @if (canWrite) { <a [routerLink]="['/retail/purchases/new']" [queryParams]="{ supplier: s._id }" class="btn btn-primary">+ New purchase</a> }
          @if (canPay) { <button type="button" class="btn btn-ghost" (click)="openPay()">Record payment</button> }
        </div>
      </div>

      <section class="card mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs text-ink-soft">You owe this supplier</p>
          <p class="text-2xl font-medium" [class.text-red-700]="outstanding() > 0">{{ outstanding() | currency: 'INR' : 'symbol' : '1.2-2' }}</p>
          @if (outstanding() < 0) { <p class="text-[11px] text-ink-soft">Negative means you have paid more than you owe (an advance).</p> }
        </div>
        <p class="text-[11px] text-ink-soft">Opening balance {{ s.openingBalance | currency: 'INR' : 'symbol' : '1.2-2' }} + invoices − payments − returns</p>
      </section>

      <section class="card mt-3">
        <h2 class="text-base font-medium">Statement</h2>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full min-w-136 text-left">
            <thead><tr class="text-[11px] text-ink-soft">
              <th class="py-1.5 pr-3 font-normal">Date</th><th class="py-1.5 pr-3 font-normal">Type</th><th class="py-1.5 pr-3 font-normal">Reference</th>
              <th class="py-1.5 pr-3 text-right font-normal">Amount</th><th class="py-1.5 text-right font-normal">Balance</th>
            </tr></thead>
            <tbody>
              @for (e of entries(); track e.id) {
                <tr class="border-t border-line text-xs">
                  <td class="py-1.5 pr-3 whitespace-nowrap">{{ e.date | date: 'dd MMM yyyy' : 'UTC' }}</td>
                  <td class="py-1.5 pr-3"><span class="badge" [class]="kind[e.kind].cls">{{ kind[e.kind].label }}</span></td>
                  <td class="py-1.5 pr-3">
                    @if (e.kind === 'PURCHASE') { <a [routerLink]="['/retail/purchases', e.id]" class="underline">{{ e.ref }}</a> <span class="text-[11px] text-ink-soft">{{ e.number }}</span> }
                    @else { {{ e.ref || '-' }} <span class="text-[11px] text-ink-soft">{{ e.note }}</span> }
                  </td>
                  <td class="py-1.5 pr-3 text-right" [class]="e.amount < 0 ? 'text-green-700' : ''">{{ e.amount | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                  <td class="py-1.5 text-right font-medium">{{ e.balance | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="py-6 text-center text-xs text-ink-soft">No invoices or payments yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else if (!error()) {
      <p class="mt-6 text-xs text-ink-soft">Loading…</p>
    }

    @if (paying()) {
      <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="paying.set(false)">
        <div class="w-full max-w-md rounded-2xl bg-surface-solid p-5 shadow-xl" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <h2 class="text-lg font-medium">Record payment</h2>
          <p class="text-xs text-ink-soft">Money you paid {{ supplier()?.name }}. It reduces what you owe.</p>
          @if (formError()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ formError() }}</p> }
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div><label class="label" for="pay-amt">Amount (₹) *</label><input id="pay-amt" type="number" min="0" step="0.01" class="field" [value]="amount" (input)="amount = +$any($event.target).value" /></div>
            <div><label class="label" for="pay-date">Paid on *</label><input id="pay-date" type="date" class="field" [value]="paidOn" (input)="paidOn = $any($event.target).value" /></div>
            <div>
              <label class="label" for="pay-mode">Mode</label>
              <select id="pay-mode" class="field" (change)="mode = $any($event.target).value">
                @for (m of modes; track m) { <option [value]="m" [selected]="m === mode">{{ m }}</option> }
              </select>
            </div>
            <div><label class="label" for="pay-ref">Reference <span class="font-normal">(UTR, cheque no.)</span></label><input id="pay-ref" class="field" [value]="reference" (input)="reference = $any($event.target).value" /></div>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="btn btn-ghost" (click)="paying.set(false)">Cancel</button>
            <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="pay()">{{ busy() ? 'Saving…' : 'Save payment' }}</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class SupplierDetail {
  private readonly api = inject(RetailApi);
  private readonly auth = inject(AuthService);

  /** route param `:id` */
  id = input.required<string>();

  private readonly ctx = inject(OutletContext);
  protected readonly kind = KIND;
  protected readonly modes = ['BANK', 'UPI', 'CASH', 'CHEQUE', 'OTHER'];
  protected readonly supplier = signal<Supplier | null>(null);
  protected readonly entries = signal<StatementEntry[]>([]);
  protected readonly outstanding = signal(0);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly paying = signal(false);
  protected readonly busy = signal(false);

  protected amount = 0;
  protected paidOn = new Date().toISOString().slice(0, 10);
  protected mode = 'BANK';
  protected reference = '';

  protected readonly hasText = (x: string | undefined): boolean => !!x;

  protected get canWrite() {
    return this.auth.hasPermission('purchase.create');
  }

  protected get canPay() {
    return this.auth.hasPermission('purchase.approve');
  }

  constructor() {
    effect(() => this.load(this.id()));
  }

  private load(id: string) {
    this.api.supplierStatement(id).subscribe({
      next: (r) => {
        this.supplier.set(r.supplier);
        this.entries.set(r.entries);
        this.outstanding.set(r.outstanding);
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  protected openPay() {
    this.amount = Math.max(0, this.outstanding());
    this.formError.set(null);
    this.paying.set(true);
  }

  protected pay() {
    if (!(this.amount > 0)) return this.formError.set('Enter the amount you paid.');
    this.busy.set(true);
    this.formError.set(null);
    this.api.paySupplier(this.id(), { amount: this.amount, paidOn: this.paidOn, mode: this.mode, reference: this.reference.trim() || undefined, branchId: this.ctx.activeId() || undefined }).subscribe({
      next: () => {
        this.busy.set(false);
        this.paying.set(false);
        this.notice.set('Payment recorded.');
        this.load(this.id());
      },
      error: (e) => {
        this.busy.set(false);
        this.formError.set(apiError(e));
      },
    });
  }
}
