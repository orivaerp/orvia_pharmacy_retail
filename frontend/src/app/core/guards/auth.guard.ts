import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthScope, AuthService } from '../services/auth.service';

/** Must be signed in. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? true : inject(Router).createUrlTree(['/login']);
};

/** Only for signed-out visitors (login page). Signed-in users go to their own area. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? inject(Router).createUrlTree([auth.homeUrl()]) : true;
};

/** Area guard: provider/ is for platform staff, retail/ for shop staff. Others are sent home. */
export const scopeGuard =
  (required: AuthScope): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.isLoggedIn()) return router.createUrlTree(['/login']);
    return auth.scope() === required ? true : router.createUrlTree([auth.homeUrl()]);
  };

/** Landing redirect for "/" based on who is signed in. */
export const homeRedirect: CanActivateFn = () => {
  const auth = inject(AuthService);
  return inject(Router).createUrlTree([auth.isLoggedIn() ? auth.homeUrl() : '/login']);
};

/** Route needs a permission; users without it are sent to their home screen. */
export const permissionGuard =
  (permission: string): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    return auth.hasPermission(permission) ? true : inject(Router).createUrlTree([auth.homeUrl()]);
  };

/** Route needs at least one of the permissions. */
export const anyPermissionGuard =
  (...permissions: string[]): CanActivateFn =>
  () => {
    const auth = inject(AuthService);
    return permissions.some((p) => auth.hasPermission(p)) ? true : inject(Router).createUrlTree([auth.homeUrl()]);
  };

/** Orvia staff who have not set up two-step verification can only open the Security page until they do. */
export const setup2faGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (!auth.user()?.mustSetup2fa || state.url.startsWith('/provider/security')) return true;
  return inject(Router).createUrlTree(['/provider/security']);
};
