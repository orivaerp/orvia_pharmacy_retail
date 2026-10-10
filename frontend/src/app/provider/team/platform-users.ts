import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';

interface PUser {
  _id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt?: string;
}

const ROLE_LABEL: Record<string, string> = { super_admin: 'Super admin', support: 'Support' };
const ROLE_ABOUT: Record<string, string> = {
  super_admin: 'Everything: shops, plans, medicine master, team, audit log.',
  support: 'Look at shops (with a stated reason), no changes to plans, team or audit log.',
};

/** Orvia's own staff: add people, set their role, switch them off, help them back in. */
@Component({
  selector: 'app-platform-users',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Platform users</h1>
        <p class="mt-0.5 text-xs text-ink-soft">The people who work for Orvia and can sign in to this area. Each is given a link to set their own password.</p>
      </div>
      <button type="button" class="btn btn-primary" (click)="openAdd()">Add person</button>
    </div>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (link(); as l) {
      <section class="card mt-3" role="status">
        <h2 class="text-sm font-medium">Send this link to {{ l.name }}</h2>
        <p class="text-[11px] text-ink-soft">One use, valid for 7 days. They set their password with it. {{ l.emailed ? "We have also emailed it to them." : "Email is not set up, so send it yourself." }}</p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <code class="min-w-0 flex-1 break-all rounded-lg border border-line bg-white/50 px-2 py-1.5 text-[11px]">{{ l.url }}</code>
          <button type="button" class="btn btn-ghost" (click)="copy(l.url)">Copy</button>
          <button type="button" class="btn btn-ghost" (click)="link.set(null)">Done</button>
        </div>
      </section>
    }

    <section class="card mt-3">
      <div class="overflow-x-auto" [class.opacity-50]="loading()">
        <table class="w-full min-w-176 text-left">
          <thead>
            <tr class="text-[11px] text-ink-soft">
              <th class="py-1.5 pr-3 font-normal">Person</th>
              <th class="py-1.5 pr-3 font-normal">Role</th>
              <th class="py-1.5 pr-3 font-normal">2-step</th>
              <th class="py-1.5 pr-3 font-normal">Last sign-in</th>
              <th class="py-1.5 pr-3 font-normal">Status</th>
              <th class="py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            @for (u of users(); track u._id) {
              <tr class="border-t border-line text-xs">
                <td class="py-2 pr-3"><span class="font-medium">{{ u.name }}</span>{{ u._id === auth.user()?.id ? ' (you)' : '' }}<div class="text-[11px] text-ink-soft">{{ u.email }}</div></td>
                <td class="py-2 pr-3">{{ roleLabel(u.role) }}</td>
                <td class="py-2 pr-3"><span class="badge" [class]="u.twoFactorEnabled ? 'bg-tone-lime' : 'bg-tone-rose'">{{ u.twoFactorEnabled ? 'on' : 'off' }}</span></td>
                <td class="py-2 pr-3 whitespace-nowrap">{{ u.lastLoginAt ? (u.lastLoginAt | date: 'dd MMM yyyy, HH:mm') : 'never' }}</td>
                <td class="py-2 pr-3"><span class="badge" [class]="u.isActive ? 'bg-tone-lime' : 'bg-chip'">{{ u.isActive ? 'active' : 'switched off' }}</span></td>
                <td class="py-2 text-right whitespace-nowrap">
                  <button type="button" class="btn btn-ghost !px-2.5 !py-0.5" (click)="openEdit(u)">Edit</button>
                  <button type="button" class="btn btn-ghost !px-2.5 !py-0.5" [disabled]="sendingId() !== null" (click)="reinvite(u)">{{ sendingId() === u._id ? 'Sending…' : 'Password link' }}</button>
                  @if (u.twoFactorEnabled) { <button type="button" class="btn btn-ghost !px-2.5 !py-0.5" (click)="reset2fa(u)">Reset 2-step</button> }
                  @if (u._id !== auth.user()?.id) {
                    <button type="button" class="btn btn-ghost !px-2.5 !py-0.5" (click)="toggle(u)">{{ u.isActive ? 'Switch off' : 'Switch on' }}</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="py-8 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'No one yet.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    @if (dialog(); as d) {
      <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="dialog.set(null)">
        <form class="w-full max-w-md rounded-2xl bg-surface-solid p-5 shadow-xl" (click)="$event.stopPropagation()" (ngSubmit)="save()" role="dialog" aria-modal="true">
          <h2 class="text-lg font-medium">{{ d === 'new' ? 'Add a person' : 'Edit ' + d.name }}</h2>
          @if (formError()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ formError() }}</p> }
          <div class="mt-3 grid gap-3">
            <div><label class="label" for="pu-name">Name *</label><input id="pu-name" name="name" class="field" [(ngModel)]="name" /></div>
            @if (d === 'new') { <div><label class="label" for="pu-email">Email *</label><input id="pu-email" name="email" type="email" class="field" [(ngModel)]="email" /></div> }
            <div>
              <label class="label" for="pu-role">Role *</label>
              <select id="pu-role" name="role" class="field" [(ngModel)]="role" [disabled]="d !== 'new' && d._id === auth.user()?.id">
                @for (r of roles(); track r) { <option [value]="r">{{ roleLabel(r) }}</option> }
              </select>
              <p class="mt-1 text-[11px] text-ink-soft">{{ about(role) }}</p>
            </div>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="btn btn-ghost" (click)="dialog.set(null)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : d === 'new' ? 'Add and get link' : 'Save' }}</button>
          </div>
        </form>
      </div>
    }
  `,
})
export class PlatformUsers {
  private readonly http = inject(HttpClient);
  protected readonly auth = inject(AuthService);
  private readonly url = `${environment.apiUrl}/provider/platform-users`;

  protected readonly users = signal<PUser[]>([]);
  protected readonly roles = signal<string[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly sendingId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly link = signal<{ name: string; url: string; emailed: boolean } | null>(null);
  protected readonly dialog = signal<PUser | 'new' | null>(null);
  protected name = '';
  protected email = '';
  protected role = 'support';

  constructor() {
    this.load();
  }

  protected roleLabel = (r: string) => ROLE_LABEL[r] ?? r;
  protected about = (r: string) => ROLE_ABOUT[r] ?? '';

  private load() {
    this.loading.set(true);
    this.http.get<{ users: PUser[]; roles: string[] }>(this.url).subscribe({
      next: (r) => {
        this.users.set(r.users);
        this.roles.set(r.roles);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }

  private run<T>(req: import('rxjs').Observable<T>, ok: string, then?: (r: T) => void) {
    this.error.set(null);
    this.notice.set(null);
    req.subscribe({
      next: (r) => {
        this.notice.set(ok);
        then?.(r);
        this.load();
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  protected openAdd() {
    this.name = this.email = '';
    this.role = 'support';
    this.formError.set(null);
    this.dialog.set('new');
  }

  protected openEdit(u: PUser) {
    this.name = u.name;
    this.role = u.role;
    this.formError.set(null);
    this.dialog.set(u);
  }

  protected save() {
    const d = this.dialog();
    if (!d) return;
    if (this.name.trim().length < 2) return this.formError.set('Enter the name.');
    if (d === 'new' && !/^\S+@\S+\.\S+$/.test(this.email.trim())) return this.formError.set('Enter a valid email address.');
    this.busy.set(true);
    this.formError.set(null);
    const req = d === 'new' ? this.http.post<{ inviteUrl: string; emailSent?: boolean }>(this.url, { name: this.name.trim(), email: this.email.trim(), role: this.role }) : this.http.patch(`${this.url}/${d._id}`, { name: this.name.trim(), role: this.role });
    req.subscribe({
      next: (r) => {
        this.busy.set(false);
        this.dialog.set(null);
        if (d === 'new') this.link.set({ name: this.name.trim(), url: (r as { inviteUrl: string }).inviteUrl, emailed: !!(r as { emailSent?: boolean }).emailSent });
        this.notice.set(d === 'new' ? 'Added. Send them the link below.' : 'Saved. A role change applies on their next action.');
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.formError.set(apiError(e));
      },
    });
  }

  protected toggle(u: PUser) {
    if (u.isActive && !confirm(`Switch off ${u.name}? They are signed out of every request immediately.`)) return;
    this.run(this.http.post(`${this.url}/${u._id}/${u.isActive ? 'deactivate' : 'activate'}`, {}), u.isActive ? `${u.name} is switched off.` : `${u.name} can sign in again.`);
  }

  protected reinvite(u: PUser) {
    if (this.sendingId()) return;
    this.sendingId.set(u._id);
    this.error.set(null);
    this.notice.set(null);
    this.http.post<{ inviteUrl: string; emailSent?: boolean }>(`${this.url}/${u._id}/reinvite`, {}).subscribe({
      next: (r) => {
        this.sendingId.set(null);
        this.link.set({ name: u.name, url: r.inviteUrl, emailed: !!r.emailSent });
        this.notice.set(r.emailSent ? `Password link emailed to ${u.email}.` : 'Link ready below, but the email could not be sent (check Provider > Email). Copy it and send it yourself.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        this.load();
      },
      error: (e) => {
        this.sendingId.set(null);
        this.error.set(apiError(e));
      },
    });
  }

  protected reset2fa(u: PUser) {
    if (!confirm(`Clear two-step verification for ${u.name}? Use this only if they lost their phone and recovery codes. They set it up again at their next sign-in.`)) return;
    this.run(this.http.post(`${this.url}/${u._id}/reset-2fa`, {}), `Two-step verification cleared for ${u.name}.`);
  }

  protected async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.notice.set('Link copied.');
    } catch {
      this.error.set('Copy failed. Select the link and copy it by hand.');
    }
  }
}
