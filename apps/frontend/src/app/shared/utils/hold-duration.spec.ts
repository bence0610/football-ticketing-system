import { CountdownPipe } from '../pipes/countdown.pipe';
import { formatHoldDuration, holdNoticeText, lockExpiryFromTtl } from './hold-duration';

describe('hold duration (single source: server ttlSeconds)', () => {
  const countdown = new CountdownPipe();

  [60, 300, 420, 3600].forEach((ttl) => {
    it(`cart text and initial countdown agree for a ${ttl} s hold`, () => {
      const now = 1_000_000;
      const remainingMs = lockExpiryFromTtl(ttl, now) - now;
      const minutes = Math.floor(ttl / 60);

      expect(countdown.transform(remainingMs)).toBe(`${String(minutes).padStart(2, '0')}:00`);
      expect(holdNoticeText(ttl)).toContain(`${minutes} perc`);
    });
  });

  it('anchors expiry to the client clock, so browser clock skew cannot distort it', () => {
    const skewedNow = Date.UTC(2020, 0, 1);
    expect(lockExpiryFromTtl(300, skewedNow) - skewedNow).toBe(300_000);
  });

  it('formats mixed durations and falls back to a generic text when unknown', () => {
    expect(formatHoldDuration(90)).toBe('1 perc 30 másodperc');
    expect(holdNoticeText(undefined)).toContain('korlátozott ideig');
  });
});
