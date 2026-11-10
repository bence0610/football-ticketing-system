/**
 * The password rule, mirrored from the server's RegisterDto
 * (apps/backend/src/modules/auth/dto/register.dto.ts):
 *
 *   - 8 to 72 characters,
 *   - at least one letter and one digit, matched by /(?=.*[A-Za-z])(?=.*\d).+/.
 *
 * Note the letter test is ASCII-only on the server: "é" or "ő" alone do not
 * count. This file must say exactly what the server says, so the form and the
 * strength meter can never call a password fine that the server will reject.
 * password-rules.spec.ts pins both to the same table of examples.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
export const PASSWORD_PATTERN = /(?=.*[A-Za-z])(?=.*\d).+/;

export interface PasswordChecks {
  readonly longEnough: boolean;
  readonly notTooLong: boolean;
  readonly hasLetter: boolean;
  readonly hasDigit: boolean;
  /** True exactly when the server accepts the password. */
  readonly accepted: boolean;
}

export function passwordChecks(password: string): PasswordChecks {
  const longEnough = password.length >= PASSWORD_MIN;
  const notTooLong = password.length <= PASSWORD_MAX;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasDigit = /\d/.test(password);
  return {
    longEnough,
    notTooLong,
    hasLetter,
    hasDigit,
    accepted: longEnough && notTooLong && PASSWORD_PATTERN.test(password),
  };
}

/** Length that earns the fourth segment. Beyond what the server asks, and only reachable once it accepts. */
export const PASSWORD_LONG = 12;

export type StrengthLevel = 'empty' | 'rejected' | 'accepted' | 'long';

export interface PasswordStrength {
  /** Segments to fill, 0-4. */
  readonly segments: 0 | 1 | 2 | 3 | 4;
  readonly level: StrengthLevel;
  readonly label: string;
}

/**
 * Three segments are the three things the server checks (length, a letter, a
 * digit); the fourth is a bonus for length 12+. Segments 1-3 therefore count
 * rules met, and the meter only reads "Megfelel" once the server would accept
 * it - so a rejected password can never look strong.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { segments: 0, level: 'empty', label: '' };
  const c = passwordChecks(password);
  if (!c.accepted) {
    const met = [c.longEnough, c.hasLetter, c.hasDigit].filter(Boolean).length;
    const segments = Math.min(met, 2) as 0 | 1 | 2;
    return {
      segments,
      level: 'rejected',
      label: c.notTooLong ? 'Még nem elfogadható' : 'Túl hosszú',
    };
  }
  return password.length >= PASSWORD_LONG
    ? { segments: 4, level: 'long', label: 'Hosszú, jó jelszó' }
    : { segments: 3, level: 'accepted', label: 'Megfelel' };
}
