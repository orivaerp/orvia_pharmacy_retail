import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';
import { SaleRow, SalesApi } from './sales-api.service';

/** Every bill, newest first. Follows the outlet chosen in the top bar. */
@Component({
  selector: 'app-sales',
  imports: [CurrencyPipe, DatePipe, RouterLink],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Bills</h1>
        <p class="mt-0.5 text-xs text-ink-soft">{{ ctx.selectedOutlet() ? ctx.selectedOutlet()!.name + ': ' : '' }}every sale, newest first.</p>
      </div>
      @if (auth.hasPermission('sales.create')) { <a routerLink="/retail/pos" class="btn btn-primary">New sale</a> }
    </div>

    <div class="mt-3 flex flex-wrap gap-2">
      <input class="field w-56" placeholder="Bill no., customer or phone" aria-label="Search bills" (input)="onQ($any($event.target).value)" />
      <input type="date" class="field w-auto" aria-label="From date" (change)="from = $any($event.target).value; page.set(1); load()" />
      <input type="date" class="field w-auto" aria-label="To date" (change)="to = $any($event.target).value; page.set(1); load()" />
    </div>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

    <section class="card mt-3">
      <div class="overflow-x-auto" [class.opacity-50]="loading()">
        <table class="w-full min-w-176 text-left">
          <thead>
            <tr class="text-[11px] text-ink-soft">
              <th class="py-1.5 pr-3 font-normal">Bill</th>
              <th class="py-1.5 pr-3 font-normal">When</th>
              <th class="py-1.5 pr-3 font-normal">Customer</th>
              <th class="py-1.5 pr-3 font-normal">Outlet</th>
              <th class="py-1.5 pr-3 font-normal">Paid by</th>
              <th class="py-1.5 pr-3 text-right font-normal">Amount</th>
              <th class="py-1.5 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            @for (s of rows(); track s._id) {
              <tr class="border-t border-line text-xs">
                <td class="py-2 pr-3 font-medium"><a [routerLink]="['/retail/sales', s._id]" class="underline">{{ s.number }}</a></td>
                <td class="py-2 pr-3 whitespace-nowrap">{{ s.createdAt | date: 'dd MMM, HH:mm' }}</td>
                <td class="py-2 pr-3">{{ s.customerName || '-' }}<div class="text-[11px] text-ink-soft">{{ s.customerPhone }}</div></td>
                <td class="py-2 pr-3">{{ s.branchId?.name }}</td>
                <td class="py-2 pr-3">{{ modes(s) }}</td>
                <td class="py-2 pr-3 text-right font-medium">{{ s.totals.grand | currency: 'INR' : 'symbol' : '1.0-0' }}</td>
                <td class="py-2"><span class="badge" [class]="s.status === 'COMPLETED' ? 'bg-tone-lime' : 'bg-tone-rose'">{{ s.status === 'CANCELLED' ? 'cancelled' : s.status === 'RETURNED' ? 'returned' : 'completed' }}</span></td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="py-8 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'No bills yet.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      <div class="mt-2 flex items-center justify-between text-xs text-ink-soft">
        <span>{{ total() }} bill{{ total() === 1 ? '' : 's' }}</span>
        <span class="flex gap-2">
          <button type="button" class="btn btn-ghost !py-0.5" [disabled]="page() <= 1" (click)="go(-1)">Previous</button>
          <button type="button" class="btn btn-ghost !py-0.5" [disabled]="page() * 20 >= total()" (click)="go(1)">Next</button>
        </span>
      </div>
    </section>
  `,
})
export class Sales {
  private readonly api = inject(SalesApi);
  protected readonly ctx = inject(OutletContext);
  protected readonly auth = inject(AuthService);

  protected readonly rows = signal<SaleRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected from = '';
  protected to = '';
  private q = '';
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.ctx.load();
    effect(() => {
      this.ctx.selected();
      untracked(() => {
        this.page.set(1);
        this.load();
      });
    });
  }

  protected modes(s: SaleRow) {
    return s.payments.map((p) => p.mode.toLowerCase()).join(' + ');
  }

  protected onQ(v: string) {
    this.q = v;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.page.set(1);
      this.load();
    }, 300);
  }

  protected go(d: number) {
    this.page.update((p) => p + d);
    this.load();
  }

  protected load() {
    this.loading.set(true);
    this.api.list({ branchId: this.ctx.selected(), q: this.q, from: this.from, to: this.to, page: this.page() }).subscribe({
      next: (r) => {
        this.rows.set(r.items);
        this.total.set(r.total);
        this.loading.set(false);
        this.error.set(null);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }
}
