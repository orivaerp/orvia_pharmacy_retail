import { Routes } from '@angular/router';
import { guestGuard, homeRedirect, scopeGuard } from './core/guards/auth.guard';

// Three top-level areas, each lazy-loaded and independent:
//   auth/      sign-in
//   provider/  service provider (platform admin) - platform staff only
//   retail/    retail pharmacy shop - tenant staff only
export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./auth/login/login').then((m) => m.Login),
    title: 'Sign in | Orvia',
  },
  {
    path: 'signup',
    canActivate: [guestGuard],
    loadComponent: () => import('./auth/signup/signup').then((m) => m.Signup),
    title: 'Start your free trial | Orvia',
  },
  {
    path: 'pricing',
    loadComponent: () => import('./auth/signup/pricing').then((m) => m.Pricing),
    title: 'Pricing | Orvia',
  },
  {
    path: 'terms',
    loadComponent: () => import('./legal/legal-pages').then((m) => m.Terms),
    title: 'Terms of use | Orvia',
  },
  {
    path: 'privacy',
    loadComponent: () => import('./legal/legal-pages').then((m) => m.Privacy),
    title: 'Privacy policy | Orvia',
  },
  {
    path: 'forgot-password',
    canActivate: [guestGuard],
    loadComponent: () => import('./auth/forgot-password/forgot-password').then((m) => m.ForgotPassword),
    title: 'Forgot password | Orvia',
  },
  {
    path: 'accept-invite',
    loadComponent: () => import('./auth/accept-invite/accept-invite').then((m) => m.AcceptInvite),
    title: 'Set your password | Orvia',
  },
  {
    // the page a customer opens from a WhatsApp link: no sign-in, the secret in the address is the key
    path: 'bill/:token',
    loadComponent: () => import('./shared/pages/public-bill').then((m) => m.PublicBill),
    title: 'Your bill',
  },
  {
    path: 'provider',
    canActivate: [scopeGuard('platform')],
    loadChildren: () => import('./provider/provider.routes').then((m) => m.PROVIDER_ROUTES),
  },
  {
    path: 'retail',
    canActivate: [scopeGuard('tenant')],
    loadChildren: () => import('./retail/retail.routes').then((m) => m.RETAIL_ROUTES),
  },
  { path: '**', canActivate: [homeRedirect], children: [] },
];
