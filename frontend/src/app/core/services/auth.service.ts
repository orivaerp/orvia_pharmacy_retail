import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  tenantId?: string;
  /** outlets this user may work in; empty = all of them (the owner) */
  branchIds?: string[];
  twoFactorEnabled?: boolean;
  /** Orvia staff must set up two-step verification before anything else opens */
  mustSetup2fa?: boolean;
}

export type AuthScope = 'platform' | 'tenant';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

/** Password was right, but a code is needed too. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challenge: string;
}

const TOKEN_KEY = 'orvia.accessToken';
const USER_KEY = 'orvia.user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly _user = signal<AuthUser | null>(this.readUser());
  readonly user = this._user.asReadonly();
  readonly isLoggedIn = computed(() => !!this._user() && !!this.token);
  /** 'platform' = service provider staff, 'tenant' = retail shop staff */
  readonly scope = computed<AuthScope | null>(() => {
    const u = this._user();
    return u ? (u.tenantId ? 'tenant' : 'platform') : null;
  });
  readonly homeUrl = computed(() => (this.scope() === 'platform' ? '/provider/dashboard' : '/retail/dashboard'));

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  login(payload: { email: string; password: string; shopCode?: string }) {
    return this.http.post<LoginResponse | TwoFactorChallenge>(`${environment.apiUrl}/auth/login`, payload).pipe(
      tap((res) => {
        if (!('twoFactorRequired' in res)) this.storeSession(res);
      }),
    );
  }

  /** Second step of sign-in: the 6-digit code from the authenticator app, or a recovery code. */
  loginTwoFactor(challenge: string, code: string) {
    return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login/2fa`, { challenge, code }).pipe(tap((res) => this.storeSession(res)));
  }

  /** "Forgot password": always answers the same, whether or not the email has an account. */
  forgotPassword(email: string, shopCode?: string) {
    return this.http.post<{ ok: boolean; message: string }>(`${environment.apiUrl}/auth/forgot`, { email, shopCode });
  }

  /** Re-reads who I am (for example after turning two-step verification on). */
  refreshMe() {
    this.http.get<AuthUser>(`${environment.apiUrl}/auth/me`).subscribe({
      next: (u) => {
        localStorage.setItem(USER_KEY, JSON.stringify(u));
        this._user.set(u);
      },
    });
  }

  /** Public: details shown on the "set your password" page. */
  inspectInvite(token: string) {
    return this.http.get<{ name: string; email: string; shopName: string | null }>(`${environment.apiUrl}/auth/invite/${token}`);
  }

  /** Sets the password from an invite link and signs the user in. */
  acceptInvite(token: string, password: string) {
    return this.http.post<LoginResponse | { passwordSet: true; twoFactorRequired: true }>(`${environment.apiUrl}/auth/invite/accept`, { token, password }).pipe(
      tap((res) => {
        if ('accessToken' in res) this.storeSession(res);
      }),
    );
  }

  private storeSession(res: LoginResponse) {
    localStorage.setItem(TOKEN_KEY, res.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    this._user.set(res.user);
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this._user.set(null);
    this.router.navigateByUrl('/login');
  }

  hasPermission(permission: string): boolean {
    return this._user()?.permissions.includes(permission) ?? false;
  }

  private readUser(): AuthUser | null {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null');
    } catch {
      return null;
    }
  }
}
