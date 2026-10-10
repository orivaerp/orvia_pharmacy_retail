import { HttpClient, HttpParams } from '@angular/common/http';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';

interface Preview {
  outlet: { _id: string; name: string };
  date: string;
  from: string;
  daysCovered: number;
  previous: { date: string; leftover: number } | null;
  locked: boolean;
  laterClose: string | null;
  existing: { counted: number; difference: number; withdrawn: number; note?: string; closedByName?: string; at: string } | null;
  opening: number | null;
  cashSales: number;
  cashRefunds: number;
  cashReceived: number;
  cashExpenses: number;
  supplierCash: number;
  nonCash: { upi: number; card: number; credit: number };
  unallocated: number;
  expected: number | null;
  expectedWithoutOpening: number;
}
interface Close {
  _id: string;
  date: string;
  expected: number;
  counted: number;
  difference: number;
  withdrawn: number;
  leftover: number;
  note?: string;
  closedByName?: string;
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** The end-of-day cash count: what the drawer should hold, what was counted, and the difference. */
@Component({
  selector: 'app-cash-close',
  imports: [FormsModule, CurrencyPipe, DatePipe],
  template: `
    <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Day close (cash)</h1>
    <p class="mt-0.5 text-xs text-ink-soft">At the end of the day, count the cash in the drawer and enter it. Orvia shows what should be there from the day's bills, refunds, udhaar received, expenses and supplier payments, and tells you if it is short or extra.</p>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (!outletId()) {
      <p class="card mt-3 text-xs">Choose an outlet in the top bar. The cash count is done for one outlet at a time.</p>
    } @else {
      <div class="mt-3 flex flex-wrap items-end gap-3">
        <div><label class="label" for="c-date">Day</label><input id="c-date" type="date" class="field !py-1" [max]="todayStr" [value]="date()" (change)="date.set($any($event.target).value)" /></div>
        <p class="text-xs text-ink-soft">Outlet: <b class="text-ink">{{ outletName() }}</b></p>
      </div>

      @if (p(); as v) {
        <section class="card mt-3">
          <h2 class="text-sm font-medium">What should be in the drawer</h2>
          @if (v.daysCovered > 1) { <p class="mt-1 text-[11px] text-ink-soft">This covers {{ v.daysCovered }} days ({{ v.from | date: 'dd MMM' }} to {{ v.date | date: 'dd MMM' }}) because the days in between were not closed.</p> }
          <dl class="mt-2 space-y-1 text-sm">
            <div class="flex justify-between"><dt>Cash at the start @if (v.previous) { <span class="text-[11px] text-ink-soft">(left after {{ v.previous.date | date: 'dd MMM' }})</span> }</dt>
              <dd>@if (v.opening !== null) { {{ v.opening | currency: 'INR' : 'symbol' : '1.2-2' }} } @else { <input type="number" min="0" step="0.01" class="field !w-32 !py-1 text-right" aria-label="Cash in the drawer at the start" [ngModel]="opening()" (ngModelChange)="opening.set($event)" /> }</dd></div>
            <div class="flex justify-between"><dt>+ Cash sales</dt><dd>{{ v.cashSales | currency: 'INR' : 'symbol' : '1.2-2' }}</dd></div>
            <div class="flex justify-between"><dt>+ Udhaar received in cash</dt><dd>{{ v.cashReceived | currency: 'INR' : 'symbol' : '1.2-2' }}</dd></div>
            <div class="flex justify-between"><dt>− Cash refunds to customers</dt><dd>{{ v.cashRefunds | currency: 'INR' : 'symbol' : '1.2-2' }}</dd></div>
            <div class="flex justify-between"><dt>− Cash expenses</dt><dd>{{ v.cashExpenses | currency: 'INR' : 'symbol' : '1.2-2' }}</dd></div>
            <div class="flex justify-between"><dt>− Cash paid to suppliers</dt><dd>{{ v.supplierCash | currency: 'INR' : 'symbol' : '1.2-2' }}</dd></div>
            <div class="flex justify-between border-t border-line pt-1.5 text-base font-medium"><dt>Should be in the drawer</dt><dd>{{ expected() | currency: 'INR' : 'symbol' : '1.2-2' }}</dd></div>
          </dl>
          <p class="mt-2 text-[11px] text-ink-soft">Not cash, so not counted here: UPI {{ v.nonCash.upi | currency: 'INR' : 'symbol' : '1.0-0' }} · card {{ v.nonCash.card | currency: 'INR' : 'symbol' : '1.0-0' }} · on credit {{ v.nonCash.credit | currency: 'INR' : 'symbol' : '1.0-0' }}.</p>
          @if (v.unallocated) { <p class="mt-1 rounded-xl bg-tone-lavender px-3 py-2 text-[11px]">{{ v.unallocated }} cash entr{{ v.unallocated === 1 ? 'y' : 'ies' }} (udhaar received, expense or supplier payment) in this period {{ v.unallocated === 1 ? 'is' : 'are' }} not tied to any outlet, so {{ v.unallocated === 1 ? 'it is' : 'they are' }} not counted here. New entries are tied to the outlet picked in the top bar.</p> }
        </section>

        @if (v.locked) {
          <p class="card mt-3 text-xs">{{ v.laterClose | date: 'dd MMM yyyy' }} is already closed after this day, so this day can no longer be changed. Days are closed in order.</p>
        } @else {
          <section class="card mt-3">
            <h2 class="text-sm font-medium">Count the cash</h2>
            @if (v.existing; as ex) { <p class="mt-1 rounded-xl bg-tone-lavender px-3 py-2 text-[11px]">This day was already closed by {{ ex.closedByName || 'someone' }}: counted {{ ex.counted | currency: 'INR' : 'symbol' : '1.2-2' }}, {{ ex.difference === 0 ? 'matched' : ex.difference < 0 ? 'short ' + (-ex.difference) : 'extra ' + ex.difference }}. Saving again replaces that count (the old one stays in the record).</p> }
            <div class="mt-2 grid gap-3 sm:grid-cols-3">
              <div><label class="label" for="c-counted">Cash counted (₹)</label><input id="c-counted" type="number" min="0" step="0.01" inputmode="decimal" class="field" [ngModel]="counted()" (ngModelChange)="counted.set($event)" /></div>
              <div><label class="label" for="c-out">Taken out of the drawer (₹)</label><input id="c-out" type="number" min="0" step="0.01" inputmode="decimal" class="field" [ngModel]="withdrawn()" (ngModelChange)="withdrawn.set($event)" /><p class="mt-0.5 text-[11px] text-ink-soft">Deposited in the bank or taken by the owner.</p></div>
              <div><label class="label" for="c-note">Note</label><input id="c-note" class="field" maxlength="300" placeholder="e.g. 50 short, gave change from the drawer" [ngModel]="note()" (ngModelChange)="note.set($event)" /></div>
            </div>
            @if (counted() !== null && counted() !== '' && diff() !== null) {
              <p class="mt-3 rounded-xl px-3 py-2 text-sm" [class]="diff() === 0 ? 'bg-tone-lime' : diff()! < 0 ? 'bg-red-50 text-red-700' : 'bg-tone-lavender'" role="status">
                @if (diff() === 0) { The cash matches. } @else if (diff()! < 0) { Short by <b>{{ -diff()! | currency: 'INR' : 'symbol' : '1.2-2' }}</b>. } @else { Extra <b>{{ diff() | currency: 'INR' : 'symbol' : '1.2-2' }}</b>. }
                Left in the drawer for tomorrow: <b>{{ leftover() | currency: 'INR' : 'symbol' : '1.2-2' }}</b>.
              </p>
            }
            <button type="button" class="btn btn-primary mt-3" [disabled]="busy() || counted() === null || counted() === ''" (click)="save()">{{ busy() ? 'Saving…' : v.existing ? 'Replace the count' : 'Close the day' }}</button>
          </section>
        }
      }

      <section class="card mt-3">
        <h2 class="text-sm font-medium">Closed days</h2>
        <div class="mt-1 overflow-x-auto">
          <table class="w-full min-w-136 text-left">
            <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Day</th><th class="py-1.5 pr-3 text-right font-normal">Should be</th><th class="py-1.5 pr-3 text-right font-normal">Counted</th><th class="py-1.5 pr-3 text-right font-normal">Difference</th><th class="py-1.5 pr-3 text-right font-normal">Taken out</th><th class="py-1.5 pr-3 text-right font-normal">Left</th><th class="py-1.5 font-normal">By</th></tr></thead>
            <tbody>
              @for (c of history(); track c._id) {
                <tr class="border-t border-line text-xs">
                  <td class="py-2 pr-3 whitespace-nowrap">{{ c.date | date: 'dd MMM yyyy' }}</td>
                  <td class="py-2 pr-3 text-right">{{ c.expected | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                  <td class="py-2 pr-3 text-right">{{ c.counted | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                  <td class="py-2 pr-3 text-right font-medium" [class]="c.difference < 0 ? 'text-red-700' : ''">{{ c.difference === 0 ? 'matched' : (c.difference | currency: 'INR' : 'symbol' : '1.2-2') }}</td>
                  <td class="py-2 pr-3 text-right">{{ c.withdrawn | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                  <td class="py-2 pr-3 text-right">{{ c.leftover | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                  <td class="py-2">{{ c.closedByName }}@if (c.note) { <span class="block text-[11px] text-ink-soft">{{ c.note }}</span> }</td>
                </tr>
              } @empty { <tr><td colspan="7" class="py-6 text-center text-xs text-ink-soft">No day closed yet.</td></tr> }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
})
export class CashClose {
  private readonly http = inject(HttpClient);
  protected readonly ctx = inject(OutletContext);
  private readonly url = `${environment.apiUrl}/cash`;

  protected readonly todayStr = today();
  protected readonly date = signal(today());
  protected readonly p = signal<Preview | null>(null);
  protected readonly history = signal<Close[]>([]);
  protected readonly opening = signal<number | string | null>(0);
  protected readonly counted = signal<number | string | null>(null);
  protected readonly withdrawn = signal<number | string | null>(0);
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly outletId = computed(() => this.ctx.activeId());
  protected readonly outletName = computed(() => this.ctx.choices().find((o) => o._id === this.outletId())?.name ?? '');

  /** the expected cash, using the opening cash typed in when this is the first close */
  protected readonly expected = computed(() => {
    const v = this.p();
    if (!v) return 0;
    return Math.round(((v.opening ?? Number(this.opening()) ?? 0) + v.expectedWithoutOpening) * 100) / 100;
  });
  protected readonly diff = computed(() => {
    const c = this.counted();
    if (c === null || c === '') return null;
    return Math.round((Number(c) - this.expected()) * 100) / 100;
  });
  protected readonly leftover = computed(() => Math.round((Number(this.counted() || 0) - Number(this.withdrawn() || 0)) * 100) / 100);

  constructor() {
    this.ctx.load();
    effect(() => {
      const outlet = this.outletId();
      const date = this.date();
      untracked(() => this.load(outlet, date));
    });
  }

  private load(outlet: string, date: string) {
    this.p.set(null);
    this.error.set(null);
    if (!outlet || !date) return;
    this.http.get<Preview>(`${this.url}/close`, { params: new HttpParams().set('branchId', outlet).set('date', date) }).subscribe({
      next: (v) => {
        if (outlet !== this.outletId() || date !== this.date()) return;
        this.p.set(v);
        this.counted.set(v.existing ? v.existing.counted : null);
        this.withdrawn.set(v.existing ? v.existing.withdrawn : 0);
        this.note.set(v.existing?.note ?? '');
      },
      error: (e) => this.error.set(apiError(e)),
    });
    this.http.get<Close[]>(`${this.url}/history`, { params: new HttpParams().set('branchId', outlet) }).subscribe({ next: (h) => this.history.set(h), error: () => this.history.set([]) });
  }

  protected save() {
    const v = this.p();
    if (!v) return;
    this.error.set(null);
    this.notice.set(null);
    const counted = Number(this.counted());
    const withdrawn = Number(this.withdrawn() || 0);
    if (!(counted >= 0)) return this.error.set('Enter the cash you counted.');
    if (withdrawn > counted) return this.error.set('You cannot take out more than you counted.');
    this.busy.set(true);
    this.http
      .post<{ difference: number; expected: number; replaced: boolean }>(`${this.url}/close`, {
        branchId: this.outletId(),
        date: this.date(),
        counted,
        withdrawn,
        openingCash: v.opening === null ? Number(this.opening() || 0) : undefined,
        note: this.note().trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.busy.set(false);
          this.notice.set(r.difference === 0 ? 'Day closed. The cash matched.' : r.difference < 0 ? `Day closed. Short by ₹${-r.difference}.` : `Day closed. Extra ₹${r.difference}.`);
          this.load(this.outletId(), this.date());
        },
        error: (e) => {
          this.busy.set(false);
          this.error.set(apiError(e));
        },
      });
  }
}
