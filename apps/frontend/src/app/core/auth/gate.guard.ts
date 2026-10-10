import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Functional guard that allows only GATE, ADMIN, or SUPER_ADMIN users into the
 * /gate route. Anonymous users are bounced to /login; authenticated fans are
 * redirected to /.
 */
export const gateGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }
  const user = auth.getCurrentUser();
  if (!user) {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }
  if (user.role === 'gate' || user.role === 'admin' || user.role === 'super_admin') {
    return true;
  }
  return router.createUrlTree(['/']);
};
