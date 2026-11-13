import { hasKickedOff, purchasableMatches } from './match-sale';

const at = (offsetMs: number, now: number): { kickoffAt: string } => ({
  kickoffAt: new Date(now + offsetMs).toISOString(),
});

describe('match sale window', () => {
  const NOW = Date.parse('2026-11-13T12:00:00.000Z');

  it('has kicked off at the instant of kickoff, not a moment before', () => {
    expect(hasKickedOff(at(0, NOW), NOW)).toBeTrue();
    expect(hasKickedOff(at(1, NOW), NOW)).toBeFalse();
    expect(hasKickedOff(at(-1, NOW), NOW)).toBeTrue();
  });

  it('counts the match as over the moment it starts, not when it ends', () => {
    // 30 minutes into a 90-minute game: already not for sale
    expect(hasKickedOff(at(-30 * 60_000, NOW), NOW)).toBeTrue();
  });

  it('treats a missing or unparseable kickoff as started', () => {
    expect(hasKickedOff({ kickoffAt: 'not a date' }, NOW)).toBeTrue();
    expect(hasKickedOff({ kickoffAt: '' }, NOW)).toBeTrue();
  });

  it('keeps only the matches still to be played, in order', () => {
    const list = [
      { id: 'past', ...at(-86_400_000, NOW) },
      { id: 'soon', ...at(3_600_000, NOW) },
      { id: 'live', ...at(-60_000, NOW) },
      { id: 'later', ...at(7 * 86_400_000, NOW) },
    ];
    expect(purchasableMatches(list, NOW).map((m) => m.id)).toEqual(['soon', 'later']);
  });
});
