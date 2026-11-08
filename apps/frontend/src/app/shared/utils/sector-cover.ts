/**
 * How a sector's coverage is worded in the UI. The flag comes from the server
 * (the `sectors` table, through the seat map); `null`/`undefined` means the
 * server has no data, and then nothing is said at all - never "open".
 */
export type Covered = boolean | null | undefined;

/** Short label for chips: "Fedett" / "Nyitott", or null when unknown. */
export function coverLabel(covered: Covered): 'Fedett' | 'Nyitott' | null {
  if (covered === true) {
    return 'Fedett';
  }
  if (covered === false) {
    return 'Nyitott';
  }
  return null;
}

/** Longer wording for tooltips / screen readers. */
export function coverDescription(covered: Covered): string | null {
  if (covered === true) {
    return 'fedett szektor (esőben száraz)';
  }
  if (covered === false) {
    return 'nyitott szektor (nem fedett)';
  }
  return null;
}
