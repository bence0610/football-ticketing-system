import { HttpErrorResponse } from '@angular/common/http';
import { extractApiErrorMessage } from './api-error';

export const SEAT_TAKEN_MESSAGE = 'Ez a szék már foglalt. Válassz másikat.';
const LOCK_FALLBACK = 'A szék zárolása sikertelen.';

/** 409s that are not about the seat: the buyer holds too many seats, or a hold is at its maximum. */
const OWN_LIMIT_CODES: ReadonlySet<string> = new Set(['seat_limit_reached', 'hold_limit_reached']);

function ownLimit(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) return false;
  const code = (error.error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && OWN_LIMIT_CODES.has(code);
}

export const SIGN_IN_TO_LOCK_MESSAGE = 'A hely lefoglalásához jelentkezz be.';

/** True when the server refused the lock because someone else holds or bought the seat. */
export function isSeatTaken(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 409 && !ownLimit(error);
}

/**
 * The one place that words a failed seat-lock for the user. The seat map and
 * the cart's "Újra lefoglalom" both use it, so a taken seat gives the same
 * message wherever you try to book it.
 */
export function lockErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 401) {
    return SIGN_IN_TO_LOCK_MESSAGE;
  }
  if (isSeatTaken(error)) {
    return SEAT_TAKEN_MESSAGE;
  }
  // seat_limit_reached / hold_limit_reached / rate_limited: the server says exactly what it is.
  return extractApiErrorMessage(error, LOCK_FALLBACK);
}
