import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { Icon } from '../../shared/components/icon';
import { apiError } from '../../shared/utils/api';
import { RetailApi, Supplier, SupplierInput } from '../retail-api.service';

/** Add / edit a supplier. The parent makes the API call. */
@Component({
  selector: 'app-supplier-dialog',
  imports: [ReactiveFormsModule],
  template: `
    <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="closed.emit()">
      <div class="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface-solid p-5 shadow-xl" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <h2 class="text-lg font-medium">{{ initial() ? 'Edit supplier' : 'Add supplier' }}</h2>
        @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
        <form [formGroup]="form" (ngSubmit)="submit()" class="mt-4 grid gap-3 sm:grid-cols-6" novalidate>
          <div class="sm:col-span-4"><label class="label" for="sp-name">Supplier name *</label><input id="sp-name" class="field" formControlName="name" /></div>
          <div class="sm:col-span-2"><label class="label" for="sp-cp">Contact person</label><input id="sp-cp" class="field" formControlName="contactPerson" /></div>
          <div class="sm:col-span-2"><label class="label" for="sp-ph">Phone</label><input id="sp-ph" class="field" formControlName="phone" /></div>
          <div class="sm:col-span-4"><label class="label" for="sp-em">Email</label><input id="sp-em" type="email" class="field" formControlName="email" /></div>
          <div class="sm:col-span-3"><label class="label" for="sp-gst">GSTIN</label><input id="sp-gst" class="field uppercase" formControlName="gstin" maxlength="15" /></div>
          <div class="sm:col-span-3"><label class="label" for="sp-dl">Drug licence no.</label><input id="sp-dl" class="field" formControlName="drugLicenseNo" /></div>
          <div class="sm:col-span-6"><label class="label" for="sp-ad">Address</label><input id="sp-ad" class="field" formControlName="address" /></div>
          <div class="sm:col-span-3"><label class="label" for="sp-ci">City</label><input id="sp-ci" class="field" formControlName="city" /></div>
          <div class="sm:col-span-3"><label class="label" for="sp-st">State</label><input id="sp-st" class="field" formControlName="state" /></div>
          <div class="sm:col-span-3"><label class="label" for="sp-cr">Credit days <span class="font-normal">(payment due after)</span></label><input id="sp-cr" type="number" min="0" class="field" formControlName="creditDays" /></div>
          <div class="sm:col-span-3">
            <label class="label" for="sp-ob">Opening balance (₹) <span class="font-normal">{{ initial() ? '(fixed)' : 'you already owe them' }}</span></label>
            <input id="sp-ob" type="number" step="0.01" class="field" formControlName="openingBalance" />
          </div>
          <div class="sm:col-span-6"><label class="label" for="sp-no">Notes</label><input id="sp-no" class="field" formControlName="notes" /></div>
          <div class="mt-2 flex justify-end gap-2 sm:col-span-6">
            <button type="button" class="btn btn-ghost" (click)="closed.emit()">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save supplier' }}</button>
          </div>
        </form>
      </div>
    </div>
  `,
})
export class SupplierDialog implements OnInit {
  private readonly fb = inject(FormBuilder);
  initial = input<Supplier | null>(null);
  error = input<string | null>(null);
  saving = input(false);
  submitted = output<SupplierInput>();
  closed = output();

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    contactPerson: [''],
    phone: [''],
    email: ['', Validators.email],
    gstin: ['', Validators.pattern(/^([0-9A-Za-z]{15})?$/)],
    drugLicenseNo: [''],
    address: [''],
    city: [''],
    state: [''],
    creditDays: [0, [Validators.min(0)]],
    openingBalance: [0],
    notes: [''],
  });

  ngOnInit() {
    const s = this.initial();
    if (!s) return;
    this.form.patchValue({ ...s } as never);
    this.form.controls.openingBalance.disable(); // the starting balance is not edited after the books begin
  }

  protected submit() {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    this.submitted.emit({ ...v, creditDays: Number(v.creditDays), openingBalance: Number(v.openingBalance) });
  }
}


@Component({
  selector: 'app-suppliers',
  imports: [CurrencyPipe, DatePipe, RouterLink, Icon, SupplierDialog],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Suppliers</h1>
        <p class="mt-0.5 text-xs text-ink-soft">Who you buy from, and what you owe each of them.</p>
      </div>
      @if (canWrite) { <button type="button" class="btn btn-primary" (click)="openAdd()">+ Add supplier</button> }
    </div>

    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }
    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

    <section class="card mt-3">
      <div class="flex flex-wrap items-center gap-3">
        <label class="flex h-9 min-w-52 flex-1 items-center gap-2 rounded-full border border-line bg-white/70 px-3 text-ink-soft">
          <app-icon name="search" [size]="14" />
          <input type="search" placeholder="Search name, phone or GSTIN…" (input)="onSearch($any($event.target).value)" class="w-full bg-transparent text-xs text-ink outline-none placeholder:text-ink-soft" />
        </label>
        <p class="text-xs text-ink-soft">You owe in total: <b class="text-sm text-ink">{{ totalOwed() | currency: 'INR' : 'symbol' : '1.2-2' }}</b></p>
      </div>

      <div class="mt-3 overflow-x-auto" [class.opacity-50]="loading()">
        <table class="w-full min-w-176 text-left">
          <thead>
            <tr class="text-[11px] text-ink-soft">
              <th class="py-1.5 pr-3 font-normal">Supplier</th>
              <th class="py-1.5 pr-3 font-normal">Contact</th>
              <th class="py-1.5 pr-3 font-normal">Credit</th>
              <th class="py-1.5 pr-3 font-normal">Invoices</th>
              <th class="py-1.5 pr-3 font-normal">Last invoice</th>
              <th class="py-1.5 pr-3 text-right font-normal">You owe</th>
              <th class="py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            @for (s of suppliers(); track s._id) {
              <tr class="border-t border-line text-xs" [class.opacity-60]="!s.isActive">
                <td class="py-2 pr-3">
                  <a [routerLink]="['/retail/suppliers', s._id]" class="font-medium hover:underline">{{ s.name }}</a>
                  @if (!s.isActive) { <span class="badge ml-1 bg-chip">inactive</span> }
                  <div class="text-[11px] text-ink-soft">{{ s.gstin || 'No GSTIN' }}</div>
                </td>
                <td class="py-2 pr-3">{{ s.contactPerson || '-' }}<div class="text-[11px] text-ink-soft">{{ s.phone }}</div></td>
                <td class="py-2 pr-3">{{ s.creditDays }} days</td>
                <td class="py-2 pr-3">{{ s.invoices ?? 0 }}</td>
                <td class="py-2 pr-3">{{ s.lastInvoiceDate ? (s.lastInvoiceDate | date: 'dd MMM yyyy') : '-' }}</td>
                <td class="py-2 pr-3 text-right font-medium" [class.text-red-700]="(s.outstanding ?? 0) > 0">{{ s.outstanding ?? 0 | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                <td class="py-2 text-right whitespace-nowrap">
                  <a [routerLink]="['/retail/suppliers', s._id]" class="btn btn-ghost">Statement</a>
                  @if (canWrite) { <button type="button" class="btn btn-ghost" (click)="openEdit(s)">Edit</button> }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="py-8 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'No suppliers yet. Add the distributors you buy from.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    @if (editing()) {
      <app-supplier-dialog [initial]="editTarget" [error]="formError()" [saving]="saving()" (submitted)="save($event)" (closed)="editing.set(null)" />
    }
  `,
})
export class Suppliers implements OnInit {
  private readonly api = inject(RetailApi);
  private readonly auth = inject(AuthService);

  protected readonly suppliers = signal<Supplier[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly editing = signal<Supplier | 'new' | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  private q = '';
  private timer?: ReturnType<typeof setTimeout>;

  protected get canWrite() {
    return this.auth.hasPermission('purchase.create');
  }

  protected get editTarget(): Supplier | null {
    const e = this.editing();
    return e && e !== 'new' ? e : null;
  }

  protected totalOwed() {
    return this.suppliers().reduce((s, x) => s + Math.max(0, x.outstanding ?? 0), 0);
  }

  ngOnInit() {
    this.load();
  }

  private load() {
    this.loading.set(true);
    this.api.suppliers({ q: this.q }).subscribe({
      next: (s) => {
        this.suppliers.set(s);
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
    this.timer = setTimeout(() => this.load(), 300);
  }

  protected openAdd() {
    this.formError.set(null);
    this.editing.set('new');
  }

  protected openEdit(s: Supplier) {
    this.formError.set(null);
    this.editing.set(s);
  }

  protected save(input: SupplierInput) {
    const target = this.editTarget;
    this.saving.set(true);
    this.formError.set(null);
    const { openingBalance, ...patch } = input;
    (target ? this.api.updateSupplier(target._id, patch) : this.api.createSupplier(input)).subscribe({
      next: (s) => {
        this.saving.set(false);
        this.editing.set(null);
        this.notice.set(target ? `“${s.name}” updated.` : `“${s.name}” added. You can now book purchases from them.`);
        void openingBalance;
        this.load();
      },
      error: (e) => {
        this.saving.set(false);
        this.formError.set(apiError(e));
      },
    });
  }
}
