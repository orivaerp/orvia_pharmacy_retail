import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';

type Kind = 'text' | 'day' | 'datetime' | 'month' | 'money' | 'int' | 'pct' | 'qty';
interface Col {
  key: string;
  label: string;
  kind?: Kind;
  right?: boolean;
}
interface ReportDef {
  id: string;
  label: string;
  about: string;
  dated: boolean;
  cols: Col[];
}
interface ReportData {
  rows: Record<string, unknown>[];
  totals?: Record<string, number>;
  modes?: { mode: string; amount: number }[];
  from: string;
  to: string;
}

const REPORTS: ReportDef[] = [
  {
    id: 'sales',
    label: 'Daily sales',
    about: 'Bills per day, with refunds taken off.',
    dated: true,
    cols: [
      { key: 'date', label: 'Date', kind: 'day' },
      { key: 'bills', label: 'Bills', kind: 'int', right: true },
      { key: 'gross', label: 'Items total', kind: 'money', right: true },
      { key: 'discount', label: 'Discount', kind: 'money', right: true },
      { key: 'sales', label: 'Billed', kind: 'money', right: true },
      { key: 'refunds', label: 'Refunds', kind: 'money', right: true },
      { key: 'net', label: 'Net sales', kind: 'money', right: true },
      { key: 'gst', label: 'GST in billed', kind: 'money', right: true },
    ],
  },
  {
    id: 'gst',
    label: 'GST summary',
    about: 'Tax collected on sales, per rate, after returns. Prices include GST, so the tax is taken out of the price.',
    dated: true,
    cols: [
      { key: 'rate', label: 'GST rate', kind: 'pct' },
      { key: 'taxable', label: 'Taxable value', kind: 'money', right: true },
      { key: 'cgst', label: 'CGST', kind: 'money', right: true },
      { key: 'sgst', label: 'SGST', kind: 'money', right: true },
      { key: 'gst', label: 'Total GST', kind: 'money', right: true },
      { key: 'total', label: 'Invoice value', kind: 'money', right: true },
    ],
  },
  {
    id: 'items',
    label: 'Items sold',
    about: 'What sold in the period, after returns, highest value first.',
    dated: true,
    cols: [
      { key: 'name', label: 'Medicine' },
      { key: 'packs', label: 'Quantity sold', kind: 'qty' },
      { key: 'amount', label: 'Amount', kind: 'money', right: true },
    ],
  },
  {
    id: 'profit',
    label: 'Profit by medicine',
    about: 'Sales before GST minus what the medicine cost you (its purchase rate), after returns. Sales whose batch has no purchase rate are shown under "No cost" and left out of profit.',
    dated: true,
    cols: [
      { key: 'name', label: 'Medicine' },
      { key: 'packs', label: 'Quantity sold', kind: 'qty' },
      { key: 'sales', label: 'Sales (before GST)', kind: 'money', right: true },
      { key: 'cost', label: 'Cost', kind: 'money', right: true },
      { key: 'profit', label: 'Profit', kind: 'money', right: true },
      { key: 'margin', label: 'Margin', kind: 'pct', right: true },
      { key: 'noCost', label: 'No cost', kind: 'money', right: true },
    ],
  },
  {
    id: 'profitdays',
    label: 'Profit by day',
    about: 'Profit for each day: sales before GST minus cost, after returns (a return is taken off the day of the original bill).',
    dated: true,
    cols: [
      { key: 'date', label: 'Date', kind: 'day' },
      { key: 'sales', label: 'Sales (before GST)', kind: 'money', right: true },
      { key: 'cost', label: 'Cost', kind: 'money', right: true },
      { key: 'profit', label: 'Profit', kind: 'money', right: true },
      { key: 'margin', label: 'Margin', kind: 'pct', right: true },
      { key: 'noCost', label: 'No cost', kind: 'money', right: true },
    ],
  },
  {
    id: 'pnl',
    label: 'Profit and loss',
    about: 'Gross profit from medicines, less your expenses, gives the net profit for the period. Add your expenses under Accounts, Expenses.',
    dated: true,
    cols: [
      { key: 'line', label: '' },
      { key: 'amount', label: 'Amount', kind: 'money', right: true },
    ],
  },
  {
    id: 'expenses',
    label: 'Expenses',
    about: 'Every expense in the period (cancelled ones are left out).',
    dated: true,
    cols: [
      { key: 'date', label: 'Date', kind: 'day' },
      { key: 'category', label: 'Category' },
      { key: 'note', label: 'Note' },
      { key: 'mode', label: 'Paid by' },
      { key: 'by', label: 'Entered by' },
      { key: 'amount', label: 'Amount', kind: 'money', right: true },
    ],
  },
  {
    id: 'register',
    label: 'Schedule H/H1 register',
    about: 'Every Schedule H and H1 sale with the doctor and patient, for inspection.',
    dated: true,
    cols: [
      { key: 'date', label: 'Date', kind: 'datetime' },
      { key: 'bill', label: 'Bill' },
      { key: 'schedule', label: 'Sch.' },
      { key: 'medicine', label: 'Medicine' },
      { key: 'batchNo', label: 'Batch' },
      { key: 'expiry', label: 'Expiry', kind: 'month' },
      { key: 'units', label: 'Units', kind: 'int', right: true },
      { key: 'doctor', label: 'Doctor' },
      { key: 'regNo', label: 'Reg. no.' },
      { key: 'patient', label: 'Patient' },
      { key: 'age', label: 'Age' },
    ],
  },
  {
    id: 'expiry',
    label: 'Expiry',
    about: 'Batches with stock that are expired or will expire soon, with the money tied up in them.',
    dated: false,
    cols: [
      { key: 'product', label: 'Medicine' },
      { key: 'batchNo', label: 'Batch' },
      { key: 'expiry', label: 'Expiry', kind: 'month' },
      { key: 'status', label: 'Status' },
      { key: 'outlet', label: 'Outlet' },
      { key: 'packs', label: 'Stock', kind: 'qty' },
      { key: 'costValue', label: 'At cost', kind: 'money', right: true },
      { key: 'mrpValue', label: 'At MRP', kind: 'money', right: true },
    ],
  },
  {
    id: 'lowstock',
    label: 'Low stock',
    about: 'Medicines at or below their reorder level, or out of stock.',
    dated: false,
    cols: [
      { key: 'name', label: 'Medicine' },
      { key: 'manufacturer', label: 'Manufacturer' },
      { key: 'packs', label: 'In stock', kind: 'qty' },
      { key: 'reorderLevel', label: 'Reorder at', kind: 'int', right: true },
      { key: 'status', label: 'Status' },
      { key: 'nearestExpiry', label: 'Nearest expiry', kind: 'month' },
    ],
  },
  {
    id: 'purchases',
    label: 'Purchases',
    about: 'Supplier invoices booked in the period.',
    dated: true,
    cols: [
      { key: 'date', label: 'Invoice date', kind: 'day' },
      { key: 'number', label: 'Our no.' },
      { key: 'invoiceNo', label: 'Supplier invoice' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'outlet', label: 'Outlet' },
      { key: 'taxable', label: 'Taxable', kind: 'money', right: true },
      { key: 'gst', label: 'GST', kind: 'money', right: true },
      { key: 'total', label: 'Invoice total', kind: 'money', right: true },
    ],
  },
  {
    id: 'supplierwise',
    label: 'By supplier',
    about: 'What was bought from each supplier in the period, after stock sent back.',
    dated: true,
    cols: [
      { key: 'supplier', label: 'Supplier' },
      { key: 'invoices', label: 'Invoices', kind: 'int', right: true },
      { key: 'taxable', label: 'Taxable', kind: 'money', right: true },
      { key: 'gst', label: 'GST', kind: 'money', right: true },
      { key: 'billed', label: 'Billed', kind: 'money', right: true },
      { key: 'returned', label: 'Sent back', kind: 'money', right: true },
      { key: 'net', label: 'Net bought', kind: 'money', right: true },
    ],
  },
  {
    id: 'purchasegst',
    label: 'Purchase GST',
    about: 'GST you paid on purchases, per rate, after stock sent back (input tax).',
    dated: true,
    cols: [
      { key: 'rate', label: 'GST rate', kind: 'pct' },
      { key: 'taxable', label: 'Taxable value', kind: 'money', right: true },
      { key: 'cgst', label: 'CGST', kind: 'money', right: true },
      { key: 'sgst', label: 'SGST', kind: 'money', right: true },
      { key: 'gst', label: 'Total GST', kind: 'money', right: true },
      { key: 'total', label: 'With GST', kind: 'money', right: true },
    ],
  },
  {
    id: 'payables',
    label: 'Supplier dues',
    about: 'What you owe each supplier today (all outlets, not by date): opening balance plus invoices, less payments and stock sent back.',
    dated: false,
    cols: [
      { key: 'supplier', label: 'Supplier' },
      { key: 'phone', label: 'Phone' },
      { key: 'creditDays', label: 'Credit days', kind: 'int', right: true },
      { key: 'invoices', label: 'Invoices', kind: 'int', right: true },
      { key: 'lastInvoice', label: 'Last invoice', kind: 'day' },
      { key: 'outstanding', label: 'You owe', kind: 'money', right: true },
    ],
  },
  {
    id: 'receivables',
    label: 'Customer dues',
    about: 'What customers owe you today (udhaar), whole shop, not by date.',
    dated: false,
    cols: [
      { key: 'customer', label: 'Customer' },
      { key: 'phone', label: 'Phone' },
      { key: 'creditLimit', label: 'Limit', kind: 'money', right: true },
      { key: 'lastVisit', label: 'Last visit', kind: 'day' },
      { key: 'owes', label: 'Owes you', kind: 'money', right: true },
    ],
  },
];

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** Shop reports: pick one, pick the dates, read it on screen or download it as a CSV for Excel. */
@Component({
  selector: 'app-reports',
  imports: [FormsModule],
  template: `
    <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Reports</h1>
    <p class="mt-0.5 text-xs text-ink-soft">{{ ctx.selectedOutlet() ? ctx.selectedOutlet()!.name : 'All your outlets' }}. Change the outlet in the top bar.</p>

    <div class="mt-3 flex flex-wrap gap-1 rounded-full border border-line bg-surface p-1 text-xs" role="tablist">
      @for (r of reports; track r.id) {
        <button type="button" role="tab" class="rounded-full px-3 py-1" [attr.aria-selected]="r.id === def().id" [class]="r.id === def().id ? 'bg-brand text-brand-ink' : ''" (click)="choose(r.id)">{{ r.label }}</button>
      }
    </div>

    <div class="mt-3 flex flex-wrap items-end gap-2">
      @if (def().dated) {
        <div><label class="label" for="r-from">From</label><input id="r-from" type="date" class="field" [ngModel]="from()" (ngModelChange)="from.set($event); load()" /></div>
        <div><label class="label" for="r-to">To</label><input id="r-to" type="date" class="field" [ngModel]="to()" (ngModelChange)="to.set($event); load()" /></div>
        <button type="button" class="btn btn-ghost" (click)="thisMonth()">This month</button>
        <button type="button" class="btn btn-ghost" (click)="lastDays(7)">Last 7 days</button>
      }
      @if (def().id === 'expiry') {
        <div>
          <label class="label" for="r-days">Show</label>
          <select id="r-days" class="field" [ngModel]="days()" (ngModelChange)="days.set(+$event); load()">
            <option [ngValue]="0">Already expired</option>
            <option [ngValue]="30">Expired + next 30 days</option>
            <option [ngValue]="60">Expired + next 60 days</option>
            <option [ngValue]="90">Expired + next 90 days</option>
          </select>
        </div>
      }
      <button type="button" class="btn btn-primary ml-auto" [disabled]="!data()?.rows?.length" (click)="download()">Download CSV</button>
    </div>
    <p class="mt-2 text-[11px] text-ink-soft">{{ def().about }}</p>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

    @if (data()?.modes?.length) {
      <div class="mt-3 flex flex-wrap gap-2 text-xs">
        @for (m of data()!.modes!; track m.mode) { <span class="rounded-full border border-line bg-surface px-3 py-1">{{ modeLabel(m.mode) }}: <b>₹{{ money(m.amount) }}</b></span> }
      </div>
    }

    <section class="card mt-3">
      <div class="overflow-x-auto" [class.opacity-50]="loading()">
        <table class="w-full min-w-176 text-left">
          <thead>
            <tr class="text-[11px] text-ink-soft">
              @for (c of def().cols; track c.key) { <th class="py-1.5 pr-3 font-normal" [class.text-right]="c.right">{{ c.label }}</th> }
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track $index) {
              <tr class="border-t border-line text-xs">
                @for (c of def().cols; track c.key) { <td class="py-1.5 pr-3" [class.text-right]="c.right">{{ show(c, row) }}</td> }
              </tr>
            } @empty {
              <tr><td [attr.colspan]="def().cols.length" class="py-8 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'Nothing to show for this period.' }}</td></tr>
            }
          </tbody>
          @if (hasTotals() && rows().length) {
            <tfoot>
              <tr class="border-t-2 border-line text-xs font-medium">
                @for (c of def().cols; track c.key; let i = $index) {
                  <td class="py-1.5 pr-3" [class.text-right]="c.right">{{ i === 0 ? 'Total' : totalOf(c) }}</td>
                }
              </tr>
            </tfoot>
          }
        </table>
      </div>
      @if (rows().length) { <p class="mt-2 text-[11px] text-ink-soft">{{ rows().length }} row{{ rows().length === 1 ? '' : 's' }}</p> }
    </section>
  `,
})
export class Reports {
  private readonly http = inject(HttpClient);
  protected readonly ctx = inject(OutletContext);

  protected readonly reports = REPORTS;
  protected readonly active = signal('sales');
  protected readonly def = computed(() => REPORTS.find((r) => r.id === this.active()) ?? REPORTS[0]);
  protected readonly from = signal(`${today().slice(0, 8)}01`);
  protected readonly to = signal(today());
  protected readonly days = signal(90);
  protected readonly data = signal<ReportData | null>(null);
  protected readonly rows = computed(() => this.data()?.rows ?? []);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  private seq = 0;

  constructor() {
    this.ctx.load();
    effect(() => {
      this.ctx.selected();
      untracked(() => this.load());
    });
  }

  protected choose(id: string) {
    this.active.set(id);
    this.data.set(null);
    this.load();
  }

  protected thisMonth() {
    this.from.set(`${today().slice(0, 8)}01`);
    this.to.set(today());
    this.load();
  }

  protected lastDays(n: number) {
    this.from.set(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() - (n - 1) * 86_400_000)));
    this.to.set(today());
    this.load();
  }

  protected load() {
    const mine = ++this.seq;
    let params = new HttpParams();
    if (this.ctx.selected()) params = params.set('branchId', this.ctx.selected());
    if (this.def().dated) params = params.set('from', this.from()).set('to', this.to());
    if (this.def().id === 'expiry') params = params.set('days', this.days());
    this.loading.set(true);
    this.http.get<ReportData>(`${environment.apiUrl}/reports/${this.def().id}`, { params }).subscribe({
      next: (d) => {
        if (mine !== this.seq) return;
        this.data.set(d);
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

  protected money(n: number) {
    return inr.format(n);
  }

  protected modeLabel(m: string) {
    return ({ CASH: 'Cash', UPI: 'UPI', CARD: 'Card', CREDIT: 'On credit' } as Record<string, string>)[m] ?? m;
  }

  /** Text shown in a cell. `forCsv` keeps money as a plain number so Excel can add it up. */
  protected show(c: Col, row: Record<string, unknown>, forCsv = false): string {
    const v = row[c.key];
    if (v === null || v === undefined || v === '') return '';
    switch (c.kind) {
      case 'money':
        return forCsv ? String(v) : Number(v) < 0 ? '-₹' + inr.format(-Number(v)) : '₹' + inr.format(Number(v));
      case 'pct':
        return `${v}%`;
      case 'day':
        return forCsv ? String(v) : new Date(`${v}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
      case 'datetime':
        return new Date(String(v)).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      case 'month': {
        const d = new Date(String(v));
        return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
      }
      case 'qty':
        return `${v} pack${v === 1 ? '' : 's'}${row['loose'] ? ' + ' + row['loose'] + ' loose' : ''}`;
      default:
        return String(v);
    }
  }

  protected hasTotals(): boolean {
    const t = this.data()?.totals;
    return !!t && this.def().cols.slice(1).some((c) => t[c.key] !== undefined);
  }

  protected totalOf(c: Col): string {
    const t = this.data()?.totals;
    if (!t || t[c.key] === undefined) return '';
    return c.kind === 'money' ? '₹' + inr.format(t[c.key]) : c.kind === 'pct' ? `${t[c.key]}%` : String(t[c.key]);
  }

  protected download() {
    const d = this.data();
    if (!d?.rows.length) return;
    const cols = this.def().cols;
    const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [cols.map((c) => cell(c.label)).join(',')];
    for (const r of d.rows) lines.push(cols.map((c) => cell(this.show(c, r, true))).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orvia-${this.def().id}${this.def().dated ? `-${d.from}-to-${d.to}` : `-${today()}`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
