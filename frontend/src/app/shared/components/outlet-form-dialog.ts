import { Component, OnInit, inject, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Outlet, OutletInput } from '../models/outlet';

/** Add / edit an outlet. The parent does the API call and passes `error` and `saving` back. Used by shops and the provider. */
@Component({
  selector: 'app-outlet-form-dialog',
  imports: [ReactiveFormsModule],
  template: `
    <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="closed.emit()">
      <div class="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface-solid p-5 shadow-xl" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <h2 class="text-lg font-medium">{{ title() }}</h2>
        @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

        <form [formGroup]="form" (ngSubmit)="submit()" class="mt-4 grid gap-3 sm:grid-cols-6" novalidate>
          <div class="sm:col-span-4">
            <label class="label" for="o-name">Outlet name *</label>
            <input id="o-name" class="field" formControlName="name" placeholder="Green Cross, Andheri" (input)="suggestCode()" />
          </div>
          <div class="sm:col-span-2">
            <label class="label" for="o-code">Code * <span class="font-normal">{{ initial() ? '(fixed)' : '' }}</span></label>
            <input id="o-code" class="field uppercase" formControlName="code" placeholder="AND" (input)="codeTouched = true" />
          </div>
          <div class="sm:col-span-6"><label class="label" for="o-addr">Address</label><input id="o-addr" class="field" formControlName="address" /></div>
          <div class="sm:col-span-2"><label class="label" for="o-city">City</label><input id="o-city" class="field" formControlName="city" /></div>
          <div class="sm:col-span-2"><label class="label" for="o-state">State</label><input id="o-state" class="field" formControlName="state" /></div>
          <div class="sm:col-span-2">
            <label class="label" for="o-pin">Pincode</label>
            <input id="o-pin" class="field" formControlName="pincode" inputmode="numeric" maxlength="6" />
          </div>
          <div class="sm:col-span-3"><label class="label" for="o-phone">Phone</label><input id="o-phone" class="field" formControlName="phone" /></div>

          <div class="sm:col-span-6 mt-1 border-t border-line pt-3">
            <p class="text-sm font-medium">Compliance details <span class="text-xs font-normal text-ink-soft">(optional now, needed before you print bills)</span></p>
            <p class="text-[11px] text-ink-soft">Licences are usually per premises, so enter this outlet's own details. They are printed on its invoices.</p>
          </div>
          <div class="sm:col-span-3"><label class="label" for="o-dl">Drug licence no.</label><input id="o-dl" class="field" formControlName="drugLicenseNo" /></div>
          <div class="sm:col-span-3"><label class="label" for="o-dlv">Licence valid till</label><input id="o-dlv" type="date" class="field" formControlName="drugLicenseValidTill" /></div>
          <div class="sm:col-span-3"><label class="label" for="o-gst">GSTIN</label><input id="o-gst" class="field uppercase" formControlName="gstin" maxlength="15" /></div>
          <div class="sm:col-span-3"></div>
          <div class="sm:col-span-3"><label class="label" for="o-ph">Pharmacist name</label><input id="o-ph" class="field" formControlName="pharmacistName" /></div>
          <div class="sm:col-span-3"><label class="label" for="o-phr">Pharmacist registration no.</label><input id="o-phr" class="field" formControlName="pharmacistRegNo" /></div>

          <div class="mt-2 flex justify-end gap-2 sm:col-span-6">
            <button type="button" class="btn btn-ghost" (click)="closed.emit()">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="saving()">{{ saving() ? 'Saving…' : submitLabel() }}</button>
          </div>
        </form>
      </div>
    </div>
  `,
})
export class OutletFormDialog implements OnInit {
  private readonly fb = inject(FormBuilder);

  title = input('Add outlet');
  submitLabel = input('Save outlet');
  initial = input<Outlet | null>(null);
  error = input<string | null>(null);
  saving = input(false);

  submitted = output<OutletInput>();
  closed = output();

  protected codeTouched = false;

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    code: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9-]{2,12}$/)]],
    address: [''],
    city: [''],
    state: [''],
    pincode: ['', Validators.pattern(/^(\d{6})?$/)],
    phone: [''],
    drugLicenseNo: [''],
    drugLicenseValidTill: [''],
    gstin: ['', Validators.pattern(/^([0-9A-Za-z]{15})?$/)],
    pharmacistName: [''],
    pharmacistRegNo: [''],
  });

  ngOnInit() {
    const o = this.initial();
    if (!o) return;
    this.form.patchValue({ ...o, drugLicenseValidTill: o.drugLicenseValidTill ? o.drugLicenseValidTill.slice(0, 10) : '' } as never);
    this.form.controls.code.disable(); // the code is the outlet's permanent identifier
  }

  /** Suggests a short code from the name until the user types their own. */
  protected suggestCode() {
    if (this.initial() || this.codeTouched) return;
    const words = this.form.controls.name.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
    const code = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 5);
    this.form.controls.code.setValue(code.slice(0, 8));
  }

  protected submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitted.emit(this.form.getRawValue());
  }
}
