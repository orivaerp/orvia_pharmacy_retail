import { Component, DestroyRef, OnInit, inject, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged, filter, of, switchMap } from 'rxjs';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FORMS, GST_RATES, CatalogItem, SCHEDULES } from '../../shared/models/medicine';
import { apiError, splitList } from '../../shared/utils/api';
import { RetailApi } from '../retail-api.service';

/**
 * "Add products" for a shop. Tab 1: search the platform catalog, tick medicines, add them in one go.
 * Tab 2: not in the catalog? create a private product right away (optionally suggest it to the provider).
 */
@Component({
  selector: 'app-add-products-dialog',
  imports: [ReactiveFormsModule],
  template: `
    <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="closed.emit()">
      <div class="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-surface-solid p-5 shadow-xl" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-medium">Add products</h2>
          <div class="flex gap-1 rounded-full border border-line p-1 text-xs" role="tablist">
            <button type="button" role="tab" class="rounded-full px-3 py-1" [class]="tab() === 'catalog' ? 'bg-brand text-brand-ink' : ''" (click)="tab.set('catalog')">From catalog</button>
            <button type="button" role="tab" class="rounded-full px-3 py-1" [class]="tab() === 'custom' ? 'bg-brand text-brand-ink' : ''" (click)="tab.set('custom')">Not listed?</button>
          </div>
        </div>

        @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
        @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

        @if (tab() === 'catalog') {
          <input type="search" class="field mt-3" placeholder="Search by name, salt, manufacturer or scan a barcode…" (input)="onSearch($any($event.target).value)" />
          <ul class="mt-2 min-h-40 flex-1 divide-y divide-line overflow-y-auto" [class.opacity-50]="loading()">
            @for (m of results(); track m._id) {
              <li>
                <div class="flex items-center gap-2">
                  <label class="flex flex-1 cursor-pointer items-center gap-3 py-2 text-xs" [class.opacity-50]="m.added">
                    <input type="checkbox" class="accent-(--brand)" [disabled]="m.added" [checked]="selected().has(m._id)" (change)="toggle(m._id, $any($event.target).checked)" />
                    <span class="flex-1">
                      <b>{{ m.name }}</b>@if (m.brand) { <span class="ml-1 badge bg-tone-lavender">{{ m.brand }}</span> }
                      <span class="block text-[11px] text-ink-soft">{{ m.composition.join(', ') }} · {{ m.manufacturer }} · {{ m.schedule }} · GST {{ m.gstPercent }}%</span>
                    </span>
                    @if (m.added) { <span class="badge bg-chip">In your inventory</span> }
                  </label>
                  <button type="button" class="btn btn-ghost shrink-0 !px-2.5 !py-1" (click)="toggleSubs(m)" [attr.aria-expanded]="subsFor() === m._id">Same salt</button>
                </div>
                @if (subsFor() === m._id) {
                  <div class="mb-2 ml-7 rounded-xl bg-white/50 p-2 text-[11px]">
                    @if (subsLoading()) { <p class="text-ink-soft">Looking for medicines with the same salt…</p> }
                    @else if (!subs().length) { <p class="text-ink-soft">No other medicine with the same salt, strength and form in the catalog.</p> }
                    @else {
                      <p class="mb-1 text-ink-soft">Same salt, strength and form:</p>
                      @for (s of subs(); track s._id) {
                        <div class="flex items-center justify-between gap-2 py-0.5">
                          <span><b>{{ s.name }}</b> <span class="text-ink-soft">{{ s.manufacturer }}</span></span>
                          @if (s.added) { <span class="badge bg-chip">In your inventory</span> }
                          @else { <button type="button" class="btn btn-ghost !px-2.5 !py-0.5" [disabled]="saving()" (click)="addOne(s)">Add</button> }
                        </div>
                      }
                    }
                  </div>
                }
              </li>
            } @empty {
              <li class="py-8 text-center text-xs text-ink-soft">{{ loading() ? 'Searching…' : 'No medicine found. Try another spelling, or use “Not listed?”.' }}</li>
            }
          </ul>
          <div class="mt-3 flex items-center justify-between">
            <span class="text-xs text-ink-soft">{{ selected().size }} selected</span>
            <div class="flex gap-2">
              <button type="button" class="btn btn-ghost" (click)="closed.emit()">Close</button>
              <button type="button" class="btn btn-primary" [disabled]="!selected().size || saving()" (click)="addSelected()">
                {{ saving() ? 'Adding…' : 'Add ' + selected().size + ' to inventory' }}
              </button>
            </div>
          </div>
        } @else {
          <p class="mt-2 text-xs text-ink-soft">This creates a private product for your shop now, so billing is never blocked. Tick the box to also suggest it to the catalog.</p>
          @if (twins().length) {
            <div class="mt-3 rounded-xl bg-tone-lavender p-2 text-xs">
              <p class="font-medium">Already in the Orvia catalog? Add it from here instead of creating a copy:</p>
              @for (m of twins(); track m._id) {
                <div class="flex items-center justify-between gap-2 py-0.5">
                  <span>{{ m.name }} <span class="text-[11px] opacity-70">{{ m.manufacturer }}</span></span>
                  @if (m.added) { <span class="badge bg-chip">In your inventory</span> }
                  @else { <button type="button" class="btn btn-ghost !px-2.5 !py-0.5" [disabled]="saving()" (click)="addOne(m)">Add this</button> }
                </div>
              }
            </div>
          }
          <form [formGroup]="form" (ngSubmit)="createCustom()" class="mt-3 grid gap-3 overflow-y-auto sm:grid-cols-6" novalidate>
            <div class="sm:col-span-6"><label class="label" for="c-name">Name * <span class="font-normal">(with strength and form)</span></label><input id="c-name" class="field" formControlName="name" placeholder="Paracetamol 500mg Tablet" /></div>
            <div class="sm:col-span-3"><label class="label" for="c-brand">Brand <span class="font-normal">(if branded)</span></label><input id="c-brand" class="field" formControlName="brand" placeholder="Dolo" /></div>
            <div class="sm:col-span-3"><label class="label" for="c-bar">Barcode <span class="font-normal">(scan it)</span></label><input id="c-bar" class="field" formControlName="barcode" inputmode="numeric" /></div>
            <div class="sm:col-span-4"><label class="label" for="c-comp">Composition (salts) * <span class="font-normal">separate with ;</span></label><input id="c-comp" class="field" formControlName="composition" /></div>
            <div class="sm:col-span-2"><label class="label" for="c-str">Strength</label><input id="c-str" class="field" formControlName="strength" /></div>
            <div class="sm:col-span-2"><label class="label" for="c-form">Form *</label><select id="c-form" class="field" formControlName="form">@for (f of forms; track f) { <option [value]="f">{{ f }}</option> }</select></div>
            <div class="sm:col-span-2"><label class="label" for="c-units">Units per pack</label><input id="c-units" type="number" min="1" class="field" formControlName="unitsPerPack" /></div>
            <div class="sm:col-span-2"><label class="label" for="c-mfr">Manufacturer</label><input id="c-mfr" class="field" formControlName="manufacturer" /></div>
            <div class="sm:col-span-2"><label class="label" for="c-mrp">MRP per pack <span class="font-normal">(reference)</span></label><input id="c-mrp" type="number" min="0" step="0.01" class="field" formControlName="referenceMrp" /></div>
            <div class="sm:col-span-2"><label class="label" for="c-gst">GST %</label><select id="c-gst" class="field" formControlName="gstPercent">@for (g of gst; track g) { <option [ngValue]="g">{{ g }}%</option> }</select></div>
            <div class="sm:col-span-2"><label class="label" for="c-sch">Schedule</label><select id="c-sch" class="field" formControlName="schedule">@for (s of schedules; track s) { <option [value]="s">{{ s }}</option> }</select></div>
            <label class="flex items-center gap-2 text-xs sm:col-span-6"><input type="checkbox" class="accent-(--brand)" formControlName="suggest" /> Suggest this medicine to the Orvia catalog</label>
            <div class="flex justify-end gap-2 sm:col-span-6">
              <button type="button" class="btn btn-ghost" (click)="closed.emit()">Close</button>
              <button type="submit" class="btn btn-primary" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Create product' }}</button>
            </div>
          </form>
        }
      </div>
    </div>
  `,
})
export class AddProductsDialog implements OnInit {
  private readonly api = inject(RetailApi);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  closed = output();
  changed = output();

  protected readonly forms = FORMS;
  protected readonly schedules = SCHEDULES;
  protected readonly gst = GST_RATES;

  protected readonly tab = signal<'catalog' | 'custom'>('catalog');

  // substitutes ("same salt") for one catalog row at a time
  protected readonly subsFor = signal<string | null>(null);
  protected readonly subs = signal<CatalogItem[]>([]);
  protected readonly subsLoading = signal(false);

  // while typing a custom name: catalog medicines that look the same
  protected readonly twins = signal<CatalogItem[]>([]);
  protected readonly results = signal<CatalogItem[]>([]);
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  private q = '';
  private timer?: ReturnType<typeof setTimeout>;

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    brand: [''],
    barcode: [''],
    referenceMrp: [null as number | null],
    composition: ['', Validators.required],
    strength: [''],
    form: ['tablet'],
    unitsPerPack: [1, [Validators.required, Validators.min(1)]],
    manufacturer: [''],
    gstPercent: [5],
    schedule: ['OTC'],
    suggest: [true],
  });

  ngOnInit() {
    this.search();
    // suggest catalog matches while the shop types a custom name
    this.form.controls.name.valueChanges
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        switchMap((n) => (n.trim().length >= 3 ? this.api.catalog({ q: n.trim(), limit: 4 }) : of(null))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({ next: (r) => this.twins.set(r?.items ?? []) });
  }

  protected onSearch(v: string) {
    this.q = v;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.search(), 300);
  }

  private search() {
    this.loading.set(true);
    this.api.catalog({ q: this.q.trim(), limit: 30 }).subscribe({
      next: (r) => {
        this.results.set(r.items);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }

  protected toggle(id: string, on: boolean) {
    const next = new Set(this.selected());
    if (on) next.add(id);
    else next.delete(id);
    this.selected.set(next);
  }

  protected toggleSubs(m: CatalogItem) {
    if (this.subsFor() === m._id) return this.subsFor.set(null);
    this.subsFor.set(m._id);
    this.subs.set([]);
    this.subsLoading.set(true);
    this.api.substitutes(m._id).subscribe({
      next: (s) => {
        this.subs.set(s);
        this.subsLoading.set(false);
      },
      error: () => this.subsLoading.set(false),
    });
  }

  /** Add one catalog medicine straight to the inventory (from a substitute or a "did you mean" row). */
  protected addOne(m: CatalogItem) {
    this.saving.set(true);
    this.error.set(null);
    this.api.addFromCatalog([m._id]).subscribe({
      next: () => {
        this.saving.set(false);
        this.notice.set(`Added "${m.name}" to your inventory.`);
        this.subs.update((l) => l.map((x) => (x._id === m._id ? { ...x, added: true } : x)));
        this.twins.update((l) => l.map((x) => (x._id === m._id ? { ...x, added: true } : x)));
        this.changed.emit();
        this.search();
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected addSelected() {
    this.saving.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.api.addFromCatalog([...this.selected()]).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.notice.set(`Added ${r.added} product${r.added === 1 ? '' : 's'} to your inventory.`);
        this.selected.set(new Set());
        this.changed.emit();
        this.search();
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected createCustom() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Please fill the name and composition.');
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.api
      .createCustom({
        ...v,
        composition: splitList(v.composition),
        unitsPerPack: Number(v.unitsPerPack),
        gstPercent: Number(v.gstPercent),
        manufacturer: v.manufacturer || 'Unknown',
        brand: v.brand.trim() || undefined,
        barcode: v.barcode.trim() || undefined,
        referenceMrp: v.referenceMrp ?? undefined,
      })
      .subscribe({
        next: (p) => {
          this.saving.set(false);
          this.notice.set(`“${p.name}” added to your inventory${p.suggested ? ' and suggested to the catalog' : ''}.`);
          this.form.reset({ form: 'tablet', unitsPerPack: 1, gstPercent: 5, schedule: 'OTC', suggest: true });
          this.twins.set([]);
          this.changed.emit();
        },
        error: (e) => {
          this.saving.set(false);
          this.error.set(apiError(e));
        },
      });
  }
}
