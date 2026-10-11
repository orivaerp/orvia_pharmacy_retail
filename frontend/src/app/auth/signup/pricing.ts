import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Logo } from '../../shared/components/logo';
import { PlanCards, PublicPlan } from './plan-cards';

/** Pricing, read live from the plan list: change a plan in the provider panel and this page changes with it. */
@Component({
  selector: 'app-pricing',
  imports: [RouterLink, Logo, PlanCards],
  template: `
    <main class="min-h-screen bg-slate-50">
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <a routerLink="/login" aria-label="Orvia"><app-logo /></a>
          <a routerLink="/login" class="text-sm font-semibold text-orvia-700 hover:text-orvia-900">Sign in</a>
        </div>
      </header>
      <div class="mx-auto max-w-5xl px-4 py-10">
        <h1 class="font-display text-3xl font-bold text-slate-900">Simple pricing for every pharmacy</h1>
        <p class="mt-1 text-sm text-slate-600">Start free, pick the plan that fits your shop, and change later. Prices are before GST.</p>
        <div class="mt-6"><app-plan-cards [plans]="plans()" [loading]="loading()" (pick)="start($event)" /></div>
        <p class="mt-4 text-xs text-slate-500">Choose a plan to start your free trial.</p>
      </div>
    </main>
  `,
})
export class Pricing implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  protected readonly plans = signal<PublicPlan[]>([]);
  protected readonly loading = signal(true);

  ngOnInit() {
    this.http.get<{ plans: PublicPlan[] }>(`${environment.apiUrl}/public/plans`).subscribe({
      next: (r) => {
        this.plans.set(r.plans);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected start(code: string) {
    this.router.navigate(['/signup'], { queryParams: { plan: code } });
  }
}
