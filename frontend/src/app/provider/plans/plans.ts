import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FEATURE_LABELS, Plan, ProviderApi, apiError } from '../provider-api.service';

@Component({
  selector: 'app-plans',
  imports: [CurrencyPipe, ReactiveFormsModule],
  templateUrl: './plans.html',
})
export class Plans implements OnInit {
  private readonly api = inject(ProviderApi);
  private readonly fb = inject(FormBuilder);

  protected readonly featureKeys = Object.keys(FEATURE_LABELS);
  protected readonly featureLabels = FEATURE_LABELS;

  protected readonly plans = signal<Plan[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly saving = signal(false);
  /** null = dialog closed, '' = creating, id = editing */
  protected readonly editingId = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    code: ['', [Validators.required, Validators.pattern(/^[a-z0-9-]{2,30}$/)]],
    price: [0, [Validators.required, Validators.min(0)]],
    cycle: ['monthly' as 'monthly' | 'yearly'],
    trialDays: [0, [Validators.required, Validators.min(0)]],
    maxOutlets: [1 as number | null, [Validators.min(1)]],
    maxUsers: [null as number | null, [Validators.min(1)]],
    maxProducts: [null as number | null, [Validators.min(1)]],
    maxBillsPerMonth: [null as number | null, [Validators.min(1)]],
    unlimitedProducts: [true],
    unlimitedBills: [true],
    unlimitedOutlets: [false],
    unlimitedUsers: [true],
    features: [[] as string[]],
    isActive: [true],
    sortOrder: [0],
  });

  ngOnInit() {
    this.load();
  }

  protected load() {
    this.api.plans().subscribe({
      next: (p) => {
        this.plans.set(p);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }

  protected openNew() {
    this.form.reset({ cycle: 'monthly', price: 0, trialDays: 0, maxOutlets: 1, maxUsers: null, maxProducts: null, maxBillsPerMonth: null, unlimitedProducts: true, unlimitedBills: true, unlimitedOutlets: false, unlimitedUsers: true, features: [], isActive: true, sortOrder: (this.plans().at(-1)?.sortOrder ?? 0) + 1 });
    this.form.controls.code.enable();
    this.formError.set(null);
    this.editingId.set('');
  }

  protected openEdit(p: Plan) {
    this.form.reset({
      name: p.name,
      code: p.code,
      price: p.price,
      cycle: p.cycle,
      trialDays: p.trialDays,
      maxOutlets: p.maxOutlets,
      maxUsers: p.maxUsers,
      maxProducts: p.maxProducts ?? null,
      maxBillsPerMonth: p.maxBillsPerMonth ?? null,
      unlimitedOutlets: p.maxOutlets == null,
      unlimitedUsers: p.maxUsers == null,
      unlimitedProducts: p.maxProducts == null,
      unlimitedBills: p.maxBillsPerMonth == null,
      features: [...p.features],
      isActive: p.isActive,
      sortOrder: p.sortOrder,
    });
    this.form.controls.code.disable(); // code is the plan's permanent identifier
    this.formError.set(null);
    this.editingId.set(p._id);
  }

  protected has(feature: string) {
    return this.form.controls.features.value.includes(feature);
  }

  protected toggleFeature(feature: string, on: boolean) {
    const cur = this.form.controls.features.value;
    this.form.controls.features.setValue(on ? [...new Set([...cur, feature])] : cur.filter((f) => f !== feature));
  }

  protected save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set('Please check the highlighted values (code: lowercase letters, numbers, dashes).');
      return;
    }
    const v = this.form.getRawValue();
    const body = {
      name: v.name,
      code: v.code,
      price: Number(v.price),
      cycle: v.cycle,
      trialDays: Number(v.trialDays),
      maxOutlets: v.unlimitedOutlets ? null : Number(v.maxOutlets ?? 1),
      maxUsers: v.unlimitedUsers ? null : Number(v.maxUsers ?? 1),
      maxProducts: v.unlimitedProducts ? null : Number(v.maxProducts ?? 1),
      maxBillsPerMonth: v.unlimitedBills ? null : Number(v.maxBillsPerMonth ?? 1),
      features: v.features,
      isActive: v.isActive,
      sortOrder: Number(v.sortOrder),
    };
    const id = this.editingId();
    const { code, ...patch } = body; // code cannot change after creation
    this.saving.set(true);
    this.formError.set(null);
    (id ? this.api.updatePlan(id, patch) : this.api.createPlan(body)).subscribe({
      next: () => {
        this.saving.set(false);
        this.editingId.set(null);
        this.load();
      },
      error: (e) => {
        this.saving.set(false);
        this.formError.set(apiError(e));
      },
    });
    void code;
  }

  protected limit(n: number | null) {
    return n == null ? 'Unlimited' : String(n);
  }
}
