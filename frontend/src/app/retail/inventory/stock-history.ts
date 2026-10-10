import { DatePipe } from '@angular/common';
import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';
import { LedgerRow, RetailApi } from '../retail-api.service';

const TYPE_LABEL: Record<string, string> = {
  OPENING: 'Opening stock',
  PURCHASE: 'Purchase',
  SALE: 'Sale',
  RETURN: 'Return',
  ADJUST: 'Adjustment',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
};
const TYPE_CLASS: Record<string, string> = {
  OPENING: 'bg-tone-lime',
  PURCHASE: 'bg-tone-lime',
  SALE: 'bg-tone-teal',
  RETURN: 'bg-tone-teal',
  ADJUST: 'bg-tone-rose',
  TRANSFER_IN: 'bg-tone-lavender',
  TRANSFER_OUT: 'bg-tone-lavender',
};
const REASON_LABEL: Record<string, string> = {
  BREAKAGE: 'Breakage',
  EXPIRED: 'Expired',
  DAMAGED: 'Damaged',
  LOSS: 'Lost or stolen',
  FOUND: 'Found',
  COUNT_CORRECTION: 'Count correction',
  OTHER: 'Other',
};

/** Every stock movement, newest first. Follows the outlet chosen in the top bar. */
@Component({
  selector: 'app-stock-history',
  imports: [DatePipe, RouterLink],
  template: `
    <a routerLink="/retail/inventory" class="text-xs text-ink-soft hover:text-ink">&larr; Inventory</a>
    <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Stock history</h1>
        <p class="mt-0.5 text-xs text-ink-soft">{{ ctx.selectedOutlet() ? ctx.selectedOutlet()!.name + ': ' : '' }}every addition, write-off and transfer, newest first. Entries are never edited, corrections are new entries.</p>
      </div>
      <select class="field w-auto" (change)="type = $any($event.target).value; load()" aria-label="Movement type">
        <option value="">All movements</option>
        @for (t of types; track t[0]) { <option [value]="t[0]">{{ t[1] }}</option> }
      </select>
    </div>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

    <section class="card mt-3">
      <div class="overflow-x-auto" [class.opacity-50]="loading()">
        <table class="w-full min-w-176 text-left">
          <thead>
            <tr class="text-[11px] text-ink-soft">
              <th class="py-1.5 pr-3 font-normal">When</th>
              <th class="py-1.5 pr-3 font-normal">Type</th>
              <th class="py-1.5 pr-3 font-normal">Product</th>
              <th class="py-1.5 pr-3 font-normal">Outlet</th>
              <th class="py-1.5 pr-3 text-right font-normal">Packs</th>
              <th class="py-1.5 pr-3 font-normal">Details</th>
              <th class="py-1.5 font-normal">By</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r._id) {
              <tr class="border-t border-line text-xs">
                <td class="py-1.5 pr-3 whitespace-nowrap">{{ r.at | date: 'dd MMM, HH:mm' }}</td>
                <td class="py-1.5 pr-3"><span class="badge" [class]="typeClass[r.type]">{{ typeLabel[r.type] }}</span></td>
                <td class="py-1.5 pr-3"><span class="font-medium">{{ r.product }}</span><div class="text-[11px] text-ink-soft">batch {{ r.batchNo }}</div></td>
                <td class="py-1.5 pr-3">{{ r.outlet }}</td>
                <td class="py-1.5 pr-3 text-right font-medium" [class]="r.packs < 0 ? 'text-red-700' : 'text-green-700'">{{ r.packs > 0 ? '+' : '' }}{{ r.packs }}</td>
                <td class="py-1.5 pr-3 text-ink-soft">{{ details(r) }}</td>
                <td class="py-1.5">{{ r.by ?? '-' }}</td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="py-8 text-center text-ink-soft">{{ loading() ? 'Loading…' : 'No movements yet.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class StockHistory implements OnInit {
  private readonly api = inject(RetailApi);
  protected readonly ctx = inject(OutletContext);

  protected readonly typeLabel = TYPE_LABEL;
  protected readonly typeClass = TYPE_CLASS;
  protected readonly types = Object.entries(TYPE_LABEL);
  protected readonly rows = signal<LedgerRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected type = '';
  private started = false;

  constructor() {
    effect(() => {
      this.ctx.selected();
      if (this.started) this.load();
    });
  }

  ngOnInit() {
    this.ctx.load();
    this.started = true;
    this.load();
  }

  protected load() {
    this.loading.set(true);
    this.api.ledger({ type: this.type, branchId: this.ctx.selected(), limit: 100 }).subscribe({
      next: (r) => {
        this.rows.set(r);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }

  protected details(r: LedgerRow) {
    return [r.reason ? REASON_LABEL[r.reason] ?? r.reason : '', r.supplierName, r.reference ? `ref ${r.reference}` : '', r.note].filter(Boolean).join(' · ') || '-';
  }
}
