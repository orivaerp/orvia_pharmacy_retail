import { Routes } from '@angular/router';
import { permissionGuard, setup2faGuard } from '../core/guards/auth.guard';
import { AppShell } from '../layouts/app-shell';
import { PROVIDER_NAV } from './provider.nav';

// Service provider (platform admin) area. Add feature pages (tenants, plans, ...) as children below.
export const PROVIDER_ROUTES: Routes = [
  {
    path: '',
    component: AppShell,
    data: { nav: PROVIDER_NAV },
    canActivateChild: [setup2faGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./dashboard/dashboard').then((m) => m.ProviderDashboard),
        title: 'Platform overview | Orvia',
      },
      {
        path: 'shops',
        loadComponent: () => import('./shops/shops').then((m) => m.Shops),
        title: 'Shops | Orvia',
      },
      {
        path: 'shops/:id',
        loadComponent: () => import('./shops/shop-detail').then((m) => m.ShopDetailPage),
        title: 'Shop | Orvia',
      },
      {
        path: 'shops/:id/support/:sid',
        loadComponent: () => import('./shops/support-view').then((m) => m.SupportView),
        title: 'Support view | Orvia',
      },
      {
        path: 'plans',
        loadComponent: () => import('./plans/plans').then((m) => m.Plans),
        title: 'Plans | Orvia',
      },
      {
        path: 'billing',
        canActivate: [permissionGuard('billing.admin')],
        loadComponent: () => import('./billing/billing-admin').then((m) => m.BillingAdmin),
        title: 'Billing | Orvia',
      },
      {
        path: 'outlet-requests',
        loadComponent: () => import('./outlets/outlet-requests').then((m) => m.OutletRequests),
        title: 'Outlet requests | Orvia',
      },
      {
        path: 'medicines',
        loadComponent: () => import('./medicines/medicines').then((m) => m.Medicines),
        title: 'Medicine Master | Orvia',
      },
      {
        path: 'platform-users',
        canActivate: [permissionGuard('platform.users.manage')],
        loadComponent: () => import('./team/platform-users').then((m) => m.PlatformUsers),
        title: 'Platform users | Orvia',
      },
      {
        path: 'email',
        canActivate: [permissionGuard('platform.users.manage')],
        loadComponent: () => import('./email/email-settings').then((m) => m.EmailSettings),
        title: 'Email | Orvia',
      },
      {
        path: 'security',
        loadComponent: () => import('../shared/pages/security').then((m) => m.Security),
        title: 'Security | Orvia',
      },
      {
        path: 'audit-log',
        canActivate: [permissionGuard('audit.view')],
        loadComponent: () => import('./audit/audit-log').then((m) => m.AuditLog),
        title: 'Audit log | Orvia',
      },
      {
        path: 'medicine-requests',
        loadComponent: () => import('./medicines/requests').then((m) => m.MedicineRequests),
        title: 'Shop requests | Orvia',
      },
    ],
  },
];
