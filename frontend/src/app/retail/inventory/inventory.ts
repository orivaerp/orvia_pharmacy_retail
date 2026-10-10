import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { Icon } from '../../shared/components/icon';
import { SCHEDULE_CLASS } from '../../shared/models/medicine';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';
import { BatchActionDialog } from './batch-action-dialog';
import { BatchRow, RetailApi, StockRow } from '../retail-api.service';

const EXPIRY_CLASS: Record<string, string> = { expired: 'bg-tone-rose', soon: 'bg-tone-lavender', ok: '' };
const STOCK_CLASS: Record<string, string> = { out: 'bg-tone-rose', low: 'bg-tone-lavender', ok: 'bg-tone-lime' };

@Component({
  selector: 'app-inventory',
  imports: [DatePipe, CurrencyPipe, RouterLink, Icon, BatchActionDialog],
  templateUrl: './inventory.html',
})
export class Inventory implements OnInit {
  private readonly api = inject(RetailApi);
  private readonly auth = inject(AuthService);
  protected readonly ctx = inject(OutletContext);

  protected readonly scheduleClass = SCHEDULE_CLASS;
  protected readonly expiryClass = EXPIRY_CLASS;
  protected readonly stockClass = STOCK_CLASS;

  protected readonly rows = signal<StockRow[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /** batches loaded for the expanded product */
  protected readonly openId = signal<string | null>(null);
  protected readonly batches = signal<BatchRow[]>([]);
  protected readonly batchLoading = signal(false);

  /** the outlet picked in the top bar ('' = all outlets this user can see) */
  protected get branchId() {
    return this.ctx.selected();
  }

  /** adjust / transfer dialog for one batch */
  protected readonly action = signal<{ mode: 'adjust' | 'transfer'; batch: BatchRow; product: string } | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected get canTransfer() {
    return this.canAdd && this.ctx.choices().length > 1;
  }

  protected openAction(mode: 'adjust' | 'transfer', batch: BatchRow, product: string) {
    this.notice.set(null);
    this.action.set({ mode, batch, product });
  }

  protected actionDone(message: string) {
    this.action.set(null);
    this.notice.set(message);
    this.load(); // numbers changed
  }

  private started = false;
  protected filter = '';
  protected q = '';
  protected page = 1;
  protected readonly limit = 20;
  private timer?: ReturnType<typeof setTimeout>;

  /** the shop-wide "low stock" level in packs, for products with no level of their own */
  protected readonly alertDefault = signal(5);
  protected alertDraft = 5;
  protected readonly alertSaving = signal(false);

  protected get canSetAlert() {
    return this.auth.hasPermission('product.manage');
  }

  protected saveAlert() {
    const packs = Math.max(0, Math.floor(Number(this.alertDraft) || 0));
    this.alertSaving.set(true);
    this.api.setLowStockDefault(packs).subscribe({
      next: (r) => {
        this.alertSaving.set(false);
        this.alertDefault.set(r.packs);
        this.alertDraft = r.packs;
        this.notice.set(r.packs ? `Low-stock alert saved: products with ${r.packs} packs or fewer show as low (unless a product has its own level).` : 'Low-stock alert switched off for products without their own level.');
        this.load();
      },
      error: (e) => {
        this.alertSaving.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected get canAdd() {
    return this.auth.hasPermission('inventory.adjust');
  }

  protected get pages() {
    return Math.max(1, Math.ceil(this.total() / this.limit));
  }

  constructor() {
    // reload when the outlet is switched (but not on first render, ngOnInit loads that)
    effect(() => {
      this.ctx.selected();
      if (this.started) {
        this.page = 1;
        this.load();
      }
    });
  }

  ngOnInit() {
    this.ctx.load();
    this.api.lowStockDefault().subscribe({ next: (r) => { this.alertDefault.set(r.packs); this.alertDraft = r.packs; }, error: () => undefined });
    this.started = true;
    this.load();
  }

  protected load() {
    this.loading.set(true);
    this.openId.set(null);
    this.api.stockSummary({ branchId: this.branchId, q: this.q.trim(), filter: this.filter, page: this.page, limit: this.limit }).subscribe({
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

  protected toggle(row: StockRow) {
    if (this.openId() === row.productId) return this.openId.set(null);
    this.openId.set(row.productId);
    this.batches.set([]);
    this.batchLoading.set(true);
    this.api.batches(row.productId, this.branchId).subscribe({
      next: (b) => {
        this.batches.set(b);
        this.batchLoading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.batchLoading.set(false);
      },
    });
  }

  protected stockText(r: StockRow) {
    if (r.units === 0) return '0';
    return r.loose ? `${r.packs} + ${r.loose} loose` : String(r.packs);
  }
}
