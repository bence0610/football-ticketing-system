import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

/** Set to true on requests whose 401 should be swallowed silently. */
export const SILENT_401 = new HttpContextToken<boolean>(() => false);

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const snackBar = inject(MatSnackBar);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && req.context.get(SILENT_401)) {
        return throwError(() => error);
      }

      let message = 'Ismeretlen hiba történt. Próbáld újra később.';
      if (error.status === 0) {
        message = 'Nem sikerült elérni a szervert. Ellenőrizd az internetkapcsolatot.';
      } else if (typeof error.error === 'object' && error.error !== null) {
        const body = error.error as { message?: string | string[] };
        if (Array.isArray(body.message)) {
          message = body.message.join(', ');
        } else if (typeof body.message === 'string') {
          message = body.message;
        }
      }

      snackBar.open(message, 'Bezárás', { duration: 5000, panelClass: ['kte-snackbar-error'] });
      return throwError(() => error);
    }),
  );
};
