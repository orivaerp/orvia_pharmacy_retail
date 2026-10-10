import { Component, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { Logo } from '../../shared/components/logo';
import { apiError } from '../../shared/utils/api';

/** Landing page for the "set your password" link a provider sends to a new shop owner. */
@Component({
  selector: 'app-accept-invite',
  imports: [ReactiveFormsModule, Logo],
  template: `
    <main class="grid min-h-screen place-items-center bg-white px-6 py-12">
      <div class="w-full max-w-sm">
        <app-logo />
        @if (info(); as i) {
          <h1 class="mt-8 font-display text-3xl font-bold text-orvia-950">Set your password</h1>
          <p class="mt-1.5 text-sm text-slate-500">
            Welcome, {{ i.name }}.{{ i.shopName ? ' You are setting up ' + i.shopName + '.' : '' }} Your login email is <strong>{{ i.email }}</strong>.
          </p>

          @if (error()) {
            <div role="alert" class="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{{ error() }}</div>
          }

          <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 space-y-4" novalidate>
            <div>
              <label for="pw" class="mb-1.5 block text-sm font-medium text-slate-700">New password</label>
              <input id="pw" type="password" formControlName="password" autocomplete="new-password"
                class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-orvia-500 focus:bg-white focus:ring-4 focus:ring-orvia-100" />
              <p class="mt-1 text-xs text-slate-400">At least 8 characters.</p>
            </div>
            <div>
              <label for="pw2" class="mb-1.5 block text-sm font-medium text-slate-700">Confirm password</label>
              <input id="pw2" type="password" formControlName="confirm" autocomplete="new-password"
                class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-orvia-500 focus:bg-white focus:ring-4 focus:ring-orvia-100" />
            </div>
            <button type="submit" [disabled]="saving()"
              class="w-full rounded-xl bg-orvia-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orvia-600/25 transition hover:bg-orvia-700 disabled:opacity-70">
              {{ saving() ? 'Saving…' : 'Set password and sign in' }}
            </button>
          </form>
        } @else if (invalid()) {
          <h1 class="mt-8 font-display text-3xl font-bold text-orvia-950">Link not valid</h1>
          <p class="mt-2 text-sm text-slate-500">{{ invalid() }}</p>
          <a href="/login" class="mt-6 inline-block text-sm font-medium text-orvia-700 hover:text-orvia-900">Go to sign in</a>
        } @else {
          <p class="mt-8 text-sm text-slate-500">Checking your link…</p>
        }
      </div>
    </main>
  `,
})
export class AcceptInvite {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  /** ?token=... (component input binding) */
  token = input<string>();

  protected readonly info = signal<{ name: string; email: string; shopName: string | null } | null>(null);
  protected readonly invalid = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirm: ['', Validators.required],
  });

  constructor() {
    effect(() => {
      const token = this.token();
      if (!token) {
        this.invalid.set('This link is missing its token. Ask your provider to send it again.');
        return;
      }
      this.auth.inspectInvite(token).subscribe({
        next: (i) => this.info.set(i),
        error: (e) => this.invalid.set(apiError(e)),
      });
    });
  }

  protected submit() {
    const { password, confirm } = this.form.getRawValue();
    if (password.length < 8) return this.error.set('Password must be at least 8 characters.');
    if (password !== confirm) return this.error.set('The two passwords do not match.');

    this.saving.set(true);
    this.error.set(null);
    this.auth.acceptInvite(this.token()!, password).subscribe({
      next: (res) => (!('accessToken' in res) ? this.router.navigate(['/login'], { queryParams: { reset: 1 } }) : this.router.navigateByUrl(this.auth.homeUrl())),
      error: (e) => {
        this.saving.set(false);
        this.error.set(apiError(e));
      },
    });
  }
}
