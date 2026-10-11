import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthShell } from '../auth-shell';
import { PlanCards, PublicPlan } from './plan-cards';

/** Pricing, read live from the plan list: change a plan in the provider panel and this page changes with it. */
@Component({
  selector: 'app-pricing',
  imports: [RouterLink, AuthShell, PlanCards],
  template: `
    <app-auth-shell [wide]="true">
      <h1>Simple pricing for every pharmacy</h1>
      <p class="au-sub">Start free, pick the plan that fits your shop, and change later. Prices are before GST. Choose a plan to start your free trial.</p>
      <app-plan-cards layout="grid" [plans]="plans()" [loading]="loading()" (pick)="start($event)" />
      <p class="au-signup">Already have an account? <a routerLink="/login">Sign in</a></p>
      <p class="au-legal">Licensed pharmacy software · Your data is encrypted and audited.</p>
    </app-auth-shell>
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
