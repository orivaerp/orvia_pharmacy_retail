import { Component, input } from '@angular/core';

@Component({
  selector: 'app-logo',
  template: `
    <span class="inline-flex items-center gap-2.5">
      <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 48 48" aria-hidden="true">
        <rect width="48" height="48" rx="14" [attr.fill]="mark()" />
        <!-- pharmacy cross -->
        <path d="M20 10h8v10h10v8H28v10h-8V28H10v-8h10z" fill="#fff" />
        <!-- capsule accent -->
        <rect x="26" y="26" width="16" height="8" rx="4" transform="rotate(-35 34 30)" fill="#6de6c1" stroke="#fff" stroke-width="1.5" />
      </svg>
      <span class="text-2xl font-bold tracking-tight" [class]="font() + ' ' + text()">Orvia</span>
    </span>
  `,
})
export class Logo {
  size = input(40);
  mark = input('#067659');
  text = input('text-orvia-900');
  font = input('font-display');
}
