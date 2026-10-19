import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../shared/components/icon';
import { StatCard, Tone } from '../../shared/components/stat-card';
import { FORMS, Medicine, SCHEDULE_CLASS } from '../../shared/models/medicine';
import { MedicinePayload, MedicineStats, ProviderApi, apiError } from '../provider-api.service';
import { ImportDialog } from './import-dialog';
import { MedicineFormDialog } from './medicine-form-dialog';

@Component({
  selector: 'app-medicines',
  imports: [Icon, MedicineFormDialog, ImportDialog, DecimalPipe, RouterLink, StatCard],
  templateUrl: './medicines.html',
})
export class Medicines implements OnInit {
  private readonly api = inject(ProviderApi);

  protected readonly forms = FORMS;

  /** the cards above the list, built like the ones on the platform overview */
  protected readonly cards = computed(() => {
    const s = this.stats();
    if (!s) return [];
    const n = (v: number) => v.toLocaleString('en-IN');
    const pct = (v: number) => (s.total ? Math.round((v / s.total) * 100) : 0);
    // the bars under a status card: its share of the catalog (a full bar is the whole catalog)
    const share = (v: number) => [Math.max(8, pct(v))];
    const topForms = s.byForm.slice(0, 3).map((f) => f.form + ' ' + n(f.count)).join(', ') + (s.byForm.length > 3 ? ', …' : '');
    const sched = ['OTC', 'H', 'H1', 'X', 'NDPS'].filter((k) => s.schedule[k]).map((k) => k + ' ' + n(s.schedule[k]));
    return [
      { label: 'Total Medicines', value: n(s.total), note: n(s.addedThisWeek) + ' added in the last 7 days', icon: 'pill', tone: 'lime' as Tone, spark: [] as number[], filter: '' },
      { label: 'Verified', value: n(s.status.verified), note: pct(s.status.verified) + '% of the catalog', icon: 'card', tone: 'teal' as Tone, spark: share(s.status.verified), filter: 'verified' },
      { label: 'Pending', value: n(s.status.pending), note: pct(s.status.pending) + '% of the catalog', icon: 'calendar', tone: 'rose' as Tone, spark: share(s.status.pending), filter: 'pending' },
      { label: 'Inactive', value: n(s.status.inactive), note: pct(s.status.inactive) + '% of the catalog', icon: 'bag', tone: 'lavender' as Tone, spark: [] as number[], filter: 'inactive' },
      { label: 'Manufacturers', value: n(s.manufacturers), note: '', icon: 'users', tone: 'lime' as Tone, spark: [] as number[], filter: '' },
      { label: 'Forms in Use', value: String(s.forms), note: topForms, icon: 'chart', tone: 'teal' as Tone, spark: [] as number[], filter: '' },
      { label: 'By Schedule', value: sched.slice(0, 2).join(' · ') || '0', note: sched.slice(2).join(' · '), icon: 'file', tone: 'rose' as Tone, spark: [] as number[], filter: '' },
      { label: 'With a Barcode', value: n(s.withBarcode), note: pct(s.withBarcode) + '% of the catalog', icon: 'cart', tone: 'lavender' as Tone, spark: [] as number[], filter: '' },
    ];
  });
  protected readonly scheduleClass = SCHEDULE_CLASS;
  protected readonly items = signal<Medicine[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /** null = closed, 'new' = add dialog, otherwise the medicine being edited */
  protected readonly editing = signal<Medicine | 'new' | null>(null);

  // medicines with the same salts, strength and form as one chosen row
  protected readonly saltOf = signal<Medicine | null>(null);
  protected readonly saltList = signal<Medicine[]>([]);
  protected readonly saltLoading = signal(false);
  protected readonly showImport = signal(false);
  protected readonly exporting = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected q = '';
  protected form = '';
  protected status = '';
  protected manufacturer = '';
  protected readonly makers = signal<{ name: string; count: number }[]>([]);
  private makerTimer?: ReturnType<typeof setTimeout>;
  protected page = 1;
  protected readonly pageSizes = [10, 25, 50, 75, 100];
  protected limit = 25;
  protected readonly stats = signal<MedicineStats | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  ngOnInit() {
    try {
      const saved = Number(localStorage.getItem('orvia.medicines.pageSize'));
      if (this.pageSizes.includes(saved)) this.limit = saved;
    } catch {
      /* the page still works without a remembered size */
    }
    this.loadStats();
    this.api.manufacturers('').subscribe((r) => this.makers.set(r));
    this.load();
  }

  protected get from() {
    return this.total() ? (this.page - 1) * this.limit + 1 : 0;
  }

  protected get to() {
    return Math.min(this.total(), this.page * this.limit);
  }

  protected setPageSize(n: number) {
    this.limit = n;
    try {
      localStorage.setItem('orvia.medicines.pageSize', String(n));
    } catch {
      /* not remembered, still applied now */
    }
    this.page = 1;
    this.load();
  }

  protected loadStats() {
    this.api.medicineStats().subscribe({ next: (s) => this.stats.set(s), error: () => undefined });
  }

  /** a status card filters the list to that status; the same card again clears it */
  protected pickStatus(s: string) {
    this.status = this.status === s ? '' : s;
    this.filtersChanged();
  }

  protected get pages() {
    return Math.max(1, Math.ceil(this.total() / this.limit));
  }

  protected load() {
    this.loadStats();
    this.loading.set(true);
    this.api.medicines({ q: this.q.trim(), form: this.form, status: this.status, manufacturer: this.manufacturer, page: this.page, limit: this.limit }).subscribe({
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

  /** Downloads what the search and filters show (everything when none is set). The columns are the ones Import CSV reads. */
  protected exportCsv() {
    this.exporting.set(true);
    this.error.set(null);
    this.api.exportMedicines({ q: this.q.trim(), form: this.form, status: this.status, manufacturer: this.manufacturer }).subscribe({
      next: (blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `orvia-medicines-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        this.exporting.set(false);
      },
      error: (e) => {
        this.exporting.set(false);
        this.error.set('The file could not be made. Please try again.');
        void e;
      },
    });
  }

  protected onSearch(v: string) {
    this.q = v;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.filtersChanged(), 300);
  }

  /** suggestions follow what is typed; the list is applied once the box holds a name (picked or typed in full) */
  protected onMaker(v: string) {
    this.manufacturer = v.trim();
    clearTimeout(this.makerTimer);
    this.makerTimer = setTimeout(() => {
      this.api.manufacturers(this.manufacturer).subscribe((r) => this.makers.set(r));
      this.filtersChanged();
    }, 300);
  }

  protected filtersChanged() {
    this.page = 1;
    this.load();
  }

  protected go(d: number) {
    this.page = Math.min(this.pages, Math.max(1, this.page + d));
    this.load();
  }

  // ---- tick rows, then verify / deactivate them (or everything matching the filter) ----
  protected readonly selected = signal<Set<string>>(new Set());
  protected readonly bulkBusy = signal(false);
  protected readonly notice = signal<string | null>(null);

  protected get allOnPageSelected() {
    return this.items().length > 0 && this.items().every((m) => this.selected().has(m._id));
  }

  protected get hasFilter() {
    return !!(this.q.trim() || this.form || this.status || this.manufacturer);
  }

  protected toggleOne(id: string, on: boolean) {
    const next = new Set(this.selected());
    if (on) next.add(id);
    else next.delete(id);
    this.selected.set(next);
  }

  protected toggleAll(on: boolean) {
    const next = new Set(this.selected());
    for (const m of this.items()) {
      if (on) next.add(m._id);
      else next.delete(m._id);
    }
    this.selected.set(next);
  }

  /** ids = ticked rows; otherwise everything that matches the current search and filters */
  protected setStatus(status: 'verified' | 'inactive' | 'pending', scope: 'selected' | 'filter') {
    const count = scope === 'selected' ? this.selected().size : this.total();
    const what = scope === 'selected' ? `${count} selected medicine${count === 1 ? '' : 's'}` : `all ${count} medicines matching the current filter`;
    if (!confirm(`Mark ${what} as ${status}? ${status === 'verified' ? 'Shops will be able to add them to their inventory.' : ''}`)) return;
    this.bulkBusy.set(true);
    this.error.set(null);
    const body = scope === 'selected' ? { status, ids: [...this.selected()] } : { status, filter: { q: this.q.trim(), form: this.form, status: this.status, manufacturer: this.manufacturer } };
    this.api.bulkMedicineStatus(body).subscribe({
      next: (r) => {
        this.bulkBusy.set(false);
        this.selected.set(new Set());
        this.notice.set(`${r.updated} medicine${r.updated === 1 ? '' : 's'} marked ${status}.`);
        this.load();
      },
      error: (e) => {
        this.bulkBusy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected openSalt(m: Medicine) {
    this.saltOf.set(m);
    this.saltList.set([]);
    this.saltLoading.set(true);
    this.api.medicineSubstitutes(m._id).subscribe({
      next: (l) => {
        this.saltList.set(l);
        this.saltLoading.set(false);
      },
      error: (e) => {
        this.saltLoading.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected newSet() {
    return new Set<string>();
  }

  protected edited(m: Medicine) {
    return this.editing() === m;
  }

  protected openAdd() {
    this.formError.set(null);
    this.editing.set('new');
  }

  protected openEdit(m: Medicine) {
    this.formError.set(null);
    this.editing.set(m);
  }

  protected get editTarget(): Medicine | null {
    const e = this.editing();
    return e && e !== 'new' ? e : null;
  }

  protected save(payload: MedicinePayload) {
    const target = this.editTarget;
    this.saving.set(true);
    this.formError.set(null);
    (target ? this.api.updateMedicine(target._id, payload) : this.api.createMedicine(payload)).subscribe({
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
