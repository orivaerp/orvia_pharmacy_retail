import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Medicine } from '../../shared/models/medicine';
import { splitList } from '../../shared/utils/api';
import { MedicinePayload, MedicineRequest, ProviderApi, apiError } from '../provider-api.service';
import { MedicineFormDialog } from './medicine-form-dialog';

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-tone-lavender',
  approved: 'bg-tone-lime',
  merged: 'bg-tone-teal',
  rejected: 'bg-tone-rose',
};

@Component({
  selector: 'app-medicine-requests',
  imports: [DatePipe, MedicineFormDialog],
  templateUrl: './requests.html',
})
export class MedicineRequests implements OnInit {
  private readonly api = inject(ProviderApi);

  protected readonly statusClass = STATUS_CLASS;
  protected readonly items = signal<MedicineRequest[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected status = 'pending';

  // one dialog/panel open at a time, for one request
  protected readonly approving = signal<MedicineRequest | null>(null);
  protected readonly merging = signal<MedicineRequest | null>(null);
  protected readonly rejecting = signal<MedicineRequest | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly matches = signal<Medicine[]>([]);
  protected rejectNote = '';
  private timer?: ReturnType<typeof setTimeout>;

  ngOnInit() {
    this.load();
  }

  protected load() {
    this.loading.set(true);
    this.api.requests(this.status).subscribe({
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

  protected setStatus(s: string) {
    this.status = s;
    this.load();
  }

  /** What the shop told us, shaped like a catalog medicine so the provider can finish it. */
  protected prefill(r: MedicineRequest): Partial<Medicine> {
    return {
      name: r.name,
      brand: r.brand,
      barcodes: r.barcode ? [r.barcode] : [],
      composition: splitList(r.composition),
      strength: r.strength,
      form: r.form,
      manufacturer: r.manufacturer && r.manufacturer !== 'Unknown' ? r.manufacturer : '',
      gstPercent: r.gstPercent ?? 5,
      schedule: r.schedule ?? 'OTC',
      hsn: '3004',
    };
  }

  private done(message: string) {
    this.saving.set(false);
    this.approving.set(null);
    this.merging.set(null);
    this.rejecting.set(null);
    this.notice.set(message);
    this.load();
  }

  private failed(e: unknown) {
    this.saving.set(false);
    this.formError.set(apiError(e));
  }

  protected approve(payload: MedicinePayload) {
    this.saving.set(true);
    this.formError.set(null);
    this.api.approveRequest(this.approving()!._id, payload).subscribe({
      next: () => this.done('Approved. It is now in the catalog and linked to the shop’s product.'),
      error: (e) => this.failed(e),
    });
  }

  // ---- merge into an existing catalog medicine ----
  protected openMerge(r: MedicineRequest) {
    this.formError.set(null);
    this.matches.set([]);
    this.merging.set(r);
    this.searchMatches(r.name);
  }

  protected onMatchSearch(v: string) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.searchMatches(v), 300);
  }

  private searchMatches(q: string) {
    this.api.medicines({ q: q.trim(), limit: 8 }).subscribe({ next: (r) => this.matches.set(r.items) });
  }

  protected merge(m: Medicine) {
    this.saving.set(true);
    this.formError.set(null);
    this.api.mergeRequest(this.merging()!._id, m._id).subscribe({
      next: () => this.done(`Merged into “${m.name}”.`),
      error: (e) => this.failed(e),
    });
  }

  // ---- reject ----
  protected openReject(r: MedicineRequest) {
    this.formError.set(null);
    this.rejectNote = '';
    this.rejecting.set(r);
  }

  protected reject() {
    if (this.rejectNote.trim().length < 3) return this.formError.set('Please give a short reason (at least 3 characters).');
    this.saving.set(true);
    this.formError.set(null);
    this.api.rejectRequest(this.rejecting()!._id, this.rejectNote.trim()).subscribe({
      next: () => this.done('Request rejected.'),
      error: (e) => this.failed(e),
    });
  }
}
