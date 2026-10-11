import { CurrencyPipe } from '@angular/common';
import { Component, ViewEncapsulation, input, output } from '@angular/core';

/** A plan as the public list gives it. The provider edits plans; this page only shows what the server sends. */
export interface PublicPlan {
  code: string;
  name: string;
  tagline: string;
  price: number;
  cycle: 'monthly' | 'yearly';
  gstPercent: number;
  trialDays: number;
  maxOutlets: number | null;
  maxUsers: number | null;
  maxProducts: number | null;
  maxBillsPerMonth: number | null;
  features: string[];
}

const FEATURE_LABELS: Record<string, string> = {
  barcodeBilling: 'Barcode billing',
  multiOutlet: 'Several outlets',
  onlinePayments: 'UPI and online payments',
  gstReports: 'GST reports',
  apiAccess: 'API access',
};

/**
 * The plans to choose from. Nothing here is typed in by hand: prices, limits, features and trial days all come from the plan list.
 * `list` stacks them (for the narrow form column), `grid` lays them side by side (for the pricing page). Colours come from the app theme.
 */
@Component({
  selector: 'app-plan-cards',
  imports: [CurrencyPipe],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="au-plans" [class.au-plans-grid]="layout() === 'grid'" role="radiogroup" aria-label="Choose a plan">
      @for (p of plans(); track p.code) {
        <button type="button" role="radio" class="au-plan" [class.on]="selected() === p.code" [attr.aria-checked]="selected() === p.code" (click)="pick.emit(p.code)">
          <span class="au-plan-head">
            <span class="au-plan-dot" aria-hidden="true"></span>
            <b>{{ p.name }}</b>
            @if (p.trialDays > 0) { <span class="au-plan-trial">{{ p.trialDays }} days free</span> }
            <span class="au-plan-price">
              @if (p.price > 0) { {{ p.price | currency: 'INR' : 'symbol' : '1.0-0' }}<small> / {{ p.cycle === 'yearly' ? 'yr' : 'mo' }} + {{ p.gstPercent }}% GST</small> } @else { Free }
            </span>
          </span>
          @if (p.tagline) { <span class="au-plan-tag">{{ p.tagline }}</span> }
          <span class="au-plan-meta">{{ limit(p.maxOutlets, 'outlet') }} · {{ limit(p.maxUsers, 'staff login') }} · {{ limit(p.maxProducts, 'product') }} · {{ limit(p.maxBillsPerMonth, 'bill') }}{{ p.maxBillsPerMonth === null ? '' : ' a month' }}</span>
          @if (p.features.length) {
            <span class="au-plan-feats">@for (f of p.features; track f) { <span>{{ label(f) }}</span> }</span>
          }
        </button>
      } @empty {
        <p class="au-plans-empty">{{ loading() ? 'Loading plans…' : 'No plans are open for sign-up right now. Please contact us.' }}</p>
      }
    </div>
  `,
  styles: `
    .au-plans { display: grid; gap: 10px; margin-bottom: 18px; }
    .au-plans-grid { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); margin-bottom: 0; }
    .au-plan { display: flex; flex-direction: column; gap: 4px; text-align: left; width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: 14px; background: var(--field); color: var(--ink); font: inherit; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s; }
    .au-plan:hover { border-color: var(--brand); }
    .au-plan:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
    .au-plan.on { border-color: var(--brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone-teal) 55%, transparent); }
    .au-plan-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 15px; }
    .au-plan-dot { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--line); flex: none; }
    .au-plan.on .au-plan-dot { border-color: var(--brand); background: radial-gradient(var(--brand) 45%, transparent 50%); }
    .au-plan-trial { font-size: 11.5px; font-weight: 500; padding: 2px 8px; border-radius: 999px; background: var(--tone-lime); color: #0b2f2e; }
    .au-plan-price { margin-left: auto; font-weight: 600; white-space: nowrap; }
    .au-plan-price small { font-size: 11.5px; font-weight: 400; color: var(--ink-soft); }
    .au-plan-tag { font-size: 12.5px; color: var(--ink-soft); padding-left: 24px; }
    .au-plan-meta { font-size: 12px; color: var(--ink-soft); padding-left: 24px; }
    .au-plan-feats { display: flex; flex-wrap: wrap; gap: 5px; padding-left: 24px; margin-top: 2px; }
    .au-plan-feats span { font-size: 11.5px; padding: 2px 8px; border-radius: 999px; background: var(--chip); }
    .au-plans-empty { font-size: 14px; color: var(--ink-soft); margin: 0; }
    @media (max-width: 560px) { .au-plan-price { margin-left: 24px; width: 100%; } }
  `,
})
export class PlanCards {
  readonly plans = input.required<PublicPlan[]>();
  readonly selected = input<string>('');
  readonly loading = input(false);
  readonly layout = input<'list' | 'grid'>('list');
  readonly pick = output<string>();

  protected limit(n: number | null, noun: string) {
    return n === null || n === undefined ? `Unlimited ${noun}s` : `${n} ${noun}${n === 1 ? '' : 's'}`;
  }
  protected label(f: string) {
    return FEATURE_LABELS[f] ?? f;
  }
}
