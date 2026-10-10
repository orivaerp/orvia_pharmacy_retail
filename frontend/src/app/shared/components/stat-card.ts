import { Component, computed, input } from '@angular/core';
import { Icon } from './icon';

export type Tone = 'lime' | 'teal' | 'rose' | 'lavender';

const TONES: Record<Tone, string> = {
  lime: 'bg-tone-lime',
  teal: 'bg-tone-teal',
  rose: 'bg-tone-rose',
  lavender: 'bg-tone-lavender',
};

/** Coloured KPI card with a mini bar sparkline (heights are percentages, last/highest bar is highlighted). */
@Component({
  selector: 'app-stat-card',
  imports: [Icon],
  template: `
    <article class="relative overflow-hidden rounded-xl p-3 text-ink" [class]="toneClass()">
      <div class="flex items-center justify-between">
        <span class="grid h-6 w-6 place-items-center rounded-full bg-white/40"><app-icon [name]="icon()" [size]="14" /></span>
        <span class="grid h-6 w-6 place-items-center rounded-full border border-black/10 bg-white/40"><app-icon name="dots" [size]="14" /></span>
      </div>
      <p class="mt-2 text-xs text-ink/60">{{ label() }}</p>
      <div class="mt-1 flex items-end justify-between gap-3">
        <div>
          <p class="text-xl font-medium tracking-tight whitespace-nowrap">{{ value() }}</p>
          @if (change()) { <p class="mt-0.5 text-[11px] whitespace-nowrap"><span class="font-medium">{{ change() }}</span> <span class="ml-1 text-ink/60">{{ period() }}</span></p> }
        </div>
        <div class="flex h-9 items-end gap-0.5" aria-hidden="true">
          @for (h of spark(); track $index; let last = $last) {
            <span class="w-1.5 rounded-full" [style.height.%]="h"
              [class]="last || h === 100 ? 'bg-linear-to-b from-brand to-brand/30' : 'bg-white/45'"></span>
          }
        </div>
      </div>
    </article>
  `,
  host: { class: 'block' },
})
export class StatCard {
  label = input.required<string>();
  value = input.required<string>();
  change = input('');
  period = input('This Month');
  icon = input('bag');
  tone = input<Tone>('lime');
  spark = input<number[]>([]);
  protected readonly toneClass = computed(() => TONES[this.tone()]);
}
