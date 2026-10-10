import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { Logo } from '../../shared/components/logo';
import { apiError } from '../../shared/utils/api';

/** "Forgot password": asks for the email and sends a 1-hour reset link. It answers the same whoever the email belongs to. */
@Component({
  selector: 'app-forgot-password',
  imports: [FormsModule, RouterLink, Logo],
  template: `
    <main class="grid min-h-screen place-items-center bg-white px-6 py-12">
      <div class="w-full max-w-sm">
        <app-logo />
        <h1 class="mt-8 font-display text-3xl font-bold text-orvia-950">Forgot your password?</h1>

        @if (sent()) {
          <p role="status" class="mt-4 rounded-xl border border-orvia-200 bg-orvia-50 px-4 py-3 text-sm text-orvia-900">
            If that email belongs to an account, a reset link is on its way. It works once and lasts 1 hour. Check your spam folder too.
          </p>
          <a routerLink="/login" class="mt-6 inline-block text-sm font-medium text-orvia-700 hover:text-orvia-900">Back to sign in</a>
        } @else {
          <p class="mt-1.5 text-sm text-slate-500">Enter your email and we will send you a link to choose a new one.</p>
          @if (error()) {
            <div role="alert" class="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{{ error() }}</div>
          }
          <form (ngSubmit)="submit()" class="mt-6 space-y-4" novalidate>
            <div>
              <label for="fp-shop" class="mb-1.5 block text-sm font-medium text-slate-700">Shop code <span class="font-normal text-slate-400">(only if you have the same email in more than one shop)</span></label>
              <input id="fp-shop" name="shop" [(ngModel)]="shopCode" type="text" placeholder="e.g. green-cross"
                class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-orvia-500 focus:bg-white focus:ring-4 focus:ring-orvia-100" />
            </div>
            <div>
              <label for="fp-email" class="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <input id="fp-email" name="email" [(ngModel)]="email" type="email" autocomplete="username" placeholder="you@pharmacy.com"
                class="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-orvia-500 focus:bg-white focus:ring-4 focus:ring-orvia-100" />
            </div>
            <button type="submit" [disabled]="busy()"
              class="w-full rounded-xl bg-orvia-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orvia-600/25 transition hover:bg-orvia-700 disabled:opacity-70">
              {{ busy() ? 'Sending…' : 'Send reset link' }}
            </button>
          </form>
          <a routerLink="/login" class="mt-6 inline-block text-sm font-medium text-orvia-700 hover:text-orvia-900">Back to sign in</a>
        }
      </div>
    </main>
  `,
})
export class ForgotPassword {
  private readonly auth = inject(AuthService);
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);
  protected email = '';
  protected shopCode = '';

  protected submit() {
    if (!/^\S+@\S+\.\S+$/.test(this.email.trim())) return this.error.set('Enter a valid email address.');
    this.busy.set(true);
    this.error.set(null);
    this.auth.forgotPassword(this.email.trim(), this.shopCode.trim() || undefined).subscribe({
      next: () => {
        this.busy.set(false);
        this.sent.set(true);
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }
}
