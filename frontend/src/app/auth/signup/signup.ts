import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Logo } from '../../shared/components/logo';
import { apiError } from '../../shared/utils/api';
import { PlanCards, PublicPlan } from './plan-cards';

const FIELD = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition outline-none placeholder:text-slate-400 focus:border-orvia-500 focus:bg-white focus:ring-4 focus:ring-orvia-100';

/** Start a free trial: choose a plan (read live from the plan list), tell us about the shop, then set a password from the email we send. */
@Component({
  selector: 'app-signup',
  imports: [FormsModule, RouterLink, Logo, PlanCards],
  template: `
    <main class="min-h-screen bg-slate-50">
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <a routerLink="/login" aria-label="Orvia"><app-logo /></a>
          <p class="text-sm text-slate-600">Already have an account? <a routerLink="/login" class="font-semibold text-orvia-700 hover:text-orvia-900">Sign in</a></p>
        </div>
      </header>

      <div class="mx-auto max-w-5xl px-4 py-8">
        @if (done(); as d) {
          <section class="mx-auto max-w-lg rounded-2xl bg-white p-8 text-center shadow-sm" role="status">
            <h1 class="font-display text-2xl font-bold text-slate-900">Check your email</h1>
            <p class="mt-3 text-sm text-slate-600">We have sent a link to <b>{{ d.email }}</b>. Open it to set your password and start using Orvia for <b>{{ d.shopName }}</b>.</p>
            <p class="mt-3 text-sm text-slate-600">@if (d.trialDays > 0) { Your <b>{{ d.trialDays }}-day free trial</b> of the <b>{{ d.plan }}</b> plan has started. } @else { You are on the <b>{{ d.plan }}</b> plan. }</p>
            <p class="mt-4 text-xs text-slate-500">The link works for 7 days. Not there? Look in your spam folder, or use “Forgot password” on the sign-in page.</p>
            <a routerLink="/login" class="mt-6 inline-block rounded-xl bg-orvia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-orvia-700">Go to sign in</a>
          </section>
        } @else {
          <h1 class="font-display text-3xl font-bold text-slate-900">Start your free trial</h1>
          <p class="mt-1 text-sm text-slate-600">@if (chosen(); as c) { @if (c.trialDays > 0) { {{ c.trialDays }} days free, no card needed. } @else { Pick a plan and tell us about your shop. } } @else { Pick a plan and tell us about your shop. }</p>

          <h2 class="mt-6 mb-2 text-sm font-semibold text-slate-800">1. Choose a plan</h2>
          <app-plan-cards [plans]="plans()" [selected]="planCode()" [loading]="loading()" (pick)="planCode.set($event)" />

          <form class="mt-8 max-w-2xl" (ngSubmit)="submit()" novalidate>
            <h2 class="mb-2 text-sm font-semibold text-slate-800">2. About you and your shop</h2>
            @if (error()) { <p role="alert" class="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{{ error() }}</p> }
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="sm:col-span-2">
                <label for="su-shop" class="mb-1.5 block text-sm font-medium text-slate-700">Shop name</label>
                <input id="su-shop" name="shopName" [class]="field" autocomplete="organization" placeholder="e.g. Green Cross Pharmacy" [(ngModel)]="f.shopName" />
              </div>
              <div>
                <label for="su-owner" class="mb-1.5 block text-sm font-medium text-slate-700">Your name</label>
                <input id="su-owner" name="ownerName" [class]="field" autocomplete="name" [(ngModel)]="f.ownerName" />
              </div>
              <div>
                <label for="su-phone" class="mb-1.5 block text-sm font-medium text-slate-700">Mobile number</label>
                <input id="su-phone" name="phone" [class]="field" inputmode="numeric" autocomplete="tel" placeholder="10 digits" [(ngModel)]="f.phone" />
              </div>
              <div>
                <label for="su-email" class="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
                <input id="su-email" name="email" type="email" [class]="field" autocomplete="email" placeholder="you@pharmacy.com" [(ngModel)]="f.email" />
                <p class="mt-1 text-xs text-slate-500">We send the link to set your password here.</p>
              </div>
              <div>
                <label for="su-city" class="mb-1.5 block text-sm font-medium text-slate-700">City <span class="font-normal text-slate-400">(optional)</span></label>
                <input id="su-city" name="city" [class]="field" autocomplete="address-level2" [(ngModel)]="f.city" />
              </div>
              <!-- a field only a bot fills in -->
              <div class="absolute -left-[9999px]" aria-hidden="true"><label for="su-web">Website</label><input id="su-web" name="website" tabindex="-1" autocomplete="off" [(ngModel)]="f.website" /></div>
            </div>

            <label class="mt-5 flex items-start gap-2 text-sm text-slate-600">
              <input type="checkbox" name="terms" class="mt-0.5 h-4 w-4 rounded border-slate-300 accent-orvia-600" [(ngModel)]="f.terms" />
              <span>I agree to the <a [href]="termsUrl" target="_blank" rel="noopener" class="font-medium text-orvia-700 underline">Terms of use</a> and the <a [href]="privacyUrl" target="_blank" rel="noopener" class="font-medium text-orvia-700 underline">Privacy policy</a>.</span>
            </label>

            <button type="submit" [disabled]="busy() || !plans().length" class="mt-6 flex w-full items-center justify-center rounded-xl bg-orvia-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orvia-600/25 transition hover:bg-orvia-700 focus:ring-4 focus:ring-orvia-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto sm:px-8">
              {{ busy() ? 'Creating your shop…' : chosen()?.trialDays ? 'Start ' + chosen()!.trialDays + '-day free trial' : 'Create my shop' }}
            </button>
            <p class="mt-3 text-xs text-slate-500">You can add your drug licence and GST details later, inside Orvia.</p>
          </form>
        }
      </div>
    </main>
  `,
})
export class Signup implements OnInit {
  private readonly http = inject(HttpClient);

  /** ?plan=<code> (from a pricing button) pre-chooses a plan */
  readonly plan = input<string>();

  protected readonly field = FIELD;
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
