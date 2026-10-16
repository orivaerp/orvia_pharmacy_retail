import { CurrencyPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Product, SCHEDULE_CLASS } from '../../shared/models/medicine';
import { apiError } from '../../shared/utils/api';
import { ProductPicker } from '../components/product-picker';
import { OutletContext } from '../outlet-context.service';
import { Outlet, PurchaseInput, RetailApi, Supplier } from '../retail-api.service';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const SOON_MS = 90 * 24 * 60 * 60 * 1000;
const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 1).getTime();
};

/** One invoice row. The money maths mirrors the server (which is the one that counts). */
class Line {
  product = signal<Product | null>(null);
  batchNo = signal('');
  expiry = signal('');
  mrp = signal<number | null>(null);
  rate = signal<number | null>(null);
  packs = signal<number | null>(null);
  free = signal(0);
  disc = signal(0);
  gst = signal<number | null>(null); // defaults to the product's GST once chosen

  readonly money = computed(() => {
    const gross = r2((this.packs() ?? 0) * (this.rate() ?? 0));
    const discount = r2((gross * this.disc()) / 100);
    const taxable = r2(gross - discount);
    const gst = r2((taxable * (this.gst() ?? 0)) / 100);
    return { gross, discount, taxable, gst, total: r2(taxable + gst) };
  });
}

@Component({
  selector: 'app-purchase-new',
  imports: [CurrencyPipe, RouterLink, ProductPicker],
  template: `
    <a routerLink="/retail/purchases" class="text-xs text-ink-soft hover:text-ink">&larr; Purchases</a>
    <div class="mt-2">
      <h1 class="text-xl font-medium tracking-tight sm:text-2xl">New purchase</h1>
      <p class="mt-0.5 text-xs text-ink-soft">Enter the supplier's invoice. Saving it adds every line to the outlet's stock.</p>
    </div>

    @if (orderNumber()) { <p class="mt-3 rounded-xl bg-tone-lavender px-3 py-2 text-xs">Booking this invoice against order <a [routerLink]="['/retail/purchase-orders', orderId]" class="font-medium underline">{{ orderNumber() }}</a>. The products still to come are filled in. Change the packs to what the supplier really sent, enter each batch and its expiry, and delete the lines that did not arrive.</p> }
    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

    <div class="mt-3 space-y-3">
      <section class="card grid gap-3 sm:grid-cols-6">
        <div class="sm:col-span-2">
          <label class="label" for="pn-sup">Supplier *</label>
          <select id="pn-sup" class="field" (change)="supplierId = $any($event.target).value">
            <option value="">Choose…</option>
            @for (s of suppliers(); track s._id) { <option [value]="s._id" [selected]="s._id === supplierId">{{ s.name }}</option> }
          </select>
          @if (!suppliers().length) { <p class="mt-1 text-[11px] text-ink-soft">No suppliers yet. <a routerLink="/retail/suppliers" class="underline">Add one first</a>.</p> }
        </div>
        <div class="sm:col-span-2">
          <label class="label" for="pn-out">Receive into outlet *</label>
          <select id="pn-out" class="field" (change)="branchId = $any($event.target).value">
            @for (o of outlets(); track o._id) { <option [value]="o._id" [selected]="o._id === branchId">{{ o.name }}</option> }
          </select>
        </div>
        <div><label class="label" for="pn-no">Invoice no. *</label><input id="pn-no" class="field" [value]="invoiceNo" (input)="invoiceNo = $any($event.target).value" /></div>
        <div><label class="label" for="pn-date">Invoice date *</label><input id="pn-date" type="date" class="field" [value]="invoiceDate" (input)="invoiceDate = $any($event.target).value" /></div>
        <div class="sm:col-span-6">
          <label class="label" for="pn-notes">Notes <span class="font-normal">(optional)</span></label>
          <input id="pn-notes" class="field" [value]="notes" (input)="notes = $any($event.target).value" />
        </div>
      </section>

      <section class="card">
        <div class="hidden grid-cols-[minmax(0,2.6fr)_1fr_1.3fr_0.9fr_0.9fr_0.7fr_0.7fr_0.8fr_0.9fr_auto] gap-2 px-1 pb-1 text-[11px] text-ink-soft xl:grid">
          <span>Product</span><span>Batch</span><span>Expiry</span><span>MRP</span><span>Rate</span><span>Packs</span><span>Free</span><span>Disc %</span><span>GST %</span><span class="w-6"></span>
        </div>
        <div class="space-y-3 xl:space-y-2">
          @for (l of lines(); track l) {
            <div class="rounded-xl border border-line bg-white/50 p-2 xl:border-0 xl:bg-transparent xl:p-0">
              <div class="grid grid-cols-2 items-start gap-2 sm:grid-cols-4 xl:grid-cols-[minmax(0,2.6fr)_1fr_1.3fr_0.9fr_0.9fr_0.7fr_0.7fr_0.8fr_0.9fr_auto]">
                <div class="col-span-2 sm:col-span-4 xl:col-span-1">
                  <app-product-picker [value]="l.product()" (valueChange)="chosen(l, $event)" (failed)="error.set($event)" />
                  @if (l.product(); as p) {
                    <p class="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-soft">
                      <span class="badge" [class]="scheduleClass[p.schedule]">{{ p.schedule }}</span>
                      <span>{{ p.form }}{{ p.strength ? ' ' + p.strength : '' }}</span>
                      <span>{{ p.unitsPerPack }} per pack</span>
                    </p>
                  }
                </div>
                <div><label class="label xl:hidden">Batch</label><input class="field uppercase" aria-label="Batch number" [value]="l.batchNo()" (input)="l.batchNo.set($any($event.target).value)" /></div>
                <div>
                  <label class="label xl:hidden">Expiry</label>
                  <input type="month" class="field" aria-label="Expiry month" [min]="minMonth" [value]="l.expiry()" (input)="l.expiry.set($any($event.target).value)" />
                  @if (expiryHint(l); as h) { <p class="mt-0.5 text-[11px] text-amber-700">{{ h }}</p> }
                </div>
                <div><label class="label xl:hidden">MRP</label><input type="number" min="0" step="0.01" class="field" aria-label="MRP per pack" [value]="l.mrp() ?? ''" (input)="l.mrp.set(num($any($event.target).value))" /></div>
                <div>
                  <label class="label xl:hidden">Rate</label>
                  <input type="number" min="0" step="0.01" class="field" aria-label="Rate per pack" [value]="l.rate() ?? ''" (input)="l.rate.set(num($any($event.target).value))" />
                  @if (l.rate() != null && l.mrp() != null && l.rate()! > l.mrp()!) { <p class="mt-0.5 text-[11px] text-amber-700">Rate is above MRP</p> }
                </div>
                <div><label class="label xl:hidden">Packs</label><input type="number" min="1" step="1" class="field" aria-label="Billed packs" [value]="l.packs() ?? ''" (input)="l.packs.set(num($any($event.target).value))" /></div>
                <div><label class="label xl:hidden">Free</label><input type="number" min="0" step="1" class="field" aria-label="Free packs" [value]="l.free()" (input)="l.free.set(num($any($event.target).value) ?? 0)" /></div>
                <div><label class="label xl:hidden">Disc %</label><input type="number" min="0" max="100" step="0.01" class="field" aria-label="Discount percent" [value]="l.disc()" (input)="l.disc.set(num($any($event.target).value) ?? 0)" /></div>
                <div>
                  <label class="label xl:hidden">GST %</label>
                  <select class="field" aria-label="GST percent" (change)="l.gst.set(+$any($event.target).value)">
                    @for (g of gstRates; track g) { <option [value]="g" [selected]="g === l.gst()">{{ g }}%</option> }
                  </select>
                </div>
                <button type="button" class="btn btn-ghost h-9 w-9 shrink-0 !p-0" [disabled]="lines().length === 1" (click)="removeLine(l)" aria-label="Remove line">&times;</button>
              </div>
              @if (l.money().total > 0) {
                <p class="mt-1 text-right text-[11px] text-ink-soft">
                  {{ l.money().taxable | currency: 'INR' : 'symbol' : '1.2-2' }} + GST {{ l.money().gst | currency: 'INR' : 'symbol' : '1.2-2' }} =
                  <b class="text-ink">{{ l.money().total | currency: 'INR' : 'symbol' : '1.2-2' }}</b>
                </p>
              }
            </div>
          }
        </div>
        <button type="button" class="btn btn-ghost mt-3" (click)="addLine()">+ Add another product</button>
      </section>

      <section class="card flex flex-wrap items-end justify-between gap-3">
        <dl class="grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5 text-xs">
          <dt class="text-ink-soft">Taxable value</dt><dd class="text-right">{{ totals().taxable | currency: 'INR' : 'symbol' : '1.2-2' }}</dd>
          <dt class="text-ink-soft">GST</dt><dd class="text-right">{{ totals().gst | currency: 'INR' : 'symbol' : '1.2-2' }}</dd>
          <dt class="text-ink-soft">Round off</dt><dd class="text-right">{{ totals().roundOff | currency: 'INR' : 'symbol' : '1.2-2' }}</dd>
          <dt class="text-sm font-medium">Invoice total</dt><dd class="text-right text-sm font-medium">{{ totals().grand | currency: 'INR' : 'symbol' : '1.2-2' }}</dd>
        </dl>
        <div class="flex gap-2">
          <a routerLink="/retail/purchases" class="btn btn-ghost">Cancel</a>
          <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="submit()">{{ saving() ? 'Saving…' : 'Save and receive stock' }}</button>
        </div>
      </section>
    </div>
  `,
})
export class PurchaseNew implements OnInit {
  private readonly api = inject(RetailApi);
  private readonly ctx = inject(OutletContext);
  private readonly router = inject(Router);

  /** ?supplier=<id> (from a supplier's page) */
  supplier = input<string>();
  /** ?order=<id> (from a purchase order: Receive goods) */
  order = input<string>();
  private readonly http = inject(HttpClient);
  protected readonly orderNumber = signal('');
  protected orderId = '';
  private orderBranch = '';

  protected readonly scheduleClass = SCHEDULE_CLASS;
  protected readonly gstRates = [0, 5, 12, 18, 28];
  protected readonly minMonth = new Date().toISOString().slice(0, 7);
  protected readonly suppliers = signal<Supplier[]>([]);
  protected readonly outlets = signal<Outlet[]>([]);
  protected readonly lines = signal<Line[]>([new Line()]);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected supplierId = '';
  protected branchId = '';
  protected invoiceNo = '';
  protected invoiceDate = new Date().toISOString().slice(0, 10);
  protected notes = '';

  protected readonly totals = computed(() => {
    const ls = this.lines().filter((l) => l.product());
    const sum = (k: 'taxable' | 'gst' | 'total') => r2(ls.reduce((s, l) => s + l.money()[k], 0));
    const exact = sum('total');
    const grand = Math.round(exact);
    return { taxable: sum('taxable'), gst: sum('gst'), roundOff: r2(grand - exact), grand };
  });

  ngOnInit() {
    this.api.suppliers({ active: true }).subscribe({
      next: (s) => {
        this.suppliers.set(s);
        if (this.supplier() && s.some((x) => x._id === this.supplier())) this.supplierId = this.supplier()!;
      },
      error: (e) => this.error.set(apiError(e)),
    });
    this.api.outlets().subscribe({
      next: (o) => {
        const active = o.filter((x) => x.isActive);
        this.outlets.set(active);
        const preferred = active.find((x) => x._id === this.ctx.selected());
        this.branchId = this.orderBranch || ((preferred ?? active[0])?._id ?? '');
      },
    });
    if (this.order()) this.fillFromOrder(this.order()!);
  }

  /** Receiving against an order: the supplier, the outlet and the products still to come are filled in. */
  private fillFromOrder(id: string) {
    this.http
      .get<{ number: string; status: string; supplierId: string; branchId: string; lines: { product: Product | null; pendingPacks: number; rate: number | null }[] }>(`${environment.apiUrl}/purchase-orders/${id}`)
      .subscribe({
        next: (o) => {
          if (!['DRAFT', 'SENT', 'PARTIAL'].includes(o.status)) return this.error.set(`Order ${o.number} is finished, so goods cannot be booked against it.`);
          this.orderId = id;
          this.orderNumber.set(o.number);
          this.supplierId = o.supplierId;
          this.orderBranch = o.branchId;
          this.branchId = o.branchId;
          const lines = o.lines
            .filter((l) => l.product && l.pendingPacks > 0)
            .map((l) => {
              const line = new Line();
              line.product.set(l.product);
              line.gst.set(l.product!.gstPercent);
              line.packs.set(l.pendingPacks);
              if (l.rate !== null) line.rate.set(l.rate);
              if (l.product!.referenceMrp) line.mrp.set(l.product!.referenceMrp);
              return line;
            });
          if (lines.length) this.lines.set(lines);
        },
        error: (e) => this.error.set(apiError(e)),
      });
  }

  protected num(v: string): number | null {
    return v === '' ? null : Number(v);
  }

  protected addLine() {
    this.lines.update((l) => [...l, new Line()]);
  }

  protected removeLine(line: Line) {
    this.lines.update((l) => (l.length > 1 ? l.filter((x) => x !== line) : l));
  }

  /** Picking a product fills in its GST rate (still editable). */
  protected chosen(line: Line, p: Product | null) {
    line.product.set(p);
    if (p) line.gst.set(p.gstPercent);
  }

  protected expiryHint(l: Line): string | null {
    if (!l.expiry()) return null;
    const end = monthEnd(l.expiry());
    if (end <= Date.now()) return 'Already expired';
    return end - Date.now() <= SOON_MS ? 'Expires within 90 days' : null;
  }

  private validate(): string | null {
    if (!this.supplierId) return 'Choose the supplier.';
    if (!this.branchId) return 'Choose the outlet that receives the stock.';
    if (!this.invoiceNo.trim()) return 'Enter the supplier’s invoice number.';
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
      if (!l.packs() || l.packs()! < 1 || !Number.isInteger(l.packs())) return `${n}: enter the billed packs (whole number, 1 or more).`;
      if (!Number.isInteger(l.free()) || l.free() < 0) return `${n}: free packs must be a whole number.`;
    }
    return null;
  }

  protected submit() {
    const problem = this.validate();
    if (problem) return this.error.set(problem);
    const body: PurchaseInput = {
      branchId: this.branchId,
      supplierId: this.supplierId,
      invoiceNo: this.invoiceNo.trim(),
      invoiceDate: this.invoiceDate,
      notes: this.notes.trim() || undefined,
      orderId: this.orderId || undefined,
      lines: this.lines()
        .filter((l) => l.product())
        .map((l) => ({ productId: l.product()!._id, batchNo: l.batchNo().trim(), expiry: l.expiry(), mrp: l.mrp()!, rate: l.rate()!, packs: l.packs()!, freePacks: l.free(), discountPct: l.disc(), gstPercent: l.gst() ?? 0 })),
    };
    this.saving.set(true);
    this.error.set(null);
    this.api.createPurchase(body).subscribe({
      next: (p) => this.router.navigate(['/retail/purchases', p._id]),
      error: (e) => {
        this.saving.set(false);
        this.error.set(apiError(e));
      },
    });
  }
}
