import { HttpClient } from '@angular/common/http';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { apiError } from '../../shared/utils/api';

interface Settings {
  source: 'shop' | 'platform' | 'none';
  keyId: string | null;
  mode: 'live' | 'test' | null;
  hasWebhookSecret: boolean;
  webhookUrl: string;
  canSaveKeys: boolean;
  updatedAt: string | null;
}
interface Unclaimed {
  _id: string;
  orderId: string;
  paymentId: string;
  amount: number;
  outlet?: string;
  at: string;
}

/** Where the shop's UPI money goes: its own Razorpay keys (saved encrypted), plus any money received but never billed. */
@Component({
  selector: 'app-payments',
  imports: [FormsModule, CurrencyPipe, DatePipe],
  template: `
    <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Payments</h1>
    <p class="mt-0.5 text-xs text-ink-soft">Where customers' UPI payments are received, and anything that came in but was never put on a bill.</p>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (s(); as st) {
      <section class="card mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-medium">Razorpay account</h2>
          <span class="flex gap-1">
            @if (st.mode) { <span class="badge" [class]="st.mode === 'live' ? 'bg-tone-lime' : 'bg-tone-rose'">{{ st.mode === 'live' ? 'LIVE: real money' : 'TEST mode' }}</span> }
            <span class="badge bg-chip">{{ st.source === 'shop' ? 'your own keys' : st.source === 'platform' ? 'Orvia default keys' : 'not set up' }}</span>
          </span>
        </div>
        <p class="mt-1 text-xs text-ink-soft">
          @if (st.source === 'shop') { UPI payments go to <b>your</b> Razorpay account ({{ st.keyId }}). }
          @else if (st.source === 'platform') { UPI payments currently go to the account Orvia is set up with ({{ st.keyId }}). Add your own keys below to receive the money directly. }
          @else { UPI collection through Razorpay is not set up. UPI is still recorded when the customer pays on your own QR. }
        </p>

        @if (st.canSaveKeys) {
          <form class="mt-3 grid gap-3 sm:grid-cols-2" (ngSubmit)="save()" autocomplete="off">
            <div><label class="label" for="k-id">Key ID *</label><input id="k-id" name="keyId" class="field" placeholder="rzp_live_…" [(ngModel)]="keyId" autocomplete="off" /></div>
            <div><label class="label" for="k-sec">Key secret *</label><input id="k-sec" name="keySecret" type="password" class="field" [(ngModel)]="keySecret" autocomplete="new-password" /></div>
            <div class="sm:col-span-2">
              <label class="label" for="k-wh">Webhook secret (recommended)</label>
              <input id="k-wh" name="webhookSecret" type="password" class="field sm:max-w-sm" [(ngModel)]="webhookSecret" autocomplete="new-password" />
            </div>
            <div class="flex flex-wrap gap-2 sm:col-span-2">
              <button class="btn btn-primary" type="submit" [disabled]="busy()">{{ busy() ? 'Checking the keys…' : st.source === 'shop' ? 'Replace keys' : 'Save keys' }}</button>
              @if (st.source === 'shop') { <button class="btn btn-ghost" type="button" [disabled]="busy()" (click)="remove()">Remove my keys</button> }
            </div>
          </form>
          <p class="mt-2 text-[11px] text-ink-soft">The keys are checked with Razorpay before saving and stored encrypted. They are never shown again, not even to you; to change them, enter new ones.</p>
        } @else {
          <p class="mt-3 rounded-xl bg-tone-rose px-3 py-2 text-xs">Saving your own keys is not switched on for this installation. Ask the Orvia team.</p>
        }
      </section>

      <section class="card mt-3">
        <h2 class="text-sm font-medium">Webhook (so no payment is missed)</h2>
        <p class="mt-1 text-xs text-ink-soft">If the browser closes right after a customer pays, Razorpay tells Orvia directly. In your Razorpay Dashboard go to Settings, Webhooks, add this address, tick <b>payment.captured</b>, and use the same secret as above.</p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <code class="min-w-0 flex-1 break-all rounded-lg border border-line bg-white/50 px-2 py-1.5 text-[11px]">{{ st.webhookUrl }}</code>
          <button type="button" class="btn btn-ghost" (click)="copy(st.webhookUrl)">Copy</button>
        </div>
        @if (st.source === 'shop' && !st.hasWebhookSecret) { <p class="mt-2 text-[11px] text-red-700">No webhook secret saved yet, so webhook calls are being ignored.</p> }
        @if (st.webhookUrl.includes('localhost')) { <p class="mt-2 text-[11px] text-ink-soft">This address only works once Orvia is on a public server.</p> }
      </section>
    }

    <section class="card mt-3">
      <h2 class="text-sm font-medium">Received but not on any bill</h2>
      <p class="text-[11px] text-ink-soft">Money the customer paid by UPI where no bill was saved (for example the screen closed). Refund it from your Razorpay Dashboard or bill the customer.</p>
      <div class="mt-2 overflow-x-auto">
        <table class="w-full min-w-136 text-left">
          <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">When</th><th class="py-1.5 pr-3 font-normal">Outlet</th><th class="py-1.5 pr-3 font-normal">Payment ref</th><th class="py-1.5 text-right font-normal">Amount</th></tr></thead>
          <tbody>
            @for (u of unclaimed(); track u._id) {
              <tr class="border-t border-line text-xs"><td class="py-1.5 pr-3 whitespace-nowrap">{{ u.at | date: 'dd MMM, HH:mm' }}</td><td class="py-1.5 pr-3">{{ u.outlet }}</td><td class="py-1.5 pr-3">{{ u.paymentId }}</td><td class="py-1.5 text-right font-medium">{{ u.amount | currency: 'INR' : 'symbol' : '1.2-2' }}</td></tr>
            } @empty {
              <tr><td colspan="4" class="py-6 text-center text-xs text-ink-soft">Nothing is waiting. Every UPI payment is on a bill.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class Payments {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/payments`;

  protected readonly s = signal<Settings | null>(null);
  protected readonly unclaimed = signal<Unclaimed[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected keyId = '';
  protected keySecret = '';
  protected webhookSecret = '';

  constructor() {
    this.http.get<Settings>(`${this.url}/settings`).subscribe({ next: (v) => this.s.set(v), error: (e) => this.error.set(apiError(e)) });
    this.http.get<Unclaimed[]>(`${this.url}/upi/unclaimed`).subscribe({ next: (v) => this.unclaimed.set(v), error: () => this.unclaimed.set([]) });
  }

  protected save() {
    this.error.set(null);
    this.notice.set(null);
    if (!this.keyId.trim() || !this.keySecret.trim()) return this.error.set('Enter both the Key ID and the Key secret.');
    if (this.keyId.trim().startsWith('rzp_live_') && !confirm('These are LIVE keys: customers will pay real money into this Razorpay account. Continue?')) return;
    this.busy.set(true);
    this.http.put<Settings>(`${this.url}/settings`, { keyId: this.keyId.trim(), keySecret: this.keySecret.trim(), webhookSecret: this.webhookSecret.trim() }).subscribe({
      next: (v) => {
        this.busy.set(false);
        this.s.set(v);
        this.keyId = this.keySecret = this.webhookSecret = '';
        this.notice.set('Keys saved. New UPI payments now go to this account.');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected remove() {
    if (!confirm('Remove your keys? UPI collection will use the Orvia default account again.')) return;
    this.busy.set(true);
    this.http.delete<Settings>(`${this.url}/settings`).subscribe({
      next: (v) => {
        this.busy.set(false);
        this.s.set(v);
        this.notice.set('Your keys were removed.');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.notice.set('Copied.');
    } catch {
      this.error.set('Copy failed. Select the address and copy it by hand.');
    }
  }
}
