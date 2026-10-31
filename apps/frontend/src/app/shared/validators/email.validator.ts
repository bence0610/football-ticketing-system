import { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * Requires the value to look like  local@domain.tld  — the domain part must
 * contain at least one dot.  Angular's built-in Validators.email accepts bare
 * domains such as "user@localhost" because it follows RFC 5321, but the
 * backend's @IsEmail() (validator.js) rejects them.  Using this validator on
 * every email field keeps client and server in sync so the user never reaches
 * the network with an address the server will reject.
 *
 * Authoritative rule: validator.js isEmail() (used by class-validator @IsEmail()).
 * This regex is the canonical front-end mirror of that rule.
 */
const STRICT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function strictEmailValidator(control: AbstractControl): ValidationErrors | null {
  const value = control.value as string | null | undefined;
  if (!value) return null;
  return STRICT_EMAIL_RE.test(value) ? null : { email: true };
}
