import { Component, computed, inject, input } from '@angular/core';
import { ChartConfiguration, Plugin } from 'chart.js';
import { ThemeService } from '../../core/services/theme.service';
import { ChartCanvas } from './chart-canvas';

/** Diagonal-hatch fill, like the striped pill bars in the design. */
function hatch(color: string): CanvasPattern | string {
  const size = 10;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return color;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgb(255 255 255 / 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-2, size + 2);
  ctx.lineTo(size + 2, -2);
  ctx.stroke();
  return ctx.createPattern(c, 'repeat') ?? color;
}

const inr = new Intl.NumberFormat('en-IN');

/** Striped pill bars over a capacity track. Colours come from theme vars --bar-1..7. */
@Component({
  selector: 'app-pill-bar-chart',
  imports: [ChartCanvas],
  template: '<div class="h-48"><app-chart [config]="config()" /></div>',
  host: { class: 'block' },
})
export class PillBarChart {
  private readonly theme = inject(ThemeService);

  labels = input.required<string[]>();
  values = input.required<number[]>();
  max = input.required<number>();
  step = input(5000);
  /** y-axis tick text */
  formatTick = input<(n: number) => string>((n) => `${n / 1000}K`);
  /** tooltip value text */
  formatValue = input<(n: number) => string>((n) => '₹' + inr.format(n));
  tooltipTitle = input('This week');

  protected readonly config = computed<ChartConfiguration<'bar'>>(() => {
    this.theme.current();
    const v = (n: string) => this.theme.cssVar(n);
    const labels = this.labels();
    const max = this.max();
    const fmtTick = this.formatTick();
    const fmtValue = this.formatValue();
    const title = this.tooltipTitle();
    const colors = labels.map((_, i) => v(`--bar-${(i % 7) + 1}`));
    const font = { family: v('--theme-font'), size: 11 };

    // circle marker at the top of each value bar
    const dots: Plugin<'bar'> = {
      id: 'barDots',
      afterDatasetsDraw: (chart) => {
        const ctx = chart.ctx;
        chart.getDatasetMeta(1).data.forEach((bar, i) => {
          if (!chart.data.datasets[1].data[i]) return; // no marker on empty bars
          ctx.save();
          ctx.beginPath();
          ctx.arc(bar.x, bar.y + 1, 4, 0, Math.PI * 2);
          ctx.fillStyle = colors[i];
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgb(255 255 255 / 0.9)';
          ctx.stroke();
          ctx.restore();
        });
      },
    };

    const bar = { borderRadius: 999, borderSkipped: false as const, grouped: false, barPercentage: 0.45, categoryPercentage: 1 };

    return {
      type: 'bar',
      plugins: [dots],
      data: {
        labels,
        datasets: [
          { ...bar, label: 'Capacity', data: labels.map(() => max), backgroundColor: v('--bar-track'), order: 2 },
          { ...bar, label: 'Value', data: this.values(), backgroundColor: colors.map(hatch), order: 1 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        layout: { padding: { top: 8 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => item.datasetIndex === 1,
            backgroundColor: v('--brand'),
            titleColor: 'rgb(255 255 255 / 0.7)',
            bodyColor: '#fff',
            titleFont: font,
            bodyFont: { ...font, size: 16, weight: 500 },
            padding: 10,
            cornerRadius: 16,
            displayColors: false,
            callbacks: {
              title: (items) => `${title} · ${items[0].label}`,
              label: (c) => fmtValue(c.parsed.y ?? 0),
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: v('--ink-soft'), font, padding: 4 } },
          y: {
            min: 0,
            max,
            grid: { color: v('--line'), tickBorderDash: [4, 4] },
            border: { display: false, dash: [4, 4] },
            ticks: { color: v('--ink-soft'), font, stepSize: this.step(), callback: (t) => fmtTick(+t), padding: 8 },
          },
        },
      },
    };
  });
}
