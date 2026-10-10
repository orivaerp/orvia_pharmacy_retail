import { HttpClient } from '@angular/common/http';
import { CurrencyPipe } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { BillingState } from './billing-types';

interface Status extends BillingState {
  due: { number: string; total: number; dueDate: string } | null;
}

/** A strip at the top of a shop's screens when the trial or subscription needs attention. Silent when all is well. */
@Component({
  selector: 'app-billing-banner',
  imports: [RouterLink, CurrencyPipe],
  template: `
    @if (message(); as m) {
      <div role="status" class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs" [class]="m.bad ? 'bg-red-50 text-red-800' : 'bg-tone-lavender text-ink'">
        <span>{{ m.text }}</span>
        @if (canPay()) { <a routerLink="/retail/billing" class="btn btn-primary !py-0.5">{{ s()?.due ? 'Pay ' + (s()!.due!.total | currency: 'INR' : 'symbol' : '1.0-0') : 'Billing' }}</a> }
        @else { <span class="text-[11px]">Ask the shop owner to open Billing.</span> }
      </div>
    }
  `,
})
export class BillingBanner implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  protected readonly s = signal<Status | null>(null);
  protected readonly canPay = computed(() => this.auth.hasPermission('billing.manage'));
  private timer?: ReturnType<typeof setInterval>;

  private readonly date = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' }) : '');

  protected readonly message = computed(() => {
    const s = this.s();
    if (!s) return null;
    switch (s.state) {
      case 'due_soon': return { bad: false, text: `${s.trial ? 'Your free trial ends' : 'Your plan renews'} on ${this.date(s.endsAt)} (${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}).${s.due ? ' Your invoice is ready.' : ''}` };
      case 'grace': return { bad: true, text: `Your subscription ended on ${this.date(s.endsAt)}. Please pay by ${this.date(s.lockAt)}, or the shop becomes view-only.` };
      case 'locked': return { bad: true, text: 'Your subscription has ended: the shop is view-only. You can see everything but not make changes until it is paid.' };
      default: return null;
    }
  });

  constructor() {
    this.load();
    this.timer = setInterval(() => this.load(), 10 * 60 * 1000);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  private load() {
    this.http.get<Status>(`${environment.apiUrl}/billing/status`).subscribe({ next: (v) => this.s.set(v), error: () => undefined });
  }
}
