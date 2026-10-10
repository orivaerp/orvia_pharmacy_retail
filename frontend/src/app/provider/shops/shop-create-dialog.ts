import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Plan, ProviderApi, apiError } from '../provider-api.service';

/** "Add shop" dialog. On success it shows the owner's one-time invite link (no email service yet). */
@Component({
  selector: 'app-shop-create-dialog',
  imports: [ReactiveFormsModule],
  template: `
    <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="closed.emit()">
      <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface-solid p-5 shadow-xl" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        @if (!inviteUrl()) {
          <h2 class="text-lg font-medium">Add shop</h2>
          <p class="mt-0.5 text-xs text-ink-soft">The owner gets a link to set their own password.</p>

          @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

          <form [formGroup]="form" (ngSubmit)="submit()" class="mt-4 grid gap-3 sm:grid-cols-2" novalidate>
            <div class="sm:col-span-2">
              <label class="label" for="name">Shop name *</label>
              <input id="name" class="field" formControlName="name" placeholder="Green Cross Pharmacy" />
            </div>
            <div>
              <label class="label" for="code">Shop code <span class="font-normal">(auto if empty)</span></label>
              <input id="code" class="field" formControlName="code" placeholder="green-cross" />
            </div>
            <div>
              <label class="label" for="planId">Plan *</label>
              <select id="planId" class="field" formControlName="planId">
                @for (p of plans(); track p._id) { <option [value]="p._id">{{ p.name }}</option> }
              </select>
            </div>
            <div>
              <label class="label" for="ownerName">Owner name *</label>
              <input id="ownerName" class="field" formControlName="ownerName" />
            </div>
            <div>
              <label class="label" for="ownerEmail">Owner email *</label>
              <input id="ownerEmail" type="email" class="field" formControlName="ownerEmail" />
            </div>
            <div>
              <label class="label" for="drugLicenseNo">Drug licence no.</label>
              <input id="drugLicenseNo" class="field" formControlName="drugLicenseNo" />
            </div>
            <div>
              <label class="label" for="gstin">GSTIN</label>
              <input id="gstin" class="field" formControlName="gstin" />
            </div>
            <div>
              <label class="label" for="phone">Phone</label>
              <input id="phone" class="field" formControlName="phone" />
            </div>
            <div>
              <label class="label" for="address">Address</label>
              <input id="address" class="field" formControlName="address" />
            </div>
            <div class="mt-2 flex justify-end gap-2 sm:col-span-2">
              <button type="button" class="btn btn-ghost" (click)="closed.emit()">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="saving()">{{ saving() ? 'Creating…' : 'Create shop' }}</button>
            </div>
          </form>
        } @else {
          <h2 class="text-lg font-medium">Shop created</h2>
          <p class="mt-1 text-xs text-ink-soft">{{ emailed() ? "We have emailed this link to the owner. You can copy it too." : "Email is not set up, so send this link to the owner yourself." }} It works once and expires in 7 days.</p>
          <div class="mt-3 flex gap-2">
            <input class="field" readonly [value]="inviteUrl()" (focus)="$any($event.target).select()" />
            <button type="button" class="btn btn-primary shrink-0" (click)="copy()">{{ copied() ? 'Copied' : 'Copy' }}</button>
          </div>
          <div class="mt-4 flex justify-end"><button type="button" class="btn btn-ghost" (click)="created.emit()">Done</button></div>
        }
      </div>
    </div>
  `,
})
export class ShopCreateDialog implements OnInit {
  private readonly api = inject(ProviderApi);
  private readonly fb = inject(FormBuilder);

  plans = input.required<Plan[]>();
  closed = output();
  created = output();

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly inviteUrl = signal<string | null>(null);
  protected readonly emailed = signal(false);
  protected readonly copied = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    code: [''],
    planId: ['', Validators.required],
    ownerName: ['', [Validators.required, Validators.minLength(2)]],
    ownerEmail: ['', [Validators.required, Validators.email]],
    drugLicenseNo: [''],
    gstin: [''],
    phone: [''],
    address: [''],
  });

  ngOnInit() {
    const first = this.plans().find((p) => p.isActive);
    if (first) this.form.patchValue({ planId: first._id });
  }

  protected submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Please fill the required fields (shop name, plan, owner name, a valid owner email).');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.api.createShop(this.form.getRawValue()).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.inviteUrl.set(res.inviteUrl);
        this.emailed.set(!!res.emailSent);
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected async copy() {
    try {
      await navigator.clipboard.writeText(this.inviteUrl() ?? '');
      this.copied.set(true);
    } catch {
      this.error.set('Copy failed. Select the link and copy it manually.');
    }
  }
}
