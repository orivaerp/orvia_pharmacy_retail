import { HttpClient } from '@angular/common/http';
import { CurrencyPipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { apiError } from '../../shared/utils/api';
import { CUSTOMER_FIELDS, Field, SUPPLIER_FIELDS, downloadText, guessMapping, readSheetFile, templateCsv } from './sheet';

interface PreviewRow {
  row: number;
  name: string;
  action: 'new' | 'exists' | null;
  errors: string[];
  warnings: string[];
}
interface Preview {
  summary: { rows: number; new: number; existing: number; errors: number; openingTotal: number };
  rows: PreviewRow[];
}
interface Result {
  created: number;
  skippedExisting: number;
  skipped: { row: number; name: string; reason: string }[];
  openingTotal: number;
}

const KIND = {
  customers: {
    fields: CUSTOMER_FIELDS,
    noun: 'customers',
    one: 'customer',
    money: 'Total udhaar brought in',
    link: '/retail/customers',
    linkLabel: 'See customers',
    help: 'Needed: <b>name</b>. Useful: <b>phone</b> (10 digits, it is how repeat customers are found), email, and <b>what they owe</b> (their udhaar so far) and the udhaar limit. A customer who is already in (same phone number) is skipped, never changed.',
  },
  suppliers: {
    fields: SUPPLIER_FIELDS,
    noun: 'suppliers',
    one: 'supplier',
    money: 'Total owed to suppliers',
    link: '/retail/suppliers',
    linkLabel: 'See suppliers',
    help: 'Needed: <b>name</b>. Useful: GSTIN, drug licence, phone, credit days, and <b>what you owe them</b> now. A supplier who is already in (same name or GSTIN) is skipped, never changed.',
  },
} as const;

/** Bring a shop's customers (with udhaar) or suppliers (with what is owed) in from Excel / CSV. */
@Component({
  selector: 'app-import-people',
  imports: [FormsModule, RouterLink, CurrencyPipe],
  template: `
    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

    @if (result(); as r) {
      <section class="card mt-3">
        <h2 class="text-sm font-medium">Done</h2>
        <ul class="mt-2 list-disc pl-5 text-xs">
          <li>{{ r.created }} {{ r.created === 1 ? k().one : k().noun }} added</li>
          @if (r.openingTotal) { <li>{{ k().money }}: {{ r.openingTotal | currency: 'INR' : 'symbol' : '1.0-0' }}</li> }
          @if (r.skippedExisting) { <li>{{ r.skippedExisting }} already existed (skipped)</li> }
          @if (r.skipped.length) { <li>{{ r.skipped.length }} row{{ r.skipped.length === 1 ? '' : 's' }} skipped because of errors</li> }
        </ul>
        @if (r.skipped.length) {
          <details class="mt-2 text-xs"><summary class="cursor-pointer">Skipped rows</summary>
            <ul class="mt-1 space-y-0.5">@for (s of r.skipped; track s.row) { <li>Row {{ s.row }} {{ s.name }}: {{ s.reason }}</li> }</ul>
          </details>
        }
        <div class="mt-3 flex gap-2">
          <a [routerLink]="k().link" class="btn btn-primary">{{ k().linkLabel }}</a>
          <button type="button" class="btn btn-ghost" (click)="reset()">Import another file</button>
        </div>
      </section>
    } @else {
      <section class="card mt-3">
        <h2 class="text-sm font-medium">1. Pick the file</h2>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <input type="file" accept=".xlsx,.csv,.txt" class="text-xs" [attr.aria-label]="'Spreadsheet of ' + k().noun" (change)="onFile($event)" />
          <button type="button" class="btn btn-ghost !py-0.5" (click)="template()">Download blank template</button>
        </div>
        <p class="mt-2 text-[11px] text-ink-soft" [innerHTML]="k().help"></p>
      </section>

      @if (headers().length) {
        <section class="card mt-3">
          <h2 class="text-sm font-medium">2. Check the columns</h2>
          <p class="mt-1 text-xs text-ink-soft">{{ dataRows().length }} row{{ dataRows().length === 1 ? '' : 's' }} found in “{{ fileName() }}”. Change any column that was guessed wrong.</p>
          <div class="mt-2 grid gap-2 sm:grid-cols-2">
            @for (h of headers(); track $index; let i = $index) {
              <div class="flex items-center gap-2 text-xs">
                <span class="w-2/5 truncate" [title]="h">{{ h || '(no name)' }}</span>
                <select class="field !py-1" [ngModel]="mapping()[i]" (ngModelChange)="setMap(i, $event)" [attr.aria-label]="'What is column ' + h">
                  <option value="">Ignore this column</option>
                  @for (f of fields(); track f.key) { <option [value]="f.key">{{ f.label }}</option> }
                </select>
              </div>
            }
          </div>
          @if (!mapping().includes('name')) { <p class="mt-2 text-xs text-red-700">No column is set as the name. Pick it above.</p> }
          <button type="button" class="btn btn-primary mt-3" [disabled]="busy() || !mapping().includes('name')" (click)="check()">{{ busy() && !preview() ? 'Checking…' : 'Check the file' }}</button>
        </section>
      }

      @if (preview(); as p) {
        <section class="card mt-3">
          <h2 class="text-sm font-medium">3. Review</h2>
          <dl class="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div class="rounded-xl bg-white/50 p-2"><dt class="text-ink-soft">New {{ k().noun }}</dt><dd class="text-base font-medium">{{ p.summary.new }} / {{ p.summary.rows }}</dd></div>
            <div class="rounded-xl bg-white/50 p-2"><dt class="text-ink-soft">Already exist (skipped)</dt><dd class="text-base font-medium">{{ p.summary.existing }}</dd></div>
            <div class="rounded-xl p-2" [class]="p.summary.errors ? 'bg-red-50' : 'bg-white/50'"><dt class="text-ink-soft">With errors (skipped)</dt><dd class="text-base font-medium">{{ p.summary.errors }}</dd></div>
            <div class="rounded-xl bg-white/50 p-2"><dt class="text-ink-soft">{{ k().money }}</dt><dd class="text-base font-medium">{{ p.summary.openingTotal | currency: 'INR' : 'symbol' : '1.0-0' }}</dd></div>
          </dl>
          <div class="mt-3 flex gap-1 text-xs">
            @for (t of tabs; track t.id) {
              <button type="button" class="rounded-full border border-line px-3 py-1" [class]="show() === t.id ? 'bg-brand text-brand-ink' : ''" (click)="show.set(t.id)">{{ t.label }} ({{ count(t.id) }})</button>
            }
          </div>
          <div class="mt-2 max-h-96 overflow-auto">
            <table class="w-full min-w-120 text-left text-xs">
              <thead class="sticky top-0 bg-surface-solid"><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-2 font-normal">Row</th><th class="py-1.5 pr-2 font-normal">Name</th><th class="py-1.5 font-normal">Notes</th></tr></thead>
              <tbody>
                @for (r of visible(); track r.row) {
                  <tr class="border-t border-line align-top">
                    <td class="py-1 pr-2">{{ r.row }}</td>
                    <td class="py-1 pr-2">{{ r.name }}</td>
                    <td class="py-1">
                      @for (e of r.errors; track e) { <p class="text-red-700">{{ e }}</p> }
                      @for (w of r.warnings; track w) { <p class="text-ink-soft">{{ w }}</p> }
                      @if (r.action === 'new' && !r.errors.length && !r.warnings.length) { <p class="text-ink-soft">Will be added</p> }
                    </td>
                  </tr>
                } @empty { <tr><td colspan="3" class="py-4 text-center text-ink-soft">Nothing here.</td></tr> }
              </tbody>
            </table>
          </div>
          @if (hidden() > 0) { <p class="mt-1 text-[11px] text-ink-soft">Showing the first 300 of {{ hidden() + 300 }}. All rows are still checked and imported.</p> }
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" class="btn btn-primary" [disabled]="busy() || !p.summary.new" (click)="run()">{{ busy() ? 'Importing…' : 'Import ' + p.summary.new + ' new ' + (p.summary.new === 1 ? k().one : k().noun) }}</button>
            <span class="text-[11px] text-ink-soft">Existing and error rows are skipped. Nothing already in your shop is changed.</span>
          </div>
        </section>
      }
    }
  `,
})
export class ImportPeople {
  private readonly http = inject(HttpClient);
  /** which list to import */
  readonly kind = input.required<'customers' | 'suppliers'>();

  protected readonly k = computed(() => KIND[this.kind()]);
  protected readonly fields = computed<Field[]>(() => this.k().fields);
  protected readonly tabs = [
    { id: 'all', label: 'All' },
    { id: 'errors', label: 'Errors' },
    { id: 'skipped', label: 'Skipped' },
  ] as const;

  protected readonly headers = signal<string[]>([]);
  protected readonly dataRows = signal<(string | number)[][]>([]);
  protected readonly mapping = signal<string[]>([]);
  protected readonly fileName = signal('');
  protected readonly preview = signal<Preview | null>(null);
  protected readonly result = signal<Result | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly show = signal<'all' | 'errors' | 'skipped'>('all');

  private matching(): PreviewRow[] {
    const p = this.preview();
    const f = this.show();
    if (!p) return [];
    return p.rows.filter((r) => (f === 'errors' ? r.errors.length : f === 'skipped' ? r.action === 'exists' : true));
  }
  protected readonly visible = computed(() => (this.preview(), this.show(), this.matching().slice(0, 300)));
  protected readonly hidden = computed(() => (this.preview(), this.show(), Math.max(0, this.matching().length - 300)));

  protected count(t: string) {
    const p = this.preview();
    if (!p) return 0;
    return t === 'errors' ? p.rows.filter((r) => r.errors.length).length : t === 'skipped' ? p.rows.filter((r) => r.action === 'exists').length : p.rows.length;
  }

  protected template() {
    downloadText(`orvia-${this.kind()}-template.csv`, templateCsv(this.fields(), null));
  }

  protected async onFile(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.error.set(null);
    this.preview.set(null);
    try {
      const rows = await readSheetFile(file);
      if (rows.length < 2) throw new Error('The file has no data rows under the column names.');
      const headers = rows[0].map((h) => String(h).trim());
      this.headers.set(headers);
      this.mapping.set(guessMapping(headers, this.fields()));
      this.dataRows.set(rows.slice(1));
      this.fileName.set(file.name);
    } catch (e) {
      this.headers.set([]);
      this.dataRows.set([]);
      this.error.set(e instanceof Error ? e.message : 'Could not read the file.');
    }
  }

  protected setMap(i: number, key: string) {
    this.mapping.update((m) => m.map((x, n) => (n === i ? key : key && x === key ? '' : x)));
    this.preview.set(null);
  }

  private payload() {
    const map = this.mapping();
    return {
      rows: this.dataRows().map((r) => {
        const o: Record<string, string | number> = {};
        map.forEach((key, i) => {
          if (key && r[i] !== undefined && String(r[i]).trim() !== '') o[key] = r[i];
        });
        return o;
      }),
    };
  }

  protected check() {
    this.busy.set(true);
    this.error.set(null);
    this.http.post<Preview>(`${environment.apiUrl}/import/${this.kind()}/preview`, this.payload()).subscribe({
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
    this.http.post<Result>(`${environment.apiUrl}/import/${this.kind()}`, this.payload()).subscribe({
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
  }
}
