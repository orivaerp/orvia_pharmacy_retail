import { Component, OnInit, inject, signal } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { Icon } from '../../shared/components/icon';
import { Product, SCHEDULE_CLASS } from '../../shared/models/medicine';
import { apiError } from '../../shared/utils/api';
import { RetailApi } from '../retail-api.service';
import { AddProductsDialog } from './add-products-dialog';
import { LABEL_SIZES, LabelSize, canPrintLabel, printLabels } from './labels';

@Component({
  selector: 'app-products',
  imports: [Icon, AddProductsDialog],
  templateUrl: './products.html',
})
export class Products implements OnInit {
  private readonly api = inject(RetailApi);
  protected readonly auth = inject(AuthService);

  protected readonly scheduleClass = SCHEDULE_CLASS;
  protected readonly items = signal<Product[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly showAdd = signal(false);

  protected readonly editing = signal<Product | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected reorder = 0;
  protected location = '';
  protected loose = false;
  protected active = true;

  protected q = '';
  protected page = 1;
  protected readonly limit = 20;
  private timer?: ReturnType<typeof setTimeout>;

  protected get canManage() {
    return this.auth.hasPermission('product.manage');
  }

  protected get pages() {
    return Math.max(1, Math.ceil(this.total() / this.limit));
  }

  ngOnInit() {
    this.load();
  }

  protected load() {
    this.loading.set(true);
    this.api.products({ q: this.q.trim(), page: this.page, limit: this.limit }).subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.total.set(r.total);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }

  protected onSearch(v: string) {
    this.q = v;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.page = 1;
      this.load();
    }, 300);
  }

  protected go(d: number) {
    this.page = Math.min(this.pages, Math.max(1, this.page + d));
    this.load();
  }

  protected max = 0;
  protected refillDays = 0;

  protected openEdit(p: Product) {
    this.reorder = p.reorderLevel;
    this.max = p.maxLevel ?? 0;
    this.refillDays = p.refillDays ?? 0;
    this.location = p.location;
    this.loose = p.looseSelling;
    this.active = p.isActive;
    this.formError.set(null);
    this.newCode.set('');
    this.labelCode = p.barcodes.find(canPrintLabel) ?? '';
    this.labelMrp = p.referenceMrp ?? 0;
    this.editing.set(p);
  }

  protected readonly newCode = signal('');
  protected readonly sizes = LABEL_SIZES;
  protected readonly printable = canPrintLabel;
  protected labelCode = '';
  protected copies = 10;
  protected labelSize: LabelSize = 'roll';
  protected labelMrp = 0;

  protected makeCode() {
    const p = this.editing()!;
    this.codeBusy.set(true);
    this.formError.set(null);
    this.api.generateBarcode(p._id).subscribe({
      next: (v) => {
        this.codeBusy.set(false);
        this.editing.set(v);
        this.labelCode = v.barcodes.find(canPrintLabel) ?? '';
      },
      error: (e) => {
        this.codeBusy.set(false);
        this.formError.set(apiError(e));
      },
    });
  }

  protected printNow() {
    const p = this.editing()!;
    const code = this.labelCode || p.barcodes.find(canPrintLabel) || '';
    if (!code) return this.formError.set('Choose a barcode to print.');
    const n = Math.floor(Number(this.copies));
    if (!(n >= 1 && n <= 500)) return this.formError.set('Copies must be between 1 and 500.');
    this.formError.set(null);
    if (!printLabels({ name: p.name, code, mrp: Number(this.labelMrp) > 0 ? Number(this.labelMrp) : undefined, copies: n, size: this.labelSize })) this.formError.set('The browser blocked the print window. Allow pop-ups for this site and try again.');
  }
  protected readonly codeBusy = signal(false);
  protected readonly catalogCodes = () => {
    const p = this.editing();
    return p ? p.barcodes.filter((b) => !(p.ownBarcodes ?? []).includes(b)) : [];
  };

  protected addCode() {
    const p = this.editing()!;
    const code = this.newCode().trim();
    if (code.length < 6) return this.formError.set('A barcode is at least 6 characters.');
    this.codeBusy.set(true);
    this.formError.set(null);
    this.api.saveBarcode(p._id, code).subscribe({
      next: (v) => {
        this.codeBusy.set(false);
        this.newCode.set('');
        this.editing.set(v);
      },
      error: (e) => {
        this.codeBusy.set(false);
        this.formError.set(apiError(e));
      },
    });
  }

  protected removeCode(code: string) {
    const p = this.editing()!;
    if (!confirm(`Remove barcode ${code} from ${p.name}? Scanning it will then find nothing until you link it again.`)) return;
    this.codeBusy.set(true);
    this.formError.set(null);
    this.api.removeBarcode(p._id, code).subscribe({
      next: (v) => {
        this.codeBusy.set(false);
        this.editing.set(v);
      },
      error: (e) => {
        this.codeBusy.set(false);
        this.formError.set(apiError(e));
      },
    });
  }

  protected save() {
    const p = this.editing()!;
    this.saving.set(true);
    this.formError.set(null);
    this.api.updateSettings(p._id, { reorderLevel: Number(this.reorder) || 0, maxLevel: Number(this.max) || 0, location: this.location, looseSelling: this.loose, refillDays: Math.max(0, Math.min(365, Math.floor(Number(this.refillDays) || 0))), isActive: this.active }).subscribe({
      next: () => {
        this.saving.set(false);
        this.editing.set(null);
        this.load();
      },
      error: (e) => {
        this.saving.set(false);
        this.formError.set(apiError(e));
      },
    });
  }
}
