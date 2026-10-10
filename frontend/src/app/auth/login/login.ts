import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { Logo } from '../../shared/components/logo';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, FormsModule, RouterLink, Logo],
  templateUrl: './login.html',
})
export class Login {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** true when the person has just reset a password and must sign in again */
  protected readonly resetDone = !!inject(ActivatedRoute).snapshot.queryParamMap.get('reset');

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showPassword = signal(false);
  /** set after a correct password when a code is also needed */
  protected readonly challenge = signal<string | null>(null);
  protected code = '';

  protected readonly form = this.fb.nonNullable.group({
    shopCode: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  protected verify() {
    const challenge = this.challenge();
    if (!challenge || this.code.trim().length < 6) return this.error.set('Enter the 6-digit code from your authenticator app.');
    this.loading.set(true);
    this.error.set(null);
    this.auth.loginTwoFactor(challenge, this.code.trim()).subscribe({
      next: () => this.router.navigateByUrl(this.auth.homeUrl()),
      error: (e: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(e.status === 0 ? 'Cannot reach the server. Please try again.' : (e.error?.message ?? 'That code is not right.'));
        if (e.status === 401) this.back(); // the sign-in expired: start over
      },
    });
  }

  protected back() {
    this.challenge.set(null);
    this.code = '';
  }

  protected submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set(null);

    const { shopCode, ...creds } = this.form.getRawValue();
    this.auth.login({ ...creds, shopCode: shopCode || undefined }).subscribe({
      next: (res) => {
        if ('twoFactorRequired' in res) {
          this.loading.set(false);
          this.challenge.set(res.challenge);
          return;
        }
        this.router.navigateByUrl(this.auth.homeUrl());
      },
      error: (e: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(
          e.status === 0
            ? 'Cannot reach the server. Please try again.'
            : (e.error?.message ?? 'Invalid email or password.'),
        );
      },
    });
  }
}
