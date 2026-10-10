import { Component, computed, inject, input } from '@angular/core';
import { ChartConfiguration } from 'chart.js';
import { ThemeService } from '../../core/services/theme.service';
import { ChartCanvas } from './chart-canvas';

export interface DonutItem {
  label: string;
  value: number;
}

/** Donut with centre total and legend. Uses theme colours --chart-1..4 (cycled). */
@Component({
  selector: 'app-donut-chart',
  imports: [ChartCanvas],
  template: `
    <div class="relative mx-auto aspect-square w-full max-w-36">
      <app-chart [config]="config()" />
      <div class="pointer-events-none absolute inset-0 grid place-content-center text-center">
        <span class="text-xs text-ink-soft">Total</span>
        <span class="text-2xl font-medium">{{ total() }}</span>
      </div>
    </div>
    <ul class="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-xs">
      @for (s of items(); track s.label; let i = $index) {
        <li class="flex items-center gap-2">
          <span class="h-2.5 w-2.5 rounded-full" [style.background]="'var(--chart-' + ((i % 4) + 1) + ')'"></span>
          {{ s.label }} <span class="text-ink-soft">{{ s.value }}%</span>
        </li>
      }
    </ul>
  `,
  host: { class: 'block' },
})
export class DonutChart {
  private readonly theme = inject(ThemeService);
  items = input.required<DonutItem[]>();
  total = input.required<string>();

  protected readonly config = computed<ChartConfiguration<'doughnut'>>(() => {
    this.theme.current();
    const v = (n: string) => this.theme.cssVar(n);
    const items = this.items();
    return {
      type: 'doughnut',
      data: {
        labels: items.map((s) => s.label),
        datasets: [
          {
            data: items.map((s) => s.value),
            backgroundColor: items.map((_, i) => v(`--chart-${(i % 4) + 1}`)),
            borderWidth: 0,
            borderRadius: 22,
            spacing: 4,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        cutout: '72%',
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: v('--brand'),
            padding: 10,
            cornerRadius: 12,
            displayColors: false,
            bodyFont: { family: v('--theme-font'), size: 12 },
            callbacks: { label: (c) => ` ${c.label}: ${c.parsed}%` },
          },
        },
      },
    };
  });
}
