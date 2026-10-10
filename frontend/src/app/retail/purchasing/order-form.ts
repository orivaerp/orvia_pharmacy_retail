import { HttpClient } from '@angular/common/http';
import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Product } from '../../shared/models/medicine';
import { apiError } from '../../shared/utils/api';
import { ProductPicker } from '../components/product-picker';
import { OutletContext } from '../outlet-context.service';
import { Outlet, RetailApi, Supplier } from '../retail-api.service';

/** One row of the order. */
class Row {
  product = signal<Product | null>(null);
  packs = signal<number | null>(null);
  rate = signal<number | null>(null);
}

/** Write a purchase order (or change a draft): the supplier, the outlet it is for, and the products with how many packs. */
@Component({
  selector: 'app-order-form',
  imports: [CurrencyPipe, RouterLink, ProductPicker],
  template: `
    <a [routerLink]="id() ? ['/retail/purchase-orders', id()] : '/retail/purchase-orders'" class="text-xs text-ink-soft hover:text-ink">&larr; {{ id() ? 'Back to the order' : 'Purchase orders' }}</a>
    <h1 class="mt-2 text-xl font-medium tracking-tight sm:text-2xl">{{ id() ? 'Change order ' + number() : 'New purchase order' }}</h1>
    <p class="mt-0.5 text-xs text-ink-soft">Choose the supplier and what to order. Save it as a draft, then send it to the supplier from the next page.</p>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

    <div class="mt-3 space-y-3">
      <section class="card grid gap-3 sm:grid-cols-6">
        <div class="sm:col-span-2">
          <label class="label" for="po-sup">Supplier *</label>
          <select id="po-sup" class="field" (change)="supplierId = $any($event.target).value">
            <option value="">Choose…</option>
            @for (s of suppliers(); track s._id) { <option [value]="s._id" [selected]="s._id === supplierId">{{ s.name }}</option> }
          </select>
        </div>
        <div class="sm:col-span-2">
          <label class="label" for="po-out">For outlet *</label>
          <select id="po-out" class="field" (change)="branchId = $any($event.target).value">
            @for (o of outlets(); track o._id) { <option [value]="o._id" [selected]="o._id === branchId">{{ o.name }}</option> }
          </select>
        </div>
        <div class="sm:col-span-2"><label class="label" for="po-date">Wanted by <span class="font-normal">(optional)</span></label><input id="po-date" type="date" class="field" [min]="today" [value]="expectedOn" (input)="expectedOn = $any($event.target).value" /></div>
        <div class="sm:col-span-6"><label class="label" for="po-notes">Note for the supplier <span class="font-normal">(optional)</span></label><input id="po-notes" class="field" maxlength="300" [value]="notes" (input)="notes = $any($event.target).value" placeholder="e.g. deliver before noon, cold chain items packed separately" /></div>
      </section>

      <section class="card">
        <div class="hidden grid-cols-[minmax(0,3fr)_1fr_1fr_auto] gap-2 px-1 pb-1 text-[11px] text-ink-soft sm:grid"><span>Product</span><span>Packs</span><span>Rate (optional)</span><span class="w-9"></span></div>
        <div class="space-y-2">
          @for (r of rows(); track r) {
            <div class="grid grid-cols-2 items-start gap-2 sm:grid-cols-[minmax(0,3fr)_1fr_1fr_auto]">
              <div class="col-span-2 sm:col-span-1"><app-product-picker [value]="r.product()" (valueChange)="r.product.set($event)" (failed)="error.set($event)" /></div>
              <div><label class="label sm:hidden">Packs</label><input type="number" min="1" step="1" inputmode="numeric" class="field" aria-label="Packs to order" [value]="r.packs() ?? ''" (input)="r.packs.set(num($any($event.target).value))" /></div>
              <div><label class="label sm:hidden">Rate</label><input type="number" min="0" step="0.01" inputmode="decimal" class="field" aria-label="Expected rate per pack" [value]="r.rate() ?? ''" (input)="r.rate.set(num($any($event.target).value))" /></div>
              <button type="button" class="btn btn-ghost h-9 w-9 shrink-0 !p-0" [disabled]="rows().length === 1" (click)="remove(r)" aria-label="Remove line">&times;</button>
            </div>
          }
        </div>
        <button type="button" class="btn btn-ghost mt-3" (click)="add()">+ Add another product</button>
      </section>

      <section class="card flex flex-wrap items-center justify-between gap-3">
        <p class="text-xs text-ink-soft">{{ count() }} product{{ count() === 1 ? '' : 's' }}, {{ packs() }} packs@if (estimate()) { · about <b class="text-ink">{{ estimate() | currency: 'INR' : 'symbol' : '1.0-0' }}</b> before GST }</p>
        <div class="flex gap-2">
          <a [routerLink]="id() ? ['/retail/purchase-orders', id()] : '/retail/purchase-orders'" class="btn btn-ghost">Cancel</a>
          <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : id() ? 'Save changes' : 'Save as draft' }}</button>
        </div>
      </section>
    </div>
  `,
})
export class OrderForm implements OnInit {
  private readonly api = inject(RetailApi);
  private readonly http = inject(HttpClient);
  private readonly ctx = inject(OutletContext);
  private readonly router = inject(Router);

  /** set when changing a draft; ?supplier=<id> pre-chooses a supplier */
  readonly id = input<string>();
  readonly supplier = input<string>();

  protected readonly today = new Date().toISOString().slice(0, 10);
  protected readonly suppliers = signal<Supplier[]>([]);
  protected readonly outlets = signal<Outlet[]>([]);
  protected readonly rows = signal<Row[]>([new Row()]);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly number = signal('');
  protected supplierId = '';
  protected branchId = '';
  protected expectedOn = '';
  protected notes = '';

  protected readonly filled = computed(() => this.rows().filter((r) => r.product()));
  protected readonly count = computed(() => this.filled().length);
  protected readonly packs = computed(() => this.filled().reduce((s, r) => s + (r.packs() ?? 0), 0));
  protected readonly estimate = computed(() => Math.round(this.filled().reduce((s, r) => s + (r.packs() ?? 0) * (r.rate() ?? 0), 0)));

  ngOnInit() {
    this.api.suppliers({ active: true }).subscribe({
      next: (s) => {
        this.suppliers.set(s);
        if (!this.id() && this.supplier() && s.some((x) => x._id === this.supplier())) this.supplierId = this.supplier()!;
      },
      error: (e) => this.error.set(apiError(e)),
    });
    this.api.outlets().subscribe({
      next: (o) => {
        const active = o.filter((x) => x.isActive);
        this.outlets.set(active);
        if (!this.branchId) this.branchId = (active.find((x) => x._id === this.ctx.selected()) ?? active[0])?._id ?? '';
      },
    });
    if (this.id()) {
      this.http.get<{ number: string; status: string; supplierId: string; branchId: string; notes?: string; expectedOn?: string; lines: { product: Product | null; packs: number; rate: number | null }[] }>(`${environment.apiUrl}/purchase-orders/${this.id()}`).subscribe({
        next: (o) => {
          if (o.status !== 'DRAFT') return void this.router.navigate(['/retail/purchase-orders', this.id()]);
          this.number.set(o.number);
          this.supplierId = o.supplierId;
          this.branchId = o.branchId;
          this.notes = o.notes ?? '';
          this.expectedOn = o.expectedOn ?? '';
          this.rows.set(
            o.lines.map((l) => {
              const r = new Row();
              r.product.set(l.product);
              r.packs.set(l.packs);
              r.rate.set(l.rate);
              return r;
            }),
          );
        },
        error: (e) => this.error.set(apiError(e)),
      });
    }
  }

  protected num(v: string): number | null {
    return v === '' ? null : Number(v);
  }
  protected add() {
    this.rows.update((r) => [...r, new Row()]);
  }
  protected remove(row: Row) {
    this.rows.update((r) => (r.length > 1 ? r.filter((x) => x !== row) : r));
  }

  protected save() {
    if (!this.supplierId) return this.error.set('Choose the supplier.');
    if (!this.branchId) return this.error.set('Choose the outlet the order is for.');
    const used = this.rows().filter((r) => r.product() || r.packs());
    if (!used.length) return this.error.set('Add at least one product.');
    for (const [i, r] of used.entries()) {
      if (!r.product()) return this.error.set(`Line ${i + 1}: choose a product from the list.`);
      if (!r.packs() || r.packs()! < 1 || !Number.isInteger(r.packs())) return this.error.set(`Line ${i + 1}: enter the packs to order (a whole number, 1 or more).`);
    }
    const body = {
      supplierId: this.supplierId,
      branchId: this.branchId,
      notes: this.notes.trim(),
      expectedOn: this.expectedOn || undefined,
      lines: used.map((r) => ({ productId: r.product()!._id, packs: r.packs()!, rate: r.rate() ?? undefined })),
    };
    this.saving.set(true);
    this.error.set(null);
    const req = this.id() ? this.http.patch<{ _id: string }>(`${environment.apiUrl}/purchase-orders/${this.id()}`, body) : this.http.post<{ _id: string }>(`${environment.apiUrl}/purchase-orders`, body);
    req.subscribe({
      next: (o) => this.router.navigate(['/retail/purchase-orders', o._id]),
      error: (e) => {
        this.saving.set(false);
        this.error.set(apiError(e));
      },
    });
  }
}
