import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { apiError } from '../../shared/utils/api';

interface Health {
  days: number;
  sent: number;
  bounces: number;
  softBounces: number;
  complaints: number;
  bounceRate: number;
  complaintRate: number;
  status: 'ok' | 'watch' | 'danger';
  suppressed: number;
  enoughMail: boolean;
}
interface Blocked {
  _id: string;
  email: string;
  reason: 'bounce' | 'complaint' | 'manual';
  detail?: string;
  count: number;
  lastAt: string;
}

interface Summary {
  configured: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  from: string | null;
  replyTo: string | null;
  health: Health;
  webhook: { url: string; topicChecked: boolean; tokenSet: boolean };
  recent: { _id: string; at: string; to: string; subject: string; template: string; status: 'sent' | 'failed' | 'skipped' | 'suppressed'; error?: string }[];
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
            <div class="flex justify-between sm:col-span-2"><dt class="text-ink-soft">Replies go to</dt><dd>{{ st.replyTo || 'the sender address (set MAIL_REPLY_TO to change)' }}</dd></div>
          </dl>
          <form class="mt-3 flex flex-wrap items-end gap-2" (ngSubmit)="test()">
            <div><label class="label" for="em-to">Send a test email to</label><input id="em-to" name="to" type="email" class="field w-64" [(ngModel)]="to" placeholder="you@yourdomain.com" /></div>
            <button class="btn btn-primary" type="submit" [disabled]="busy()">{{ busy() ? 'Sending…' : 'Send test' }}</button>
          </form>
        } @else {
          <p class="mt-2 text-xs text-ink-soft">Nothing is emailed yet. Invite links are still shown on screen so you can send them yourself. To switch email on, set these in the server's environment file and restart it:</p>
          <pre class="mt-2 overflow-x-auto rounded-lg border border-line bg-white/60 p-2 text-[11px]">SMTP_HOST=email-smtp.ap-south-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=your-ses-smtp-username
SMTP_PASS=your-ses-smtp-password
MAIL_FROM=Orvia &lt;no-reply&#64;yourdomain.com&gt;
MAIL_REPLY_TO=support&#64;yourdomain.com</pre>
          <p class="mt-1 text-[11px] text-ink-soft">Amazon SES: use the SMTP endpoint of your region and the <b>SMTP credentials</b> made in the SES console (not an AWS access key). The address in MAIL_FROM, or its whole domain, must be verified in SES; until AWS lifts the sandbox limit, only verified recipients receive mail. Port 465 (SSL) also works.</p>
        }
      </section>

      <section class="card mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-medium">Delivery health (last {{ st.health.days }} days)</h2>
          <span class="badge" [class]="st.health.status === 'ok' ? 'bg-tone-lime' : st.health.status === 'watch' ? 'bg-tone-lavender' : 'bg-tone-rose'">{{ st.health.status === 'ok' ? 'Healthy' : st.health.status === 'watch' ? 'Watch this' : 'Too many bounces or complaints' }}</span>
        </div>
        <dl class="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div class="rounded-xl bg-white/50 p-2"><dt class="text-ink-soft">Sent</dt><dd class="font-medium">{{ st.health.sent }}</dd></div>
          <div class="rounded-xl bg-white/50 p-2"><dt class="text-ink-soft">Bounced for good</dt><dd class="font-medium">{{ st.health.bounces }} ({{ st.health.bounceRate }}%)</dd></div>
          <div class="rounded-xl bg-white/50 p-2"><dt class="text-ink-soft">Marked as spam</dt><dd class="font-medium">{{ st.health.complaints }} ({{ st.health.complaintRate }}%)</dd></div>
          <div class="rounded-xl bg-white/50 p-2"><dt class="text-ink-soft">Blocked addresses</dt><dd class="font-medium">{{ st.health.suppressed }}</dd></div>
        </dl>
        <p class="mt-2 text-[11px] text-ink-soft">Amazon SES reviews an account at about <b>5%</b> bounces or <b>0.1%</b> complaints and can pause it at <b>10%</b> or <b>0.5%</b>. Only bounces that can never work are counted ({{ st.health.softBounces }} passing ones, such as a full mailbox, are not). @if (!st.health.enoughMail) { With under 50 emails sent the percentages are not meaningful yet. }</p>
      </section>

      <section class="card mt-3">
        <h2 class="text-sm font-medium">Bounces and complaints from Amazon</h2>
        <p class="mt-1 text-xs text-ink-soft">Orvia learns about a bounce or a spam complaint only if SES tells it. Then that address is blocked and never mailed again, which is what protects the account. Set it up once:</p>
        <ol class="mt-2 list-decimal space-y-1 pl-5 text-xs">
          <li>In <b>Amazon SNS</b> (same region as SES), create a <b>Standard topic</b>, for example <code>orvia-ses-events</code>.</li>
          <li>In <b>SES &gt; Verified identities</b>, open your domain, <b>Notifications</b>, and send both <b>Bounce</b> and <b>Complaint</b> feedback to that topic. (Or use a configuration set with an event destination; both formats work.)</li>
          <li>In SNS, create a <b>subscription</b> on the topic: protocol <b>HTTPS</b>, endpoint <code class="break-all">{{ st.webhook.url }}</code>. Orvia confirms it by itself. The status must show "Confirmed".</li>
          <li>Put the topic's ARN in <code>SES_SNS_TOPIC_ARN</code> (only that topic is accepted) and, if you like, a secret in <code>SES_WEBHOOK_TOKEN</code> (then add <code>?token=…</code> to the endpoint) and restart the server.
            <span class="text-ink-soft"> Here: topic {{ st.webhook.topicChecked ? 'is checked' : 'is NOT checked yet' }}, secret {{ st.webhook.tokenSet ? 'is set' : 'is not set' }}.</span></li>
          <li>Test with the <b>SES mailbox simulator</b>: send to <code>bounce&#64;simulator.amazonses.com</code> and <code>complaint&#64;simulator.amazonses.com</code>. They appear below within a minute and do not count against your reputation.</li>
        </ol>
        <p class="mt-2 text-[11px] text-ink-soft">The address must be reachable from the internet over HTTPS. Every message is checked against Amazon's signature before anything is believed.</p>
      </section>

      <section class="card mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-medium">Blocked addresses</h2>
          <form class="flex items-center gap-2" (ngSubmit)="block()">
            <input name="blockEmail" type="email" class="field w-56 !py-1" placeholder="block an address by hand" [(ngModel)]="blockEmail" aria-label="Address to block" />
            <button type="submit" class="btn btn-ghost !py-1" [disabled]="busy()">Block</button>
          </form>
        </div>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full min-w-136 text-left">
            <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Address</th><th class="py-1.5 pr-3 font-normal">Why</th><th class="py-1.5 pr-3 font-normal">Last</th><th class="py-1.5"></th></tr></thead>
            <tbody>
              @for (b of blocked(); track b._id) {
                <tr class="border-t border-line text-xs">
                  <td class="py-1.5 pr-3">{{ b.email }}</td>
                  <td class="py-1.5 pr-3">{{ b.reason === 'bounce' ? 'bounced' : b.reason === 'complaint' ? 'marked as spam' : 'blocked by hand' }}@if (b.count > 1) { <span class="text-ink-soft"> ×{{ b.count }}</span> }@if (b.detail) { <div class="text-[11px] text-ink-soft">{{ b.detail }}</div> }</td>
                  <td class="py-1.5 pr-3 whitespace-nowrap">{{ b.lastAt | date: 'dd MMM yyyy' }}</td>
                  <td class="py-1.5 text-right"><button type="button" class="btn btn-ghost !py-0.5" [disabled]="busy()" (click)="unblock(b)">Allow again</button></td>
                </tr>
              } @empty {
                <tr><td colspan="4" class="py-5 text-center text-xs text-ink-soft">No address is blocked.</td></tr>
              }
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-[11px] text-ink-soft">Allow an address again only when you know the problem is fixed (for example the customer corrected their mailbox). A shop that tries to email a blocked address is told why.</p>
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
                  <td class="py-1.5"><span class="badge" [class]="r.status === 'sent' ? 'bg-tone-lime' : r.status === 'failed' ? 'bg-tone-rose' : 'bg-chip'">{{ r.status === 'skipped' ? 'not sent (email off)' : r.status === 'suppressed' ? 'blocked (bounced before)' : r.status }}</span>@if (r.error && (r.status === 'failed' || r.status === 'suppressed')) { <div class="text-[11px] text-red-700">{{ r.error }}</div> }</td>
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
  protected blockEmail = '';
  protected readonly blocked = signal<Blocked[]>([]);

  constructor() {
    this.load();
  }

  private load() {
    this.http.get<Summary>(this.url).subscribe({ next: (v) => this.s.set(v), error: (e) => this.error.set(apiError(e)) });
    this.http.get<Blocked[]>(`${this.url}/suppressed`).subscribe({ next: (v) => this.blocked.set(v), error: () => undefined });
  }

  protected block() {
    const email = this.blockEmail.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return this.error.set('Enter the address to block.');
    this.act(this.http.post(`${this.url}/suppressed`, { email }), `${email} is blocked.`, () => (this.blockEmail = ''));
  }

  protected unblock(b: Blocked) {
    if (!confirm(`Allow ${b.email} to be emailed again?`)) return;
    this.act(this.http.delete(`${this.url}/suppressed/${b._id}`), `${b.email} can be emailed again.`);
  }

  private act(call: import('rxjs').Observable<unknown>, done: string, after?: () => void) {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        this.notice.set(done);
        after?.();
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
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
