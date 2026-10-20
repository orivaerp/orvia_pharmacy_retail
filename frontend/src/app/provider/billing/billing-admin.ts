import { HttpClient, HttpParams } from '@angular/common/http';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { BillingState, InvoiceRow, STATE_CLASS, STATE_LABEL } from '../../shared/billing/billing-types';
import { InvoiceParty, printInvoice } from '../../shared/billing/print-invoice';
import { Page, apiError } from '../../shared/utils/api';

interface Overview extends Page<InvoiceRow> {
  summary: { mrr: number; outstanding: number; outstandingCount: number; overdue: number; overdueCount: number; collectedThisMonth: number };
}

const url = `${environment.apiUrl}/provider/billing`;

/** All shops' subscription invoices: what is owed, what came in, and the buttons to mark paid, void or run the job. */
@Component({
  selector: 'app-billing-admin',
  imports: [CurrencyPipe, DatePipe, FormsModule, RouterLink],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Billing</h1>
        <p class="mt-0.5 text-xs text-ink-soft">Subscription invoices for every shop. The daily job issues them a week before a period ends and sends reminders.</p>
      </div>
      <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="run()">{{ busy() ? 'Running…' : 'Run billing now' }}</button>
    </div>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (d(); as o) {
      <div class="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <div class="card"><p class="text-xs text-ink-soft">Monthly recurring</p><p class="mt-1 text-xl font-medium">{{ o.summary.mrr | currency: 'INR' : 'symbol' : '1.0-0' }}</p></div>
        <div class="card"><p class="text-xs text-ink-soft">Collected this month</p><p class="mt-1 text-xl font-medium">{{ o.summary.collectedThisMonth | currency: 'INR' : 'symbol' : '1.0-0' }}</p></div>
        <div class="card"><p class="text-xs text-ink-soft">Unpaid</p><p class="mt-1 text-xl font-medium">{{ o.summary.outstanding | currency: 'INR' : 'symbol' : '1.0-0' }}</p><p class="text-[11px] text-ink-soft">{{ o.summary.outstandingCount }} invoice{{ o.summary.outstandingCount === 1 ? '' : 's' }}</p></div>
        <div class="card"><p class="text-xs text-ink-soft">Overdue</p><p class="mt-1 text-xl font-medium" [class.text-red-700]="o.summary.overdueCount">{{ o.summary.overdue | currency: 'INR' : 'symbol' : '1.0-0' }}</p><p class="text-[11px] text-ink-soft">{{ o.summary.overdueCount }} invoice{{ o.summary.overdueCount === 1 ? '' : 's' }}</p></div>
      </div>

      <div class="mt-3 flex gap-1 rounded-full border border-line bg-surface p-1 text-xs w-fit" role="tablist">
        @for (t of tabs; track t[0]) { <button type="button" role="tab" class="rounded-full px-3 py-1" [attr.aria-selected]="status() === t[0]" [class]="status() === t[0] ? 'bg-brand text-brand-ink' : ''" (click)="setStatus(t[0])">{{ t[1] }}</button> }
      </div>

      <section class="card mt-3">
        <div class="overflow-x-auto" [class.opacity-50]="loading()">
          <table class="w-full min-w-176 text-left">
            <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Invoice</th><th class="py-1.5 pr-3 font-normal">Shop</th><th class="py-1.5 pr-3 font-normal">Period</th><th class="py-1.5 pr-3 text-right font-normal">Total</th><th class="py-1.5 pr-3 font-normal">Status</th><th class="py-1.5"></th></tr></thead>
            <tbody>
              @for (i of o.items; track i._id) {
                <tr class="border-t border-line text-xs">
                  <td class="py-2 pr-3 font-medium">{{ i.number }}<div class="text-[11px] font-normal text-ink-soft">{{ i.issuedAt | date: 'dd MMM yyyy' }}</div></td>
                  <td class="py-2 pr-3"><a [routerLink]="['/provider/shops', i.tenantId]" class="underline">{{ i.tenantName }}</a><div class="text-[11px] text-ink-soft">{{ i.planName }}</div></td>
                  <td class="py-2 pr-3 whitespace-nowrap">{{ i.periodStart | date: 'dd MMM' }} to {{ i.periodEnd | date: 'dd MMM yyyy' }}</td>
                  <td class="py-2 pr-3 text-right font-medium">{{ i.total | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                  <td class="py-2 pr-3">
                    <span class="badge" [class]="i.status === 'paid' ? 'bg-tone-lime' : i.status === 'void' ? 'bg-chip' : overdue(i) ? 'bg-tone-rose' : 'bg-tone-lavender'">{{ i.status === 'issued' ? (overdue(i) ? 'overdue' : 'unpaid') : i.status }}</span>
                    <div class="text-[11px] text-ink-soft">{{ i.status === 'paid' ? (i.paidAt | date: 'dd MMM') + ' · ' + i.method + (i.reference ? ' ' + i.reference : '') : i.status === 'void' ? i.voidReason : 'due ' + (i.dueDate | date: 'dd MMM') }}</div>
                  </td>
                  <td class="py-2 text-right whitespace-nowrap">
                    @if (i.status === 'issued') {
                      <button type="button" class="btn btn-primary !px-3 !py-0.5" (click)="openPay(i)">Mark paid</button>
                      <button type="button" class="btn btn-ghost !px-3 !py-0.5" (click)="voidIt(i)">Void</button>
                    }
                    <button type="button" class="btn btn-ghost !px-3 !py-0.5" (click)="print(i)">View</button>
                  </td>
                </tr>
              } @empty { <tr><td colspan="6" class="py-8 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'No invoices here.' }}</td></tr> }
            </tbody>
          </table>
        </div>
        <div class="mt-2 flex items-center justify-between text-xs text-ink-soft">
          <span>{{ o.total }} invoice{{ o.total === 1 ? '' : 's' }}</span>
          <span class="flex gap-2"><button type="button" class="btn btn-ghost !py-0.5" [disabled]="page() <= 1" (click)="go(-1)">Previous</button><button type="button" class="btn btn-ghost !py-0.5" [disabled]="page() * 25 >= o.total" (click)="go(1)">Next</button></span>
        </div>
      </section>
    }

    @if (paying(); as p) {
      <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="paying.set(null)">
        <form class="w-full max-w-sm rounded-2xl bg-surface-solid p-5 shadow-xl" (click)="$event.stopPropagation()" (ngSubmit)="markPaid()" role="dialog" aria-modal="true">
          <h2 class="text-lg font-medium">Mark {{ p.number }} paid</h2>
          <p class="text-xs text-ink-soft">{{ p.tenantName }} · {{ p.total | currency: 'INR' : 'symbol' : '1.2-2' }}. Only do this once the money has reached you.</p>
          @if (formError()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ formError() }}</p> }
          <div class="mt-3 grid gap-3">
            <div><label class="label" for="mp-m">Received by</label><select id="mp-m" name="m" class="field" [(ngModel)]="method"><option value="bank">Bank transfer</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="other">Other</option></select></div>
            <div><label class="label" for="mp-r">Reference (UTR, cheque no.)</label><input id="mp-r" name="r" class="field" [(ngModel)]="reference" /></div>
            <div><label class="label" for="mp-d">Received on</label><input id="mp-d" name="d" type="date" class="field" [(ngModel)]="paidOn" /></div>
          </div>
          <div class="mt-4 flex justify-end gap-2"><button type="button" class="btn btn-ghost" (click)="paying.set(null)">Cancel</button><button type="submit" class="btn btn-primary" [disabled]="busy()">Mark paid</button></div>
        </form>
      </div>
    }
  `,
})
export class BillingAdmin {
  private readonly http = inject(HttpClient);
  protected readonly tabs: [string, string][] = [['', 'All'], ['issued', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']];
  protected readonly d = signal<Overview | null>(null);
  protected readonly status = signal('');
  protected readonly page = signal(1);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly paying = signal<InvoiceRow | null>(null);
  protected method = 'bank';
  protected reference = '';
  protected paidOn = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  constructor() {
    this.load();
  }

  protected overdue = (i: InvoiceRow) => i.status === 'issued' && new Date(i.dueDate) < new Date();

  private load() {
    this.loading.set(true);
    let params = new HttpParams().set('page', this.page());
    if (this.status()) params = params.set('status', this.status());
    this.http.get<Overview>(url, { params }).subscribe({
      next: (v) => {
        this.d.set(v);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }

  protected setStatus(s: string) {
    this.status.set(s);
    this.page.set(1);
    this.load();
  }

  protected go(n: number) {
    this.page.update((p) => p + n);
    this.load();
  }

  protected run() {
    this.busy.set(true);
    this.error.set(null);
    this.http.post<{ issued: number; reminded: number; started: number }>(`${url}/run`, {}).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.notice.set(`Done: ${r.issued} invoice${r.issued === 1 ? '' : 's'} issued, ${r.reminded} reminder${r.reminded === 1 ? '' : 's'} sent${r.started ? `, ${r.started} existing shop${r.started === 1 ? '' : 's'} started on a billing period` : ''}.`);
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected openPay(i: InvoiceRow) {
    this.method = 'bank';
    this.reference = '';
    this.formError.set(null);
    this.paying.set(i);
  }

  protected markPaid() {
    const i = this.paying();
    if (!i) return;
    this.busy.set(true);
    this.http.post(`${url}/invoices/${i._id}/mark-paid`, { method: this.method, reference: this.reference.trim() || undefined, paidOn: this.paidOn }).subscribe({
      next: () => {
        this.busy.set(false);
        this.paying.set(null);
        this.notice.set(`${i.number} marked paid. ${i.tenantName} is active again.`);
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.formError.set(apiError(e));
      },
    });
  }

  protected voidIt(i: InvoiceRow) {
    const reason = prompt(`Void ${i.number}? Say why (it cannot be undone; a new invoice can be issued).`);
    if (!reason || reason.trim().length < 3) return;
    this.http.post(`${url}/invoices/${i._id}/void`, { reason: reason.trim() }).subscribe({
      next: () => {
        this.notice.set(`${i.number} voided.`);
        this.load();
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  protected print(i: InvoiceRow) {
    this.http.get<{ invoice: InvoiceRow; shop: InvoiceParty; company: InvoiceParty }>(`${url}/invoices/${i._id}/print`).subscribe({
      next: (r) => {
        if (!printInvoice(r.invoice, r.company, r.shop)) this.error.set('The print window was blocked. Allow pop-ups for this site.');
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }
}

/** The billing box on a shop's page: where it stands, more time, and an early invoice. */
@Component({
  selector: 'app-shop-billing-card',
  imports: [DatePipe, CurrencyPipe, FormsModule],
  template: `
    <section class="card mt-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-base font-medium">Billing</h2>
        @if (st(); as s) { <span class="badge" [class]="stateClass[s.state]">{{ stateLabel[s.state] }}</span> }
      </div>
      @if (error()) { <p role="alert" class="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
      @if (notice()) { <p class="mt-2 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }
      @if (st(); as s) {
        <p class="mt-1 text-xs text-ink-soft">
          @if (s.endsAt) { {{ s.trial ? 'Trial' : 'Paid' }} until {{ s.endsAt | date: 'dd MMM yyyy' }}@if (s.lockAt && s.state !== 'active' && s.state !== 'trial') { · view-only from {{ s.lockAt | date: 'dd MMM yyyy' }} } }
          @else { No recurring charge. }
        </p>
        <div class="mt-2 flex flex-wrap gap-2">
          <button type="button" class="btn btn-ghost" (click)="extending.set(!extending())">Give more time</button>
          <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="invoiceNow()">Issue next invoice now</button>
        </div>
        @if (extending()) {
          <form class="mt-2 flex flex-wrap items-end gap-2" (ngSubmit)="extend()">
            <div><label class="label" for="ex-d">Days</label><input id="ex-d" name="d" type="number" min="1" max="90" class="field w-24" [(ngModel)]="days" /></div>
            <div class="min-w-48 flex-1"><label class="label" for="ex-r">Reason</label><input id="ex-r" name="r" class="field" [(ngModel)]="reason" placeholder="e.g. payment promised on Friday" /></div>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">Extend</button>
          </form>
        }
      }
      @if (invoices().length) {
        <ul class="mt-3 divide-y divide-line text-xs">
          @for (i of invoices(); track i._id) {
            <li class="flex flex-wrap items-center justify-between gap-2 py-1.5"><span><b>{{ i.number }}</b> · {{ i.total | currency: 'INR' : 'symbol' : '1.0-0' }} · {{ i.periodStart | date: 'dd MMM' }} to {{ i.periodEnd | date: 'dd MMM yyyy' }}</span><span class="badge" [class]="i.status === 'paid' ? 'bg-tone-lime' : i.status === 'void' ? 'bg-chip' : 'bg-tone-rose'">{{ i.status === 'issued' ? 'unpaid' : i.status }}</span></li>
          }
        </ul>
      }
    </section>
  `,
})
export class ShopBillingCard {
  private readonly http = inject(HttpClient);
  shopId = input.required<string>();
  protected readonly stateLabel = STATE_LABEL;
  protected readonly stateClass = STATE_CLASS;
  protected readonly st = signal<BillingState | null>(null);
  protected readonly invoices = signal<InvoiceRow[]>([]);
  protected readonly busy = signal(false);
  protected readonly extending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected days = 7;
  protected reason = '';

  constructor() {
    effect(() => {
      const id = this.shopId();
      untracked(() => this.load(id));
    });
  }

  private load(id: string) {
    this.http.get<{ state: BillingState; invoices: InvoiceRow[] }>(`${url}/tenants/${id}`).subscribe({
      next: (r) => {
        this.st.set(r.state);
        this.invoices.set(r.invoices);
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  protected extend() {
    if (this.reason.trim().length < 3) return this.error.set('Say why you are giving more time.');
    this.busy.set(true);
    this.error.set(null);
    this.http.post<BillingState>(`${url}/tenants/${this.shopId()}/extend`, { days: Number(this.days), reason: this.reason.trim() }).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.st.set(s);
        this.extending.set(false);
        this.reason = '';
        this.notice.set('More time given.');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected invoiceNow() {
    this.busy.set(true);
    this.error.set(null);
    this.http.post<InvoiceRow>(`${url}/tenants/${this.shopId()}/invoice`, {}).subscribe({
      next: (i) => {
        this.busy.set(false);
        this.invoices.update((l) => [i, ...l]);
        this.notice.set(`${i.number} issued and emailed to the owner.`);
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }
}
