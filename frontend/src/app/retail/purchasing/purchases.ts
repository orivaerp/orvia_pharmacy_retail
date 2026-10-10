import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { Icon } from '../../shared/components/icon';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';
import { PurchaseRow, RetailApi, Supplier } from '../retail-api.service';

@Component({
  selector: 'app-purchases',
  imports: [CurrencyPipe, DatePipe, RouterLink, Icon],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Purchases</h1>
        <p class="mt-0.5 text-xs text-ink-soft">{{ ctx.selectedOutlet() ? ctx.selectedOutlet()!.name + ': ' : '' }}supplier invoices. Booking one adds its stock to the outlet.</p>
      </div>
      @if (canWrite) { <a routerLink="/retail/purchases/new" class="btn btn-primary">+ New purchase</a> }
    </div>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

    <section class="card mt-3">
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex h-9 min-w-52 flex-1 items-center gap-2 rounded-full border border-line bg-white/70 px-3 text-ink-soft">
          <app-icon name="search" [size]="14" />
          <input type="search" placeholder="Search invoice no. or supplier…" (input)="onSearch($any($event.target).value)" class="w-full bg-transparent text-xs text-ink outline-none placeholder:text-ink-soft" />
        </label>
        <select class="field w-auto" aria-label="Supplier" (change)="supplierId = $any($event.target).value; changed()">
          <option value="">All suppliers</option>
          @for (s of suppliers(); track s._id) { <option [value]="s._id">{{ s.name }}</option> }
        </select>
      </div>

      <div class="mt-3 overflow-x-auto" [class.opacity-50]="loading()">
        <table class="w-full min-w-176 text-left">
          <thead>
            <tr class="text-[11px] text-ink-soft">
              <th class="py-1.5 pr-3 font-normal">Date</th>
              <th class="py-1.5 pr-3 font-normal">Invoice</th>
              <th class="py-1.5 pr-3 font-normal">Supplier</th>
              <th class="py-1.5 pr-3 font-normal">Outlet</th>
              <th class="py-1.5 pr-3 font-normal">Due</th>
              <th class="py-1.5 pr-3 text-right font-normal">Amount</th>
              <th class="py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            @for (p of rows(); track p._id) {
              <tr class="border-t border-line text-xs">
                <td class="py-2 pr-3 whitespace-nowrap">{{ p.invoiceDate | date: 'dd MMM yyyy' : 'UTC' }}</td>
                <td class="py-2 pr-3"><span class="font-medium">{{ p.invoiceNo }}</span><div class="text-[11px] text-ink-soft">{{ p.number }}</div></td>
                <td class="py-2 pr-3">{{ p.supplierName }}</td>
                <td class="py-2 pr-3">{{ p.branchId?.name }}</td>
                <td class="py-2 pr-3 whitespace-nowrap">{{ p.dueDate ? (p.dueDate | date: 'dd MMM yyyy' : 'UTC') : '-' }}</td>
                <td class="py-2 pr-3 text-right font-medium">{{ p.totals.grand | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                <td class="py-2 text-right"><a [routerLink]="['/retail/purchases', p._id]" class="btn btn-ghost">View</a></td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="py-8 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'No purchases yet. Book your first supplier invoice.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>

      @if (total() > limit) {
        <div class="mt-3 flex items-center justify-between text-xs text-ink-soft">
          <span>Page {{ page }} of {{ pages }}</span>
          <div class="flex gap-2">
            <button type="button" class="btn btn-ghost" [disabled]="page <= 1" (click)="go(-1)">Previous</button>
            <button type="button" class="btn btn-ghost" [disabled]="page >= pages" (click)="go(1)">Next</button>
          </div>
        </div>
      }
    </section>
  `,
})
export class Purchases implements OnInit {
  private readonly api = inject(RetailApi);
  private readonly auth = inject(AuthService);
  protected readonly ctx = inject(OutletContext);

  protected readonly rows = signal<PurchaseRow[]>([]);
  protected readonly suppliers = signal<Supplier[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected supplierId = '';
  protected q = '';
  protected page = 1;
  protected readonly limit = 20;
  private started = false;
  private timer?: ReturnType<typeof setTimeout>;

  protected get canWrite() {
    return this.auth.hasPermission('purchase.create');
  }

  protected get pages() {
    return Math.max(1, Math.ceil(this.total() / this.limit));
  }

  constructor() {
    effect(() => {
      this.ctx.selected();
      if (this.started) this.changed();
    });
  }

  ngOnInit() {
    this.ctx.load();
    this.api.suppliers({}).subscribe({ next: (s) => this.suppliers.set(s) });
    this.started = true;
    this.load();
  }

  protected load() {
    this.loading.set(true);
    this.api.purchases({ supplierId: this.supplierId, branchId: this.ctx.selected(), q: this.q.trim(), page: this.page, limit: this.limit }).subscribe({
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

  protected changed() {
    this.page = 1;
    this.load();
  }

  protected onSearch(v: string) {
    this.q = v;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.changed(), 300);
  }

  protected go(d: number) {
    this.page = Math.min(this.pages, Math.max(1, this.page + d));
    this.load();
  }
}
