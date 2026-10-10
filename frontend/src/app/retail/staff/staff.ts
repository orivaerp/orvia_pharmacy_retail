import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';
import { RetailApi, STAFF_ROLES, StaffUser } from '../retail-api.service';

@Component({
  selector: 'app-staff',
  imports: [DatePipe],
  templateUrl: './staff.html',
})
export class Staff implements OnInit {
  private readonly api = inject(RetailApi);
  private readonly auth = inject(AuthService);
  protected readonly ctx = inject(OutletContext);

  protected readonly roles = STAFF_ROLES;
  protected readonly users = signal<StaffUser[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly inviteUrl = signal<string | null>(null);
  protected readonly emailed = signal(false);
  /** the person whose password link is being made and emailed right now (it takes a few seconds) */
  protected readonly sendingId = signal<string | null>(null);
  protected readonly busy = signal(false);

  /** add / edit dialog: null = closed, 'new' = add, otherwise the person being edited */
  protected readonly editing = signal<StaffUser | 'new' | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected name = '';
  protected email = '';
  protected role = 'cashier';
  protected readonly picked = signal<Set<string>>(new Set());

  protected readonly canManage = computed(() => this.auth.hasPermission('user.manage'));

  protected get editTarget(): StaffUser | null {
    const e = this.editing();
    return e && e !== 'new' ? e : null;
  }

  ngOnInit() {
    this.ctx.load(true);
    this.load();
  }

  private load() {
    this.loading.set(true);
    this.api.staff().subscribe({
      next: (u) => {
        this.users.set(u);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }

  protected roleLabel(id: string) {
    return this.roles.find((r) => r.id === id)?.label ?? (id === 'shop_owner' ? 'Owner' : id);
  }

  protected outletNames(u: StaffUser) {
    if (u.role === 'shop_owner' || !u.branchIds.length) return 'All outlets';
    const names = this.ctx.outlets().filter((o) => u.branchIds.includes(o._id)).map((o) => o.name);
    return names.join(', ') || '-';
  }

  // ---- add / edit ----
  protected openAdd() {
    this.name = '';
    this.email = '';
    this.role = 'cashier';
    // pre-tick the outlet the owner is currently looking at, or the only one
    const first = this.ctx.selected() || (this.ctx.choices().length === 1 ? this.ctx.choices()[0]._id : '');
    this.picked.set(new Set(first ? [first] : []));
    this.formError.set(null);
    this.editing.set('new');
  }

  protected openEdit(u: StaffUser) {
    this.name = u.name;
    this.email = u.email;
    this.role = u.role;
    this.picked.set(new Set(u.branchIds));
    this.formError.set(null);
    this.editing.set(u);
  }

  protected togglePick(id: string, on: boolean) {
    const next = new Set(this.picked());
    if (on) next.add(id);
    else next.delete(id);
    this.picked.set(next);
  }

  protected save() {
    if (this.name.trim().length < 2) return this.formError.set('Enter the name.');
    if (!this.editTarget && !/^\S+@\S+\.\S+$/.test(this.email.trim())) return this.formError.set('Enter a valid email address.');
    if (!this.picked().size) return this.formError.set('Choose at least one outlet.');

    const branchIds = [...this.picked()];
    this.busy.set(true);
    this.formError.set(null);
    const target = this.editTarget;
    const failed = (e: unknown) => {
      this.busy.set(false);
      this.formError.set(apiError(e));
    };

    if (target) {
      this.api.updateStaff(target._id, { name: this.name.trim(), role: this.role, branchIds }).subscribe({
        next: () => {
          this.busy.set(false);
          this.editing.set(null);
          this.notice.set('Changes saved. They apply on the person’s next action.');
          this.load();
        },
        error: failed,
      });
      return;
    }

    this.api.addStaff({ name: this.name.trim(), email: this.email.trim().toLowerCase(), role: this.role, branchIds }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.editing.set(null);
        this.inviteUrl.set(r.inviteUrl);
        this.emailed.set(!!r.emailSent);
        this.notice.set(r.emailSent ? `${r.user.name} added. The password link was emailed to ${r.user.email}; you can also copy it below.` : `${r.user.name} added, but the email could not be sent. Copy the link below and send it so they can set a password.`);
        this.load();
      },
      error: failed,
    });
  }

  // ---- row actions ----
  protected toggleActive(u: StaffUser) {
    this.error.set(null);
    this.api.setStaffActive(u._id, !u.isActive).subscribe({
      next: () => {
        this.notice.set(u.isActive ? `${u.name} can no longer sign in.` : `${u.name} can sign in again.`);
        this.inviteUrl.set(null);
        this.load();
      },
      error: (e) => this.error.set(apiError(e)),
    });
  }

  protected newLink(u: StaffUser) {
    if (this.sendingId()) return;
    this.error.set(null);
    this.notice.set(null);
    this.sendingId.set(u._id);
    this.api.reinviteStaff(u._id).subscribe({
      next: (r) => {
        this.sendingId.set(null);
        this.inviteUrl.set(r.inviteUrl);
        this.emailed.set(!!r.emailSent);
        this.notice.set(
          r.emailSent
            ? `Password link emailed to ${u.email}. Any older link stops working. You can also copy it below.`
            : `New password link for ${u.name} is ready below, but the email could not be sent (is email set up under Provider > Email?). Copy the link and send it yourself. Any older link stops working.`,
        );
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: (e) => {
        this.sendingId.set(null);
        this.error.set(apiError(e));
        window.scrollTo({ top: 0, behavior: 'smooth' });
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
