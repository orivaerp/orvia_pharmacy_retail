import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnDestroy, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Page, apiError } from '../../shared/utils/api';
import { Product } from '../../shared/models/medicine';
import { ProviderApi, SupportSessionInfo } from '../provider-api.service';

type Tab = 'suppliers' | 'purchases' | 'stock' | 'history' | 'products';

interface SupplierRow { _id: string; name: string; gstin?: string; phone?: string; creditDays: number; outstanding: number; invoices: number }
interface Statement { outstanding: number; entries: { kind: string; id: string; date: string; ref: string; amount: number; balance: number }[] }
interface PurchaseRow { _id: string; number: string; invoiceNo: string; invoiceDate: string; supplierName: string; branchId: { name: string } | null; totals: { grand: number } }
interface PurchaseDetail { lines: { name: string; batchNo: string; packs: number; freePacks: number; rate: number; gstPercent: number; total: number }[] }
interface StockRow { productId: string; name: string; manufacturer: string; schedule: string; packs: number; loose: number; batches: number; nearestExpiry: string | null; stockStatus: string }
interface Movement { _id: string; at: string; type: string; product: string; batchNo?: string; outlet?: string; packs: number; reason?: string; supplierName?: string; reference?: string; by?: string }

/**
 * Read-only look into a shop for support. There is no button here that changes anything.
 * The session is time-limited and the shop owner sees that it happened and what was opened.
 */
@Component({
  selector: 'app-support-view',
  imports: [CurrencyPipe, DatePipe, RouterLink],
  template: `
    <div class="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
      <b>Read-only support view.</b>
      @if (info(); as i) {
        Reason: “{{ i.reason }}”. Ends {{ i.expiresAt | date: 'HH:mm' }} ({{ minutesLeft() }} min left).
        The shop owner can see this session and what you open.
      }
      <button type="button" class="ml-2 underline" (click)="end()">End session</button>
    </div>

    @if (ended()) {
      <section class="card mt-3 text-center">
        <p class="text-sm font-medium">This support session has ended.</p>
        <p class="mt-1 text-xs text-ink-soft">Start a new one from the shop page, with a reason, if you still need to look.</p>
        <a [routerLink]="['/provider/shops', id()]" class="btn btn-primary mt-3">Back to the shop</a>
      </section>
    } @else {
      <div class="mt-3 flex flex-wrap gap-1 rounded-full border border-line bg-surface p-1 text-xs" role="tablist">
        @for (t of tabs; track t[0]) {
          <button type="button" role="tab" class="rounded-full px-3 py-1" [attr.aria-selected]="tab() === t[0]" [class]="tab() === t[0] ? 'bg-brand text-brand-ink' : ''" (click)="open(t[0])">{{ t[1] }}</button>
        }
      </div>

      @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

      <section class="card mt-3">
        <div class="overflow-x-auto" [class.opacity-50]="loading()">
          @switch (tab()) {
            @case ('suppliers') {
              <table class="w-full min-w-136 text-left">
                <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Supplier</th><th class="py-1.5 pr-3 font-normal">GSTIN</th><th class="py-1.5 pr-3 font-normal">Credit</th><th class="py-1.5 pr-3 font-normal">Invoices</th><th class="py-1.5 pr-3 text-right font-normal">Owed</th><th class="py-1.5"></th></tr></thead>
                <tbody>
                  @for (s of suppliers(); track s._id) {
                    <tr class="border-t border-line text-xs">
                      <td class="py-1.5 pr-3 font-medium">{{ s.name }}<div class="text-[11px] font-normal text-ink-soft">{{ s.phone }}</div></td>
                      <td class="py-1.5 pr-3">{{ s.gstin || '-' }}</td>
                      <td class="py-1.5 pr-3">{{ s.creditDays }} days</td>
                      <td class="py-1.5 pr-3">{{ s.invoices }}</td>
                      <td class="py-1.5 pr-3 text-right font-medium">{{ s.outstanding | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                      <td class="py-1.5 text-right"><button type="button" class="btn btn-ghost !px-2.5 !py-0.5" (click)="toggleStatement(s._id)">{{ statementOf() === s._id ? 'Hide' : 'Statement' }}</button></td>
                    </tr>
                    @if (statementOf() === s._id && statement(); as st) {
                      <tr class="bg-white/40"><td colspan="6" class="px-3 pb-2">
                        <table class="w-full text-left text-[11px]">
                          @for (e of st.entries; track e.id) {
                            <tr class="border-t border-line/60"><td class="py-1 pr-3">{{ e.date | date: 'dd MMM yyyy' : 'UTC' }}</td><td class="py-1 pr-3">{{ e.kind }}</td><td class="py-1 pr-3">{{ e.ref }}</td><td class="py-1 pr-3 text-right">{{ e.amount | currency: 'INR' : 'symbol' : '1.2-2' }}</td><td class="py-1 text-right">{{ e.balance | currency: 'INR' : 'symbol' : '1.2-2' }}</td></tr>
                          } @empty { <tr><td class="py-1 text-ink-soft">No entries.</td></tr> }
                        </table>
                      </td></tr>
                    }
                  } @empty { <tr><td colspan="6" class="py-6 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'No suppliers.' }}</td></tr> }
                </tbody>
              </table>
            }
            @case ('purchases') {
              <table class="w-full min-w-136 text-left">
                <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Date</th><th class="py-1.5 pr-3 font-normal">Invoice</th><th class="py-1.5 pr-3 font-normal">Supplier</th><th class="py-1.5 pr-3 font-normal">Outlet</th><th class="py-1.5 pr-3 text-right font-normal">Amount</th><th class="py-1.5"></th></tr></thead>
                <tbody>
                  @for (p of purchases(); track p._id) {
                    <tr class="border-t border-line text-xs">
                      <td class="py-1.5 pr-3 whitespace-nowrap">{{ p.invoiceDate | date: 'dd MMM yyyy' : 'UTC' }}</td>
                      <td class="py-1.5 pr-3 font-medium">{{ p.invoiceNo }}<div class="text-[11px] font-normal text-ink-soft">{{ p.number }}</div></td>
                      <td class="py-1.5 pr-3">{{ p.supplierName }}</td>
                      <td class="py-1.5 pr-3">{{ p.branchId?.name }}</td>
                      <td class="py-1.5 pr-3 text-right font-medium">{{ p.totals.grand | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                      <td class="py-1.5 text-right"><button type="button" class="btn btn-ghost !px-2.5 !py-0.5" (click)="toggleInvoice(p._id)">{{ invoiceOf() === p._id ? 'Hide' : 'Lines' }}</button></td>
                    </tr>
                    @if (invoiceOf() === p._id && invoice(); as inv) {
                      <tr class="bg-white/40"><td colspan="6" class="px-3 pb-2">
                        <table class="w-full text-left text-[11px]">
                          @for (l of inv.lines; track $index) {
                            <tr class="border-t border-line/60"><td class="py-1 pr-3">{{ l.name }}</td><td class="py-1 pr-3">batch {{ l.batchNo }}</td><td class="py-1 pr-3">{{ l.packs }}{{ l.freePacks ? ' + ' + l.freePacks + ' free' : '' }} packs @ {{ l.rate | currency: 'INR' : 'symbol' : '1.2-2' }}</td><td class="py-1 pr-3">GST {{ l.gstPercent }}%</td><td class="py-1 text-right">{{ l.total | currency: 'INR' : 'symbol' : '1.2-2' }}</td></tr>
                          }
                        </table>
                      </td></tr>
                    }
                  } @empty { <tr><td colspan="6" class="py-6 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'No purchases.' }}</td></tr> }
                </tbody>
              </table>
            }
            @case ('stock') {
              <table class="w-full min-w-136 text-left">
                <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Product</th><th class="py-1.5 pr-3 font-normal">Schedule</th><th class="py-1.5 pr-3 font-normal">Packs</th><th class="py-1.5 pr-3 font-normal">Batches</th><th class="py-1.5 pr-3 font-normal">Nearest expiry</th><th class="py-1.5 font-normal">Status</th></tr></thead>
                <tbody>
                  @for (s of stock(); track s.productId) {
                    <tr class="border-t border-line text-xs"><td class="py-1.5 pr-3 font-medium">{{ s.name }}<div class="text-[11px] font-normal text-ink-soft">{{ s.manufacturer }}</div></td><td class="py-1.5 pr-3">{{ s.schedule }}</td><td class="py-1.5 pr-3">{{ s.packs }}{{ s.loose ? ' + ' + s.loose + ' loose' : '' }}</td><td class="py-1.5 pr-3">{{ s.batches }}</td><td class="py-1.5 pr-3">{{ s.nearestExpiry ? (s.nearestExpiry | date: 'MMM yyyy' : 'UTC') : '-' }}</td><td class="py-1.5">{{ s.stockStatus }}</td></tr>
                  } @empty { <tr><td colspan="6" class="py-6 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'No products.' }}</td></tr> }
                </tbody>
              </table>
            }
            @case ('history') {
              <table class="w-full min-w-136 text-left">
                <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">When</th><th class="py-1.5 pr-3 font-normal">Type</th><th class="py-1.5 pr-3 font-normal">Product</th><th class="py-1.5 pr-3 font-normal">Outlet</th><th class="py-1.5 pr-3 text-right font-normal">Packs</th><th class="py-1.5 font-normal">Details</th></tr></thead>
                <tbody>
                  @for (m of history(); track m._id) {
                    <tr class="border-t border-line text-xs"><td class="py-1.5 pr-3 whitespace-nowrap">{{ m.at | date: 'dd MMM, HH:mm' }}</td><td class="py-1.5 pr-3">{{ m.type }}</td><td class="py-1.5 pr-3">{{ m.product }}<div class="text-[11px] text-ink-soft">batch {{ m.batchNo }}</div></td><td class="py-1.5 pr-3">{{ m.outlet }}</td><td class="py-1.5 pr-3 text-right">{{ m.packs > 0 ? '+' : '' }}{{ m.packs }}</td><td class="py-1.5 text-ink-soft">{{ [m.reason, m.supplierName, m.reference, m.by].filter(hasText).join(' · ') }}</td></tr>
                  } @empty { <tr><td colspan="6" class="py-6 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'No movements.' }}</td></tr> }
                </tbody>
              </table>
            }
            @case ('products') {
              <table class="w-full min-w-136 text-left">
                <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Product</th><th class="py-1.5 pr-3 font-normal">Form</th><th class="py-1.5 pr-3 font-normal">Schedule</th><th class="py-1.5 pr-3 font-normal">GST</th><th class="py-1.5 pr-3 font-normal">Reorder at</th><th class="py-1.5 font-normal">Source</th></tr></thead>
                <tbody>
                  @for (p of products(); track p._id) {
                    <tr class="border-t border-line text-xs"><td class="py-1.5 pr-3 font-medium">{{ p.name }}</td><td class="py-1.5 pr-3">{{ p.form }} {{ p.strength }}</td><td class="py-1.5 pr-3">{{ p.schedule }}</td><td class="py-1.5 pr-3">{{ p.gstPercent }}%</td><td class="py-1.5 pr-3">{{ p.reorderLevel }}</td><td class="py-1.5">{{ p.isCustom ? 'shop’s own' : 'catalog' }}</td></tr>
                  } @empty { <tr><td colspan="6" class="py-6 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'No products.' }}</td></tr> }
                </tbody>
              </table>
            }
          }
        </div>
      </section>
    }
  `,
})
export class SupportView implements OnDestroy {
  private readonly api = inject(ProviderApi);
  private readonly router = inject(Router);

  /** route params: the shop and the support session */
  id = input.required<string>();
  sid = input.required<string>();

  protected readonly tabs: [Tab, string][] = [['suppliers', 'Suppliers'], ['purchases', 'Purchases'], ['stock', 'Stock'], ['history', 'Stock history'], ['products', 'Products']];
  protected readonly tab = signal<Tab>('suppliers');
  protected readonly info = signal<SupportSessionInfo | null>(null);
  protected readonly minutesLeft = signal(0);
  protected readonly ended = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly suppliers = signal<SupplierRow[]>([]);
  protected readonly purchases = signal<PurchaseRow[]>([]);
  protected readonly stock = signal<StockRow[]>([]);
  protected readonly history = signal<Movement[]>([]);
  protected readonly products = signal<Product[]>([]);
  protected readonly statementOf = signal<string | null>(null);
  protected readonly statement = signal<Statement | null>(null);
  protected readonly invoiceOf = signal<string | null>(null);
  protected readonly invoice = signal<PurchaseDetail | null>(null);

  protected readonly hasText = (x: string | undefined): boolean => !!x;
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    effect(() => {
      const sid = this.sid();
      this.api.supportInfo(sid).subscribe({
        next: (i) => {
          this.info.set(i);
          this.tick();
          this.open('suppliers');
        },
        error: () => this.ended.set(true),
      });
    });
    this.timer = setInterval(() => this.tick(), 15_000);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  private tick() {
    const i = this.info();
    if (!i) return;
    const left = Math.ceil((new Date(i.expiresAt).getTime() - Date.now()) / 60000);
    this.minutesLeft.set(Math.max(0, left));
    if (left <= 0) this.ended.set(true);
  }

  /** Any answer saying the session is over switches the page to the "ended" state. */
  private failed(e: unknown) {
    this.loading.set(false);
    const msg = apiError(e);
    if (/ended|not found/i.test(msg)) this.ended.set(true);
    else this.error.set(msg);
  }

  protected open(tab: Tab) {
    this.tab.set(tab);
    this.error.set(null);
    this.loading.set(true);
    const done = () => this.loading.set(false);
    const sid = this.sid();
    switch (tab) {
      case 'suppliers':
        return this.api.supportGet<SupplierRow[]>(sid, 'suppliers').subscribe({ next: (r) => (this.suppliers.set(r), done()), error: (e) => this.failed(e) });
      case 'purchases':
        return this.api.supportGet<Page<PurchaseRow>>(sid, 'purchases', { limit: 50 }).subscribe({ next: (r) => (this.purchases.set(r.items), done()), error: (e) => this.failed(e) });
      case 'stock':
        return this.api.supportGet<Page<StockRow>>(sid, 'stock', { limit: 50 }).subscribe({ next: (r) => (this.stock.set(r.items), done()), error: (e) => this.failed(e) });
      case 'history':
        return this.api.supportGet<Movement[]>(sid, 'stock-history', { limit: 100 }).subscribe({ next: (r) => (this.history.set(r), done()), error: (e) => this.failed(e) });
      case 'products':
        return this.api.supportGet<Page<Product>>(sid, 'products', { limit: 50 }).subscribe({ next: (r) => (this.products.set(r.items), done()), error: (e) => this.failed(e) });
    }
  }

  protected toggleStatement(supplierId: string) {
    if (this.statementOf() === supplierId) return this.statementOf.set(null);
    this.statementOf.set(supplierId);
    this.statement.set(null);
    this.api.supportGet<Statement>(this.sid(), `suppliers/${supplierId}`).subscribe({ next: (r) => this.statement.set(r), error: (e) => this.failed(e) });
  }

  protected toggleInvoice(purchaseId: string) {
    if (this.invoiceOf() === purchaseId) return this.invoiceOf.set(null);
    this.invoiceOf.set(purchaseId);
    this.invoice.set(null);
    this.api.supportGet<PurchaseDetail>(this.sid(), `purchases/${purchaseId}`).subscribe({ next: (r) => this.invoice.set(r), error: (e) => this.failed(e) });
  }

  protected end() {
    this.api.endSupport(this.sid()).subscribe({
      next: () => this.router.navigate(['/provider/shops', this.id()]),
      error: () => this.router.navigate(['/provider/shops', this.id()]),
    });
  }
}
