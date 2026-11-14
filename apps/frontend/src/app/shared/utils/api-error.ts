import { HttpErrorResponse } from "@angular/common/http";

export const NETWORK_ERROR_MESSAGE =
  "Nem sikerült elérni a szervert. Ellenőrizd az internetkapcsolatot.";

/** What a 429 `rate_limited` answer of the auth and account endpoints says. */
export const RATE_LIMITED_MESSAGE = "Túl sok próbálkozás. Próbáld újra később.";

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

/** The machine-readable `code` of the global error body (e.g. `email_taken`), if any. */
export function apiErrorCode(error: unknown): string | null {
  if (error instanceof HttpErrorResponse && error.error && typeof error.error === "object") {
    const code = (error.error as Record<string, unknown>)["code"];
    return typeof code === "string" ? code : null;
  }
  return null;
}

/** Every message of the global error body: one for a coded error, one per failed rule for a validation error. */
export function apiErrorMessages(error: unknown): string[] {
  if (error instanceof HttpErrorResponse && error.error && typeof error.error === "object") {
    const message = (error.error as Record<string, unknown>)["message"];
    if (typeof message === "string" && message.length > 0) return [message];
    if (Array.isArray(message)) {
      return message.filter((v): v is string => typeof v === "string" && v.length > 0);
    }
  }
  return [];
}

/** The first server message, or null: the wording the auth pages show as is. */
export function apiErrorMessage(error: unknown): string | null {
  return apiErrorMessages(error)[0] ?? null;
}

export interface FieldErrorSplit<F extends string> {
  /** The first message that names each field. */
  readonly fields: Partial<Record<F, string>>;
  /** Messages that name no field: they belong in the form's error block. */
  readonly rest: readonly string[];
}

/**
 * Spreads the messages of a 400 validation body onto form fields. The server
 * sends one message per failed rule (class-validator), either its own Hungarian
 * wording ("A keresztnév legfeljebb 100 karakter lehet.") or the default one,
 * which starts with the property name ("firstName must be..."). `matchers` says,
 * per field, what in a message identifies it; the first matching field wins.
 */
export function splitFieldErrors<F extends string>(
  error: unknown,
  matchers: Readonly<Record<F, RegExp>>,
): FieldErrorSplit<F> {
  const fields: Partial<Record<F, string>> = {};
  const rest: string[] = [];
  const names = Object.keys(matchers) as F[];
  for (const message of apiErrorMessages(error)) {
    const field = names.find((name) => message.startsWith(name) || matchers[name].test(message));
    if (field === undefined) {
      rest.push(message);
    } else if (fields[field] === undefined) {
      fields[field] = message;
    }
  }
  return { fields, rest };
}
