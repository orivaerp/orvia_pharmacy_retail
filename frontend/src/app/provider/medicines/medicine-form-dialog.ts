import { Component, OnInit, inject, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FORMS, GST_RATES, Medicine, SCHEDULES } from '../../shared/models/medicine';
import { splitList } from '../../shared/utils/api';
import { MedicinePayload } from '../provider-api.service';

/**
 * Add / edit a catalog medicine. Also used to approve a shop's request (prefilled, provider confirms the
 * facts a shop cannot know: HSN, GST, schedule). The parent performs the API call and passes `error`/`saving` back.
 */
@Component({
  selector: 'app-medicine-form-dialog',
  imports: [ReactiveFormsModule],
  template: `
    <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="closed.emit()">
      <div class="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface-solid p-5 shadow-xl" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <h2 class="text-lg font-medium">{{ title() }}</h2>
        @if (hint()) { <p class="mt-0.5 text-xs text-ink-soft">{{ hint() }}</p> }
        @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

        <form [formGroup]="form" (ngSubmit)="submit()" class="mt-4 grid gap-3 sm:grid-cols-6" novalidate>
          <div class="sm:col-span-4"><label class="label" for="m-name">Name * <span class="font-normal">(with strength and form)</span></label><input id="m-name" class="field" formControlName="name" placeholder="Paracetamol 500mg Tablet" /></div>
          <div class="sm:col-span-2"><label class="label" for="m-brand">Brand</label><input id="m-brand" class="field" formControlName="brand" /></div>
          <div class="sm:col-span-4"><label class="label" for="m-comp">Composition (salts) * <span class="font-normal">separate with ;</span></label><input id="m-comp" class="field" formControlName="composition" placeholder="Amoxicillin; Clavulanic Acid" /></div>
          <div class="sm:col-span-2"><label class="label" for="m-str">Strength</label><input id="m-str" class="field" formControlName="strength" placeholder="500mg" /></div>
          <div class="sm:col-span-2">
            <label class="label" for="m-form">Form *</label>
            <select id="m-form" class="field" formControlName="form">@for (f of forms; track f) { <option [value]="f">{{ f }}</option> }</select>
          </div>
          <div class="sm:col-span-2"><label class="label" for="m-units">Units per pack</label><input id="m-units" type="number" min="1" class="field" formControlName="unitsPerPack" /></div>
          <div class="sm:col-span-2"><label class="label" for="m-mfr">Manufacturer *</label><input id="m-mfr" class="field" formControlName="manufacturer" /></div>
          <div class="sm:col-span-2"><label class="label" for="m-hsn">HSN *</label><input id="m-hsn" class="field" formControlName="hsn" /></div>
          <div class="sm:col-span-2">
            <label class="label" for="m-gst">GST % *</label>
            <select id="m-gst" class="field" formControlName="gstPercent">@for (g of gst; track g) { <option [ngValue]="g">{{ g }}%</option> }</select>
          </div>
          <div class="sm:col-span-2">
            <label class="label" for="m-sch">Schedule</label>
            <select id="m-sch" class="field" formControlName="schedule">@for (s of schedules; track s) { <option [value]="s">{{ s }}</option> }</select>
          </div>
          <div class="sm:col-span-3"><label class="label" for="m-cat">Category</label><input id="m-cat" class="field" formControlName="category" placeholder="Antibiotic" /></div>
          <div class="sm:col-span-3"><label class="label" for="m-bar">Barcodes <span class="font-normal">separate with ;</span></label><input id="m-bar" class="field" formControlName="barcodes" /></div>
          <div class="sm:col-span-3">
            <label class="label" for="m-status">Status</label>
            <select id="m-status" class="field" formControlName="status"><option value="verified">verified</option><option value="pending">pending</option><option value="inactive">inactive</option></select>
          </div>
          <div class="mt-2 flex justify-end gap-2 sm:col-span-6">
            <button type="button" class="btn btn-ghost" (click)="closed.emit()">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="saving()">{{ saving() ? 'Saving…' : submitLabel() }}</button>
          </div>
        </form>
      </div>
    </div>
  `,
})
export class MedicineFormDialog implements OnInit {
  private readonly fb = inject(FormBuilder);

  title = input('Add medicine');
  hint = input('');
  submitLabel = input('Save');
  initial = input<Partial<Medicine> | null>(null);
  error = input<string | null>(null);
  saving = input(false);

  submitted = output<MedicinePayload>();
  closed = output();

  protected readonly forms = FORMS;
  protected readonly schedules = SCHEDULES;
  protected readonly gst = GST_RATES;

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    brand: [''],
    composition: ['', Validators.required],
    strength: [''],
    form: ['tablet', Validators.required],
    unitsPerPack: [1, [Validators.required, Validators.min(1)]],
    manufacturer: ['', Validators.required],
    hsn: ['3004', [Validators.required, Validators.pattern(/^\d{4,8}$/)]],
    gstPercent: [5, Validators.required],
    schedule: ['OTC'],
    category: [''],
    barcodes: [''],
    status: ['verified'],
  });

  ngOnInit() {
    const m = this.initial();
    if (!m) return;
    this.form.patchValue({
      name: m.name ?? '',
      brand: m.brand ?? '',
      composition: (m.composition ?? []).join('; '),
      strength: m.strength ?? '',
      form: m.form ?? 'tablet',
      unitsPerPack: m.unitsPerPack ?? 1,
      manufacturer: m.manufacturer ?? '',
      hsn: m.hsn ?? '3004',
      gstPercent: m.gstPercent ?? 5,
      schedule: m.schedule ?? 'OTC',
      category: m.category ?? '',
      barcodes: (m.barcodes ?? []).join('; '),
      status: m.status ?? 'verified',
    });
  }

  protected submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.submitted.emit({
      ...v,
      brand: v.brand || undefined,
      composition: splitList(v.composition),
      barcodes: splitList(v.barcodes),
      unitsPerPack: Number(v.unitsPerPack),
      gstPercent: Number(v.gstPercent),
      status: v.status as MedicinePayload['status'],
    });
  }
}
