import { Component, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';
import { AuthShell } from '../auth-shell';

/** Landing page for the "set your password" link (a new shop owner, or a member of staff, or a password reset). */
@Component({
  selector: 'app-accept-invite',
  imports: [ReactiveFormsModule, AuthShell],
  template: `
    <app-auth-shell>
      @if (info(); as i) {
        <h1>Set your password</h1>
        <p class="au-sub">Welcome, {{ i.name }}.{{ i.shopName ? ' You are setting up ' + i.shopName + '.' : '' }} Your login email is <b>{{ i.email }}</b>.</p>

        @if (error()) { <p role="alert" class="au-err">{{ error() }}</p> }

        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <label class="au-lbl" for="pw">New password</label>
          <div class="au-field au-pw">
            <svg class="au-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>
            <input id="pw" [type]="show() ? 'text' : 'password'" formControlName="password" autocomplete="new-password" placeholder="At least 8 characters" />
            <button type="button" class="au-show" (click)="show.set(!show())" [attr.aria-pressed]="show()" [attr.aria-label]="show() ? 'Hide password' : 'Show password'">{{ show() ? 'Hide' : 'Show' }}</button>
          </div>
          <label class="au-lbl" for="pw2">Confirm password</label>
          <div class="au-field">
            <svg class="au-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>
            <input id="pw2" [type]="show() ? 'text' : 'password'" formControlName="confirm" autocomplete="new-password" placeholder="Type it again" />
          </div>
          <button type="submit" class="au-btn" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Set password and sign in' }}</button>
        </form>
      } @else if (invalid()) {
        <h1>Link not valid</h1>
        <p class="au-sub">{{ invalid() }}</p>
        <a href="/login" class="au-btn" style="display:grid;place-items:center;text-decoration:none">Go to sign in</a>
      } @else {
        <h1>One moment</h1>
        <p class="au-sub">Checking your link…</p>
      }
      <p class="au-legal">Licensed pharmacy software · Your data is encrypted and audited.</p>
    </app-auth-shell>
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
  protected readonly show = signal(false);

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
