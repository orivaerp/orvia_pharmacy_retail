import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { INVOICE_LAYOUTS, InvoiceLayout, InvoiceParty, previewInvoice } from '../../shared/billing/print-invoice';
import { apiError } from '../../shared/utils/api';

type Values = Record<string, string | number | null>;
interface Payload {
  saved: Values;
  inUse: Values;
  defaults: Values;
}

const TEXT = ['companyName', 'companyAddress', 'companyGstin', 'companyPan', 'companyPhone', 'companyEmail', 'companyWebsite', 'bankDetails', 'invoiceNote', 'invoiceTerms', 'invoiceLayout', 'invoiceAccent', 'companyLogo', 'supportEmail', 'supportPhone', 'grievanceName', 'grievanceEmail'];
const NUMBERS = ['billingGstPercent', 'billingGraceDays', 'signupTrialDays'];

/** Provider > Settings: the company details on invoices, billing rules, the sign-up trial, and who to contact. Saved here, no server restart. */
@Component({
  selector: 'app-platform-settings',
  imports: [FormsModule],
  template: `
    <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Settings</h1>
    <p class="mt-0.5 text-xs text-ink-soft">Saved here, they apply at once and win over the server's own settings. Leave a box empty to use the server's value (shown as the hint).</p>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (loaded()) {
      <form class="mt-3 grid gap-3 lg:grid-cols-2" (ngSubmit)="save()">
        <section class="card">
          <h2 class="text-sm font-medium">Company (printed on subscription invoices)</h2>
          <div class="mt-3 grid gap-3">
            <div><label class="label" for="s-name">Company name</label><input id="s-name" name="companyName" class="field" [placeholder]="hint('companyName')" [(ngModel)]="f['companyName']" /></div>
            <div><label class="label" for="s-addr">Address</label><textarea id="s-addr" name="companyAddress" rows="2" class="field" [placeholder]="hint('companyAddress')" [(ngModel)]="f['companyAddress']"></textarea></div>
            <div><label class="label" for="s-gstin">GSTIN</label><input id="s-gstin" name="companyGstin" class="field uppercase" maxlength="15" [placeholder]="hint('companyGstin')" [(ngModel)]="f['companyGstin']" /></div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div><label class="label" for="s-pan">PAN</label><input id="s-pan" name="companyPan" class="field uppercase" maxlength="10" [placeholder]="hint('companyPan')" [(ngModel)]="f['companyPan']" /></div>
              <div><label class="label" for="s-cphone">Phone</label><input id="s-cphone" name="companyPhone" class="field" [placeholder]="hint('companyPhone')" [(ngModel)]="f['companyPhone']" /></div>
              <div><label class="label" for="s-cemail">Email</label><input id="s-cemail" name="companyEmail" type="email" class="field" [placeholder]="hint('companyEmail')" [(ngModel)]="f['companyEmail']" /></div>
              <div><label class="label" for="s-cweb">Website</label><input id="s-cweb" name="companyWebsite" class="field" placeholder="www.example.com" [(ngModel)]="f['companyWebsite']" /></div>
            </div>
            <div><label class="label" for="s-bank">Bank details (for payment by bank transfer)</label><textarea id="s-bank" name="bankDetails" rows="2" class="field" [placeholder]="hint('bankDetails')" [(ngModel)]="f['bankDetails']"></textarea></div>
          </div>
        </section>

        <section class="card lg:col-span-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-medium">Invoice look</h2>
            <button type="button" class="btn btn-ghost" (click)="preview()">Preview invoice</button>
          </div>
          <p class="mt-1 text-[11px] text-ink-soft">Pick a layout for the subscription invoices. The preview uses what is typed above, even before you save.</p>
          <div class="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Invoice layout">
            @for (l of layouts; track l.id) {
              <button type="button" role="radio" [attr.aria-checked]="layout() === l.id" class="rounded-xl border p-3 text-left text-xs" [class]="layout() === l.id ? 'border-brand bg-white/70' : 'border-line'" (click)="f['invoiceLayout'] = l.id">
                <span class="font-medium">{{ l.label }}</span>
                <span class="mt-0.5 block text-[11px] text-ink-soft">{{ l.hint }}</span>
              </button>
            }
          </div>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label class="label" for="s-accent">Accent colour (Modern layout)</label>
              <div class="flex items-center gap-2">
                <input id="s-accent" name="invoiceAccent" type="color" class="h-9 w-14 rounded border border-line" [ngModel]="f['invoiceAccent'] || hint('invoiceAccent')" (ngModelChange)="f['invoiceAccent'] = $event" />
                <span class="text-[11px] text-ink-soft">{{ f['invoiceAccent'] || hint('invoiceAccent') }}</span>
              </div>
            </div>
            <div>
              <label class="label" for="s-logo">Logo (PNG or JPG, up to 200 KB)</label>
              <input id="s-logo" type="file" accept="image/png,image/jpeg" class="field" (change)="pickLogo($event)" />
              @if (f['companyLogo']) {
                <div class="mt-2 flex items-center gap-3">
                  <img [src]="f['companyLogo']" alt="Logo" class="max-h-14 max-w-40 rounded border border-line bg-white p-1" />
                  <button type="button" class="btn btn-ghost" (click)="f['companyLogo'] = ''">Remove logo</button>
                </div>
              }
            </div>
            <div class="sm:col-span-2"><label class="label" for="s-terms">Terms (printed under the total)</label><textarea id="s-terms" name="invoiceTerms" rows="2" class="field" placeholder="For example: Subscription fees are not refundable." [(ngModel)]="f['invoiceTerms']"></textarea></div>
            <div class="sm:col-span-2"><label class="label" for="s-note">Footer line</label><input id="s-note" name="invoiceNote" class="field" [placeholder]="hint('invoiceNote')" [(ngModel)]="f['invoiceNote']" /></div>
          </div>
        </section>

        <section class="card">
          <h2 class="text-sm font-medium">Billing and sign-up</h2>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div><label class="label" for="s-gst">GST on subscriptions (%)</label><input id="s-gst" name="billingGstPercent" type="number" min="0" max="40" step="0.5" class="field" [placeholder]="hint('billingGstPercent')" [(ngModel)]="f['billingGstPercent']" /><p class="mt-1 text-[11px] text-ink-soft">0 means no GST on invoices.</p></div>
            <div><label class="label" for="s-grace">Days to pay after the due date</label><input id="s-grace" name="billingGraceDays" type="number" min="0" max="60" class="field" [placeholder]="hint('billingGraceDays')" [(ngModel)]="f['billingGraceDays']" /></div>
            <div class="sm:col-span-2"><label class="label" for="s-trial">Free trial for a new shop that signs up itself (days)</label><input id="s-trial" name="signupTrialDays" type="number" min="0" max="90" class="field" [placeholder]="hint('signupTrialDays')" [(ngModel)]="f['signupTrialDays']" /><p class="mt-1 text-[11px] text-ink-soft">Used for a paid plan that has no trial days of its own. A plan's own trial days win.</p></div>
          </div>
          <p class="mt-3 text-[11px] text-ink-soft">The GST rate applies to invoices made from now on; invoices already made keep the rate they were made with. Prices on the public pricing page use the new rate straight away.</p>
        </section>

        <section class="card lg:col-span-2">
          <h2 class="text-sm font-medium">Contact (shown on the Terms and Privacy pages)</h2>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div><label class="label" for="s-semail">Support email</label><input id="s-semail" name="supportEmail" type="email" class="field" [placeholder]="hint('supportEmail')" [(ngModel)]="f['supportEmail']" /></div>
            <div><label class="label" for="s-sphone">Support phone</label><input id="s-sphone" name="supportPhone" class="field" [(ngModel)]="f['supportPhone']" /></div>
            <div><label class="label" for="s-gname">Grievance officer (name)</label><input id="s-gname" name="grievanceName" class="field" [(ngModel)]="f['grievanceName']" /></div>
            <div><label class="label" for="s-gemail">Grievance officer (email)</label><input id="s-gemail" name="grievanceEmail" type="email" class="field" [(ngModel)]="f['grievanceEmail']" /></div>
          </div>
          <p class="mt-2 text-[11px] text-ink-soft">Indian rules expect a named person people can write to about their data. Without one, the privacy page shows the support email only.</p>
        </section>

        <div class="flex justify-end lg:col-span-2">
          <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save settings' }}</button>
        </div>
      </form>
    }
  `,
})
export class PlatformSettings {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/provider/settings`;
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected f: Record<string, string | number | null> = {};
  protected readonly layouts = INVOICE_LAYOUTS;
  private defaults: Values = {};

  constructor() {
    this.http.get<Payload>(this.url).subscribe({
      next: (p) => this.fill(p),
      error: (e) => this.error.set(apiError(e)),
    });
  }

  private fill(p: Payload) {
    this.defaults = p.defaults;
    this.f = {};
    for (const k of [...TEXT, ...NUMBERS]) this.f[k] = p.saved[k] === '' || p.saved[k] === null || p.saved[k] === undefined ? (NUMBERS.includes(k) ? null : '') : p.saved[k];
    this.loaded.set(true);
  }

  protected layout(): InvoiceLayout {
    const v = String(this.f['invoiceLayout'] || this.hint('invoiceLayout') || 'classic');
    return v === 'modern' || v === 'compact' ? v : 'classic';
  }

  protected pickLogo(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.error.set(null);
    if (!/^image\/(png|jpeg)$/.test(file.type)) return void this.error.set('Choose a PNG or JPG logo.');
    if (file.size > 200 * 1024) return void this.error.set('That logo is too big (over 200 KB). Use a smaller picture.');
    const r = new FileReader();
    r.onload = () => (this.f['companyLogo'] = String(r.result));
    r.readAsDataURL(file);
  }

  /** a sample invoice with what is typed now (the server's value where a box is empty) */
  protected preview() {
    const v = (k: string) => String(this.f[k] || this.hint(k) || '');
    const company: InvoiceParty = {
      name: v('companyName'), address: v('companyAddress'), gstin: v('companyGstin'), pan: v('companyPan'), phone: v('companyPhone'), email: v('companyEmail'), website: v('companyWebsite'),
      bankDetails: v('bankDetails'), logo: String(this.f['companyLogo'] || ''), note: v('invoiceNote'), terms: v('invoiceTerms'), layout: this.layout(), accent: v('invoiceAccent'),
    };
    if (!previewInvoice(company)) this.error.set('The preview window was blocked. Allow pop-ups for this site.');
  }

  protected hint(k: string) {
    const d = this.defaults[k];
    return d === undefined || d === null || d === '' ? '' : String(d);
  }

  protected save() {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    const body: Values = {};
    for (const k of TEXT) body[k] = String(this.f[k] ?? '').trim();
    for (const k of NUMBERS) body[k] = this.f[k] === null || this.f[k] === '' || this.f[k] === undefined ? null : Number(this.f[k]);
    this.http.patch<Payload>(this.url, body).subscribe({
      next: (p) => {
        this.fill(p);
        this.busy.set(false);
        this.notice.set('Settings saved.');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }
}
