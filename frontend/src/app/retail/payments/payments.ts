import { HttpClient } from '@angular/common/http';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { apiError } from '../../shared/utils/api';

interface Settings {
  source: 'shop' | 'none';
  keyId: string | null;
  mode: 'live' | 'test' | null;
  hasWebhookSecret: boolean;
  webhookUrl: string;
  canSaveKeys: boolean;
  gatewayAllowed: boolean;
  updatedAt: string | null;
}
interface OwnUpi {
  upiId: string | null;
  payeeName: string | null;
  qrImage: string | null;
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

    <section class="card mt-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-medium">Your own UPI ID / QR</h2>
        <span class="badge" [class]="own()?.upiId || own()?.qrImage ? 'bg-tone-lime' : 'bg-chip'">{{ own()?.upiId || own()?.qrImage ? 'added' : 'not added' }}</span>
      </div>
      <p class="mt-1 text-xs text-ink-soft">Add the UPI ID (or the QR) you already use for your shop. At the counter, choose UPI and Orvia shows a QR with the bill amount in it. The customer pays straight into your bank account; when you see the money arrive, press <b>Payment received</b>. This works for every shop, with no payment gateway.</p>
      <form class="mt-3 grid gap-3 sm:grid-cols-2" (ngSubmit)="saveOwn()" autocomplete="off">
        <div><label class="label" for="u-id">UPI ID</label><input id="u-id" name="upiId" class="field" placeholder="shopname@okhdfcbank" [(ngModel)]="upiId" autocomplete="off" /></div>
        <div><label class="label" for="u-nm">Name shown to the customer</label><input id="u-nm" name="payeeName" class="field" placeholder="Your shop name" [(ngModel)]="payeeName" maxlength="80" /></div>
        <div class="sm:col-span-2">
          <label class="label" for="u-img">Your QR picture (optional; PNG or JPG, up to 250 KB)</label>
          <input id="u-img" type="file" accept="image/png,image/jpeg" class="field sm:max-w-sm" (change)="pickImage($event)" />
          @if (picture()) {
            <div class="mt-2 flex items-center gap-3">
              <img [src]="picture()" alt="Your UPI QR" class="h-28 w-28 rounded-xl border border-line bg-white object-contain" />
              <button type="button" class="btn btn-ghost" (click)="picture.set(null)">Remove picture</button>
            </div>
          }
          <p class="mt-1 text-[11px] text-ink-soft">With a UPI ID, Orvia makes a fresh QR for each bill with the amount filled in. A picture alone is shown as it is, so the customer types the amount.</p>
        </div>
        <div class="flex flex-wrap gap-2 sm:col-span-2">
          <button class="btn btn-primary" type="submit" [disabled]="busy()">Save UPI details</button>
          @if (own()?.upiId || own()?.qrImage) { <button class="btn btn-ghost" type="button" [disabled]="busy()" (click)="removeOwn()">Remove</button> }
        </div>
      </form>
    </section>

    @if (s(); as st) {
      @if (!st.gatewayAllowed) {
        <section class="card mt-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-medium">Online UPI with Razorpay (payment gateway)</h2>
            <span class="badge bg-chip">not active</span>
          </div>
          <p class="mt-1 text-xs text-ink-soft">With the gateway, Orvia confirms the payment by itself and fills it into the bill, with no one watching the phone. It is switched on shop by shop. To get it for your shop:</p>
          <ol class="mt-2 list-decimal space-y-1.5 pl-5 text-xs">
            <li>Have your own <b>Razorpay account</b> with KYC done and the account <b>activated for live payments</b>.</li>
            <li>In the Razorpay Dashboard go to <b>Account &amp; Settings &rarr; Website and app details</b> and add <b>https://pharmacy.orviaerp.com</b>. Wait until Razorpay approves it. Without this approval Razorpay refuses the payments with <i>"Business &ndash; Website Mismatch"</i>.</li>
            <li>In the same Dashboard create your <b>API keys</b> (Key ID and Key secret) and keep them ready. If you want, also create a <b>webhook secret</b>.</li>
            <li>Ask the <b>Orvia team</b> to switch on online UPI for your shop. Tell them your shop name and that the Razorpay website is approved.</li>
            <li>Come back to this page. The box to add your keys appears here once it is switched on.</li>
          </ol>
          <p class="mt-2 text-[11px] text-ink-soft">Until then, use your own UPI ID / QR above. It works right away.</p>
        </section>
      } @else {
      <section class="card mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-medium">Razorpay account</h2>
          <span class="flex gap-1">
            @if (st.mode) { <span class="badge" [class]="st.mode === 'live' ? 'bg-tone-lime' : 'bg-tone-rose'">{{ st.mode === 'live' ? 'LIVE: real money' : 'TEST mode' }}</span> }
            <span class="badge bg-chip">{{ st.source === 'shop' ? 'your own keys' : 'not set up' }}</span>
          </span>
        </div>
        <p class="mt-1 text-xs text-ink-soft">
          @if (st.source === 'shop') { UPI payments go to <b>your</b> Razorpay account ({{ st.keyId }}). }
          @else { UPI collection through Razorpay is not set up. Add <b>your own</b> Razorpay keys below to take UPI at the counter; the money goes to your account. Until then, UPI is still recorded when the customer pays on your own QR. }
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
  protected readonly own = signal<OwnUpi | null>(null);
  protected readonly picture = signal<string | null>(null);
  protected upiId = '';
  protected payeeName = '';
  protected keyId = '';
  protected keySecret = '';
  protected webhookSecret = '';

  constructor() {
    this.http.get<Settings>(`${this.url}/settings`).subscribe({ next: (v) => this.s.set(v), error: (e) => this.error.set(apiError(e)) });
    this.http.get<OwnUpi>(`${this.url}/upi/own`).subscribe({ next: (v) => this.setOwn(v), error: () => undefined });
    this.http.get<Unclaimed[]>(`${this.url}/upi/unclaimed`).subscribe({ next: (v) => this.unclaimed.set(v), error: () => this.unclaimed.set([]) });
  }

  private setOwn(v: OwnUpi) {
    this.own.set(v);
    this.upiId = v.upiId ?? '';
    this.payeeName = v.payeeName ?? '';
    this.picture.set(v.qrImage);
  }

  protected pickImage(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.error.set(null);
    if (!/^image\/(png|jpeg)$/.test(f.type)) return void this.error.set('Choose a PNG or JPG picture of your QR.');
    if (f.size > 250 * 1024) return void this.error.set('That picture is too big (over 250 KB). Use a smaller screenshot of your QR.');
    const r = new FileReader();
    r.onload = () => this.picture.set(String(r.result));
    r.readAsDataURL(f);
  }

  protected saveOwn() {
    this.error.set(null);
    this.notice.set(null);
    if (!this.upiId.trim() && !this.picture()) return this.error.set('Enter your UPI ID, or add a picture of your QR.');
    this.busy.set(true);
    this.http.put<OwnUpi>(`${this.url}/upi/own`, { upiId: this.upiId.trim(), payeeName: this.payeeName.trim(), qrImage: this.picture() ?? '' }).subscribe({
      next: (v) => {
        this.busy.set(false);
        this.setOwn(v);
        this.notice.set('UPI details saved. Choose UPI at the counter to show your QR.');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected removeOwn() {
    if (!confirm('Remove your UPI ID and QR from Orvia?')) return;
    this.busy.set(true);
    this.http.delete<OwnUpi>(`${this.url}/upi/own`).subscribe({
      next: (v) => {
        this.busy.set(false);
        this.setOwn(v);
        this.notice.set('Your UPI details were removed.');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
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
