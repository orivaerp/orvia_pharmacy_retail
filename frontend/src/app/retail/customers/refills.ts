import { HttpClient, HttpParams } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { apiError } from '../../shared/utils/api';

interface Item {
  productId: string;
  name: string;
  due: string;
  boughtOn: string;
  bill: string;
  daysLeft: number;
}
interface Due {
  customerId: string;
  name: string;
  phone: string;
  email: string;
  lastRemindedAt: string | null;
  canEmail: boolean;
  items: Item[];
}
interface Listing {
  items: Due[];
  total: number;
  emailable: number;
  shopName: string;
  shopPhone: string;
  remindEveryDays: number;
}

const when = (n: number) => (n > 1 ? `runs out in ${n} days` : n === 1 ? 'runs out tomorrow' : n === 0 ? 'runs out today' : n === -1 ? 'ran out yesterday' : `ran out ${-n} days ago`);

/** Regular customers whose medicines are running out: who, which medicine, and how long is left. Remind them on WhatsApp or by email. */
@Component({
  selector: 'app-refills',
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Refills</h1>
        <p class="mt-0.5 text-xs text-ink-soft">Customers whose regular medicines are about to run out, worked out from what they bought last time. A reminder brings them back before they miss a dose.</p>
      </div>
      @if (canAll() && emailable()) { <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="remindAll()">Email reminder to all ({{ emailable() }})</button> }
    </div>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }
    @if (notice()) { <p class="mt-3 rounded-xl bg-tone-lime px-3 py-2 text-xs">{{ notice() }}</p> }

    <div class="mt-3 flex flex-wrap items-end gap-2">
      <div>
        <label class="label" for="r-ahead">Running out within</label>
        <select id="r-ahead" class="field !py-1" [ngModel]="ahead()" (ngModelChange)="ahead.set(+$event); load()">
          <option [ngValue]="3">3 days</option><option [ngValue]="7">7 days</option><option [ngValue]="14">14 days</option><option [ngValue]="30">30 days</option>
        </select>
      </div>
      <div>
        <label class="label" for="r-late">Already out for up to</label>
        <select id="r-late" class="field !py-1" [ngModel]="late()" (ngModelChange)="late.set(+$event); load()">
          <option [ngValue]="7">7 days</option><option [ngValue]="30">30 days</option><option [ngValue]="90">90 days</option>
        </select>
      </div>
    </div>

    <section class="mt-3 grid gap-2" [class.opacity-50]="loading()">
      @for (c of items(); track c.customerId) {
        <div class="card">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <a [routerLink]="['/retail/customers', c.customerId]" class="text-sm font-medium underline">{{ c.name }}</a>
              <span class="ml-2 text-xs text-ink-soft">{{ c.phone || 'no phone' }}</span>
              @if (c.lastRemindedAt) { <p class="text-[11px] text-ink-soft">Last reminded {{ c.lastRemindedAt | date: 'dd MMM' }}</p> }
            </div>
            <div class="flex flex-wrap gap-1.5">
              @if (c.phone) { <button type="button" class="btn btn-primary !py-0.5" (click)="whatsapp(c)">WhatsApp reminder</button> }
              <button type="button" class="btn btn-ghost !py-0.5" [disabled]="busy() || !c.email || !c.canEmail" [attr.title]="!c.email ? 'No email address for this customer' : !c.canEmail ? 'Already emailed this week' : null" (click)="email(c)">Email reminder</button>
            </div>
          </div>
          <ul class="mt-2 divide-y divide-line text-xs">
            @for (i of c.items; track i.productId) {
              <li class="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span><b>{{ i.name }}</b>{{ ' ' }}<span [class]="i.daysLeft < 0 ? 'text-red-700' : ''">{{ when(i.daysLeft) }}</span>{{ ' ' }}<span class="text-ink-soft">(bought {{ i.boughtOn | date: 'dd MMM' }}, bill {{ i.bill }})</span></span>
                <button type="button" class="text-[11px] underline" [disabled]="busy()" (click)="dismiss(c, i)">Not needed</button>
              </li>
            }
          </ul>
        </div>
      } @empty {
        <div class="card text-xs">
          @if (loading()) { Loading… } @else {
            <p>Nobody is due for a refill in this period.</p>
            <p class="mt-1 text-ink-soft">To start, open <a routerLink="/retail/products" class="underline">Products</a>, press Edit on a regular medicine (sugar, BP, thyroid) and fill “Refill reminder: days one pack lasts”. It works on bills you made earlier too, as long as the customer was on the bill.</p>
          }
        </div>
      }
    </section>
  `,
})
export class Refills {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly url = `${environment.apiUrl}/refills`;

  protected readonly items = signal<Due[]>([]);
  protected readonly emailable = signal(0);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly ahead = signal(7);
  protected readonly late = signal(30);
  protected readonly canAll = computed(() => this.auth.hasPermission('purchase.approve'));
  private shop = { name: '', phone: '' };

  constructor() {
    this.load();
  }

  protected when = when;

  private params() {
    return new HttpParams().set('ahead', this.ahead()).set('late', this.late());
  }

  protected load() {
    this.loading.set(true);
    this.http.get<Listing>(this.url, { params: this.params() }).subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.emailable.set(r.emailable);
        this.shop = { name: r.shopName, phone: r.shopPhone };
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }

  /** Opens WhatsApp with the message typed (the owner presses send there), and notes that this customer was reminded. */
  protected whatsapp(c: Due) {
    const list = c.items.map((i) => `${i.name} (${when(i.daysLeft)})`).join(', ');
    const text = [`Hello ${c.name}, this is ${this.shop.name || 'your pharmacy'}.`, `From what you bought last time, your medicines may be finishing: ${list}.`, this.shop.phone ? `Please call ${this.shop.phone} or visit us to refill, so you do not miss a dose.` : 'Please visit us to refill, so you do not miss a dose.', 'If you have already refilled, please ignore this message.'].join('\n');
    const phone = c.phone.replace(/\D/g, '').slice(-10);
    window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    this.http.post(`${this.url}/${c.customerId}/remind`, { channel: 'whatsapp' }, { params: this.params() }).subscribe({ next: () => this.load(), error: (e) => this.error.set(apiError(e)) });
  }

  protected email(c: Due) {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.http.post<{ sentTo: string }>(`${this.url}/${c.customerId}/remind`, { channel: 'email' }, { params: this.params() }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.notice.set(`Reminder emailed to ${r.sentTo}. Replies come to your email.`);
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected remindAll() {
    if (!confirm(`Send a refill reminder email to ${this.emailable()} customer${this.emailable() === 1 ? '' : 's'}? Anyone reminded in the last 7 days, or without an email address, is skipped.`)) return;
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    this.http.post<{ sent: number; noEmail: number; recent: number; failed: number; failures: string[] }>(`${this.url}/remind-all`, {}, { params: this.params() }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.notice.set(`${r.sent} reminder${r.sent === 1 ? '' : 's'} sent. Skipped: ${r.noEmail} with no email, ${r.recent} reminded this week${r.failed ? `. ${r.failed} could not be sent (${r.failures.join('; ')})` : ''}.`);
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }

  protected dismiss(c: Due, i: Item) {
    if (!confirm(`Stop reminding ${c.name} about ${i.name}? It comes back only if they buy it again.`)) return;
    this.busy.set(true);
    this.http.post(`${this.url}/dismiss`, { customerId: c.customerId, productId: i.productId, boughtOn: i.boughtOn }).subscribe({
      next: () => {
        this.busy.set(false);
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(apiError(e));
      },
    });
  }
}
