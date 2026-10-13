import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';
import { Customer, CustomersApi, whatsappReminder } from './customers-api.service';

/** The shop's customers: who they are, who owes money (udhaar), and when they last came. */
@Component({
  selector: 'app-customers',
  imports: [CurrencyPipe, DatePipe, FormsModule, RouterLink],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Customers</h1>
        <p class="mt-0.5 text-xs text-ink-soft">Customers are added when you enter a phone number on a bill, or here. Udhaar (credit) is tracked per customer.</p>
      </div>
      @if (canEdit()) { <button type="button" class="btn btn-primary" (click)="openAdd()">Add customer</button> }
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <input class="field w-56" placeholder="Name or phone" aria-label="Search customers" (input)="onQ($any($event.target).value)" />
      <div class="flex gap-1 rounded-full border border-line bg-surface p-1 text-xs" role="tablist">
        <button type="button" role="tab" class="rounded-full px-3 py-1" [attr.aria-selected]="!dueOnly()" [class]="!dueOnly() ? 'bg-brand text-brand-ink' : ''" (click)="setDue(false)">All</button>
        <button type="button" role="tab" class="rounded-full px-3 py-1" [attr.aria-selected]="dueOnly()" [class]="dueOnly() ? 'bg-brand text-brand-ink' : ''" (click)="setDue(true)">Owes money</button>
      </div>
      @if (dueOnly() && total()) {
        <span class="text-xs">Total to collect: <b>{{ totalDue() | currency: 'INR' : 'symbol' : '1.0-0' }}</b></span>
        @if (canRemindAll()) { <button type="button" class="btn btn-ghost !py-0.5" [disabled]="reminding() || !remindable()" (click)="remindAll()">{{ reminding() ? 'Sending…' : 'Email reminder to all (' + remindable() + ')' }}</button> }
      }
    </div>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    <section class="card mt-3">
      <div class="overflow-x-auto" [class.opacity-50]="loading()">
        <table class="w-full min-w-176 text-left">
          <thead>
            <tr class="text-[11px] text-ink-soft">
              <th class="py-1.5 pr-3 font-normal">Customer</th>
              <th class="py-1.5 pr-3 font-normal">Phone</th>
              <th class="py-1.5 pr-3 font-normal">Bills</th>
              <th class="py-1.5 pr-3 font-normal">Spent</th>
              <th class="py-1.5 pr-3 font-normal">Last visit</th>
              <th class="py-1.5 text-right font-normal">Owes</th>
            </tr>
          </thead>
          <tbody>
            @for (c of rows(); track c._id) {
              <tr class="border-t border-line text-xs" [class.opacity-60]="!c.isActive">
                <td class="py-2 pr-3 font-medium"><a [routerLink]="['/retail/customers', c._id]" class="underline">{{ c.name }}</a>@if (!c.isActive) { <span class="badge bg-chip ml-1">inactive</span> }</td>
                <td class="py-2 pr-3">{{ c.phone || '-' }}</td>
                <td class="py-2 pr-3">{{ c.bills }}</td>
                <td class="py-2 pr-3">{{ c.spent | currency: 'INR' : 'symbol' : '1.0-0' }}</td>
                <td class="py-2 pr-3 whitespace-nowrap">{{ c.lastVisit ? (c.lastVisit | date: 'dd MMM yyyy') : 'never' }}</td>
                <td class="py-2 text-right font-medium" [class.text-red-700]="c.owes > 0">{{ c.owes > 0 ? (c.owes | currency: 'INR' : 'symbol' : '1.0-0') : '-' }}@if (c.owes > 0 && wa(c); as link) { <a [href]="link" target="_blank" rel="noopener" class="ml-2 text-[11px] font-normal underline">WhatsApp</a> }</td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="py-8 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : dueOnly() ? 'Nobody owes you anything.' : 'No customers yet.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      <div class="mt-2 flex items-center justify-between text-xs text-ink-soft">
        <span>{{ total() }} customer{{ total() === 1 ? '' : 's' }}</span>
        <span class="flex gap-2">
          <button type="button" class="btn btn-ghost !py-0.5" [disabled]="page() <= 1" (click)="go(-1)">Previous</button>
          <button type="button" class="btn btn-ghost !py-0.5" [disabled]="page() * 20 >= total()" (click)="go(1)">Next</button>
        </span>
      </div>
    </section>

    @if (adding()) {
      <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" (click)="adding.set(false)">
        <form class="w-full max-w-md rounded-2xl bg-surface-solid p-5 shadow-xl" (click)="$event.stopPropagation()" (ngSubmit)="save()" role="dialog" aria-modal="true">
          <h2 class="text-lg font-medium">Add customer</h2>
          @if (formError()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ formError() }}</p> }
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div class="sm:col-span-2"><label class="label" for="cu-name">Name *</label><input id="cu-name" name="name" class="field" [(ngModel)]="f.name" /></div>
            <div><label class="label" for="cu-phone">Phone (10 digits)</label><input id="cu-phone" name="phone" class="field" inputmode="numeric" [(ngModel)]="f.phone" /></div>
            <div><label class="label" for="cu-limit">Udhaar limit (₹, 0 = none)</label><input id="cu-limit" name="limit" type="number" min="0" class="field" [(ngModel)]="f.creditLimit" /></div>
            <div><label class="label" for="cu-open">Already owes (₹)</label><input id="cu-open" name="open" type="number" class="field" [(ngModel)]="f.openingBalance" /></div>
            <div><label class="label" for="cu-email">Email</label><input id="cu-email" name="email" type="email" class="field" [(ngModel)]="f.email" /></div>
            <div class="sm:col-span-2"><label class="label" for="cu-addr">Address</label><input id="cu-addr" name="addr" class="field" [(ngModel)]="f.address" /></div>
            <div><label class="label" for="cu-city">City</label><input id="cu-city" name="city" class="field" [(ngModel)]="f.city" /></div>
            <div><label class="label" for="cu-pin">Pincode</label><input id="cu-pin" name="pin" class="field" inputmode="numeric" maxlength="6" [(ngModel)]="f.pincode" /></div>
            <div class="sm:col-span-2"><label class="label" for="cu-gstin">GSTIN (only for a business that gives you its GSTIN)</label><input id="cu-gstin" name="gstin" class="field uppercase" maxlength="15" [(ngModel)]="f.gstin" /><p class="mt-1 text-[11px] text-ink-soft">With a GSTIN, bills to this customer are B2B invoices that go in your GSTR-1 by name, and can have an e-invoice. The address, city and pincode are needed for that.</p></div>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="btn btn-ghost" (click)="adding.set(false)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Add customer' }}</button>
          </div>
        </form>
      </div>
    }
  `,
})
export class Customers {
  private readonly api = inject(CustomersApi);
  private readonly auth = inject(AuthService);

  protected readonly rows = signal<Customer[]>([]);
  protected readonly total = signal(0);
  protected readonly totalDue = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly dueOnly = signal(false);
  protected readonly adding = signal(false);
  protected readonly busy = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly canEdit = computed(() => this.auth.hasPermission('sales.create'));
  protected readonly canRemindAll = computed(() => this.auth.hasPermission('purchase.approve'));
  protected readonly remindable = signal(0);
  protected readonly reminding = signal(false);
  protected readonly notice = signal<string | null>(null);
  private shopName = '';
  protected f = { name: '', phone: '', email: '', address: '', city: '', pincode: '', gstin: '', creditLimit: 0, openingBalance: 0 };
  private q = '';
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.load();
  }

  protected onQ(v: string) {
    this.q = v;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.page.set(1);
      this.load();
    }, 300);
  }

  protected wa(c: Customer) {
    return whatsappReminder(this.shopName, c.name, c.phone, c.owes);
  }

  protected remindAll() {
    if (!confirm(`Send a reminder email to ${this.remindable()} customer${this.remindable() === 1 ? '' : 's'} who owe money? Anyone reminded in the last 3 days, or without an email address, is skipped.`)) return;
    this.reminding.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.api.remindAll().subscribe({
      next: (r) => {
        this.reminding.set(false);
        this.notice.set(`${r.sent} reminder${r.sent === 1 ? '' : 's'} sent. Skipped: ${r.noEmail} with no email, ${r.recent} reminded in the last 3 days${r.failed ? `. ${r.failed} could not be sent (${r.failures.join('; ')})` : ''}.`);
        this.load();
      },
      error: (e) => {
        this.reminding.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected setDue(on: boolean) {
    this.dueOnly.set(on);
    this.page.set(1);
    this.load();
  }

  protected go(d: number) {
    this.page.update((p) => p + d);
    this.load();
  }

  private load() {
    this.loading.set(true);
    this.api.list({ q: this.q, filter: this.dueOnly() ? 'due' : '', page: this.page() }).subscribe({
      next: (r) => {
        this.rows.set(r.items);
        this.total.set(r.total);
        this.totalDue.set(r.totalDue);
        this.remindable.set(r.remindable ?? 0);
        this.shopName = r.shopName ?? '';
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }

  protected openAdd() {
    this.f = { name: '', phone: '', email: '', address: '', city: '', pincode: '', gstin: '', creditLimit: 0, openingBalance: 0 };
    this.formError.set(null);
    this.adding.set(true);
  }

  protected save() {
    if (this.f.name.trim().length < 2) return this.formError.set('Enter the name.');
    this.busy.set(true);
    this.formError.set(null);
    this.api
      .create({ name: this.f.name.trim(), phone: this.f.phone.trim() || undefined, email: this.f.email.trim() || undefined, address: this.f.address.trim() || undefined, city: this.f.city.trim() || undefined, pincode: this.f.pincode.trim() || undefined, gstin: this.f.gstin.trim().toUpperCase() || undefined, creditLimit: Number(this.f.creditLimit) || 0, openingBalance: Number(this.f.openingBalance) || 0 })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.adding.set(false);
          this.load();
        },
        error: (e) => {
          this.busy.set(false);
          this.formError.set(apiError(e));
        },
      });
  }
}
