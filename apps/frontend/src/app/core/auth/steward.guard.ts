import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { isGateRole } from './roles';

/**
 * A signed-in gate user (the steward account) may use /gate only. This is
 * applied once, as canActivateChild on the pathless route that wraps the whole
 * site (admin area and shell), so every current and future page outside /gate
 * sends the steward back to the gate. Everyone else passes untouched.
 * Presentation only: the API refuses a gate user on fan endpoints by itself.
 */
export const stewardOnlyGuard: CanActivateChildFn = () => {
  const auth = inject(AuthService);
  if (auth.isAuthenticated() && isGateRole(auth.getCurrentUser()?.role)) {
    return inject(Router).createUrlTree(['/gate']);
  }
  return true;
};
