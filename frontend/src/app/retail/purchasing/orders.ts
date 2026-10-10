import { HttpClient, HttpParams } from '@angular/common/http';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';

export interface OrderRow {
  _id: string;
  number: string;
  supplierName: string;
  branchName?: string;
  status: 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';
  items: number;
  packs: number;
  pendingPacks: number;
  estimate: number;
  expectedOn?: string;
  createdAt: string;
  createdByName?: string;
}

export const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Draft', cls: 'bg-chip' },
  SENT: { label: 'Sent', cls: 'bg-tone-lavender' },
  PARTIAL: { label: 'Partly received', cls: 'bg-tone-lavender' },
  RECEIVED: { label: 'Received', cls: 'bg-tone-lime' },
  CLOSED: { label: 'Closed (short)', cls: 'bg-tone-rose' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-tone-rose' },
};

/** Purchase orders: what was asked of suppliers, and what is still to arrive. */
@Component({
  selector: 'app-orders',
  imports: [RouterLink, CurrencyPipe, DatePipe],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Purchase orders</h1>
        <p class="mt-0.5 text-xs text-ink-soft">Ask a supplier to send medicines, send them the order, and when the goods and invoice come, book them against the order so you can see what is still pending.</p>
      </div>
      @if (canWrite()) { <a routerLink="/retail/purchase-orders/new" class="btn btn-primary">New order</a> }
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <div class="flex gap-1 rounded-full border border-line bg-surface p-1 text-xs" role="tablist">
        @for (t of tabs; track t.id) { <button type="button" role="tab" class="rounded-full px-3 py-1" [attr.aria-selected]="tab() === t.id" [class]="tab() === t.id ? 'bg-brand text-brand-ink' : ''" (click)="setTab(t.id)">{{ t.label }}</button> }
      </div>
      <input class="field w-56" placeholder="Order no., supplier or medicine" aria-label="Search orders" (input)="onQ($any($event.target).value)" />
    </div>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

    <section class="card mt-3">
      <div class="overflow-x-auto" [class.opacity-50]="loading()">
        <table class="w-full min-w-176 text-left">
          <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Order</th><th class="py-1.5 pr-3 font-normal">Supplier</th><th class="py-1.5 pr-3 font-normal">For outlet</th><th class="py-1.5 pr-3 font-normal">Items</th><th class="py-1.5 pr-3 font-normal">Still to come</th><th class="py-1.5 pr-3 text-right font-normal">About</th><th class="py-1.5 font-normal">Status</th></tr></thead>
          <tbody>
            @for (o of rows(); track o._id) {
              <tr class="border-t border-line text-xs">
                <td class="py-2 pr-3 font-medium"><a [routerLink]="['/retail/purchase-orders', o._id]" class="underline">{{ o.number }}</a><div class="text-[11px] font-normal text-ink-soft">{{ o.createdAt | date: 'dd MMM yyyy' }}</div></td>
                <td class="py-2 pr-3">{{ o.supplierName }}</td>
                <td class="py-2 pr-3">{{ o.branchName }}</td>
                <td class="py-2 pr-3">{{ o.items }} ({{ o.packs }} packs)</td>
                <td class="py-2 pr-3">{{ o.status === 'DRAFT' || o.status === 'SENT' || o.status === 'PARTIAL' ? o.pendingPacks + ' packs' : '-' }}</td>
                <td class="py-2 pr-3 text-right">{{ o.estimate ? (o.estimate | currency: 'INR' : 'symbol' : '1.0-0') : '-' }}</td>
                <td class="py-2"><span class="badge" [class]="status[o.status].cls">{{ status[o.status].label }}</span></td>
              </tr>
            } @empty { <tr><td colspan="7" class="py-8 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'No orders here.' }}</td></tr> }
          </tbody>
        </table>
      </div>
      <div class="mt-2 flex items-center justify-between text-xs text-ink-soft">
        <span>{{ total() }} order{{ total() === 1 ? '' : 's' }}</span>
        <span class="flex gap-2">
          <button type="button" class="btn btn-ghost !py-0.5" [disabled]="page() <= 1" (click)="go(-1)">Previous</button>
          <button type="button" class="btn btn-ghost !py-0.5" [disabled]="page() * 20 >= total()" (click)="go(1)">Next</button>
        </span>
      </div>
    </section>
  `,
})
export class Orders {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly ctx = inject(OutletContext);

  protected readonly status = ORDER_STATUS;
  protected readonly tabs = [
    { id: 'open', label: 'Open' },
    { id: 'RECEIVED', label: 'Received' },
    { id: 'done', label: 'Closed and cancelled' },
    { id: '', label: 'All' },
  ] as const;
  protected readonly tab = signal<string>('open');
  protected readonly rows = signal<OrderRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly canWrite = computed(() => this.auth.hasPermission('purchase.create'));
  private q = '';
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.ctx.load();
    effect(() => {
      const outlet = this.ctx.selected();
      untracked(() => {
        this.page.set(1);
        this.load(outlet);
      });
    });
  }

  protected setTab(t: string) {
    this.tab.set(t);
    this.page.set(1);
    this.load(this.ctx.selected());
  }

  protected onQ(v: string) {
    this.q = v;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.page.set(1);
      this.load(this.ctx.selected());
    }, 300);
  }

  protected go(d: number) {
    this.page.update((p) => p + d);
    this.load(this.ctx.selected());
  }

  private load(outlet: string) {
    this.loading.set(true);
    let params = new HttpParams().set('page', this.page());
    const t = this.tab();
    if (t) params = params.set('status', t);
    if (outlet) params = params.set('branchId', outlet);
    if (this.q.trim()) params = params.set('q', this.q.trim());
    this.http.get<{ items: OrderRow[]; total: number }>(`${environment.apiUrl}/purchase-orders`, { params }).subscribe({
      next: (r) => {
        this.rows.set(r.items);
        this.total.set(r.total);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }
}
