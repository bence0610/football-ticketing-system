import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { extractApiErrorMessage } from '../../shared/utils/api-error';

/** Set to true on requests whose 401 should be swallowed silently. */
export const SILENT_401 = new HttpContextToken<boolean>(() => false);

/**
 * Set to true on requests that originate from a user-triggered form submission.
 * The form component shows its own error block (role="alert") above the submit
 * button, so the global snackbar must not fire a duplicate message.
 * Only truly background / out-of-band failures (session expiry, lock timeout
 * while the user is away) should surface via the snackbar.
 */
export const SKIP_ERROR_SNACKBAR = new HttpContextToken<boolean>(() => false);

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const snackBar = inject(MatSnackBar);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && req.context.get(SILENT_401)) {
        return throwError(() => error);
      }

      if (req.context.get(SKIP_ERROR_SNACKBAR)) {
        return throwError(() => error);
      }

      const message = extractApiErrorMessage(
        error,
        'Ismeretlen hiba történt. Próbáld újra később.',
      );

      snackBar.open(message, 'Bezárás', { duration: 5000, panelClass: ['kte-snackbar-error'] });
      return throwError(() => error);
    }),
  );
};
