/**
 * The one way a person's full name is written: family name first, as is usual
 * in Hungarian ("Kovács Béla"). Here `lastName` is the Vezetéknév and
 * `firstName` the Keresztnév. Use this everywhere a full name is shown or
 * sent - the profile, the gate, loan invitations, emails - so no screen
 * disagrees with another. (Greetings address a person by `firstName` alone and
 * do not use this.)
 */
export interface NameParts {
  firstName?: string | null;
  lastName?: string | null;
}

export function formatFullName(person: NameParts): string {
  return [person.lastName, person.firstName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ');
}
