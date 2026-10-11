import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { apiError } from '../../shared/utils/api';
import { AuthShell } from '../auth-shell';
import { PlanCards, PublicPlan } from './plan-cards';

/** What every plan includes (the plan cards show what differs: outlets, staff, barcode billing, UPI, GST reports). Only things that are built. */
const INCLUDED = [
  { title: 'Billing', items: ['POS billing with GST, returns and bill cancel', 'Schedule H and H1 details and register', 'Print A4 or 80 mm, or send the bill on WhatsApp', 'UPI QR and split payments'] },
  { title: 'Stock', items: ['Batch and expiry tracking (FEFO)', 'Low-stock and expiry alerts', 'Stock count and purchase orders', 'Import your stock from Excel'] },
  { title: 'Customers', items: ['Udhaar (credit) tracking and reminders', 'Refill reminders for regular medicines', 'Customer statements'] },
  { title: 'Money and control', items: ['Expenses, day-close cash count', 'Profit and loss reports', 'Staff roles and a log of who did what', 'Two-step sign-in'] },
];

/** Start a free trial: choose a plan (read live from the plan list), tell us about the shop, then set a password from the email we send. */
@Component({
  selector: 'app-signup',
  imports: [FormsModule, RouterLink, AuthShell, PlanCards],
  template: `
    <app-auth-shell
      heading="Start free. Be billing in minutes."
      text="Choose a plan, tell us about your shop and set a password from the email we send. No card needed for the trial."
      [features]="visualFeatures">
      @if (done(); as d) {
        <h1>Check your email</h1>
        <p class="au-sub">We have sent a link to <b>{{ d.email }}</b>. Open it to set your password and start using Orvia for <b>{{ d.shopName }}</b>.</p>
        <p class="au-ok" role="status">@if (d.trialDays > 0) { Your <b>{{ d.trialDays }}-day free trial</b> of the <b>{{ d.plan }}</b> plan has started. } @else { You are on the <b>{{ d.plan }}</b> plan. }</p>
        <p class="au-more" style="text-align:left">The link works for 7 days. Not there? Look in your spam folder, or use “Forgot password” on the sign-in page.</p>
        <a routerLink="/login" class="au-btn" style="display:grid;place-items:center;text-decoration:none;margin-top:18px">Go to sign in</a>
      } @else {
        <h1>Start your free trial</h1>
        <p class="au-sub">{{ chosen()?.trialDays ? chosen()!.trialDays + ' days free, no card needed.' : 'Pick a plan and tell us about your shop.' }}</p>

        @if (error()) { <p role="alert" class="au-err">{{ error() }}</p> }

        <span class="au-lbl">Choose a plan</span>
        <app-plan-cards [plans]="plans()" [selected]="planCode()" [loading]="loading()" (pick)="planCode.set($event)" />

        <details class="au-incl" [open]="roomy">
          <summary>What you get in every plan</summary>
          <div class="au-incl-grid">
            @for (g of included; track g.title) {
              <div>
                <b>{{ g.title }}</b>
                <ul>@for (i of g.items; track i) { <li>{{ i }}</li> }</ul>
              </div>
            }
          </div>
        </details>

        <form (ngSubmit)="submit()" novalidate>
          <label class="au-lbl" for="su-shop">Shop name</label>
          <div class="au-field">
            <svg class="au-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /><path d="M12 12v5M9.5 14.5h5" /></svg>
            <input id="su-shop" name="shopName" autocomplete="organization" placeholder="e.g. Green Cross Pharmacy" [(ngModel)]="f.shopName" />
          </div>

          <div class="au-two">
            <div>
              <label class="au-lbl" for="su-owner">Your name</label>
              <div class="au-field">
                <svg class="au-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5" /></svg>
                <input id="su-owner" name="ownerName" autocomplete="name" placeholder="Full name" [(ngModel)]="f.ownerName" />
              </div>
            </div>
            <div>
              <label class="au-lbl" for="su-phone">Mobile number</label>
              <div class="au-field">
                <svg class="au-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="3.5" width="10" height="17" rx="2.5" /><path d="M11 17.5h2" /></svg>
                <input id="su-phone" name="phone" inputmode="numeric" autocomplete="tel" placeholder="10 digits" [(ngModel)]="f.phone" />
              </div>
            </div>
          </div>

          <label class="au-lbl" for="su-email">Email</label>
          <div class="au-field">
            <svg class="au-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="3" /><path d="m4.5 8 7.5 5.5L19.5 8" /></svg>
            <input id="su-email" name="email" type="email" autocomplete="email" placeholder="you@yourpharmacy.com" [(ngModel)]="f.email" />
          </div>
          <p class="au-hint">We send the link to set your password here.</p>

          <label class="au-lbl" for="su-city">City <span>(optional)</span></label>
          <div class="au-field">
            <svg class="au-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0C5.5 15.4 12 21 12 21Z" /><circle cx="12" cy="10" r="2.3" /></svg>
            <input id="su-city" name="city" autocomplete="address-level2" placeholder="City" [(ngModel)]="f.city" />
          </div>

          <!-- a field only a bot fills in -->
          <div class="au-trap" aria-hidden="true"><label for="su-web">Website</label><input id="su-web" name="website" tabindex="-1" autocomplete="off" [(ngModel)]="f.website" /></div>

          <label class="au-terms">
            <input type="checkbox" name="terms" [(ngModel)]="f.terms" />
            <span>I agree to the <a [href]="termsUrl" target="_blank" rel="noopener">Terms of use</a> and the <a [href]="privacyUrl" target="_blank" rel="noopener">Privacy policy</a>.</span>
          </label>

          <button type="submit" class="au-btn" [disabled]="busy() || !plans().length">{{ busy() ? 'Creating your shop…' : chosen()?.trialDays ? 'Start ' + chosen()!.trialDays + '-day free trial' : 'Create my shop' }}</button>
          <p class="au-more">You can add your drug licence and GST details later, inside Orvia.</p>
        </form>

        <p class="au-signup">Already have an account? <a routerLink="/login">Sign in</a></p>
      }
      <p class="au-legal">Licensed pharmacy software · Your data is encrypted and audited.</p>
    </app-auth-shell>
  `,
})
export class Signup implements OnInit {
  private readonly http = inject(HttpClient);

  /** ?plan=<code> (from a pricing button) pre-chooses a plan */
  readonly plan = input<string>();

  protected readonly included = INCLUDED;
  /** the picture side lists the headline points (it is hidden on a phone, where the list above the form is used) */
  protected readonly visualFeatures = ['14-day free trial, no card needed', 'Fast POS billing with GST', 'Batch & expiry tracking (FEFO)', 'Schedule H1 register', 'Udhaar and refill reminders', 'Stock count and purchase orders', 'Profit and day-close reports', 'Bill on WhatsApp in one tap'];
  /** the full list starts open on a tablet or desktop and closed on a phone */
  protected readonly roomy = typeof window === 'undefined' || window.innerWidth > 820;
  protected readonly termsUrl = environment.termsUrl;
  protected readonly privacyUrl = environment.privacyUrl;
  protected readonly plans = signal<PublicPlan[]>([]);
  protected readonly planCode = signal('');
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal<{ email: string; shopName: string; plan: string; trialDays: number } | null>(null);
  protected readonly chosen = computed(() => this.plans().find((p) => p.code === this.planCode()) ?? null);
  protected f = { shopName: '', ownerName: '', phone: '', email: '', city: '', terms: false, website: '' };

  ngOnInit() {
    this.http.get<{ plans: PublicPlan[] }>(`${environment.apiUrl}/public/plans`).subscribe({
      next: (r) => {
        this.plans.set(r.plans);
        const wanted = this.plan();
        // the plan from the link if it is on offer, otherwise the middle one (the one most shops pick), otherwise the first
        this.planCode.set(r.plans.find((p) => p.code === wanted)?.code ?? r.plans[Math.floor((r.plans.length - 1) / 2)]?.code ?? '');
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Could not load the plans. Please refresh the page.');
      },
    });
  }

  protected submit() {
    this.error.set(null);
    const f = this.f;
    if (!this.planCode()) return this.error.set('Choose a plan.');
    if (f.shopName.trim().length < 2) return this.error.set('Enter the shop name.');
    if (f.ownerName.trim().length < 2) return this.error.set('Enter your name.');
    if (f.phone.replace(/\D/g, '').length < 10) return this.error.set('Enter a 10-digit mobile number.');
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return this.error.set('Enter a valid email address.');
    if (!f.terms) return this.error.set('Please accept the Terms of use and Privacy policy to continue.');
    this.busy.set(true);
    this.http
      .post<{ email: string; shopName: string; plan: PublicPlan }>(`${environment.apiUrl}/public/signup`, {
        shopName: f.shopName.trim(),
        ownerName: f.ownerName.trim(),
        email: f.email.trim(),
        phone: f.phone.trim(),
        city: f.city.trim() || undefined,
        planCode: this.planCode(),
        acceptTerms: true,
        website: f.website,
      })
      .subscribe({
        next: (r) => {
          this.busy.set(false);
          const p = this.chosen();
          this.done.set({ email: r.email ?? f.email.trim(), shopName: r.shopName ?? f.shopName.trim(), plan: p?.name ?? '', trialDays: p?.trialDays ?? 0 });
        },
        error: (e) => {
          this.busy.set(false);
          this.error.set(e?.status === 429 ? 'Too many sign-ups from this connection. Please try again in an hour.' : apiError(e));
        },
      });
  }
}
