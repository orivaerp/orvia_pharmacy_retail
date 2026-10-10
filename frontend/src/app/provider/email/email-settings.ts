import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { apiError } from '../../shared/utils/api';

interface Summary {
  configured: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  from: string | null;
  recent: { _id: string; at: string; to: string; subject: string; template: string; status: 'sent' | 'failed' | 'skipped'; error?: string }[];
}

/** Is email set up, send a test, and see what was sent. The server settings live in the environment, not here. */
@Component({
  selector: 'app-email-settings',
  imports: [FormsModule, DatePipe],
  template: `
    <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Email</h1>
    <p class="mt-0.5 text-xs text-ink-soft">Invitations, password resets and security notices are sent from here.</p>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (s(); as st) {
      <section class="card mt-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-sm font-medium">Mail server</h2>
          <span class="badge" [class]="st.configured ? 'bg-tone-lime' : 'bg-tone-rose'">{{ st.configured ? 'Set up' : 'Not set up' }}</span>
        </div>
        @if (st.configured) {
          <dl class="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <div class="flex justify-between"><dt class="text-ink-soft">Server</dt><dd>{{ st.host }}:{{ st.port }}{{ st.secure ? ' (SSL)' : '' }}</dd></div>
            <div class="flex justify-between"><dt class="text-ink-soft">Sign-in</dt><dd>{{ st.user || 'none' }}</dd></div>
            <div class="flex justify-between sm:col-span-2"><dt class="text-ink-soft">Sent as</dt><dd>{{ st.from }}</dd></div>
          </dl>
          <form class="mt-3 flex flex-wrap items-end gap-2" (ngSubmit)="test()">
            <div><label class="label" for="em-to">Send a test email to</label><input id="em-to" name="to" type="email" class="field w-64" [(ngModel)]="to" placeholder="you@yourdomain.com" /></div>
            <button class="btn btn-primary" type="submit" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send test' }}</button>
          </form>
        } @else {
          <p class="mt-2 text-xs text-ink-soft">Nothing is emailed yet. Invite links are still shown on screen so you can send them yourself. To switch email on, set these in the server's environment file and restart it:</p>
          <pre class="mt-2 overflow-x-auto rounded-lg border border-line bg-white/60 p-2 text-[11px]">SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-login
SMTP_PASS=your-password
MAIL_FROM=Orvia &lt;no-reply&#64;yourdomain.com&gt;</pre>
          <p class="mt-1 text-[11px] text-ink-soft">Use port 465 with SMTP_SECURE=true if your provider asks for SSL. Any SMTP provider works (Zoho, Brevo, Amazon SES, Gmail with an app password ...). Use a sender address on a domain you own and have verified with the provider, or messages land in spam.</p>
        }
      </section>

      <section class="card mt-3">
        <h2 class="text-sm font-medium">Recent emails</h2>
        <p class="text-[11px] text-ink-soft">Only who, what and whether it was delivered to the mail server. The message itself is never kept, because invitation emails contain secret links.</p>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full min-w-136 text-left">
            <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">When</th><th class="py-1.5 pr-3 font-normal">To</th><th class="py-1.5 pr-3 font-normal">Subject</th><th class="py-1.5 font-normal">Result</th></tr></thead>
            <tbody>
              @for (r of st.recent; track r._id) {
                <tr class="border-t border-line text-xs">
                  <td class="py-1.5 pr-3 whitespace-nowrap">{{ r.at | date: 'dd MMM, HH:mm' }}</td>
                  <td class="py-1.5 pr-3">{{ r.to }}</td>
                  <td class="py-1.5 pr-3">{{ r.subject }}</td>
                  <td class="py-1.5"><span class="badge" [class]="r.status === 'sent' ? 'bg-tone-lime' : r.status === 'failed' ? 'bg-tone-rose' : 'bg-chip'">{{ r.status === 'skipped' ? 'not sent (email off)' : r.status }}</span>@if (r.error && r.status === 'failed') { <div class="text-[11px] text-red-700">{{ r.error }}</div> }</td>
                </tr>
              } @empty {
                <tr><td colspan="4" class="py-6 text-center text-xs text-ink-soft">Nothing sent yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
})
export class EmailSettings {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/provider/email`;
  protected readonly s = signal<Summary | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected to = '';

  constructor() {
    this.load();
  }

  private load() {
    this.http.get<Summary>(this.url).subscribe({ next: (v) => this.s.set(v), error: (e) => this.error.set(apiError(e)) });
  }

  protected test() {
    this.error.set(null);
    this.notice.set(null);
    if (!/^\S+@\S+\.\S+$/.test(this.to.trim())) return this.error.set('Enter an email address to send the test to.');
    this.busy.set(true);
    this.http.post<{ sent: boolean; error?: string }>(`${this.url}/test`, { to: this.to.trim() }).subscribe({
      next: (r) => {
        this.busy.set(false);
        if (r.sent) this.notice.set(`Test email handed to the mail server for ${this.to.trim()}. Check the inbox (and spam).`);
        else this.error.set(`The test email was not sent: ${r.error ?? 'unknown error'}`);
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }
}
