import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Product, SCHEDULE_CLASS } from '../../shared/models/medicine';
import { apiError } from '../../shared/utils/api';
import { ProductPicker } from '../components/product-picker';
import { OutletContext } from '../outlet-context.service';
import { Outlet, RetailApi, StockEntry } from '../retail-api.service';

/** One row of the entry form. Plain signals so each cell updates without rebuilding the table. */
class Line {
  product = signal<Product | null>(null);
  batchNo = signal('');
  expiry = signal('');
  mrp = signal<number | null>(null);
  rate = signal<number | null>(null);
  packs = signal<number | null>(null);

  readonly total = computed(() => (this.rate() ?? 0) * (this.packs() ?? 0));
}

const SOON_MS = 90 * 24 * 60 * 60 * 1000;

/** First day after the given YYYY-MM month: a batch is valid through the end of its expiry month. */
const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 1).getTime();
};

@Component({
  selector: 'app-stock-entry',
  imports: [CurrencyPipe, FormsModule, RouterLink, ProductPicker],
  templateUrl: './stock-entry.html',
})
export class StockEntryPage implements OnInit {
  private readonly api = inject(RetailApi);
  private readonly ctx = inject(OutletContext);

  protected readonly scheduleClass = SCHEDULE_CLASS;
  protected readonly outlets = signal<Outlet[]>([]);
  protected readonly lines = signal<Line[]>([new Line()]);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly done = signal<{ branch: string; lines: { name: string; batchNo: string; packs: number; units: number }[] } | null>(null);

  protected branchId = '';
  protected type: 'OPENING' | 'PURCHASE' = 'OPENING';
  protected supplierName = '';
  protected reference = '';
  protected readonly minMonth = new Date().toISOString().slice(0, 7);

  protected readonly totals = computed(() => {
    const ls = this.lines().filter((l) => l.product());
    return { items: ls.length, packs: ls.reduce((s, l) => s + (l.packs() ?? 0), 0), value: ls.reduce((s, l) => s + l.total(), 0) };
  });

  ngOnInit() {
    this.api.outlets().subscribe({
      next: (o) => {
        const active = o.filter((x) => x.isActive);
        this.outlets.set(active);
        const preferred = active.find((o) => o._id === this.ctx.selected());
        if (!this.branchId && active.length) this.branchId = (preferred ?? active[0])._id;
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  protected addLine() {
    this.lines.update((l) => [...l, new Line()]);
  }

  protected removeLine(line: Line) {
    this.lines.update((l) => (l.length > 1 ? l.filter((x) => x !== line) : l));
  }

  // ---- per-line hints ----
  protected expiryHint(line: Line): string | null {
    const ym = line.expiry();
    if (!ym) return null;
    const end = monthEnd(ym);
    if (end <= Date.now()) return 'Already expired';
    if (end - Date.now() <= SOON_MS) return 'Expires within 90 days';
    return null;
  }

  protected rateHint(line: Line): string | null {
    const m = line.mrp();
    const r = line.rate();
    return m != null && r != null && r > m ? 'Rate is above MRP' : null;
  }

  // ---- submit ----
  private validate(): string | null {
    if (!this.branchId) return 'Choose an outlet.';
    const filled = this.lines().filter((l) => l.product() || l.batchNo() || l.packs());
    if (!filled.length) return 'Add at least one product.';
    for (const [i, l] of filled.entries()) {
      const n = `Line ${i + 1}`;
      if (!l.product()) return `${n}: choose a product from the list.`;
      if (!l.batchNo().trim()) return `${n}: enter the batch number.`;
      if (!l.expiry()) return `${n}: enter the expiry month.`;
      if (monthEnd(l.expiry()) <= Date.now()) return `${n}: this batch has already expired.`;
      if (!l.mrp() || l.mrp()! <= 0) return `${n}: enter the MRP.`;
      if (l.rate() == null || l.rate()! < 0) return `${n}: enter the purchase rate.`;
      if (!l.packs() || l.packs()! < 1 || !Number.isInteger(l.packs())) return `${n}: enter the number of packs (whole number).`;
    }
    return null;
  }

  protected submit() {
    const problem = this.validate();
    if (problem) return this.error.set(problem);

    const body: StockEntry = {
      branchId: this.branchId,
      type: this.type,
      supplierName: this.supplierName.trim() || undefined,
      reference: this.reference.trim() || undefined,
      lines: this.lines()
        .filter((l) => l.product())
        .map((l) => ({ productId: l.product()!._id, batchNo: l.batchNo().trim(), expiry: l.expiry(), mrp: l.mrp()!, purchaseRate: l.rate()!, packs: l.packs()! })),
    };
    this.saving.set(true);
    this.error.set(null);
    this.api.createStockEntry(body).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.done.set({ branch: r.branch.name, lines: r.lines });
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected another() {
    this.done.set(null);
    this.lines.set([new Line()]);
    this.reference = '';
  }
}
