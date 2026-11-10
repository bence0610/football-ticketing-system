import { isWithinValidity, validityWindow } from './season-pass-validity';

// What the DATE columns hand us: UTC midnight of the calendar day.
const FROM = new Date('2026-08-01T00:00:00.000Z');
const UNTIL = new Date('2027-06-30T00:00:00.000Z');

const covered = (kickoffIso: string, from = FROM, until = UNTIL): boolean =>
  isWithinValidity(new Date(kickoffIso), from, until);

describe('season pass validity window (Europe/Budapest)', () => {
  it('runs from the start of the first day to the start of the day after the last', () => {
    const w = validityWindow(FROM, UNTIL);
    // 1 Aug 2026 00:00 CEST and 1 Jul 2027 00:00 CEST
    expect(w.startsAt.toISOString()).toBe('2026-07-31T22:00:00.000Z');
    expect(w.endsBefore.toISOString()).toBe('2027-06-30T22:00:00.000Z');
  });

  describe('first day', () => {
    it('covers a match just after midnight local time', () => {
      expect(covered('2026-07-31T22:00:00.000Z')).toBe(true); // 00:00:00 local, inclusive
      expect(covered('2026-07-31T22:30:00.000Z')).toBe(true); // 00:30 local
    });
    it('covers a match at UTC midnight and in the afternoon', () => {
      expect(covered('2026-08-01T00:00:00.000Z')).toBe(true);
      expect(covered('2026-08-01T15:00:00.000Z')).toBe(true);
    });
    it('does not cover the last instant of the day before', () => {
      expect(covered('2026-07-31T21:59:59.999Z')).toBe(false); // 23:59:59.999 local
    });
  });

  describe('final day', () => {
    it('covers a match at UTC midnight (the old cut-off) and in the afternoon', () => {
      expect(covered('2027-06-30T00:00:00.000Z')).toBe(true);
      expect(covered('2027-06-30T16:00:00.000Z')).toBe(true);
    });
    it('covers a match kicking off late in the evening', () => {
      expect(covered('2027-06-30T21:30:00.000Z')).toBe(true); // 23:30 local
      expect(covered('2027-06-30T21:59:59.999Z')).toBe(true); // 23:59:59.999 local
    });
    it('does not cover the first instant of the next day', () => {
      expect(covered('2027-06-30T22:00:00.000Z')).toBe(false); // 00:00 on 1 Jul local
    });
  });

  describe('daylight saving time', () => {
    // Clocks go back on 25 Oct 2026 (a 25-hour day): CEST +2 -> CET +1.
    const from = new Date('2026-10-01T00:00:00.000Z');

    it('ends a pass whose last day is before the change at 00:00 CEST', () => {
      const until = new Date('2026-10-24T00:00:00.000Z');
      expect(validityWindow(from, until).endsBefore.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    });

    it('covers the whole 25-hour day of the change, and ends at 00:00 CET', () => {
      const until = new Date('2026-10-25T00:00:00.000Z');
      expect(validityWindow(from, until).endsBefore.toISOString()).toBe('2026-10-25T23:00:00.000Z');
      expect(covered('2026-10-25T22:30:00.000Z', from, until)).toBe(true); // 23:30 CET
      expect(covered('2026-10-25T23:00:00.000Z', from, until)).toBe(false);
    });

    it('uses +01:00 in winter', () => {
      const w = validityWindow(
        new Date('2027-01-01T00:00:00.000Z'),
        new Date('2027-01-31T00:00:00.000Z'),
      );
      expect(w.startsAt.toISOString()).toBe('2026-12-31T23:00:00.000Z');
      expect(w.endsBefore.toISOString()).toBe('2027-01-31T23:00:00.000Z');
    });
  });

  it('rolls the day after the last day over a year end', () => {
    const w = validityWindow(
      new Date('2026-12-01T00:00:00.000Z'),
      new Date('2026-12-31T00:00:00.000Z'),
    );
    expect(w.endsBefore.toISOString()).toBe('2026-12-31T23:00:00.000Z'); // 1 Jan 00:00 CET
  });
});
