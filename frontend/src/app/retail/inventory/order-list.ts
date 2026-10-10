import { HttpClient } from '@angular/common/http';
import { CurrencyPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';
import { OrderRow, RetailApi, Supplier } from '../retail-api.service';

interface Line extends OrderRow {
  qty: number;
  on: boolean;
  /** who to order it from: starts as the last supplier, can be changed */
  to: string;
}

/** What to order: low and out-of-stock products with a suggested quantity, grouped by supplier, ready to send. */
@Component({
  selector: 'app-order-list',
  imports: [CurrencyPipe, FormsModule, RouterLink],
  template: `
    <a routerLink="/retail/inventory" class="text-xs text-ink-soft hover:text-ink">&larr; Inventory</a>
    <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Order list</h1>
        <p class="mt-0.5 text-xs text-ink-soft">{{ ctx.selectedOutlet() ? ctx.selectedOutlet()!.name + ': ' : '' }}products that are low or out of stock, with how many packs to order. Change a quantity or supplier, untick what you do not want, then send each supplier their sheet.</p>
      </div>
    </div>
    <p class="mt-2 text-[11px] text-ink-soft">Suggested = the product's <b>Maximum</b> (Products page) minus what you have; with no Maximum it is twice the reorder level. The supplier is whoever you last bought it from. When the goods arrive, book them under Purchases.</p>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @for (g of groups(); track g.key) {
      <section class="card mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-sm font-medium">{{ g.name }}</h2>
            <p class="text-[11px] text-ink-soft">{{ g.count }} item{{ g.count === 1 ? '' : 's' }} selected@if (g.cost) { · about {{ g.cost | currency: 'INR' : 'symbol' : '1.0-0' }} at the last rates (before GST) }</p>
          </div>
          <div class="flex flex-wrap gap-2">
            @if (g.key) { <button type="button" class="btn btn-primary" [disabled]="!g.count || busy()" (click)="makeOrder(g.key)">Create purchase order</button> }
            <button type="button" class="btn btn-ghost" [disabled]="!g.count" (click)="copy(g.key)">Copy text (WhatsApp)</button>
            <button type="button" class="btn btn-ghost" [disabled]="!g.count" (click)="print(g.key)">Print</button>
            <button type="button" class="btn btn-ghost" [disabled]="!g.count" (click)="csv(g.key)">CSV</button>
          </div>
        </div>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full min-w-176 text-left">
            <thead>
              <tr class="text-[11px] text-ink-soft">
                <th class="w-6 py-1.5 pr-2 font-normal"></th>
                <th class="py-1.5 pr-3 font-normal">Product</th>
                <th class="py-1.5 pr-3 font-normal">In stock</th>
                <th class="py-1.5 pr-3 font-normal">Sold in 30 days</th>
                <th class="py-1.5 pr-3 font-normal">Order (packs)</th>
                <th class="py-1.5 pr-3 font-normal">Supplier</th>
                <th class="py-1.5 text-right font-normal">Last rate</th>
              </tr>
            </thead>
            <tbody>
              @for (r of g.lines; track r.productId) {
                <tr class="border-t border-line text-xs">
                  <td class="py-1.5 pr-2"><input type="checkbox" [checked]="r.on" (change)="patch(r.productId, { on: $any($event.target).checked })" [attr.aria-label]="'Order ' + r.name" /></td>
                  <td class="py-1.5 pr-3 font-medium">{{ r.name }}<div class="text-[11px] font-normal text-ink-soft">{{ r.manufacturer }}</div></td>
                  <td class="py-1.5 pr-3"><span class="badge" [class]="r.status === 'out' ? 'bg-tone-rose' : 'bg-tone-lavender'">{{ r.status === 'out' ? 'out' : r.packs + ' left' }}</span><div class="text-[11px] text-ink-soft">reorder at {{ r.reorderAt }}{{ r.maxLevel ? ', max ' + r.maxLevel : '' }}</div></td>
                  <td class="py-1.5 pr-3">{{ r.soldLast30 }}</td>
                  <td class="py-1.5 pr-3"><input type="number" min="1" class="field w-20 !py-1" [ngModel]="r.qty" (ngModelChange)="patch(r.productId, { qty: num($event) })" [attr.aria-label]="'Packs of ' + r.name" /></td>
                  <td class="py-1.5 pr-3">
                    <select class="field !py-1" [ngModel]="r.to" (ngModelChange)="patch(r.productId, { to: $event })" [attr.aria-label]="'Supplier for ' + r.name">
                      <option value="">No supplier yet</option>
                      @for (s of suppliers(); track s._id) { <option [value]="s._id">{{ s.name }}</option> }
                    </select>
                  </td>
                  <td class="py-1.5 text-right">{{ r.lastRate ? (r.lastRate | currency: 'INR' : 'symbol' : '1.2-2') : '-' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @empty {
      <section class="card mt-3"><p class="py-8 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'Nothing to order. Everything is above its low-stock level.' }}</p></section>
    }
  `,
})
export class OrderList {
  private readonly api = inject(RetailApi);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  protected readonly ctx = inject(OutletContext);
  protected readonly busy = signal(false);

  protected readonly lines = signal<Line[]>([]);
  protected readonly suppliers = signal<Supplier[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly groups = computed(() => {
    const byKey = new Map<string, Line[]>();
    for (const l of this.lines()) byKey.set(l.to, [...(byKey.get(l.to) ?? []), l]);
    const nameOf = (key: string) => this.suppliers().find((s) => s._id === key)?.name ?? (key ? 'Supplier' : 'No supplier yet');
    return [...byKey.entries()]
      .map(([key, lines]) => {
        const on = lines.filter((l) => l.on);
        return { key, name: nameOf(key), lines, count: on.length, cost: Math.round(on.reduce((t, l) => t + (l.lastRate ?? 0) * l.qty, 0)) };
      })
      .sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || a.name.localeCompare(b.name));
  });

  constructor() {
    this.ctx.load();
    this.api.suppliers({ active: true }).subscribe({ next: (s) => this.suppliers.set(s), error: () => undefined });
    effect(() => {
      const outlet = this.ctx.selected();
      untracked(() => this.load(outlet));
    });
  }

  protected num(v: unknown) {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  private load(outlet: string) {
    this.loading.set(true);
    this.api.orderList(outlet).subscribe({
      next: (r) => {
        this.lines.set(r.items.map((i) => ({ ...i, qty: i.suggested, on: true, to: i.supplierId ?? '' })));
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }

  protected patch(productId: string, change: Partial<Line>) {
    this.lines.update((ls) => ls.map((l) => (l.productId === productId ? { ...l, ...change } : l)));
  }

  private chosen(key: string) {
    return this.lines().filter((l) => l.to === key && l.on);
  }

  private text(key: string) {
    const supplier = this.suppliers().find((s) => s._id === key)?.name;
    const where = this.ctx.selectedOutlet()?.name;
    const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    return [
      `Order request${supplier ? ' for ' + supplier : ''}`,
      `${where ? 'For: ' + where + '\n' : ''}Date: ${date}`,
      '',
      ...this.chosen(key).map((l, i) => `${i + 1}. ${l.name}${l.manufacturer ? ' (' + l.manufacturer + ')' : ''}: ${l.qty} pack${l.qty === 1 ? '' : 's'}`),
      '',
      'Please confirm availability and rates. Thank you.',
    ].join('\n');
  }

  /** Turns the ticked products of one supplier into a draft purchase order, ready to send. */
  protected makeOrder(key: string) {
    const branchId = this.ctx.activeId();
    if (!branchId) return this.error.set('Choose an outlet in the top bar first: an order is for one outlet.');
    this.error.set(null);
    this.busy.set(true);
    this.http
      .post<{ _id: string }>(`${environment.apiUrl}/purchase-orders`, { supplierId: key, branchId, lines: this.chosen(key).map((l) => ({ productId: l.productId, packs: l.qty, rate: l.lastRate ?? undefined })) })
      .subscribe({
        next: (o) => this.router.navigate(['/retail/purchase-orders', o._id]),
        error: (e) => {
          this.busy.set(false);
          this.error.set(apiError(e));
        },
      });
  }

  protected async copy(key: string) {
    this.notice.set(null);
    try {
      await navigator.clipboard.writeText(this.text(key));
      this.notice.set('Order copied. Paste it into WhatsApp or an email to the supplier.');
    } catch {
      this.error.set('Copy failed. Use Print instead.');
    }
  }

  protected print(key: string) {
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
    const w = window.open('', '_blank', 'width=720,height=800');
    if (!w) return this.error.set('The print window was blocked. Allow pop-ups for this site.');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Order</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:640px;margin:24px auto;white-space:pre-wrap}</style></head><body>${esc(this.text(key))}<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  }

  protected csv(key: string) {
    const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const rows = [['Product', 'Manufacturer', 'Packs to order', 'In stock', 'Last rate'].join(','), ...this.chosen(key).map((l) => [l.name, l.manufacturer, l.qty, l.packs, l.lastRate ?? ''].map(cell).join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `order-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
