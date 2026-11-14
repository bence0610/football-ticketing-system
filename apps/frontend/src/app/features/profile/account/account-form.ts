export { RATE_LIMITED_MESSAGE } from '../../../shared/utils/api-error';

/**
 * Moves focus to the first field of `formSelector` that shows an error. Runs
 * after the next render, because a field marked invalid by a server answer only
 * gets its aria-invalid="true" then (its control itself may still be valid).
 */
export function focusFirstInvalid(formSelector: string): void {
  setTimeout(() => {
    document
      .querySelector<HTMLInputElement>(`${formSelector} input[aria-invalid="true"]`)
      ?.focus();
  });
}
