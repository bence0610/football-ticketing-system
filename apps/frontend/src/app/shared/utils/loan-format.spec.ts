import { timeLeft, timeLeftLabel } from './loan-format';

describe('loan-format timeLeft', () => {
  const now = Date.parse('2026-11-10T10:00:00Z');
  const at = (ms: number) => new Date(now + ms).toISOString();

  it('counts days, hours and minutes', () => {
    expect(timeLeft(at(2 * 86_400_000 + 3_600_000), now)).toBe('2 nap');
    expect(timeLeft(at(5 * 3_600_000 + 60_000), now)).toBe('5 óra');
    expect(timeLeft(at(40 * 60_000 + 1000), now)).toBe('40 perc');
    expect(timeLeft(at(5_000), now)).toBe('1 perc');
  });

  it('is null once the time has passed, and the label then says so', () => {
    expect(timeLeft(at(-1), now)).toBeNull();
    expect(timeLeftLabel(at(-1), now)).toBe('lejárt');
    expect(timeLeftLabel(at(3 * 3_600_000 + 5), now)).toBe('még 3 óra');
  });
});
