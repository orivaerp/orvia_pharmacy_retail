import { HttpClient, HttpParams } from '@angular/common/http';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';

interface Summary {
  _id: string;
  name: string;
  status: 'OPEN' | 'REVIEW' | 'APPLIED' | 'CANCELLED';
  counted: number;
  startedByName?: string;
  createdAt: string;
  appliedAt?: string;
  appliedByName?: string;
  summary?: { changed: number; shortValue: number; extraValue: number; uncountedWrittenOff: number };
}
interface SheetRow {
  batchId: string;
  productId: string;
  name: string;
  manufacturer: string;
  location: string;
  barcodes: string[];
  batchNo: string;
  expiryDate: string;
  unitsPerPack: number;
  looseSelling: boolean;
  counted: { packs: number; loose: number } | null;
  packsIn: string;
  looseIn: string;
  saved: boolean;
}
interface Review {
  count: Summary;
  lines: { batchId: string; name: string; batchNo: string; expiryDate: string; system: { packs: number; loose: number }; counted: { packs: number; loose: number }; diff: { packs: number; loose: number }; diffUnits: number; value: number; costKnown: boolean }[];
  matched: number;
  totals: { counted: number; changed: number; shortValue: number; extraValue: number; noCostLines: number };
  uncounted: { batches: number; value: number };
}

const qty = (q: { packs: number; loose: number }) => `${q.packs}${q.loose ? ' + ' + q.loose + ' loose' : ''}`;
const MAX_ROWS = 300;

/** Count the stock on the shelf, see what differs from the system, and fix it. */
@Component({
  selector: 'app-stock-count',
  imports: [FormsModule, RouterLink, CurrencyPipe, DatePipe],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Stock count</h1>
        <p class="mt-0.5 text-xs text-ink-soft">Walk the shelves, count what is really there, and Orvia shows what is short or extra. While you count, the stock Orvia holds is hidden, so the count is honest.</p>
      </div>
      <a routerLink="/retail/inventory" class="btn btn-ghost">Back to inventory</a>
    </div>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (!outletId()) {
      <p class="card mt-3 text-xs">Choose an outlet in the top bar. A count is done for one outlet at a time.</p>
    } @else {
      @if (!current()) {
        <section class="card mt-3">
          <h2 class="text-sm font-medium">Start a count for {{ outletName() }}</h2>
          <p class="mt-1 text-xs text-ink-soft">You will get a list of every batch in stock. Enter how many packs you find. You can stop and carry on later; nothing changes in your stock until the corrections are applied.</p>
          <div class="mt-2 flex flex-wrap items-end gap-2">
            <div><label class="label" for="sc-name">Name (optional)</label><input id="sc-name" class="field !py-1" maxlength="80" placeholder="e.g. October count, rack A" [ngModel]="newName()" (ngModelChange)="newName.set($event)" /></div>
            <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="start()">Start counting</button>
          </div>
        </section>
      } @else if (current(); as c) {
        @if (c.status === 'OPEN') {
          <section class="card mt-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 class="text-sm font-medium">{{ c.name }} <span class="badge bg-tone-lavender ml-1">counting</span></h2>
                <p class="text-xs text-ink-soft">{{ counted() }} of {{ rows().length }} batches counted. Started by {{ c.startedByName }}.</p>
              </div>
              <div class="flex gap-2">
                <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="cancel()">Cancel count</button>
                <button type="button" class="btn btn-primary" [disabled]="busy() || !counted()" (click)="finish()">Finish counting</button>
              </div>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <input id="sc-q" class="field !min-h-11 w-64 text-base sm:text-sm" autocomplete="off" placeholder="Search name, rack, batch or scan a barcode" aria-label="Search the list" [ngModel]="q()" (ngModelChange)="q.set($event)" (keydown.enter)="onEnter()" />
              <label class="flex items-center gap-1.5 text-xs"><input type="checkbox" [ngModel]="onlyOpen()" (ngModelChange)="onlyOpen.set($event)" /> Show only batches not counted yet</label>
            </div>
            <div class="mt-2 overflow-x-auto">
              <table class="w-full min-w-136 text-left">
                <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Medicine</th><th class="py-1.5 pr-3 font-normal">Rack</th><th class="py-1.5 pr-3 font-normal">Batch</th><th class="py-1.5 pr-3 font-normal">Expiry</th><th class="py-1.5 pr-3 font-normal">Packs counted</th><th class="py-1.5 font-normal">Loose</th></tr></thead>
                <tbody>
                  @for (r of shown(); track r.batchId) {
                    <tr class="border-t border-line text-xs" [class.bg-white]="r.counted">
                      <td class="py-1.5 pr-3 font-medium">{{ r.name }}<span class="block text-[11px] font-normal text-ink-soft">{{ r.manufacturer }}</span></td>
                      <td class="py-1.5 pr-3">{{ r.location || '-' }}</td>
                      <td class="py-1.5 pr-3">{{ r.batchNo }}</td>
                      <td class="py-1.5 pr-3 whitespace-nowrap">{{ r.expiryDate | date: 'MMM yyyy' : 'UTC' }}</td>
                      <td class="py-1.5 pr-3"><input [id]="'cnt-' + r.batchId" type="number" min="0" step="1" inputmode="numeric" class="field !min-h-10 !w-24 !py-1" [attr.aria-label]="'Packs of ' + r.name + ' batch ' + r.batchNo" [ngModel]="r.packsIn" (ngModelChange)="r.packsIn = $event; r.saved = false" (change)="save(r)" /></td>
                      <td class="py-1.5">
                        @if (r.looseSelling) { <input type="number" min="0" step="1" inputmode="numeric" class="field !min-h-10 !w-20 !py-1" [attr.aria-label]="'Loose units of ' + r.name" [ngModel]="r.looseIn" (ngModelChange)="r.looseIn = $event; r.saved = false" (change)="save(r)" /> } @else { <span class="text-ink-soft">-</span> }
                        @if (r.saved) { <span class="ml-2 text-[11px] text-ink-soft" aria-label="saved">saved</span> }
                      </td>
                    </tr>
                  } @empty { <tr><td colspan="6" class="py-6 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'Nothing matches.' }}</td></tr> }
                </tbody>
              </table>
            </div>
            @if (hidden() > 0) { <p class="mt-1 text-[11px] text-ink-soft">Showing the first {{ max }} of {{ hidden() + max }}. Search to narrow the list.</p> }
          </section>
        } @else {
          <section class="card mt-3">
            <h2 class="text-sm font-medium">{{ c.name }} <span class="badge bg-tone-lime ml-1">counted, waiting for review</span></h2>
            @if (!canApprove()) {
              <p class="mt-2 text-xs">Counting is done. The owner or a manager will see the differences and apply them. You can go back to counting if you missed something.</p>
              <div class="mt-3 flex gap-2"><button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="reopen()">Back to counting</button></div>
            } @else if (review(); as v) {
              <dl class="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div class="rounded-xl bg-white/50 p-2"><dt class="text-ink-soft">Batches counted</dt><dd class="text-base font-medium">{{ v.totals.counted }}</dd></div>
                <div class="rounded-xl bg-white/50 p-2"><dt class="text-ink-soft">Matched</dt><dd class="text-base font-medium">{{ v.matched }}</dd></div>
                <div class="rounded-xl p-2" [class]="v.totals.shortValue ? 'bg-red-50' : 'bg-white/50'"><dt class="text-ink-soft">Short (at cost)</dt><dd class="text-base font-medium">{{ v.totals.shortValue | currency: 'INR' : 'symbol' : '1.0-0' }}</dd></div>
                <div class="rounded-xl bg-white/50 p-2"><dt class="text-ink-soft">Extra (at cost)</dt><dd class="text-base font-medium">{{ v.totals.extraValue | currency: 'INR' : 'symbol' : '1.0-0' }}</dd></div>
              </dl>
              @if (v.totals.noCostLines) { <p class="mt-1 text-[11px] text-ink-soft">{{ v.totals.noCostLines }} batch{{ v.totals.noCostLines === 1 ? ' has' : 'es have' }} no purchase rate, so {{ v.totals.noCostLines === 1 ? 'its' : 'their' }} value shows as ₹0.</p> }
              <div class="mt-3 overflow-x-auto">
                <table class="w-full min-w-136 text-left">
                  <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Medicine</th><th class="py-1.5 pr-3 font-normal">Batch</th><th class="py-1.5 pr-3 text-right font-normal">Orvia had</th><th class="py-1.5 pr-3 text-right font-normal">You counted</th><th class="py-1.5 pr-3 text-right font-normal">Difference</th><th class="py-1.5 text-right font-normal">Value</th></tr></thead>
                  <tbody>
                    @for (l of v.lines; track l.batchId) {
                      <tr class="border-t border-line text-xs">
                        <td class="py-1.5 pr-3 font-medium">{{ l.name }}</td>
                        <td class="py-1.5 pr-3">{{ l.batchNo }}</td>
                        <td class="py-1.5 pr-3 text-right">{{ fmt(l.system) }}</td>
                        <td class="py-1.5 pr-3 text-right">{{ fmt(l.counted) }}</td>
                        <td class="py-1.5 pr-3 text-right font-medium" [class]="l.diffUnits < 0 ? 'text-red-700' : ''">{{ l.diffUnits > 0 ? '+' : '' }}{{ fmt(l.diff) }}</td>
                        <td class="py-1.5 text-right" [class]="l.value < 0 ? 'text-red-700' : ''">{{ l.value | currency: 'INR' : 'symbol' : '1.0-2' }}</td>
                      </tr>
                    } @empty { <tr><td colspan="6" class="py-4 text-center text-xs text-ink-soft">Everything you counted matches the system.</td></tr> }
                  </tbody>
                </table>
              </div>
              @if (v.uncounted.batches) {
                <label class="mt-3 flex items-start gap-2 rounded-xl bg-tone-lavender px-3 py-2 text-xs">
                  <input type="checkbox" class="mt-0.5" [ngModel]="uncountedAsZero()" (ngModelChange)="uncountedAsZero.set($event)" />
                  <span><b>{{ v.uncounted.batches }}</b> batch{{ v.uncounted.batches === 1 ? '' : 'es' }} (worth {{ v.uncounted.value | currency: 'INR' : 'symbol' : '1.0-0' }} at cost) {{ v.uncounted.batches === 1 ? 'was' : 'were' }} not counted. They are left as they are. Tick this only if you counted every shelf and the rest is really gone: they will be written off.</span>
                </label>
              }
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <input class="field !py-1 w-64" maxlength="200" placeholder="Note (optional)" aria-label="Note" [ngModel]="applyNote()" (ngModelChange)="applyNote.set($event)" />
                <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="apply(v)">{{ busy() ? 'Applying…' : 'Apply corrections' }}</button>
                <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="reopen()">Back to counting</button>
                <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="cancel()">Cancel count</button>
              </div>
              <p class="mt-1 text-[11px] text-ink-soft">Each difference is added to (or taken off) the batch and recorded in the stock history as a count correction. Bills made while you were counting are not undone.</p>
            } @else { <p class="mt-2 text-xs text-ink-soft">Loading the differences…</p> }
          </section>
        }
      }

      <section class="card mt-3">
        <h2 class="text-sm font-medium">Earlier counts</h2>
        <div class="mt-1 overflow-x-auto">
          <table class="w-full min-w-136 text-left">
            <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Count</th><th class="py-1.5 pr-3 font-normal">Status</th><th class="py-1.5 pr-3 text-right font-normal">Short (cost)</th><th class="py-1.5 pr-3 text-right font-normal">Extra (cost)</th><th class="py-1.5 font-normal">Applied by</th></tr></thead>
            <tbody>
              @for (h of history(); track h._id) {
                <tr class="border-t border-line text-xs">
                  <td class="py-2 pr-3">{{ h.name }}<span class="block text-[11px] text-ink-soft">{{ h.createdAt | date: 'dd MMM yyyy' }}</span></td>
                  <td class="py-2 pr-3">{{ statusText(h.status) }}</td>
                  <td class="py-2 pr-3 text-right" [class]="(h.summary?.shortValue ?? 0) > 0 ? 'text-red-700' : ''">{{ h.status === 'APPLIED' ? (h.summary?.shortValue | currency: 'INR' : 'symbol' : '1.0-0') : '' }}</td>
                  <td class="py-2 pr-3 text-right">{{ h.status === 'APPLIED' ? (h.summary?.extraValue | currency: 'INR' : 'symbol' : '1.0-0') : '' }}</td>
                  <td class="py-2">{{ h.appliedByName }}@if (h.appliedAt) { <span class="block text-[11px] text-ink-soft">{{ h.appliedAt | date: 'dd MMM yyyy, HH:mm' }}</span> }</td>
                </tr>
              } @empty { <tr><td colspan="5" class="py-6 text-center text-xs text-ink-soft">No stock count yet.</td></tr> }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
})
export class StockCount {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  protected readonly ctx = inject(OutletContext);
  private readonly url = `${environment.apiUrl}/stock-counts`;

  protected readonly max = MAX_ROWS;
  protected readonly current = signal<Summary | null>(null);
  protected readonly history = signal<Summary[]>([]);
  protected readonly rows = signal<SheetRow[]>([]);
  protected readonly review = signal<Review | null>(null);
  protected readonly q = signal('');
  protected readonly onlyOpen = signal(false);
  protected readonly newName = signal('');
  protected readonly applyNote = signal('');
  protected readonly uncountedAsZero = signal(false);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly outletId = computed(() => this.ctx.activeId());
  protected readonly outletName = computed(() => this.ctx.choices().find((o) => o._id === this.outletId())?.name ?? '');
  protected readonly canApprove = computed(() => this.auth.hasPermission('purchase.approve'));
  protected readonly counted = computed(() => this.rows().filter((r) => r.counted).length);

  private readonly filtered = computed(() => {
    const text = this.q().trim().toLowerCase();
    return this.rows().filter((r) => (!this.onlyOpen() || !r.counted) && (!text || [r.name, r.manufacturer, r.location, r.batchNo].some((s) => s?.toLowerCase().includes(text)) || r.barcodes.includes(this.q().trim())));
  });
  protected readonly shown = computed(() => this.filtered().slice(0, MAX_ROWS));
  protected readonly hidden = computed(() => Math.max(0, this.filtered().length - MAX_ROWS));

  constructor() {
    this.ctx.load();
    effect(() => {
      const outlet = this.outletId();
      untracked(() => this.refresh(outlet));
    });
  }

  protected fmt = qty;
  protected statusText(s: string) {
    return ({ OPEN: 'Counting', REVIEW: 'Waiting for review', APPLIED: 'Applied', CANCELLED: 'Cancelled' } as Record<string, string>)[s] ?? s;
  }

  private refresh(outlet: string) {
    this.current.set(null);
    this.rows.set([]);
    this.review.set(null);
    if (!outlet) return;
    this.http.get<{ current: Summary | null; history: Summary[] }>(this.url, { params: new HttpParams().set('branchId', outlet) }).subscribe({
      next: (r) => {
        if (outlet !== this.outletId()) return;
        this.current.set(r.current);
        this.history.set(r.history);
        if (r.current?.status === 'OPEN') this.loadSheet(r.current._id);
        if (r.current?.status === 'REVIEW' && this.canApprove()) this.loadReview(r.current._id);
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  private loadSheet(id: string) {
    this.loading.set(true);
    this.http.get<{ rows: (Omit<SheetRow, 'packsIn' | 'looseIn' | 'saved'>)[] }>(`${this.url}/${id}/sheet`).subscribe({
      next: (r) => {
        this.rows.set(r.rows.map((x) => ({ ...x, packsIn: x.counted ? String(x.counted.packs) : '', looseIn: x.counted?.loose ? String(x.counted.loose) : '', saved: false })));
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  private loadReview(id: string) {
    this.http.get<Review>(`${this.url}/${id}/review`).subscribe({ next: (r) => this.review.set(r), error: (e) => this.error.set(apiError(e)) });
  }

  protected start() {
    this.act(this.http.post<Summary>(this.url, { branchId: this.outletId(), name: this.newName().trim() || undefined }), () => {
      this.newName.set('');
      this.notice.set('Count started. Enter what you find on the shelves.');
    });
  }

  protected finish() {
    const c = this.current()!;
    if (!confirm(`Finish counting? ${this.counted()} of ${this.rows().length} batches were counted.`)) return;
    this.act(this.http.post(`${this.url}/${c._id}/submit`, {}), () => this.notice.set('Counting finished.'));
  }

  protected reopen() {
    this.act(this.http.post(`${this.url}/${this.current()!._id}/reopen`, {}), () => this.notice.set('Back to counting.'));
  }

  protected cancel() {
    if (!confirm('Cancel this count? What you counted is thrown away. Your stock is not changed.')) return;
    this.act(this.http.post(`${this.url}/${this.current()!._id}/cancel`, {}), () => this.notice.set('Count cancelled.'));
  }

  protected apply(v: Review) {
    const extra = this.uncountedAsZero() ? ` ${v.uncounted.batches} batch(es) nobody counted will be WRITTEN OFF to zero.` : '';
    if (!confirm(`Apply ${v.totals.changed} correction${v.totals.changed === 1 ? '' : 's'} to your stock?${extra} This cannot be undone (a correcting count would be needed).`)) return;
    this.act(this.http.post<Summary>(`${this.url}/${this.current()!._id}/apply`, { uncountedAsZero: this.uncountedAsZero(), note: this.applyNote().trim() || undefined }), (r) => {
      this.uncountedAsZero.set(false);
      this.applyNote.set('');
      this.notice.set(`Corrections applied: ${r.summary?.changed ?? 0} batch${r.summary?.changed === 1 ? '' : 'es'} changed.`);
    });
  }

  private act<T>(req: import('rxjs').Observable<T>, done: (r: T) => void) {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    req.subscribe({
      next: (r) => {
        this.busy.set(false);
        done(r);
        this.refresh(this.outletId());
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  /** Saves one row when its numbers change (clears the count when both are emptied). */
  protected save(r: SheetRow) {
    const c = this.current();
    if (!c) return;
    const packsText = String(r.packsIn ?? '').trim();
    const looseText = String(r.looseIn ?? '').trim();
    if (!packsText && !looseText) {
      if (!r.counted) return;
      this.http.delete(`${this.url}/${c._id}/lines/${r.batchId}`).subscribe({ next: () => (r.counted = null), error: (e) => this.error.set(apiError(e)) });
      return;
    }
    const packs = Number(packsText || 0);
    const loose = Number(looseText || 0);
    if (!Number.isInteger(packs) || packs < 0 || !Number.isInteger(loose) || loose < 0) return this.error.set(`${r.name}: enter whole numbers, 0 or more.`);
    this.error.set(null);
    this.http.put(`${this.url}/${c._id}/lines`, { batchId: r.batchId, packs, loose }).subscribe({
      next: () => {
        r.counted = { packs, loose };
        r.saved = true;
        this.rows.update((x) => [...x]); // refresh the "counted" total
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  /** A scanned barcode (the scanner presses Enter): jump to that medicine's first row. */
  protected onEnter() {
    const text = this.q().trim();
    const hit = this.filtered().find((r) => r.barcodes.includes(text)) ?? (this.filtered().length === 1 ? this.filtered()[0] : undefined);
    if (hit) setTimeout(() => document.getElementById('cnt-' + hit.batchId)?.focus(), 0);
  }
}
