/**
 * The one rule for "is this match covered by the pass": a pass sold as valid
 * from day A to day B covers every match that kicks off on a calendar day from
 * A to B INCLUSIVE, with the days read in the stadium's timezone.
 *
 * The pass stores plain dates (`valid_from`, `valid_until`), which arrive as
 * UTC midnight of that calendar date. Comparing a kickoff against that instant
 * would end the pass at the START of its last day. So the window is widened to
 * [start of first day, start of the day after the last day) in the stadium's
 * timezone. `getMatchQr`, the season-pass list, the profile and the chatbot all
 * go through this file (the clients receive the instants from the API), so they
 * cannot disagree.
 */
export const STADIUM_TIMEZONE = 'Europe/Budapest';

export interface ValidityWindow {
  /** First instant covered (inclusive). */
  startsAt: Date;
  /** First instant NOT covered (exclusive): midnight after the last day. */
  endsBefore: Date;
}

/** How far the timezone's wall clock is ahead of UTC at the given instant. */
function offsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instantMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The instant at which the given calendar day starts in the timezone. */
function startOfDay(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month, day);
  // Offset at the guess, then re-read it at the result so a DST change between
  // the two is honoured.
  const first = guess - offsetMs(guess, timeZone);
  return new Date(guess - offsetMs(first, timeZone));
}

/**
 * @param validFrom  the pass's first day (a DATE column: UTC midnight of the day)
 * @param validUntil the pass's last day, likewise
 */
export function validityWindow(
  validFrom: Date,
  validUntil: Date,
  timeZone: string = STADIUM_TIMEZONE,
): ValidityWindow {
  return {
    startsAt: startOfDay(
      validFrom.getUTCFullYear(),
      validFrom.getUTCMonth(),
      validFrom.getUTCDate(),
      timeZone,
    ),
    // Date.UTC rolls day+1 over month and year ends.
    endsBefore: startOfDay(
      validUntil.getUTCFullYear(),
      validUntil.getUTCMonth(),
      validUntil.getUTCDate() + 1,
      timeZone,
    ),
  };
}

export function isWithinValidity(
  kickoff: Date,
  validFrom: Date,
  validUntil: Date,
  timeZone: string = STADIUM_TIMEZONE,
): boolean {
  const { startsAt, endsBefore } = validityWindow(validFrom, validUntil, timeZone);
  return kickoff.getTime() >= startsAt.getTime() && kickoff.getTime() < endsBefore.getTime();
}
