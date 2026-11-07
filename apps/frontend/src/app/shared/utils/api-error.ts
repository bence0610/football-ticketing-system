import { HttpErrorResponse } from "@angular/common/http";

export const NETWORK_ERROR_MESSAGE =
  "Nem sikerült elérni a szervert. Ellenőrizd az internetkapcsolatot.";

/**
 * The single place that turns a failed call into text for the user.
 *
 * For an HttpErrorResponse the server's own `message` (string, or the list
 * class-validator produces) wins. `HttpErrorResponse.message` is never used: it
 * is Angular's technical "Http failure response for <url>: 409 Conflict".
 * Plain Errors (e.g. thrown by the Stripe wrapper) keep their own message.
 */
export function extractApiErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return NETWORK_ERROR_MESSAGE;
    }
    const body: unknown = error.error;
    if (body && typeof body === "object" && "message" in body) {
      const value = (body as { message: unknown }).message;
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
      if (Array.isArray(value)) {
        const parts = value.filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        );
        if (parts.length > 0) {
          return parts.join(", ");
        }
      }
    }
    return fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return fallback;
}
