import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { Icon } from '../../shared/components/icon';
import { OutletFormDialog } from '../../shared/components/outlet-form-dialog';
import { Limits, Outlet, OutletInput, OutletRequest } from '../../shared/models/outlet';
import { apiError } from '../../shared/utils/api';
import { RetailApi } from '../retail-api.service';

type Usage = Limits & { pendingRequest: { count: number; note?: string; at: string } | null };

@Component({
  selector: 'app-outlets',
  imports: [DatePipe, Icon, OutletFormDialog],
  templateUrl: './outlets.html',
})
export class Outlets implements OnInit {
  private readonly api = inject(RetailApi);
  private readonly auth = inject(AuthService);

  protected readonly outlets = signal<Outlet[]>([]);
  protected readonly usage = signal<Usage | null>(null);
  protected readonly requests = signal<OutletRequest[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  /** null = closed, 'new' = add dialog, otherwise the outlet being edited */
  protected readonly editing = signal<Outlet | 'new' | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly closing = signal<Outlet | null>(null);
  protected readonly closeError = signal<string | null>(null);

  protected readonly requesting = signal(false);
  protected requestCount = 1;
  protected requestNote = '';

  protected get canManage() {
    return this.auth.hasPermission('branch.manage');
  }

  protected readonly atLimit = computed(() => {
    const o = this.usage()?.outlets;
    return !!o && o.limit != null && o.used >= o.limit;
  });

  protected readonly usedPct = computed(() => {
    const o = this.usage()?.outlets;
    if (!o) return 0;
    return o.limit == null ? 8 : Math.min(100, Math.round((o.used / o.limit) * 100));
  });

  protected get editTarget(): Outlet | null {
    const e = this.editing();
    return e && e !== 'new' ? e : null;
  }

  ngOnInit() {
    this.load();
  }

  protected load() {
    this.loading.set(true);
    this.api.outlets().subscribe({
      next: (o) => {
        this.outlets.set(o);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
    this.api.outletUsage().subscribe({ next: (u) => this.usage.set(u) });
    if (this.canManage) this.api.outletRequests().subscribe({ next: (r) => this.requests.set(r) });
  }

  protected addressLine(o: Outlet) {
    return [o.address, o.city, o.state, o.pincode].filter((x) => !!x).join(', ') || 'No address yet';
  }

  protected licenceState(o: Outlet): 'expired' | 'soon' | null {
    if (!o.drugLicenseValidTill) return null;
    const left = new Date(o.drugLicenseValidTill).getTime() - Date.now();
    return left < 0 ? 'expired' : left < 60 * 864e5 ? 'soon' : null;
  }

  // ---- add / edit ----
  protected openAdd() {
    this.formError.set(null);
    this.editing.set('new');
  }

  protected openEdit(o: Outlet) {
    this.formError.set(null);
    this.editing.set(o);
  }

  protected save(input: OutletInput) {
    const target = this.editTarget;
    this.saving.set(true);
    this.formError.set(null);
    const { code, ...patch } = input;
    (target ? this.api.updateOutlet(target._id, patch) : this.api.createOutlet(input)).subscribe({
      next: (o) => {
        this.saving.set(false);
        this.editing.set(null);
        this.notice.set(target ? `“${o.name}” updated.` : `“${o.name}” added. Next: add its stock, then its staff.`);
        void code;
        this.load();
      },
      error: (e) => {
        this.saving.set(false);
        this.formError.set(apiError(e));
      },
    });
  }

  // ---- close / reopen ----
  protected askClose(o: Outlet) {
    this.closeError.set(null);
    this.closing.set(o);
  }

  protected confirmClose() {
    const o = this.closing()!;
    this.saving.set(true);
    this.closeError.set(null);
    this.api.setOutletActive(o._id, false).subscribe({
      next: () => {
        this.saving.set(false);
        this.closing.set(null);
        this.notice.set(`“${o.name}” is now inactive and no longer counts toward your limit.`);
        this.load();
      },
      error: (e) => {
        this.saving.set(false);
        this.closeError.set(apiError(e));
      },
    });
  }

  protected reopen(o: Outlet) {
    this.error.set(null);
    this.api.setOutletActive(o._id, true).subscribe({
      next: () => {
        this.notice.set(`“${o.name}” is active again.`);
        this.load();
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  // ---- ask the provider for more outlets ----
  protected openRequest() {
    this.formError.set(null);
    this.requestCount = 1;
    this.requestNote = '';
    this.requesting.set(true);
  }

  protected sendRequest() {
    this.saving.set(true);
    this.formError.set(null);
    this.api.requestOutlets(Number(this.requestCount), this.requestNote.trim()).subscribe({
      next: () => {
        this.saving.set(false);
        this.requesting.set(false);
        this.notice.set('Request sent. The provider will review it and you will see the new limit here.');
        this.load();
      },
      error: (e) => {
        this.saving.set(false);
        this.formError.set(apiError(e));
      },
    });
  }
}
