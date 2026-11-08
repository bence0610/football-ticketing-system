import { HttpErrorResponse } from '@angular/common/http';
import { extractApiErrorMessage } from './api-error';

export const SEAT_TAKEN_MESSAGE = 'Ez a szék már foglalt. Válassz másikat.';
const LOCK_FALLBACK = 'A szék zárolása sikertelen.';

/** True when the server refused the lock because someone else holds or bought the seat. */
export function isSeatTaken(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 409;
}

/**
 * The one place that words a failed seat-lock for the user. The seat map and
 * the cart's "Újra lefoglalom" both use it, so a taken seat gives the same
 * message wherever you try to book it.
 */
export function lockErrorMessage(error: unknown): string {
  if (isSeatTaken(error)) {
    return SEAT_TAKEN_MESSAGE;
  }
  return extractApiErrorMessage(error, LOCK_FALLBACK);
}
