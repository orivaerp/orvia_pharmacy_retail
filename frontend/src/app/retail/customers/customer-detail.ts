import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';
import { SalesApi, SaleRow } from '../sales/sales-api.service';
import { Customer, CustomersApi, StatementEntry, whatsappReminder } from './customers-api.service';

const KIND: Record<string, string> = { OPENING: 'Opening balance', CREDIT_SALE: 'Udhaar on bill', PAYMENT: 'Payment received', RETURN: 'Return against udhaar' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** One customer: what they owe, a statement of every entry, their bills, and taking payment against udhaar. */
@Component({
  selector: 'app-customer-detail',
  imports: [CurrencyPipe, DatePipe, FormsModule, RouterLink],
  template: `
    <a routerLink="/retail/customers" class="text-xs text-ink-soft hover:text-ink">&larr; Customers</a>
    @if (error()) { <p role="alert" class="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-2 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    @if (c(); as cu) {
      <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="flex items-center gap-2 text-xl font-medium tracking-tight sm:text-2xl">{{ cu.name }} @if (!cu.isActive) { <span class="badge bg-chip">inactive</span> }</h1>
          <p class="mt-0.5 text-xs text-ink-soft">{{ cu.phone || 'No phone' }}{{ cu.email ? ' · ' + cu.email : '' }}{{ cu.address ? ' · ' + cu.address : '' }}</p>
        </div>
        @if (canEdit()) {
          <div class="flex gap-2">
            @if (cu.owes > 0) {
              <button type="button" class="btn btn-primary" (click)="openReceive()">Receive payment</button>
              <button type="button" class="btn btn-ghost" [disabled]="reminding() || !cu.email" [attr.title]="cu.email ? null : 'Add an email address to send email reminders'" (click)="remind()">{{ reminding() ? 'Sending…' : 'Email reminder' }}</button>
              @if (waLink(); as link) { <a [href]="link" target="_blank" rel="noopener" class="btn btn-ghost">WhatsApp reminder</a> }
            }
            <button type="button" class="btn btn-ghost" (click)="openEdit()">Edit</button>
          </div>
        }
      </div>

      @if (cu.lastReminderAt) { <p class="mt-1 text-[11px] text-ink-soft">Last reminded by email on {{ cu.lastReminderAt | date: 'dd MMM yyyy' }} ({{ cu.remindersSent }} time{{ cu.remindersSent === 1 ? '' : 's' }}).</p> }
      <div class="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <div class="card"><p class="text-xs text-ink-soft">Owes you</p><p class="mt-1 text-xl font-medium" [class.text-red-700]="cu.owes > 0">{{ cu.owes | currency: 'INR' : 'symbol' : '1.0-0' }}</p></div>
        <div class="card"><p class="text-xs text-ink-soft">Udhaar limit</p><p class="mt-1 text-xl font-medium">{{ cu.creditLimit ? (cu.creditLimit | currency: 'INR' : 'symbol' : '1.0-0') : 'none' }}</p></div>
        <div class="card"><p class="text-xs text-ink-soft">Bills · spent</p><p class="mt-1 text-xl font-medium">{{ cu.bills }} · {{ cu.spent | currency: 'INR' : 'symbol' : '1.0-0' }}</p></div>
        <div class="card"><p class="text-xs text-ink-soft">Last visit</p><p class="mt-1 text-xl font-medium">{{ cu.lastVisit ? (cu.lastVisit | date: 'dd MMM yyyy') : 'never' }}</p></div>
      </div>

      <section class="card mt-3">
        <h2 class="text-sm font-medium">Udhaar statement</h2>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full min-w-136 text-left">
            <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Date</th><th class="py-1.5 pr-3 font-normal">What</th><th class="py-1.5 pr-3 font-normal">Reference</th><th class="py-1.5 pr-3 text-right font-normal">Amount</th><th class="py-1.5 text-right font-normal">Balance</th></tr></thead>
            <tbody>
              @for (e of statement(); track e.id) {
                <tr class="border-t border-line text-xs">
                  <td class="py-1.5 pr-3 whitespace-nowrap">{{ e.date | date: 'dd MMM yyyy' : 'UTC' }}</td>
                  <td class="py-1.5 pr-3">{{ kind(e) }}</td>
                  <td class="py-1.5 pr-3">{{ e.ref }}{{ e.note ? ' · ' + e.note : '' }}{{ e.by ? ' · ' + e.by : '' }}</td>
                  <td class="py-1.5 pr-3 text-right" [class.text-red-700]="e.amount > 0">{{ e.amount > 0 ? '+' : '' }}{{ e.amount | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                  <td class="py-1.5 text-right font-medium">{{ e.balance | currency: 'INR' : 'symbol' : '1.2-2' }}</td>
                </tr>
              } @empty { <tr><td colspan="5" class="py-6 text-center text-xs text-ink-soft">No udhaar yet.</td></tr> }
            </tbody>
          </table>
        </div>
      </section>

      <section class="card mt-3">
        <h2 class="text-sm font-medium">Bills</h2>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full min-w-136 text-left">
            <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">Bill</th><th class="py-1.5 pr-3 font-normal">When</th><th class="py-1.5 pr-3 font-normal">Paid by</th><th class="py-1.5 pr-3 text-right font-normal">Amount</th><th class="py-1.5 font-normal">Status</th></tr></thead>
            <tbody>
              @for (s of bills(); track s._id) {
                <tr class="border-t border-line text-xs">
                  <td class="py-1.5 pr-3 font-medium"><a [routerLink]="['/retail/sales', s._id]" class="underline">{{ s.number }}</a></td>
                  <td class="py-1.5 pr-3 whitespace-nowrap">{{ s.createdAt | date: 'dd MMM, HH:mm' }}</td>
                  <td class="py-1.5 pr-3">{{ modes(s) }}</td>
                  <td class="py-1.5 pr-3 text-right font-medium">{{ s.totals.grand | currency: 'INR' : 'symbol' : '1.0-0' }}</td>
                  <td class="py-1.5">{{ s.status === 'CANCELLED' ? 'cancelled' : s.status === 'RETURNED' ? 'returned' : 'completed' }}</td>
                </tr>
              } @empty { <tr><td colspan="5" class="py-6 text-center text-xs text-ink-soft">No bills yet.</td></tr> }
            </tbody>
          </table>
        </div>
      </section>
    }

    @if (dialog() === 'receive') {
      <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="dialog.set(null)">
        <form class="w-full max-w-sm rounded-2xl bg-surface-solid p-5 shadow-xl" (click)="$event.stopPropagation()" (ngSubmit)="receive()" role="dialog" aria-modal="true">
          <h2 class="text-lg font-medium">Receive payment</h2>
          <p class="text-xs text-ink-soft">{{ c()?.name }} owes {{ c()?.owes | currency: 'INR' : 'symbol' : '1.0-0' }}.</p>
          @if (formError()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ formError() }}</p> }
          <div class="mt-3 grid gap-3">
            <div><label class="label" for="rp-amt">Amount (₹) *</label><input id="rp-amt" name="amt" type="number" min="1" class="field" [(ngModel)]="amount" /></div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="label" for="rp-mode">Received by</label><select id="rp-mode" name="mode" class="field" [(ngModel)]="mode"><option value="CASH">Cash</option><option value="UPI">UPI</option><option value="CARD">Card</option><option value="BANK">Bank</option><option value="OTHER">Other</option></select></div>
              <div><label class="label" for="rp-date">Date</label><input id="rp-date" name="date" type="date" class="field" [(ngModel)]="date" /></div>
            </div>
            <div><label class="label" for="rp-ref">Reference / note</label><input id="rp-ref" name="ref" class="field" [(ngModel)]="reference" placeholder="UPI ref, cheque no. ..." /></div>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="btn btn-ghost" (click)="dialog.set(null)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save payment' }}</button>
          </div>
        </form>
      </div>
    }

    @if (dialog() === 'edit') {
      <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="dialog.set(null)">
        <form class="w-full max-w-md rounded-2xl bg-surface-solid p-5 shadow-xl" (click)="$event.stopPropagation()" (ngSubmit)="saveEdit()" role="dialog" aria-modal="true">
          <h2 class="text-lg font-medium">Edit customer</h2>
          @if (formError()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ formError() }}</p> }
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div class="sm:col-span-2"><label class="label" for="ce-name">Name *</label><input id="ce-name" name="name" class="field" [(ngModel)]="e.name" /></div>
            <div><label class="label" for="ce-phone">Phone</label><input id="ce-phone" name="phone" class="field" inputmode="numeric" [(ngModel)]="e.phone" /></div>
            <div><label class="label" for="ce-limit">Udhaar limit (₹, 0 = none)</label><input id="ce-limit" name="limit" type="number" min="0" class="field" [(ngModel)]="e.creditLimit" /></div>
            <div><label class="label" for="ce-email">Email</label><input id="ce-email" name="email" type="email" class="field" [(ngModel)]="e.email" /></div>
            <div><label class="label" for="ce-addr">Address</label><input id="ce-addr" name="addr" class="field" [(ngModel)]="e.address" /></div>
            <label class="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" name="active" [(ngModel)]="e.isActive" /> Active (inactive customers cannot be picked on a bill)</label>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="btn btn-ghost" (click)="dialog.set(null)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Save' }}</button>
          </div>
        </form>
      </div>
    }
  `,
})
export class CustomerDetailPage {
  private readonly api = inject(CustomersApi);
  private readonly sales = inject(SalesApi);
  private readonly auth = inject(AuthService);
  private readonly ctx = inject(OutletContext);

  id = input.required<string>();
  protected readonly c = signal<Customer | null>(null);
  protected readonly statement = signal<StatementEntry[]>([]);
  protected readonly bills = signal<SaleRow[]>([]);
  protected readonly shop = signal<{ name: string; phone: string }>({ name: '', phone: '' });
  protected readonly reminding = signal(false);
  protected readonly waLink = computed(() => {
    const c = this.c();
    return c ? whatsappReminder(this.shop().name, c.name, c.phone, c.owes) : null;
  });
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly dialog = signal<'receive' | 'edit' | null>(null);
  protected readonly canEdit = computed(() => this.auth.hasPermission('sales.create'));
  protected amount: number | null = null;
  protected mode = 'CASH';
  protected date = today();
  protected reference = '';
  protected e = { name: '', phone: '', email: '', address: '', creditLimit: 0, isActive: true };

  constructor() {
    effect(() => this.load(this.id()));
  }

  protected kind = (x: StatementEntry) => KIND[x.kind] ?? x.kind;
  protected modes = (s: SaleRow) => s.payments.map((p) => p.mode.toLowerCase()).join(' + ');

  private load(id: string) {
    this.api.get(id).subscribe({
      next: (r) => {
        this.c.set(r.customer);
        this.statement.set(r.statement);
        this.shop.set(r.shop);
      },
      error: (e) => this.error.set(apiError(e)),
    });
    this.sales.listForCustomer(id).subscribe({ next: (r) => this.bills.set(r.items), error: () => this.bills.set([]) });
  }

  protected remind() {
    this.error.set(null);
    this.notice.set(null);
    this.reminding.set(true);
    this.api.remind(this.id()).subscribe({
      next: (r) => {
        this.reminding.set(false);
        this.notice.set(`Reminder emailed to ${r.sentTo}. Replies come to your email.`);
        this.load(this.id());
      },
      error: (e) => {
        this.reminding.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected openReceive() {
    this.amount = this.c()?.owes ?? null;
    this.mode = 'CASH';
    this.date = today();
    this.reference = '';
    this.formError.set(null);
    this.dialog.set('receive');
  }

  protected receive() {
    if (!this.amount || this.amount <= 0) return this.formError.set('Enter the amount received.');
    this.busy.set(true);
    this.formError.set(null);
    this.api.receive(this.id(), { amount: Number(this.amount), receivedOn: this.date, mode: this.mode, reference: this.reference.trim() || undefined, branchId: this.ctx.activeId() || undefined }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.dialog.set(null);
        this.notice.set(`Payment of ₹${r.amount} saved.`);
        this.load(this.id());
      },
      error: (e) => {
        this.busy.set(false);
        this.formError.set(apiError(e));
      },
    });
  }

  protected openEdit() {
    const cu = this.c();
    if (!cu) return;
    this.e = { name: cu.name, phone: cu.phone, email: cu.email, address: cu.address, creditLimit: cu.creditLimit, isActive: cu.isActive };
    this.formError.set(null);
    this.dialog.set('edit');
  }

  protected saveEdit() {
    if (this.e.name.trim().length < 2) return this.formError.set('Enter the name.');
    this.busy.set(true);
    this.formError.set(null);
    this.api.update(this.id(), { name: this.e.name.trim(), phone: this.e.phone.trim(), email: this.e.email.trim(), address: this.e.address.trim(), creditLimit: Number(this.e.creditLimit) || 0, isActive: this.e.isActive }).subscribe({
      next: () => {
        this.busy.set(false);
        this.dialog.set(null);
        this.notice.set('Saved.');
        this.load(this.id());
      },
      error: (e) => {
        this.busy.set(false);
        this.formError.set(apiError(e));
      },
    });
  }
}
