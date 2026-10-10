import { HttpClient, HttpParams } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { apiError } from '../../shared/utils/api';

interface Item {
  _id: string;
  at: string;
  area: string;
  action: string;
  text: string;
  who: { name: string; role: string; orvia: boolean } | null;
  ip: string | null;
}
interface Listing {
  items: Item[];
  total: number;
  page: number;
  limit: number;
  areas: Record<string, string>;
}
interface Person {
  _id: string;
  name: string;
  role: string;
  isActive: boolean;
}

const AREA_CLASS: Record<string, string> = { bills: 'bg-tone-lime', stock: 'bg-tone-lavender', purchases: 'bg-tone-teal', products: 'bg-chip', money: 'bg-tone-rose', people: 'bg-chip', settings: 'bg-chip', security: 'bg-tone-lavender' };
const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

/** Who did what in the shop: bills, stock, money, staff, settings and sign-ins, newest first. Only the owner sees this. */
@Component({
  selector: 'app-activity',
  imports: [FormsModule, DatePipe],
  template: `
    <h1 class="text-xl font-medium tracking-tight sm:text-2xl">Activity</h1>
    <p class="mt-0.5 text-xs text-ink-soft">Who did what in your shop. Everything is written down as it happens and nobody, not even you, can change or remove it.</p>

    @if (error()) { <p role="alert" class="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{{ error() }}</p> }

    <div class="mt-3 flex flex-wrap items-end gap-2">
      <div><label class="label" for="a-from">From</label><input id="a-from" type="date" class="field !py-1" [value]="from()" (change)="from.set($any($event.target).value); reset()" /></div>
      <div><label class="label" for="a-to">To</label><input id="a-to" type="date" class="field !py-1" [value]="to()" (change)="to.set($any($event.target).value); reset()" /></div>
      <div>
        <label class="label" for="a-area">What</label>
        <select id="a-area" class="field !py-1" [ngModel]="area()" (ngModelChange)="area.set($event); reset()">
          <option value="">Everything</option>
          @for (a of areaList(); track a[0]) { <option [value]="a[0]">{{ a[1] }}</option> }
        </select>
      </div>
      <div>
        <label class="label" for="a-who">Who</label>
        <select id="a-who" class="field !py-1" [ngModel]="who()" (ngModelChange)="who.set($event); reset()">
          <option value="">Everyone</option>
          @for (p of people(); track p._id) { <option [value]="p._id">{{ p.name }} ({{ role(p.role) }}){{ p.isActive ? '' : ' - switched off' }}</option> }
        </select>
      </div>
      <button type="button" class="btn btn-ghost !py-1" (click)="lastDays(1)">Today</button>
      <button type="button" class="btn btn-ghost !py-1" (click)="lastDays(7)">Last 7 days</button>
      <button type="button" class="btn btn-ghost !py-1" (click)="lastDays(30)">Last 30 days</button>
    </div>

    <section class="card mt-3">
      <div class="overflow-x-auto" [class.opacity-50]="loading()">
        <table class="w-full min-w-136 text-left">
          <thead><tr class="text-[11px] text-ink-soft"><th class="py-1.5 pr-3 font-normal">When</th><th class="py-1.5 pr-3 font-normal">Who</th><th class="py-1.5 pr-3 font-normal">What</th></tr></thead>
          <tbody>
            @for (i of items(); track i._id) {
              <tr class="border-t border-line align-top text-xs">
                <td class="py-2 pr-3 whitespace-nowrap">{{ i.at | date: 'dd MMM, HH:mm' }}</td>
                <td class="py-2 pr-3">
                  @if (i.who) {
                    <span class="font-medium">{{ i.who.orvia ? 'Orvia team' : i.who.name }}</span>
                    <span class="block text-[11px] text-ink-soft">{{ i.who.orvia ? i.who.name : role(i.who.role) }}</span>
                  } @else { <span class="text-ink-soft">-</span> }
                </td>
                <td class="py-2 pr-3">
                  <span class="badge mr-1.5" [class]="areaClass(i.area)">{{ areaName(i.area) }}</span>{{ i.text }}
                  @if (i.ip) { <span class="text-[11px] text-ink-soft"> · from {{ i.ip }}</span> }
                </td>
              </tr>
            } @empty { <tr><td colspan="3" class="py-8 text-center text-xs text-ink-soft">{{ loading() ? 'Loading…' : 'Nothing was done in this period.' }}</td></tr> }
          </tbody>
        </table>
      </div>
      <div class="mt-2 flex items-center justify-between text-xs text-ink-soft">
        <span>{{ total() }} event{{ total() === 1 ? '' : 's' }}</span>
        <span class="flex gap-2">
          <button type="button" class="btn btn-ghost !py-0.5" [disabled]="page() <= 1" (click)="go(-1)">Newer</button>
          <button type="button" class="btn btn-ghost !py-0.5" [disabled]="page() * limit >= total()" (click)="go(1)">Older</button>
        </span>
      </div>
    </section>
  `,
})
export class Activity {
  private readonly http = inject(HttpClient);
  protected readonly limit = 50;

  protected readonly items = signal<Item[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly areas = signal<Record<string, string>>({});
  protected readonly areaList = computed(() => Object.entries(this.areas()));
  protected readonly people = signal<Person[]>([]);
  protected readonly from = signal(day(new Date(Date.now() - 6 * 86_400_000)));
  protected readonly to = signal(day(new Date()));
  protected readonly area = signal('');
  protected readonly who = signal('');

  constructor() {
    this.http.get<Person[]>(`${environment.apiUrl}/users`).subscribe({ next: (p) => this.people.set(p), error: () => this.people.set([]) });
    this.load();
  }

  protected role(r: string) {
    return r.replace(/_/g, ' ');
  }
  protected areaName(a: string) {
    return this.areas()[a] ?? a;
  }
  protected areaClass(a: string) {
    return AREA_CLASS[a] ?? 'bg-chip';
  }

  protected lastDays(n: number) {
    this.from.set(day(new Date(Date.now() - (n - 1) * 86_400_000)));
    this.to.set(day(new Date()));
    this.reset();
  }

  protected reset() {
    this.page.set(1);
    this.load();
  }

  protected go(d: number) {
    this.page.update((p) => p + d);
    this.load();
  }

  private load() {
    this.loading.set(true);
    let params = new HttpParams().set('page', this.page()).set('limit', this.limit);
    if (this.from()) params = params.set('from', this.from());
    if (this.to()) params = params.set('to', this.to());
    if (this.area()) params = params.set('area', this.area());
    if (this.who()) params = params.set('userId', this.who());
    this.http.get<Listing>(`${environment.apiUrl}/activity`, { params }).subscribe({
      next: (r) => {
        this.items.set(r.items);
        this.total.set(r.total);
        this.areas.set(r.areas);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }
}
