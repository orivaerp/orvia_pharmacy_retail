import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { DonutChart } from '../../shared/components/donut-chart';
import { PillBarChart } from '../../shared/components/pill-bar-chart';
import { StatCard } from '../../shared/components/stat-card';
import { apiError } from '../../shared/utils/api';
import { OutletContext } from '../outlet-context.service';
import { DashboardData, SalesApi } from '../sales/sales-api.service';

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const rupees = (n: number) => '₹' + inr.format(Math.round(n));
const MODE_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', CREDIT: 'On credit' };
const STEPS = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 5000000];

/** Owner's home: today's numbers from real bills and stock. Follows the outlet chosen in the top bar. */
@Component({
  selector: 'app-dashboard',
  imports: [StatCard, DonutChart, PillBarChart, CurrencyPipe, DatePipe, RouterLink],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  private readonly api = inject(SalesApi);
  protected readonly auth = inject(AuthService);
  protected readonly ctx = inject(OutletContext);

  protected readonly data = signal<DashboardData | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly cards = computed(() => {
    const d = this.data();
    if (!d) return [];
    const out: { label: string; value: string; change: string; period: string; icon: string; tone: 'lime' | 'teal' | 'rose' | 'lavender'; spark: number[] }[] = [];
    if (d.sales) {
      const top = Math.max(...d.sales.week.map((w) => w.value), 1);
      const spark = d.sales.week.map((w) => Math.max(6, Math.round((w.value / top) * 100)));
      const c = d.sales.changePct;
      out.push({ label: "Today's sales", value: rupees(d.sales.today), change: c == null ? `${d.sales.billsToday} bills` : `${c > 0 ? '+' : ''}${c}%`, period: c == null ? 'today' : 'vs yesterday', icon: 'bag', tone: 'lime', spark });
      out.push({ label: 'This month', value: rupees(d.sales.month), change: `${d.sales.billsMonth} bills`, period: 'so far', icon: 'chart', tone: 'teal', spark: [] });
    }
    if (d.stock) {
      out.push({ label: 'Low or out of stock', value: String(d.stock.low + d.stock.out), change: `${d.stock.out} out`, period: `${d.stock.low} low`, icon: 'grid', tone: 'lavender', spark: [] });
      out.push({ label: 'Expiring in 30 days', value: String(d.stock.expiring30), change: d.stock.expired ? `${d.stock.expired} expired` : '', period: d.stock.expired ? 'still in stock' : '', icon: 'file', tone: 'rose', spark: [] });
    }
    return out;
  });

  protected readonly split = computed(() => {
    const by = this.data()?.sales?.byMode ?? [];
    const sum = by.reduce((s, m) => s + m.value, 0);
    return sum > 0 ? by.map((m) => ({ label: MODE_LABEL[m.mode] ?? m.mode, value: Math.round((m.value / sum) * 100) })) : [];
  });
  protected readonly splitTotal = computed(() => rupees((this.data()?.sales?.byMode ?? []).reduce((s, m) => s + m.value, 0)));

  protected readonly week = computed(() => {
    const w = this.data()?.sales?.week ?? [];
    const top = Math.max(...w.map((x) => x.value), 1);
    const step = STEPS.find((s) => s * 4 >= top) ?? Math.ceil(top / 4);
    return { labels: w.map((x) => x.label), values: w.map((x) => Math.max(0, x.value)), max: step * 4, step };
  });

  protected readonly tick = (n: number) => (n >= 1000 ? `${n / 1000}K` : String(n));
  protected readonly modeLabel = (m: string) => MODE_LABEL[m] ?? m;

  constructor() {
    this.ctx.load();
    effect(() => {
      const outlet = this.ctx.selected();
      untracked(() => this.load(outlet));
    });
  }

  private load(outlet: string) {
    this.loading.set(true);
    this.api.dashboard(outlet).subscribe({
      next: (d) => {
        this.data.set(d);
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
