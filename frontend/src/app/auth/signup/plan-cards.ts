import { Component, input, output } from '@angular/core';
import { CurrencyPipe } from '@angular/common';

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

/** The plans side by side. Nothing here is typed in by hand: prices, limits, features and trial days all come from the plan list. */
@Component({
  selector: 'app-plan-cards',
  imports: [CurrencyPipe],
  template: `
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Choose a plan">
      @for (p of plans(); track p.code) {
        <button type="button" role="radio" [attr.aria-checked]="selected() === p.code" (click)="pick.emit(p.code)"
          class="flex flex-col rounded-2xl border bg-white p-4 text-left transition focus:ring-4 focus:ring-orvia-200 focus:outline-none"
          [class]="selected() === p.code ? 'border-orvia-600 ring-2 ring-orvia-600' : 'border-slate-200 hover:border-orvia-300'">
          <span class="flex items-start justify-between gap-2">
            <span class="text-base font-semibold text-slate-900">{{ p.name }}</span>
            @if (p.trialDays > 0) { <span class="rounded-full bg-orvia-50 px-2 py-0.5 text-[11px] font-medium text-orvia-800">{{ p.trialDays }} days free</span> }
          </span>
          @if (p.tagline) { <span class="mt-0.5 text-xs text-slate-500">{{ p.tagline }}</span> }
          <span class="mt-3 text-2xl font-semibold text-slate-900">
            @if (p.price > 0) { {{ p.price | currency: 'INR' : 'symbol' : '1.0-0' }}<span class="text-xs font-normal text-slate-500"> / {{ p.cycle === 'yearly' ? 'year' : 'month' }} + {{ p.gstPercent }}% GST</span> } @else { Free }
          </span>
          <span class="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-xs text-slate-600">
            <span>Outlets</span><span class="font-medium text-slate-800">{{ limit(p.maxOutlets) }}</span>
            <span>Staff logins</span><span class="font-medium text-slate-800">{{ limit(p.maxUsers) }}</span>
            <span>Products</span><span class="font-medium text-slate-800">{{ limit(p.maxProducts) }}</span>
            <span>Bills per month</span><span class="font-medium text-slate-800">{{ limit(p.maxBillsPerMonth) }}</span>
          </span>
          <span class="mt-3 flex flex-wrap gap-1">
            @for (f of p.features; track f) { <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">{{ label(f) }}</span> }
          </span>
        </button>
      } @empty {
        <p class="text-sm text-slate-500">{{ loading() ? 'Loading plans…' : 'No plans are open for sign-up right now. Please contact us.' }}</p>
      }
    </div>
  `,
})
export class PlanCards {
  readonly plans = input.required<PublicPlan[]>();
  readonly selected = input<string>('');
  readonly loading = input(false);
  readonly pick = output<string>();

  protected limit(n: number | null) {
    return n === null || n === undefined ? 'Unlimited' : String(n);
  }
  protected label(f: string) {
    return FEATURE_LABELS[f] ?? f;
  }
}
