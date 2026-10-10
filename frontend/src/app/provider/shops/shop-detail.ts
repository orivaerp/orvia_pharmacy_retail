import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ShopBillingCard } from '../billing/billing-admin';
import { OutletFormDialog } from '../../shared/components/outlet-form-dialog';
import { Limits, Outlet, OutletInput } from '../../shared/models/outlet';
import { Plan, ProviderApi, ShopDetail, apiError } from '../provider-api.service';
import { STATUS_CLASS } from './shops';

@Component({
  selector: 'app-shop-detail',
  imports: [DatePipe, RouterLink, ReactiveFormsModule, OutletFormDialog, ShopBillingCard],
  templateUrl: './shop-detail.html',
})
export class ShopDetailPage {
  private readonly api = inject(ProviderApi);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  /** route param `:id` (component input binding) */
  id = input.required<string>();

  protected readonly statusClass = STATUS_CLASS;
  protected readonly detail = signal<ShopDetail | null>(null);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly inviteUrl = signal<string | null>(null);
  protected readonly emailed = signal(false);

  protected readonly outlets = signal<Outlet[]>([]);
  protected readonly limits = signal<Limits | null>(null);
  protected readonly showAddOutlet = signal(false);
  protected readonly outletSaving = signal(false);
  protected readonly outletError = signal<string | null>(null);
  protected extra = 0;

  // support access: look at the shop's data (read-only) with a stated reason
  protected readonly showSupport = signal(false);
  protected supportReason = '';
  protected readonly supportError = signal<string | null>(null);

  protected readonly showSuspend = signal(false);
  protected readonly editing = signal(false);
  protected reason = '';
  protected selectedPlan = '';

  protected readonly profile = this.fb.nonNullable.group({ name: '', drugLicenseNo: '', gstin: '', phone: '', address: '' });

  protected readonly tenant = computed(() => this.detail()?.tenant ?? null);

  constructor() {
    this.api.plans().subscribe({ next: (p) => this.plans.set(p) });
    effect(() => this.load(this.id()));
  }

  private loadOutlets(id: string) {
    this.api.shopOutlets(id).subscribe({
      next: (r) => {
        this.outlets.set(r.outlets);
        this.limits.set(r.limits);
        this.extra = r.limits.extraOutlets;
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  private load(id: string) {
    this.loadOutlets(id);
    this.api.shop(id).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.selectedPlan = d.tenant.planId?._id ?? '';
        this.profile.reset({
          name: d.tenant.name,
          drugLicenseNo: d.tenant.drugLicenseNo ?? '',
          gstin: d.tenant.gstin ?? '',
          phone: d.tenant.phone ?? '',
          address: d.tenant.address ?? '',
        });
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  /** Runs an action, then reloads the shop. Shows the API error instead of failing silently. */
  private run(req: import('rxjs').Observable<unknown>, okMessage: string, after?: () => void) {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    req.subscribe({
      next: () => {
        this.busy.set(false);
        this.notice.set(okMessage);
        after?.();
        this.load(this.id());
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected openSupport() {
    this.supportReason = '';
    this.supportError.set(null);
    this.showSupport.set(true);
  }

  protected startSupport() {
    if (this.supportReason.trim().length < 10) return this.supportError.set('Please say why you need to look (at least 10 characters). The shop owner can read this.');
    this.busy.set(true);
    this.supportError.set(null);
    this.api.startSupport(this.id(), this.supportReason.trim()).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.showSupport.set(false);
        this.router.navigate(['/provider/shops', this.id(), 'support', r.sessionId]);
      },
      error: (e) => {
        this.busy.set(false);
        this.supportError.set(apiError(e));
      },
    });
  }

  // ---- outlets (the provider can act for the shop; the shop's limit still applies) ----
  protected addOutlet(input: OutletInput) {
    this.outletSaving.set(true);
    this.outletError.set(null);
    this.api.addShopOutlet(this.id(), input).subscribe({
      next: (o) => {
        this.outletSaving.set(false);
        this.showAddOutlet.set(false);
        this.notice.set(`Outlet ${o.name} added for the shop.`);
        this.load(this.id());
      },
      error: (e) => {
        this.outletSaving.set(false);
        this.outletError.set(apiError(e));
      },
    });
  }

  protected toggleOutlet(o: Outlet) {
    this.run(this.api.setShopOutletActive(this.id(), o._id, !o.isActive), o.isActive ? 'Outlet closed.' : 'Outlet reopened.');
  }

  protected saveExtra() {
    this.run(this.api.setExtraOutlets(this.id(), Math.max(0, Math.floor(Number(this.extra) || 0))), 'Outlet limit updated.');
  }

  protected usageClass(used: number, max: number | null | undefined) {
    if (max == null) return 'bg-brand/60';
    return used >= max ? 'bg-red-500' : 'bg-brand';
  }

  protected pct(used: number, max: number | null | undefined) {
    return max == null ? 8 : Math.min(100, Math.round((used / max) * 100));
  }

  protected suspend() {
    if (this.reason.trim().length < 3) {
      this.error.set('Please give a reason (at least 3 characters).');
      return;
    }
    this.run(this.api.suspend(this.id(), this.reason.trim()), 'Shop suspended. Its users are signed out of every request.', () => {
      this.showSuspend.set(false);
      this.reason = '';
    });
  }

  protected activate() {
    this.run(this.api.activate(this.id()), 'Shop activated.');
  }

  protected changePlan() {
    if (!this.selectedPlan || this.selectedPlan === this.tenant()?.planId?._id) return;
    this.run(this.api.changePlan(this.id(), this.selectedPlan), 'Plan changed.');
  }

  protected saveProfile() {
    const v = this.profile.getRawValue();
    this.run(this.api.updateShop(this.id(), v), 'Details saved.', () => this.editing.set(false));
  }

  protected reinvite() {
    this.busy.set(true);
    this.error.set(null);
    this.api.reinvite(this.id()).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.inviteUrl.set(r.inviteUrl);
        this.emailed.set(!!r.emailSent);
        this.notice.set(r.emailSent ? 'Password link emailed to the owner. You can also copy it below.' : 'Link ready below, but the email could not be sent (check Provider > Email). Copy it and send it yourself.');
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected async copy() {
    try {
      await navigator.clipboard.writeText(this.inviteUrl() ?? '');
      this.notice.set('Link copied.');
    } catch {
      this.error.set('Copy failed. Select the link and copy it manually.');
    }
  }
}
