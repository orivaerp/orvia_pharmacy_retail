import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../utils/api';

interface Status {
  enabled: boolean;
  enabledAt: string | null;
  recoveryLeft: number;
  required: boolean;
  available: boolean;
}
interface Setup {
  secret: string;
  otpauthUrl: string;
  qr: string;
}

/** Two-step verification with an authenticator app. Used by Orvia staff and shop users alike. */
@Component({
  selector: 'app-security',
  imports: [FormsModule, DatePipe],
  template: `
    <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Security</h1>
    <p class="mt-0.5 text-xs text-ink-soft">Protect your account with a second step at sign-in: a 6-digit code from an authenticator app on your phone.</p>

    @if (auth.user()?.mustSetup2fa) {
      <p role="alert" class="mt-3 rounded-xl bg-tone-rose px-3 py-2 text-xs"><b>Set this up to continue.</b> Orvia requires two-step verification for staff. Everything else stays locked until it is on.</p>
    }
    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (codes(); as list) {
      <section class="card mt-3">
        <h2 class="text-sm font-medium">Save your recovery codes</h2>
        <p class="mt-1 text-xs text-ink-soft">If you lose your phone, each of these works once instead of the 6-digit code. They are shown <b>only now</b>. Keep them somewhere safe, not on the same phone.</p>
        <ul class="mt-2 grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-4">
          @for (c of list; track c) { <li class="rounded-lg border border-line bg-white/60 px-2 py-1 text-center">{{ c }}</li> }
        </ul>
        <div class="mt-3 flex gap-2">
          <button type="button" class="btn btn-ghost" (click)="copyCodes(list)">Copy</button>
          <button type="button" class="btn btn-primary" (click)="codes.set(null)">I have saved them</button>
        </div>
      </section>
    } @else if (s(); as st) {
      <section class="card mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-medium">Two-step verification</h2>
          <span class="badge" [class]="st.enabled ? 'bg-tone-lime' : 'bg-tone-rose'">{{ st.enabled ? 'On' : 'Off' }}</span>
        </div>

        @if (!st.available) {
          <p class="mt-2 text-xs text-ink-soft">This is not switched on for this installation yet. Ask the Orvia team.</p>
        } @else if (!st.enabled && !setup()) {
          <p class="mt-2 text-xs text-ink-soft">You will need an authenticator app such as Google Authenticator, Microsoft Authenticator or Authy.</p>
          <button type="button" class="btn btn-primary mt-3" [disabled]="busy()" (click)="begin()">Set up</button>
        } @else if (setup(); as su) {
          <ol class="mt-2 list-decimal space-y-1 pl-4 text-xs text-ink-soft">
            <li>Open your authenticator app and add an account by scanning this QR.</li>
            <li>Type the 6-digit code the app shows now.</li>
          </ol>
          <div class="mt-3 flex flex-wrap items-start gap-4">
            <img [src]="su.qr" width="176" height="176" alt="QR code to scan with your authenticator app" class="rounded-xl border border-line bg-white p-1" />
            <div class="min-w-0 text-xs">
              <p class="text-ink-soft">Cannot scan? Enter this key in the app:</p>
              <code class="mt-1 block rounded-lg border border-line bg-white/60 px-2 py-1 font-mono break-all select-all">{{ su.secret }}</code>
              <form class="mt-3 flex items-end gap-2" (ngSubmit)="enable()">
                <div><label class="label" for="s-code">6-digit code</label><input id="s-code" name="code" class="field w-36" inputmode="numeric" autocomplete="one-time-code" maxlength="7" [(ngModel)]="code" /></div>
                <button class="btn btn-primary" type="submit" [disabled]="busy()">{{ busy() ? 'Checking…' : 'Turn on' }}</button>
                <button class="btn btn-ghost" type="button" (click)="setup.set(null); code = ''">Cancel</button>
              </form>
            </div>
          </div>
        } @else {
          <p class="mt-2 text-xs text-ink-soft">On since {{ st.enabledAt | date: 'dd MMM yyyy' }}. You have <b>{{ st.recoveryLeft }}</b> unused recovery code{{ st.recoveryLeft === 1 ? '' : 's' }}.</p>
          <form class="mt-3 grid gap-2 sm:grid-cols-2" (ngSubmit)="$event.preventDefault()" autocomplete="off">
            <div><label class="label" for="p-pw">Your password</label><input id="p-pw" name="pw" type="password" class="field" [(ngModel)]="password" autocomplete="current-password" /></div>
            <div><label class="label" for="p-code">Current 6-digit code</label><input id="p-code" name="pcode" class="field" inputmode="numeric" maxlength="7" [(ngModel)]="code" autocomplete="one-time-code" /></div>
            <div class="flex flex-wrap gap-2 sm:col-span-2">
              <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="newCodes()">Get new recovery codes</button>
              @if (!st.required) { <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="disable()">Turn off</button> }
            </div>
          </form>
          <p class="mt-2 text-[11px] text-ink-soft">Your password and a current code are needed to change these settings, so a stolen session cannot.{{ st.required ? ' Orvia staff cannot turn two-step verification off.' : '' }}</p>
        }
      </section>
    }
  `,
})
export class Security {
  private readonly http = inject(HttpClient);
  protected readonly auth = inject(AuthService);
  private readonly url = `${environment.apiUrl}/auth/2fa`;

  protected readonly s = signal<Status | null>(null);
  protected readonly setup = signal<Setup | null>(null);
  protected readonly codes = signal<string[] | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected code = '';
  protected password = '';

  constructor() {
    this.load();
  }

  private load() {
    this.http.get<Status>(`${this.url}/status`).subscribe({ next: (v) => this.s.set(v), error: (e) => this.error.set(apiError(e)) });
  }

  private start() {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
  }

  private fail = (e: unknown) => {
    this.busy.set(false);
    this.error.set(apiError(e));
  };

  protected begin() {
    this.start();
    this.http.post<Setup>(`${this.url}/setup`, {}).subscribe({
      next: (v) => {
        this.busy.set(false);
        this.setup.set(v);
      },
      error: this.fail,
    });
  }

  protected enable() {
    this.start();
    this.http.post<{ recoveryCodes: string[] }>(`${this.url}/enable`, { code: this.code.trim() }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.code = '';
        this.setup.set(null);
        this.codes.set(r.recoveryCodes);
        this.notice.set('Two-step verification is on.');
        this.load();
        this.auth.refreshMe(); // lifts the "set this up first" lock for Orvia staff
      },
      error: this.fail,
    });
  }

  private proof() {
    if (!this.password || this.code.trim().length < 6) {
      this.error.set('Enter your password and a current code from the app.');
      return null;
    }
    return { password: this.password, code: this.code.trim() };
  }

  protected newCodes() {
    const p = this.proof();
    if (!p) return;
    this.start();
    this.http.post<{ recoveryCodes: string[] }>(`${this.url}/recovery-codes`, p).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.code = this.password = '';
        this.codes.set(r.recoveryCodes);
        this.load();
      },
      error: this.fail,
    });
  }

  protected disable() {
    const p = this.proof();
    if (!p || !confirm('Turn off two-step verification? Your account will be protected by the password alone.')) return;
    this.start();
    this.http.post(`${this.url}/disable`, p).subscribe({
      next: () => {
        this.busy.set(false);
        this.code = this.password = '';
        this.notice.set('Two-step verification is off.');
        this.load();
        this.auth.refreshMe();
      },
      error: this.fail,
    });
  }

  protected async copyCodes(list: string[]) {
    try {
      await navigator.clipboard.writeText(list.join('\n'));
      this.notice.set('Copied.');
    } catch {
      this.error.set('Copy failed. Select the codes and copy them by hand.');
    }
  }
}
