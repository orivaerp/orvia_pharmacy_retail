import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';
import { AuthShell } from '../auth-shell';

/** "Forgot password": asks for the email and sends a 1-hour reset link. It answers the same whoever the email belongs to. */
@Component({
  selector: 'app-forgot-password',
  imports: [FormsModule, RouterLink, AuthShell],
  template: `
    <app-auth-shell>
      <h1>Forgot your password?</h1>

      @if (sent()) {
        <p class="au-sub">Check your inbox.</p>
        <p role="status" class="au-ok">If that email belongs to an account, a reset link is on its way. It works once and lasts 1 hour. Check your spam folder too.</p>
        <p class="au-signup"><a routerLink="/login">Back to sign in</a></p>
      } @else {
        <p class="au-sub">Enter your email and we will send you a link to choose a new one.</p>
        @if (error()) { <p role="alert" class="au-err">{{ error() }}</p> }
        <form (ngSubmit)="submit()" novalidate>
          <label class="au-lbl" for="fp-shop">Shop code <span>(only if you have the same email in more than one shop)</span></label>
          <div class="au-field">
            <svg class="au-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /><path d="M12 12v5M9.5 14.5h5" /></svg>
            <input id="fp-shop" name="shop" [(ngModel)]="shopCode" type="text" placeholder="Shop code" />
          </div>
          <label class="au-lbl" for="fp-email">Email</label>
          <div class="au-field">
            <svg class="au-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="3" /><path d="m4.5 8 7.5 5.5L19.5 8" /></svg>
            <input id="fp-email" name="email" [(ngModel)]="email" type="email" autocomplete="username" placeholder="you@yourpharmacy.com" />
          </div>
          <button type="submit" class="au-btn" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send reset link' }}</button>
        </form>
        <p class="au-signup"><a routerLink="/login">Back to sign in</a></p>
      }
      <p class="au-legal">Licensed pharmacy software · Your data is encrypted and audited.</p>
    </app-auth-shell>
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
