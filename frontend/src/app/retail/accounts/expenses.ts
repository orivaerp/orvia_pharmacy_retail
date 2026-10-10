import { HttpClient, HttpParams } from '@angular/common/http';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';

interface Expense {
  _id: string;
  date: string;
  category: string;
  amount: number;
  mode: string;
  note?: string;
  branchId?: string;
  status: 'ACTIVE' | 'VOID';
  voidReason?: string;
  createdByName?: string;
}
interface Listing {
  items: Expense[];
  from: string;
  to: string;
  total: number;
  byCategory: Record<string, number>;
  categories: string[];
  modes: string[];
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** What the shop spends to run: rent, salary, electricity ... Entered here, taken off profit in the Profit and loss report. */
@Component({
  selector: 'app-expenses',
  imports: [FormsModule, CurrencyPipe, DatePipe],
  template: `
    <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Expenses</h1>
    <p class="mt-0.5 text-xs text-ink-soft">Write down what you spend to run the shop. Cash expenses are taken off the drawer in the day's cash count, and all of them come off profit in the Profit and loss report. Buying medicines is not an expense: that is a purchase.</p>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    <form class="card mt-3 grid gap-3 sm:grid-cols-6" (ngSubmit)="add()">
      <div class="sm:col-span-1"><label class="label" for="e-date">Date</label><input id="e-date" name="date" type="date" class="field" [max]="todayStr" [(ngModel)]="f.date" /></div>
      <div class="sm:col-span-2">
        <label class="label" for="e-cat">Category</label>
        <select id="e-cat" name="category" class="field" [(ngModel)]="f.category">
          @for (c of categories(); track c) { <option [value]="c">{{ c }}</option> }
        </select>
      </div>
      <div class="sm:col-span-1"><label class="label" for="e-amt">Amount (₹)</label><input id="e-amt" name="amount" type="number" min="0" step="0.01" inputmode="decimal" class="field" [(ngModel)]="f.amount" /></div>
      <div class="sm:col-span-1">
        <label class="label" for="e-mode">Paid by</label>
        <select id="e-mode" name="mode" class="field" [(ngModel)]="f.mode">
          @for (m of modes(); track m) { <option [value]="m">{{ m === 'CASH' ? 'Cash from the drawer' : m }}</option> }
        </select>
      </div>
      <div class="sm:col-span-1">
        <label class="label" for="e-out">Outlet</label>
        <select id="e-out" name="branchId" class="field" [(ngModel)]="f.branchId">
          <option value="">Whole shop</option>
          @for (o of ctx.choices(); track o._id) { <option [value]="o._id">{{ o.name }}</option> }
        </select>
      </div>
      <div class="sm:col-span-5"><label class="label" for="e-note">Note</label><input id="e-note" name="note" class="field" maxlength="200" placeholder="e.g. October rent, electrician" [(ngModel)]="f.note" /></div>
      <div class="flex items-end sm:col-span-1"><button type="submit" class="btn btn-primary w-full" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Add expense' }}</button></div>
    </form>

    <div class="mt-4 flex flex-wrap items-end gap-2">
      <div><label class="label" for="x-from">From</label><input id="x-from" type="date" class="field !py-1" [value]="from()" (change)="from.set($any($event.target).value); load()" /></div>
      <div><label class="label" for="x-to">To</label><input id="x-to" type="date" class="field !py-1" [value]="to()" (change)="to.set($any($event.target).value); load()" /></div>
      <span class="text-sm">Total: <b>{{ total() | currency: 'INR' : 'symbol' : '1.0-0' }}</b></span>
    </div>
    @if (cats().length) {
      <p class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-soft">
        @for (c of cats(); track c[0]) { <span>{{ c[0] }}: <b class="text-ink">{{ c[1] | currency: 'INR' : 'symbol' : '1.0-0' }}</b></span> }
      </p>
    }

    <section class="card mt-3">
      <div class="overflow-x-auto" [class.opacity-50]="loading()">
        <table class="w-full min-w-136 text-left">
          <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Date</th><th class="py-1.5 pr-3 font-normal">Category</th><th class="py-1.5 pr-3 font-normal">Note</th><th class="py-1.5 pr-3 font-normal">Paid by</th><th class="py-1.5 pr-3 text-right font-normal">Amount</th><th class="py-1.5"></th></tr></thead>
          <tbody>
            @for (e of items(); track e._id) {
              <tr class="border-t border-line text-xs" [class.opacity-50]="e.status === 'VOID'">
                <td class="py-2 pr-3 whitespace-nowrap">{{ e.date | date: 'dd MMM yyyy' : 'UTC' }}</td>
                <td class="py-2 pr-3">{{ e.category }}</td>
                <td class="py-2 pr-3">{{ e.note }}@if (e.status === 'VOID') { <span class="badge bg-chip ml-1">cancelled: {{ e.voidReason }}</span> }</td>
                <td class="py-2 pr-3">{{ e.mode }}</td>
                <td class="py-2 pr-3 text-right font-medium" [class.line-through]="e.status === 'VOID'">{{ e.amount | currency: 'INR' : 'symbol' : '1.0-2' }}</td>
                <td class="py-2 text-right">@if (e.status === 'ACTIVE') { <button type="button" class="btn btn-ghost !px-2.5 !py-0.5" (click)="cancel(e)">Cancel</button> }</td>
              </tr>
            } @empty { <tr><td colspan="6" class="py-8 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'No expenses in this period.' }}</td></tr> }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class Expenses {
  private readonly http = inject(HttpClient);
  protected readonly ctx = inject(OutletContext);
  private readonly url = `${environment.apiUrl}/expenses`;

  protected readonly todayStr = today();
  protected readonly items = signal<Expense[]>([]);
  protected readonly total = signal(0);
  protected readonly byCategory = signal<Record<string, number>>({});
  protected readonly categories = signal<string[]>(['Rent', 'Salary', 'Electricity and water', 'Transport', 'Packaging', 'Repairs and maintenance', 'Marketing', 'Licence and fees', 'Tea and misc', 'Other']);
  protected readonly modes = signal<string[]>(['CASH', 'UPI', 'BANK', 'CHEQUE', 'OTHER']);
  protected readonly cats = computed(() => Object.entries(this.byCategory()).sort((a, b) => b[1] - a[1]));
  protected readonly from = signal(`${today().slice(0, 8)}01`);
  protected readonly to = signal(today());
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected f = { date: today(), category: 'Rent', amount: null as number | null, mode: 'CASH', branchId: '', note: '' };

  constructor() {
    this.ctx.load();
    this.load();
  }

  protected load() {
    this.loading.set(true);
    this.http.get<Listing>(this.url, { params: new HttpParams().set('from', this.from()).set('to', this.to()) }).subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.total.set(r.total);
        this.byCategory.set(r.byCategory);
        this.categories.set(r.categories);
        this.modes.set(r.modes);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }

  protected add() {
    this.error.set(null);
    this.notice.set(null);
    const amount = Number(this.f.amount);
    if (!(amount > 0)) return this.error.set('Enter the amount.');
    this.busy.set(true);
    this.http.post(this.url, { date: this.f.date, category: this.f.category, amount, mode: this.f.mode, note: this.f.note.trim() || undefined, branchId: this.f.branchId || undefined }).subscribe({
      next: () => {
        this.busy.set(false);
        this.notice.set(`Saved: ${this.f.category}, ₹${amount}.`);
        this.f = { ...this.f, amount: null, note: '' };
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected cancel(e: Expense) {
    const reason = prompt(`Cancel this ${e.category} expense of ₹${e.amount}? It stays on record as cancelled. Why?`);
    if (reason === null) return;
    this.error.set(null);
    this.notice.set(null);
    this.http.post<{ warning?: string }>(`${this.url}/${e._id}/void`, { reason }).subscribe({
      next: (r) => {
        this.notice.set(r.warning ?? 'Expense cancelled.');
        this.load();
      },
      error: (er) => this.error.set(apiError(er)),
    });
  }
}
