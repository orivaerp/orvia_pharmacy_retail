import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { DonutChart } from '../../shared/components/donut-chart';
import { PillBarChart } from '../../shared/components/pill-bar-chart';
import { StatCard } from '../../shared/components/stat-card';
import { DashboardStats, ProviderApi, apiError } from '../provider-api.service';
import { STATUS_CLASS } from '../shops/shops';

@Component({
  selector: 'app-provider-dashboard',
  imports: [StatCard, DonutChart, PillBarChart, DatePipe, RouterLink],
  templateUrl: './dashboard.html',
})
export class ProviderDashboard implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ProviderApi);

  protected readonly statusClass = STATUS_CLASS;
  protected readonly stats = signal<DashboardStats | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly cards = computed(() => {
    const t = this.stats()?.totals;
    if (!t) return [];
    // daily sign-ups over the last 7 days, scaled to 0-100 for the card's mini bars
    const daily = this.stats()!.signups.values;
    const max = Math.max(...daily, 1);
    return [
      { label: 'Total Shops', value: String(t.shops), note: `${t.outlets} active outlet${t.outlets === 1 ? '' : 's'}`, icon: 'bag', tone: 'lime' as const, spark: daily.map((v) => Math.max(8, Math.round((v / max) * 100))) },
      { label: 'Active Shops', value: String(t.active), note: '', icon: 'card', tone: 'teal' as const, spark: [] as number[] },
      { label: 'On Trial', value: String(t.trial), note: t.trialsEnding ? `${t.trialsEnding} ending in 7 days` : '', icon: 'calendar', tone: 'rose' as const, spark: [] as number[] },
      { label: 'Monthly Revenue', value: '₹' + new Intl.NumberFormat('en-IN').format(t.mrr), note: 'paying shops only', icon: 'chart', tone: 'lavender' as const, spark: [] as number[] },
    ];
  });

  protected readonly max = computed(() => Math.max(4, ...(this.stats()?.signups.values ?? [0])));

  protected readonly count = (n: number) => String(n);
  protected readonly shopsLabel = (n: number) => `${n} new shop${n === 1 ? '' : 's'}`;

  ngOnInit() {
    this.api.stats().subscribe({
      next: (s) => this.stats.set(s),
      error: (e) => this.error.set(apiError(e)),
    });
  }
}
