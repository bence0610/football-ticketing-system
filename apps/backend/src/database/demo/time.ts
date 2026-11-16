/**
 * Calendar helpers for the demo schedule. A "day number" is the number of days since
 * 1970-01-01 (so weekdays are plain arithmetic); wall-clock times are in the stadium's
 * timezone and converted to the UTC instants the database stores.
 */
export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const TIME_ZONE = 'Europe/Budapest';

function offsetMs(instantMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
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

/** The calendar day (in the stadium's timezone) that the instant falls on. */
export function dayNumberOf(instant: Date): number {
  return Math.floor((instant.getTime() + offsetMs(instant.getTime())) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekdayOf(dayNumber: number): number {
  return (((dayNumber + 4) % 7) + 7) % 7;
}

/** The UTC instant at which the wall clock in the stadium's timezone reads `hour:minute` on that day. */
export function wallClockToUtc(dayNumber: number, hour: number, minute: number): Date {
  const guess = dayNumber * DAY_MS + hour * HOUR_MS + minute * MINUTE_MS;
  const first = guess - offsetMs(guess);
  return new Date(guess - offsetMs(first));
}

/** Month 1..12 of a day number. */
export function monthOf(dayNumber: number): number {
  return new Date(dayNumber * DAY_MS).getUTCMonth() + 1;
}

/** The day number of a DATE column value (a Date at UTC midnight). */
export function dayNumberOfDateColumn(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

export function dayNumberToUtcMidnight(dayNumber: number): Date {
  return new Date(dayNumber * DAY_MS);
}
