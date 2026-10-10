import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';
import { STOCK_FIELDS, downloadText, guessMapping, readSheetFile, templateCsv } from './sheet';

interface PreviewRow {
  row: number;
  name: string;
  action: 'existing' | 'catalog' | 'custom' | null;
  product: string;
  newProduct: boolean;
  errors: string[];
  warnings: string[];
}
interface Preview {
  summary: { rows: number; ok: number; errors: number; newProducts: number; stockRows: number; packs: number; batchesAlreadyInStock: number; limitError: string | null };
  rows: PreviewRow[];
}
interface Result {
  productsAdded: number;
  stockRows: number;
  packs: number;
  skipped: { row: number; name: string; reason: string }[];
  failed: { rows: string; reason: string }[];
  outlet: string;
}

const ACTION_LABEL = { existing: 'Your product', catalog: 'From catalog', custom: 'New (yours)' } as const;

/** Bring a shop's existing medicines and stock in from Excel / CSV. */
@Component({
  selector: 'app-import-stock',
  imports: [FormsModule, RouterLink],
  template: `
    <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Import products and stock</h1>
    <p class="mt-0.5 text-xs text-ink-soft">Move your current stock from an Excel or CSV file (from Marg, Busy, Tally or your own sheet) instead of typing it. Nothing is saved until you press Import.</p>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

    @if (result(); as r) {
      <section class="card mt-3">
        <h2 class="text-sm font-medium">Done: imported into {{ r.outlet }}</h2>
        <ul class="mt-2 list-disc pl-5 text-xs">
          <li>{{ r.productsAdded }} new product{{ r.productsAdded === 1 ? '' : 's' }} added</li>
          <li>{{ r.stockRows }} stock row{{ r.stockRows === 1 ? '' : 's' }} ({{ r.packs }} packs) received as opening stock</li>
          @if (r.skipped.length) { <li>{{ r.skipped.length }} row{{ r.skipped.length === 1 ? '' : 's' }} skipped because of errors</li> }
        </ul>
        @if (r.failed.length) {
          <div role="alert" class="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
            Some stock could not be saved:
            @for (f of r.failed; track f.rows) { <p>Rows {{ f.rows }}: {{ f.reason }}</p> }
          </div>
        }
        @if (r.skipped.length) {
          <details class="mt-2 text-xs"><summary class="cursor-pointer">Skipped rows</summary>
            <ul class="mt-1 space-y-0.5">@for (s of r.skipped; track s.row) { <li>Row {{ s.row }} {{ s.name }}: {{ s.reason }}</li> }</ul>
          </details>
        }
        <div class="mt-3 flex gap-2">
          <a routerLink="/retail/inventory" class="btn btn-primary">See inventory</a>
          <button type="button" class="btn btn-ghost" (click)="reset()">Import another file</button>
        </div>
      </section>
    } @else {
      <section class="card mt-3">
        <h2 class="text-sm font-medium">1. Pick the outlet and the file</h2>
        <p class="mt-1 text-xs text-ink-soft">
          Stock goes into: <b>{{ outletName() || 'no outlet chosen' }}</b>@if (!outletId()) { . Choose an outlet in the top bar first. }
        </p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <input type="file" accept=".xlsx,.csv,.txt" class="text-xs" aria-label="Spreadsheet file" (change)="onFile($event)" />
          <button type="button" class="btn btn-ghost !py-0.5" (click)="template()">Download blank template</button>
        </div>
        <p class="mt-2 text-[11px] text-ink-soft">
          The first row must be the column names. Needed for a medicine: <b>name</b>. To add stock too: <b>batch, expiry (08/2027), MRP and quantity in packs</b>. A medicine that is not in the Orvia catalog is created as your own product if it has <b>form and GST %</b>.
        </p>
      </section>

      @if (headers().length) {
        <section class="card mt-3">
          <h2 class="text-sm font-medium">2. Check the columns</h2>
          <p class="mt-1 text-xs text-ink-soft">{{ dataRows().length }} row{{ dataRows().length === 1 ? '' : 's' }} found in “{{ fileName() }}”. Orvia guessed what each column is; change any that are wrong.</p>
          <div class="mt-2 grid gap-2 sm:grid-cols-2">
            @for (h of headers(); track $index; let i = $index) {
              <div class="flex items-center gap-2 text-xs">
                <span class="w-2/5 truncate" [title]="h">{{ h || '(no name)' }}</span>
                <select class="field !py-1" [ngModel]="mapping()[i]" (ngModelChange)="setMap(i, $event)" [attr.aria-label]="'What is column ' + h">
                  <option value="">Ignore this column</option>
                  @for (f of fields; track f.key) { <option [value]="f.key">{{ f.label }}</option> }
                </select>
              </div>
            }
          </div>
          @if (!mapped('name')) { <p class="mt-2 text-xs text-red-700">No column is set as “Medicine name”. Pick it above.</p> }
          @else if (!mapped('packs')) { <p class="mt-2 text-xs text-ink-soft">No quantity column: the medicines will be added <b>without stock</b>.</p> }
          <button type="button" class="btn btn-primary mt-3" [disabled]="busy() || !mapped('name') || !outletId()" (click)="check()">{{ busy() && !preview() ? 'Checking…' : 'Check the file' }}</button>
        </section>
      }

      @if (preview(); as p) {
        <section class="card mt-3">
          <h2 class="text-sm font-medium">3. Review</h2>
          <dl class="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div class="rounded-xl bg-white/50 p-2"><dt class="text-ink-soft">Rows ready</dt><dd class="text-base font-medium">{{ p.summary.ok }} / {{ p.summary.rows }}</dd></div>
            <div class="rounded-xl p-2" [class]="p.summary.errors ? 'bg-red-50' : 'bg-white/50'"><dt class="text-ink-soft">With errors (skipped)</dt><dd class="text-base font-medium">{{ p.summary.errors }}</dd></div>
            <div class="rounded-xl bg-white/50 p-2"><dt class="text-ink-soft">New products</dt><dd class="text-base font-medium">{{ p.summary.newProducts }}</dd></div>
            <div class="rounded-xl bg-white/50 p-2"><dt class="text-ink-soft">Packs of stock</dt><dd class="text-base font-medium">{{ p.summary.packs }}</dd></div>
          </dl>
          @if (p.summary.limitError) { <p role="alert" class="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ p.summary.limitError }}</p> }
          @if (p.summary.batchesAlreadyInStock) {
            <label class="mt-2 flex items-start gap-2 rounded-xl bg-tone-lavender px-3 py-2 text-xs">
              <input type="checkbox" class="mt-0.5" [ngModel]="confirmAdd()" (ngModelChange)="confirmAdd.set($event)" />
              <span>{{ p.summary.batchesAlreadyInStock }} row{{ p.summary.batchesAlreadyInStock === 1 ? ' is a batch' : 's are batches' }} already in your stock. Importing <b>adds</b> these packs on top. Tick this only if that is what you want. (Importing the same file twice doubles the stock.)</span>
            </label>
          }

          <div class="mt-3 flex gap-1 text-xs">
            @for (t of tabs; track t.id) {
              <button type="button" class="rounded-full border border-line px-3 py-1" [class]="show() === t.id ? 'bg-brand text-brand-ink' : ''" (click)="show.set(t.id)">{{ t.label }} ({{ count(t.id) }})</button>
            }
          </div>
          <div class="mt-2 max-h-96 overflow-auto">
            <table class="w-full min-w-136 text-left text-xs">
              <thead class="sticky top-0 bg-surface-solid"><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-2 font-normal">Row</th><th class="py-1.5 pr-2 font-normal">Medicine</th><th class="py-1.5 pr-2 font-normal">Becomes</th><th class="py-1.5 font-normal">Notes</th></tr></thead>
              <tbody>
                @for (r of visible(); track r.row) {
                  <tr class="border-t border-line align-top">
                    <td class="py-1 pr-2">{{ r.row }}</td>
                    <td class="py-1 pr-2">{{ r.name }}</td>
                    <td class="py-1 pr-2">@if (r.action) { {{ label(r.action) }}@if (r.product && r.product !== r.name) { <span class="text-ink-soft"> · {{ r.product }}</span> } }</td>
                    <td class="py-1">
                      @for (e of r.errors; track e) { <p class="text-red-700">{{ e }}</p> }
                      @for (w of r.warnings; track w) { <p class="text-ink-soft">{{ w }}</p> }
                    </td>
                  </tr>
                } @empty { <tr><td colspan="4" class="py-4 text-center text-ink-soft">Nothing here.</td></tr> }
              </tbody>
            </table>
          </div>
          @if (hidden() > 0) { <p class="mt-1 text-[11px] text-ink-soft">Showing the first 300 of {{ hidden() + 300 }}. All rows are still checked and imported.</p> }

          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" class="btn btn-primary" [disabled]="busy() || !p.summary.ok || !!p.summary.limitError || (p.summary.batchesAlreadyInStock > 0 && !confirmAdd())" (click)="run()">{{ busy() ? 'Importing…' : 'Import ' + p.summary.ok + ' row' + (p.summary.ok === 1 ? '' : 's') }}</button>
            @if (p.summary.errors) { <span class="text-[11px] text-ink-soft">The {{ p.summary.errors }} row{{ p.summary.errors === 1 ? '' : 's' }} with errors will be skipped. Fix them in your file and import again, or add them by hand.</span> }
          </div>
        </section>
      }
    }
  `,
})
export class ImportStock {
  private readonly http = inject(HttpClient);
  private readonly ctx = inject(OutletContext);
  private readonly url = `${environment.apiUrl}/import`;

  protected readonly fields = STOCK_FIELDS;
  protected readonly tabs = [
    { id: 'all', label: 'All' },
    { id: 'errors', label: 'Errors' },
    { id: 'warnings', label: 'Warnings' },
  ] as const;

  protected readonly headers = signal<string[]>([]);
  protected readonly dataRows = signal<(string | number)[][]>([]);
  protected readonly mapping = signal<string[]>([]);
  protected readonly fileName = signal('');
  protected readonly preview = signal<Preview | null>(null);
  protected readonly result = signal<Result | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmAdd = signal(false);
  protected readonly show = signal<'all' | 'errors' | 'warnings'>('all');

  protected readonly outletId = computed(() => {
    const picked = this.ctx.selected();
    if (picked) return picked;
    const all = this.ctx.choices();
    return all.length === 1 ? all[0]._id : '';
  });
  protected readonly outletName = computed(() => this.ctx.choices().find((o) => o._id === this.outletId())?.name ?? '');

  protected readonly visible = computed(() => {
    const p = this.preview();
    if (!p) return [];
    const f = this.show();
    return p.rows.filter((r) => (f === 'errors' ? r.errors.length : f === 'warnings' ? r.warnings.length && !r.errors.length : true)).slice(0, 300);
  });
  protected readonly hidden = computed(() => {
    const p = this.preview();
    if (!p) return 0;
    const f = this.show();
    const n = p.rows.filter((r) => (f === 'errors' ? r.errors.length : f === 'warnings' ? r.warnings.length && !r.errors.length : true)).length;
    return Math.max(0, n - 300);
  });

  constructor() {
    this.ctx.load();
  }

  protected label(a: keyof typeof ACTION_LABEL) {
    return ACTION_LABEL[a];
  }

  protected count(t: string) {
    const p = this.preview();
    if (!p) return 0;
    return t === 'errors' ? p.rows.filter((r) => r.errors.length).length : t === 'warnings' ? p.rows.filter((r) => r.warnings.length && !r.errors.length).length : p.rows.length;
  }

  protected mapped(key: string) {
    return this.mapping().includes(key);
  }

  protected template() {
    downloadText('orvia-stock-template.csv', templateCsv(STOCK_FIELDS));
  }

  protected async onFile(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.error.set(null);
    this.preview.set(null);
    this.confirmAdd.set(false);
    try {
      const rows = await readSheetFile(file);
      if (rows.length < 2) throw new Error('The file has no data rows under the column names.');
      const headers = rows[0].map((h) => String(h).trim());
      this.headers.set(headers);
      this.mapping.set(guessMapping(headers, STOCK_FIELDS));
      this.dataRows.set(rows.slice(1));
      this.fileName.set(file.name);
    } catch (e) {
      this.headers.set([]);
      this.dataRows.set([]);
      this.error.set(e instanceof Error ? e.message : 'Could not read the file.');
    }
  }

  protected setMap(i: number, key: string) {
    // one field can come from only one column
    this.mapping.update((m) => m.map((k, n) => (n === i ? key : key && k === key ? '' : k)));
    this.preview.set(null);
  }

  private payload() {
    const map = this.mapping();
    const rows = this.dataRows().map((r) => {
      const o: Record<string, string | number> = {};
      map.forEach((key, i) => {
        if (key && r[i] !== undefined && String(r[i]).trim() !== '') o[key] = r[i];
      });
      return o;
    });
    return { branchId: this.outletId(), rows, confirmAdd: this.confirmAdd() };
  }

  protected check() {
    this.busy.set(true);
    this.error.set(null);
    this.http.post<Preview>(`${this.url}/stock/preview`, this.payload()).subscribe({
      next: (p) => {
        this.busy.set(false);
        this.preview.set(p);
        this.show.set(p.summary.errors ? 'errors' : 'all');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected run() {
    this.busy.set(true);
    this.error.set(null);
    this.http.post<Result>(`${this.url}/stock`, this.payload()).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.result.set(r);
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected reset() {
    this.result.set(null);
    this.preview.set(null);
    this.headers.set([]);
    this.dataRows.set([]);
    this.confirmAdd.set(false);
  }
}
