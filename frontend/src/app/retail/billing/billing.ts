import { HttpClient } from '@angular/common/http';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { BillingState, InvoiceRow, STATE_CLASS, STATE_LABEL } from '../../shared/billing/billing-types';
import { InvoiceParty, printInvoice } from '../../shared/billing/print-invoice';
import { apiError } from '../../shared/utils/api';
import { payWithCheckout } from '../../shared/utils/razorpay';

interface Meter {
  used: number;
  limit: number | null;
}
interface BillingData {
  plan: { name: string; price: number; cycle: string; features: string[] } | null;
  state: BillingState;
  gstPercent: number;
  limits: { outlets: Meter; users: Meter; products: Meter; bills: Meter; features: string[] };
  invoices: InvoiceRow[];
  canPayOnline: boolean;
  company: InvoiceParty;
}

const FEATURES: [string, string][] = [
  ['multiOutlet', 'Multiple outlets and stock transfers'],
  ['onlinePayments', 'UPI QR and online payments at the counter'],
  ['gstReports', 'GST reports'],
  ['barcodeBilling', 'Barcode billing'],
];

/** The shop's subscription: plan, what it is using, invoices, and paying them. Owner only. */
@Component({
  selector: 'app-billing',
  imports: [CurrencyPipe, DatePipe],
  template: `
    <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Billing</h1>
    <p class="mt-0.5 text-xs text-ink-soft">Your Orvia subscription: plan, what you are using, and invoices.</p>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (d(); as b) {
      <section class="card mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-base font-medium">{{ b.plan?.name ?? 'No plan' }}</h2>
            @if (b.plan) { <p class="text-xs text-ink-soft">{{ b.plan.price | currency: 'INR' : 'symbol' : '1.0-0' }} per {{ b.plan.cycle === 'yearly' ? 'year' : 'month' }} @if (b.gstPercent > 0) { + {{ b.gstPercent }}% GST }</p> }
          </div>
          <span class="badge" [class]="stateClass[b.state.state]">{{ stateLabel[b.state.state] }}</span>
        </div>
        <p class="mt-2 text-xs">{{ headline() }}</p>

        @if (open(); as inv) {
          <div class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/50 p-3">
            <div class="text-xs"><b>{{ inv.number }}</b> · {{ inv.total | currency: 'INR' : 'symbol' : '1.2-2' }} · due {{ inv.dueDate | date: 'dd MMM yyyy' }}</div>
            <div class="flex gap-2">
              @if (b.canPayOnline) { <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="pay(inv)">{{ busy() ? 'Opening…' : 'Pay now' }}</button> }
              <button type="button" class="btn btn-ghost" (click)="print(inv)">View invoice</button>
            </div>
          </div>
          @if (!b.canPayOnline && b.company.bankDetails) { <p class="mt-2 text-[11px] text-ink-soft">Pay by bank transfer to {{ b.company.bankDetails }}, with {{ inv.number }} as the reference, and tell us. We mark it paid.</p> }
          @else if (b.company.bankDetails) { <p class="mt-2 text-[11px] text-ink-soft">Or pay by bank transfer: {{ b.company.bankDetails }} (reference {{ inv.number }}). We mark it paid when it arrives.</p> }
        }
      </section>

      <div class="mt-3 grid gap-3 md:grid-cols-2">
        <section class="card">
          <h2 class="text-sm font-medium">What you are using</h2>
          <div class="mt-2 space-y-2.5">
            @for (m of meters(); track m.label) {
              <div>
                <div class="flex justify-between text-xs"><span>{{ m.label }}</span><span [class.text-red-700]="m.full">{{ m.used }} of {{ m.limit ?? 'unlimited' }}</span></div>
                <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-black/10" role="progressbar" [attr.aria-valuenow]="m.used" [attr.aria-valuemax]="m.limit ?? m.used"><div class="h-full rounded-full" [class]="m.full ? 'bg-red-500' : 'bg-brand'" [style.width.%]="m.pct"></div></div>
              </div>
            }
          </div>
          <p class="mt-2 text-[11px] text-ink-soft">Bills are counted per calendar month. At the limit you cannot add more until the next month or a bigger plan. Ask Orvia to upgrade.</p>
        </section>
        <section class="card">
          <h2 class="text-sm font-medium">Included in your plan</h2>
          <ul class="mt-2 space-y-1 text-xs">
            @for (f of features; track f[0]) { <li class="flex items-center gap-2"><span [class]="has(f[0]) ? 'text-green-700' : 'text-ink-soft'" aria-hidden="true">{{ has(f[0]) ? '✓' : '✕' }}</span><span [class.text-ink-soft]="!has(f[0])">{{ f[1] }}{{ has(f[0]) ? '' : ' (not in your plan)' }}</span></li> }
          </ul>
        </section>
      </div>

      <section class="card mt-3">
        <h2 class="text-sm font-medium">Invoices</h2>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full min-w-136 text-left">
            <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Invoice</th><th class="py-1.5 pr-3 font-normal">Period</th><th class="py-1.5 pr-3 text-right font-normal">Amount</th><th class="py-1.5 pr-3 font-normal">Status</th><th class="py-1.5"></th></tr></thead>
            <tbody>
              @for (i of b.invoices; track i._id) {
                <tr class="border-t border-line text-xs">
                  <td class="py-2 pr-3 font-medium">{{ i.number }}<div class="text-[11px] font-normal text-ink-soft">issued {{ i.issuedAt | date: 'dd MMM yyyy' }}</div></td>
                  <td class="py-2 pr-3 whitespace-nowrap">{{ i.periodStart | date: 'dd MMM' }} to {{ i.periodEnd | date: 'dd MMM yyyy' }}</td>
                  <td class="py-2 pr-3 text-right font-medium">{{ i.total | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                  <td class="py-2 pr-3"><span class="badge" [class]="i.status === 'paid' ? 'bg-tone-lime' : i.status === 'void' ? 'bg-chip' : 'bg-tone-rose'">{{ i.status === 'issued' ? 'unpaid' : i.status }}</span>@if (i.status === 'paid') { <div class="text-[11px] text-ink-soft">{{ i.paidAt | date: 'dd MMM yyyy' }}</div> }</td>
                  <td class="py-2 text-right whitespace-nowrap">
                    @if (i.status === 'issued' && b.canPayOnline) { <button type="button" class="btn btn-primary !px-3 !py-0.5" [disabled]="busy()" (click)="pay(i)">Pay</button> }
                    <button type="button" class="btn btn-ghost !px-3 !py-0.5" (click)="print(i)">View</button>
                  </td>
                </tr>
              } @empty { <tr><td colspan="5" class="py-6 text-center text-xs text-ink-soft">No invoices yet. Your first one is issued a week before your trial or period ends.</td></tr> }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
})
export class Billing {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly url = `${environment.apiUrl}/billing`;

  protected readonly stateLabel = STATE_LABEL;
  protected readonly stateClass = STATE_CLASS;
  protected readonly features = FEATURES;
  protected readonly d = signal<BillingData | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly open = computed(() => this.d()?.invoices.filter((i) => i.status === 'issued').sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate))[0] ?? null);
  protected readonly meters = computed(() => {
    const l = this.d()?.limits;
    if (!l) return [];
    const row = (label: string, m: Meter) => ({ label, used: m.used, limit: m.limit, full: m.limit != null && m.used >= m.limit, pct: m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 8 });
    return [row('Outlets', l.outlets), row('Users', l.users), row('Products', l.products), row('Bills this month', l.bills)];
  });

  constructor() {
    this.load();
  }

  protected has = (f: string) => this.d()?.limits.features.includes(f) ?? false;

  /** One plain sentence about where the subscription stands. */
  protected headline(): string {
    const s = this.d()?.state;
    if (!s) return '';
    const date = (x?: string | null) => (x ? new Date(x).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
    switch (s.state) {
      case 'trial': return `Your free trial runs until ${date(s.endsAt)} (${s.daysLeft} days left).`;
      case 'due_soon': return `${s.trial ? 'Your trial ends' : 'Your plan renews'} on ${date(s.endsAt)}. Pay the invoice below to carry on without a break.`;
      case 'grace': return `Your subscription ended on ${date(s.endsAt)}. Everything still works until ${date(s.lockAt)}, then the shop becomes view-only until you pay.`;
      case 'locked': return `Your subscription ended on ${date(s.endsAt)}. The shop is view-only: you can see everything but not change it. Pay the invoice to continue. Your data is safe.`;
      default: return s.endsAt ? `Paid until ${date(s.endsAt)}.` : 'Your plan has no recurring charge.';
    }
  }

  private load() {
    this.http.get<BillingData>(this.url).subscribe({ next: (v) => this.d.set(v), error: (e) => this.error.set(apiError(e)) });
  }

  protected async pay(inv: InvoiceRow) {
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
    try {
      const order = await new Promise<{ orderId: string; keyId: string; amountPaise: number; name: string; description: string }>((ok, no) =>
        this.http.post<{ orderId: string; keyId: string; amountPaise: number; name: string; description: string }>(`${this.url}/invoices/${inv._id}/pay-order`, {}).subscribe({ next: ok, error: no }),
      );
      const paid = await payWithCheckout(order, { name: this.auth.user()?.name, email: this.auth.user()?.email });
      if (!paid) return this.busy.set(false);
      this.http.post(`${this.url}/invoices/${inv._id}/verify`, { orderId: paid.razorpay_order_id, paymentId: paid.razorpay_payment_id, signature: paid.razorpay_signature }).subscribe({
        next: () => {
          this.busy.set(false);
          this.notice.set('Payment received. Thank you! Your subscription is active.');
          this.load();
        },
        error: (e) => {
          this.busy.set(false);
          this.error.set(`Your payment went through but could not be confirmed yet: ${apiError(e)} It is usually confirmed within a minute; refresh this page. Payment ref ${paid.razorpay_payment_id}.`);
        },
      });
    } catch (e) {
      this.busy.set(false);
      this.error.set(e instanceof Error && !('status' in e) ? e.message : apiError(e));
    }
  }

  protected print(inv: InvoiceRow) {
    this.http.get<{ invoice: InvoiceRow; shop: InvoiceParty; company: InvoiceParty }>(`${this.url}/invoices/${inv._id}`).subscribe({
      next: (r) => {
        if (!printInvoice(r.invoice, r.company, r.shop)) this.error.set('The print window was blocked. Allow pop-ups for this site.');
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }
}
