import { Component, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { CatalogItem, Product } from '../../shared/models/medicine';
import { apiError } from '../../shared/utils/api';
import { RetailApi } from '../retail-api.service';

/**
 * Type a name, salt or barcode (a scanner "types" it and presses Enter) and pick a product.
 * Shows the shop's own products first, then the Orvia catalog; a catalog pick is added to the shop's
 * inventory on the spot. A barcode that led to a product is saved on it, so the next scan finds it directly.
 */
@Component({
  selector: 'app-product-picker',
  imports: [RouterLink],
  template: `
    <div class="relative">
      <input class="field" [value]="query()" [placeholder]="placeholder()" aria-label="Product" autocomplete="off"
        (input)="onQuery($any($event.target).value)" (keydown.enter)="onEnter($event)" (focus)="onFocus()" (blur)="closeSoon()" />
      @if (open()) {
        <div class="absolute z-20 mt-1 max-h-72 w-full min-w-72 overflow-y-auto rounded-xl border border-line bg-surface-solid text-xs shadow-lg">
          @if (adding()) {
            <p class="px-3 py-3 text-ink-soft">Adding to your inventory…</p>
          } @else {
            @if (mine().length) {
              <p class="px-3 pt-2 pb-1 text-[10px] font-medium tracking-wider text-ink-soft uppercase">In your inventory</p>
              @for (p of mine(); track p._id) {
                <button type="button" class="block w-full px-3 py-1.5 text-left hover:bg-chip" (mousedown)="pick(p)">
                  <b>{{ p.name }}</b>@if (p.brand) { <span class="badge ml-1 bg-tone-lavender">{{ p.brand }}</span> }<span class="block text-[11px] text-ink-soft">{{ p.manufacturer }} · {{ p.schedule }} · GST {{ p.gstPercent }}%</span>
                </button>
              }
            }
            @if (catalog().length) {
              <p class="px-3 pt-2 pb-1 text-[10px] font-medium tracking-wider text-ink-soft uppercase">From Orvia catalog <span class="font-normal normal-case">(added to your inventory when you pick it)</span></p>
              @for (m of catalog(); track m._id) {
                <button type="button" class="block w-full px-3 py-1.5 text-left hover:bg-chip" (mousedown)="pickFromCatalog(m)">
                  <b>{{ m.name }}</b>@if (m.brand) { <span class="badge ml-1 bg-tone-lavender">{{ m.brand }}</span> }<span class="block text-[11px] text-ink-soft">{{ m.manufacturer }} · {{ m.schedule }} · GST {{ m.gstPercent }}%</span>
                </button>
              }
            }
            @if (!mine().length && !catalog().length) {
              <p class="px-3 py-3 text-ink-soft">
                {{ searched() ? 'Nothing found in your inventory or the catalog.' : 'Searching…' }}
                @if (searched()) { Try another spelling, or <a routerLink="/retail/products" class="underline">create your own product</a>. }
              </p>
            }
          }
        </div>
      }
      @if (message()) { <p class="mt-1 text-[11px] text-ink-soft">{{ message() }}</p> }
    </div>
  `,
  host: { class: 'block' },
})
export class ProductPicker {
  private readonly api = inject(RetailApi);
  private readonly auth = inject(AuthService);

  /** the chosen product (parent owns it; typing again clears it so a stale pick can never be submitted) */
  value = input<Product | null>(null);
  placeholder = input('Search medicine name, salt or barcode…');
  valueChange = output<Product | null>();
  failed = output<string>();

  protected readonly query = signal('');
  protected readonly mine = signal<Product[]>([]);
  protected readonly catalog = signal<CatalogItem[]>([]);
  protected readonly adding = signal(false);
  protected readonly open = signal(false);
  protected readonly searched = signal(false);
  protected readonly message = signal<string | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  private get canAddFromCatalog() {
    return this.auth.hasPermission('product.manage');
  }

  protected onQuery(v: string) {
    this.query.set(v);
    this.message.set(null);
    if (this.value()) this.valueChange.emit(null);
    this.open.set(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.search(), 250);
  }

  protected onFocus() {
    this.open.set(true);
    if (!this.searched()) this.search();
  }

  private search() {
    const q = this.query().trim();
    forkJoin({
      mine: this.api.products({ q, limit: 8 }),
      catalog: this.canAddFromCatalog && q.length >= 2 ? this.api.catalog({ q, limit: 8 }) : of(null),
    }).subscribe({
      next: (r) => {
        this.mine.set(r.mine.items.filter((p) => p.isActive));
        this.catalog.set((r.catalog?.items ?? []).filter((m) => !m.added)); // already-added ones show under "in your inventory"
        this.searched.set(true);
      },
      error: (e) => this.failed.emit(apiError(e)),
    });
  }

  protected pick(p: Product) {
    const typed = this.query().trim();
    this.query.set(p.name);
    this.open.set(false);
    this.valueChange.emit(p);
    // scan once, remembered
    if (/^\d{8,14}$/.test(typed) && !p.barcodes?.includes(typed)) {
      this.api.saveBarcode(p._id, typed).subscribe({
        next: () => this.message.set(`Barcode ${typed} saved. Next time, scan it to find this product.`),
        error: () => {}, // e.g. the barcode belongs to another product: not worth interrupting the entry
      });
    }
  }

  protected pickFromCatalog(item: CatalogItem) {
    this.adding.set(true);
    this.api.addFromCatalog([item._id]).subscribe({
      next: () =>
        this.api.products({ q: item.name, limit: 10 }).subscribe({
          next: (r) => {
            this.adding.set(false);
            const p = r.items.find((x) => x.masterId === item._id);
            if (p) this.pick(p);
            else this.failed.emit('The medicine was added, but could not be selected. Search for it again.');
          },
          error: (e) => {
            this.adding.set(false);
            this.failed.emit(apiError(e));
          },
        }),
      error: (e) => {
        this.adding.set(false);
        this.failed.emit(apiError(e));
      },
    });
  }

  /** Scanners press Enter after the code: if it finds exactly one medicine, use it. Enter must not submit the form. */
  protected onEnter(ev: Event) {
    ev.preventDefault();
    const total = this.mine().length + this.catalog().length;
    if (!/^\d{8,14}$/.test(this.query().trim()) || total !== 1) return;
    if (this.mine().length) this.pick(this.mine()[0]);
    else this.pickFromCatalog(this.catalog()[0]);
  }

  protected closeSoon() {
    setTimeout(() => this.open.set(false), 200); // let a click on a result register first
  }

  /** The parent can clear the box (e.g. "add another" resets a row). */
  reset() {
    this.query.set('');
    this.mine.set([]);
    this.catalog.set([]);
    this.searched.set(false);
    this.message.set(null);
  }
}
