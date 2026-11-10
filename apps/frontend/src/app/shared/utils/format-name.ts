/**
 * The one way a person's full name is written: family name first, as is usual
 * in Hungarian ("Kovács Béla"). `lastName` is the Vezetéknév and `firstName`
 * the Keresztnév. Mirrors apps/backend/src/common/format-name.ts, which formats
 * the names the server sends (gate verdict, loan invitations, emails).
 */
export interface NameParts {
  readonly firstName?: string | null;
  readonly lastName?: string | null;
}

export function formatFullName(person: NameParts): string {
  return [person.lastName, person.firstName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ');
}

/** "KB" for Kovács Béla: family-name initial first, like the full name. */
export function initialsOf(person: NameParts): string {
  return [person.lastName, person.firstName]
    .map((part) => (part ?? '').trim().charAt(0).toUpperCase())
    .join('');
}
