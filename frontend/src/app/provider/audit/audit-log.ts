import { HttpClient, HttpParams } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { Page, apiError } from '../../shared/utils/api';

interface AuditRow {
  _id: string;
  at: string;
  action: string;
  actor: { name: string; email: string; platform: boolean } | null;
  shop: { _id: string; name: string; code: string } | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
}

const AREAS: [string, string][] = [
  ['', 'Everything'],
  ['shops', 'Shops'],
  ['plans', 'Plans'],
  ['medicines', 'Medicine master'],
  ['outlets', 'Outlets'],
  ['staff', 'Staff'],
  ['stock', 'Stock'],
  ['purchasing', 'Purchasing'],
  ['sales', 'Sales'],
  ['payments', 'Payment settings'],
  ['support', 'Support access'],
  ['team', 'Team and sign-ins'],
  ['billing', 'Billing'],
];

/** What happened, in plain words. Anything not listed falls back to the raw action name. */
const LABELS: Record<string, string> = {
  'tenant.create': 'Shop created',
  'tenant.update': 'Shop details changed',
  'tenant.suspend': 'Shop suspended',
  'tenant.activate': 'Shop activated',
  'tenant.change_plan': 'Plan changed',
  'tenant.limits': 'Outlet limit changed',
  'tenant.reinvite': 'New password link sent',
  'plan.create': 'Plan created',
  'plan.update': 'Plan changed',
  'medicine.create': 'Medicine added to master',
  'medicine.update': 'Medicine changed',
  'medicine.import': 'Medicines imported',
  'medicine.bulk_status': 'Medicines verified or deactivated in bulk',
  'medicine.request.approve': 'Medicine request approved',
  'medicine.request.merge': 'Medicine request merged',
  'medicine.request.reject': 'Medicine request rejected',
  'outlet.create': 'Outlet added',
  'outlet.create.by_provider': 'Outlet added by Orvia',
  'outlet.update': 'Outlet changed',
  'outlet.update.by_provider': 'Outlet changed by Orvia',
  'outlet.activate': 'Outlet reopened',
  'outlet.activate.by_provider': 'Outlet reopened by Orvia',
  'outlet.deactivate': 'Outlet closed',
  'outlet.deactivate.by_provider': 'Outlet closed by Orvia',
  'outlet.request': 'Extra outlet requested',
  'outlet.request.approve': 'Outlet request approved',
  'outlet.request.reject': 'Outlet request rejected',
  'staff.create': 'Staff added',
  'staff.update': 'Staff changed',
  'staff.activate': 'Staff reactivated',
  'staff.deactivate': 'Staff deactivated',
  'staff.reinvite': 'Staff password link sent',
  'stock.adjust': 'Stock adjusted',
  'stock.transfer': 'Stock transferred',
  'supplier.create': 'Supplier added',
  'supplier.update': 'Supplier changed',
  'supplier.payment': 'Supplier paid',
  'purchase.create': 'Purchase booked',
  'purchase.return': 'Purchase returned',
  'sale.create': 'Bill made',
  'sale.return': 'Sale returned',
  'payments.keys.set': 'Payment keys saved',
  'payments.keys.remove': 'Payment keys removed',
  'platformuser.create': 'Orvia staff added',
  'platformuser.update': 'Orvia staff changed',
  'platformuser.deactivate': 'Orvia staff switched off',
  'platformuser.activate': 'Orvia staff switched on',
  'platformuser.reinvite': 'Password link sent to Orvia staff',
  'platformuser.reset_2fa': 'Two-step verification cleared',
  'auth.login': 'Signed in',
  'auth.login.failed': 'Failed sign-in',
  'auth.2fa.failed': 'Wrong two-step code',
  'auth.2fa.enabled': 'Two-step verification turned on',
  'auth.2fa.disabled': 'Two-step verification turned off',
  'auth.2fa.recovery_codes': 'New recovery codes made',
  'billing.invoice.issued': 'Subscription invoice issued',
  'billing.invoice.manual': 'Invoice issued by hand',
  'billing.invoice.paid': 'Subscription invoice paid',
  'billing.invoice.void': 'Subscription invoice voided',
  'billing.extended': 'More time given to a shop',
  'billing.run': 'Billing run by hand',
  'support.start': 'Support session started',
  'support.end': 'Support session ended',
};

/** The things worth showing at a glance from an entry's details. */
function summary(meta: Record<string, unknown> | null): string {
  if (!meta) return '';
  return Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
    .slice(0, 160);
}

/** Every important change on the platform, who made it and when. Read-only: entries can never be edited or deleted. */
@Component({
  selector: 'app-audit-log',
  imports: [DatePipe, FormsModule],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Audit log</h1>
        <p class="mt-0.5 text-xs text-ink-soft">Who did what, and when, across all shops. Entries cannot be edited or deleted.</p>
      </div>
      <button type="button" class="btn btn-ghost" [disabled]="exporting() || !total()" (click)="exportCsv()">{{ exporting() ? 'Preparing…' : 'Download CSV' }}</button>
    </div>

    <div class="mt-3 flex flex-wrap gap-2">
      <input class="field w-56" placeholder="Person, shop or action" aria-label="Search" (input)="onQ($any($event.target).value)" />
      <select class="field w-auto" aria-label="Area" [ngModel]="area" (ngModelChange)="area = $event; reset()">
        @for (a of areas; track a[0]) { <option [value]="a[0]">{{ a[1] }}</option> }
      </select>
      <input type="date" class="field w-auto" aria-label="From date" [ngModel]="from" (ngModelChange)="from = $event; reset()" />
      <input type="date" class="field w-auto" aria-label="To date" [ngModel]="to" (ngModelChange)="to = $event; reset()" />
    </div>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

    <section class="card mt-3">
      <div class="overflow-x-auto" [class.opacity-50]="loading()">
        <table class="w-full min-w-176 text-left">
          <thead>
            <tr class="text-[11px] text-ink-soft">
              <th class="py-1.5 pr-3 font-normal">When</th>
              <th class="py-1.5 pr-3 font-normal">Who</th>
              <th class="py-1.5 pr-3 font-normal">What</th>
              <th class="py-1.5 pr-3 font-normal">Shop</th>
              <th class="py-1.5 font-normal">Details</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r._id) {
              <tr class="cursor-pointer border-t border-line text-xs hover:bg-white/40" (click)="toggle(r._id)">
                <td class="py-1.5 pr-3 whitespace-nowrap">{{ r.at | date: 'dd MMM, HH:mm:ss' }}</td>
                <td class="py-1.5 pr-3">
                  @if (r.actor) {
                    <span class="font-medium">{{ r.actor.name }}</span>
                    <span class="badge ml-1" [class]="r.actor.platform ? 'bg-tone-lavender' : 'bg-chip'">{{ r.actor.platform ? 'Orvia' : 'shop staff' }}</span>
                    <div class="text-[11px] text-ink-soft">{{ r.actor.email }}</div>
                  } @else { <span class="text-ink-soft">system</span> }
                </td>
                <td class="py-1.5 pr-3">{{ label(r.action) }}<div class="text-[11px] text-ink-soft">{{ r.action }}</div></td>
                <td class="py-1.5 pr-3">{{ r.shop?.name || '-' }}</td>
                <td class="py-1.5 text-ink-soft">{{ summary(r.meta) }}</td>
              </tr>
              @if (open() === r._id) {
                <tr class="bg-white/40"><td colspan="5" class="px-3 py-2">
                  <pre class="overflow-x-auto text-[11px]">{{ pretty(r) }}</pre>
                </td></tr>
              }
            } @empty {
              <tr><td colspan="5" class="py-8 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'Nothing matches these filters.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      <div class="mt-2 flex items-center justify-between text-xs text-ink-soft">
        <span>{{ total() }} entr{{ total() === 1 ? 'y' : 'ies' }}</span>
        <span class="flex gap-2">
          <button type="button" class="btn btn-ghost !py-0.5" [disabled]="page() <= 1" (click)="go(-1)">Newer</button>
          <button type="button" class="btn btn-ghost !py-0.5" [disabled]="page() * limit >= total()" (click)="go(1)">Older</button>
        </span>
      </div>
    </section>
  `,
})
export class AuditLog {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/provider/audit-logs`;

  protected readonly areas = AREAS;
  protected readonly limit = 50;
  protected readonly rows = signal<AuditRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly open = signal<string | null>(null);
  protected area = '';
  protected from = '';
  protected to = '';
  private q = '';
  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  constructor() {
    this.load();
  }

  protected label = (a: string) => LABELS[a] ?? a;
  protected summary = summary;
  protected pretty = (r: AuditRow) => JSON.stringify({ at: r.at, action: r.action, actor: r.actor, shop: r.shop, ip: r.ip, details: r.meta }, null, 2);

  protected toggle(id: string) {
    this.open.update((o) => (o === id ? null : id));
  }

  protected onQ(v: string) {
    this.q = v;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reset(), 300);
  }

  protected reset() {
    this.page.set(1);
    this.load();
  }

  protected go(d: number) {
    this.page.update((p) => p + d);
    this.load();
  }

  private params(page: number, limit: number) {
    let p = new HttpParams().set('page', page).set('limit', limit);
    if (this.q.trim()) p = p.set('q', this.q.trim());
    if (this.area) p = p.set('area', this.area);
    if (this.from) p = p.set('from', this.from);
    if (this.to) p = p.set('to', this.to);
    return p;
  }

  private load() {
    const mine = ++this.seq;
    this.loading.set(true);
    this.http.get<Page<AuditRow>>(this.url, { params: this.params(this.page(), this.limit) }).subscribe({
      next: (r) => {
        if (mine !== this.seq) return;
        this.rows.set(r.items);
        this.total.set(r.total);
        this.open.set(null);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        if (mine !== this.seq) return;
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }

  /** Everything that matches the filters (up to 1000 newest entries) as a CSV for Excel. */
  protected exportCsv() {
    this.exporting.set(true);
    this.http.get<Page<AuditRow>>(this.url, { params: this.params(1, 1000) }).subscribe({
      next: (r) => {
        const cell = (v: unknown) => {
          const s = String(v ?? '');
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [['When', 'Who', 'Email', 'Kind', 'Action', 'Shop', 'Details', 'IP'].join(',')];
        for (const x of r.items) {
          lines.push([x.at, x.actor?.name, x.actor?.email, x.actor ? (x.actor.platform ? 'Orvia' : 'shop staff') : '', x.action, x.shop?.name, JSON.stringify(x.meta ?? {}), x.ip].map(cell).join(','));
        }
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `orvia-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        this.exporting.set(false);
      },
      error: (e) => {
        this.exporting.set(false);
        this.error.set(apiError(e));
      },
    });
  }
}
