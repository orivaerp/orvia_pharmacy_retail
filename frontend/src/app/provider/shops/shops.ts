import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../shared/components/icon';
import { Plan, ProviderApi, Shop, apiError } from '../provider-api.service';
import { ShopCreateDialog } from './shop-create-dialog';

export const STATUS_CLASS: Record<string, string> = {
  active: 'bg-tone-lime',
  trial: 'bg-tone-lavender',
  suspended: 'bg-tone-rose',
};

@Component({
  selector: 'app-shops',
  imports: [DatePipe, RouterLink, Icon, ShopCreateDialog],
  templateUrl: './shops.html',
})
export class Shops implements OnInit {
  private readonly api = inject(ProviderApi);

  protected readonly statusClass = STATUS_CLASS;
  protected readonly shops = signal<Shop[]>([]);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly showCreate = signal(false);

  protected q = '';
  protected status = '';
  protected planId = '';
  protected page = 1;
  protected readonly limit = 10;
  private timer?: ReturnType<typeof setTimeout>;

  ngOnInit() {
    this.api.plans().subscribe({ next: (p) => this.plans.set(p) });
    this.load();
  }

  protected get pages() {
    return Math.max(1, Math.ceil(this.total() / this.limit));
  }

  protected load() {
    this.loading.set(true);
    this.api.shops({ q: this.q.trim(), status: this.status, planId: this.planId, page: this.page, limit: this.limit }).subscribe({
      next: (res) => {
        this.shops.set(res.items);
        this.total.set(res.total);
        this.error.set(null);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(apiError(e));
        this.loading.set(false);
      },
    });
  }

  protected onSearch(value: string) {
    this.q = value;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.filtersChanged(), 300);
  }

  protected filtersChanged() {
    this.page = 1;
    this.load();
  }

  protected go(delta: number) {
    this.page = Math.min(this.pages, Math.max(1, this.page + delta));
    this.load();
  }

  protected onCreated() {
    this.showCreate.set(false);
    this.filtersChanged();
  }
}
