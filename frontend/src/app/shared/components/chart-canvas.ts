import { Component, ElementRef, OnDestroy, effect, input, viewChild } from '@angular/core';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  ChartConfiguration,
  DoughnutController,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

// Register only what the app uses to keep the bundle small. Add controllers here as new chart types appear.
Chart.register(
  ArcElement, BarController, BarElement, DoughnutController, LineController, LineElement,
  PointElement, CategoryScale, LinearScale, Tooltip, Legend,
);

/** Thin Angular wrapper: pass a Chart.js config (usually a computed signal); the chart is rebuilt when it changes. */
@Component({
  selector: 'app-chart',
  template: '<canvas #canvas></canvas>',
  host: { class: 'relative block h-full w-full' },
})
export class ChartCanvas implements OnDestroy {
  readonly config = input.required<ChartConfiguration>();
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart;

  constructor() {
    effect(() => {
      const el = this.canvas()?.nativeElement;
      const cfg = this.config();
      if (!el) return;
      this.chart?.destroy();
      this.chart = new Chart(el, cfg);
    });
  }

  ngOnDestroy() {
    this.chart?.destroy();
  }
}
