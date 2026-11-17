import { Competition, MatchStatus } from '../entities/match.entity';
import { OPPONENT_KEYS, OPPONENTS } from './data';
import { FULLEST_ROUND, LIVE_ROUND, buildSchedule, leagueRounds } from './schedule';
import { DAY_MS, HOUR_MS } from './time';

const SEASON = {
  label: '2026/2027',
  validFrom: new Date('2026-07-01T00:00:00Z'),
  validUntil: new Date('2027-06-30T00:00:00Z'),
};
const NOW = new Date('2026-11-16T19:24:00Z');

describe('the demo league schedule', () => {
  const { current, previous } = buildSchedule(NOW, SEASON, '2025/2026');
  const league = current.filter((m) => m.competition === Competition.NB2);

  it('is 30 rounds: 15 at home and 15 away', () => {
    expect(league).toHaveLength(30);
    expect(league.filter((m) => m.home)).toHaveLength(15);
    expect(league.filter((m) => !m.home)).toHaveLength(15);
    expect(leagueRounds().map((r) => r.round)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('meets each of the 15 opponents once at home and once away', () => {
    expect(OPPONENT_KEYS).toHaveLength(15);
    for (const key of OPPONENT_KEYS) {
      const against = league.filter((m) => m.opponentKey === key);
      expect(against.map((m) => m.home).sort()).toEqual([false, true]);
    }
    expect(new Set(OPPONENT_KEYS.map((k) => OPPONENTS[k].name))).toEqual(
      new Set([
        'Soroksár',
        'Kazincbarcika',
        'Tiszakécske',
        'Mezőkövesd',
        'Gyirmót',
        'Ajka',
        'Diósgyőri VTK',
        'BVSC-Zugló',
        'Szeged',
        'Videoton',
        'Szentlőrinc',
        'Kozármisleny',
        'Nagykanizsa',
        'Karcag',
        'Csákvár',
      ]),
    );
  });

  it('has some played, one in progress, one sold out and the rest on sale', () => {
    const byRound = (r: number) => league.find((m) => m.round === r)!;
    const played = league.filter((m) => m.round! < LIVE_ROUND);
    expect(
      played.every(
        (m) =>
          m.status === MatchStatus.FINISHED && m.kickoffAt.getTime() < NOW.getTime() - 4 * HOUR_MS,
      ),
    ).toBe(true);

    const live = byRound(LIVE_ROUND);
    expect(live.home).toBe(true);
    expect(live.status).toBe(MatchStatus.ON_SALE);
    expect(NOW.getTime() - live.kickoffAt.getTime()).toBeGreaterThan(0);
    expect(NOW.getTime() - live.kickoffAt.getTime()).toBeLessThan(2 * HOUR_MS);

    const fullest = byRound(FULLEST_ROUND);
    expect(fullest.home).toBe(true);
    // never sold out: a fully ticketed league match would leave no seat for a season pass
    expect(fullest.status).toBe(MatchStatus.ON_SALE);
    expect(league.filter((m) => m.fullest)).toHaveLength(1);
    expect([...current, ...previous].some((m) => m.status === MatchStatus.SOLD_OUT)).toBe(false);

    const upcoming = league.filter((m) => m.round! > LIVE_ROUND);
    expect(upcoming.every((m) => m.kickoffAt.getTime() > NOW.getTime() + 12 * HOUR_MS)).toBe(true);
    for (const m of upcoming.filter((x) => x.home)) expect(m.status).toBe(MatchStatus.ON_SALE);
    for (const m of upcoming.filter((x) => !x.home)) expect(m.status).toBe(MatchStatus.SCHEDULED);
  });

  it('has no cancelled match: that flow is not built', () => {
    expect([...current, ...previous].some((m) => m.status === MatchStatus.CANCELLED)).toBe(false);
  });

  it('has two Magyar Kupa home ties, one played and one to come', () => {
    const cups = current.filter((m) => m.competition === Competition.MAGYAR_KUPA);
    expect(cups).toHaveLength(2);
    expect(cups.every((m) => m.home && !m.passEligible)).toBe(true);
    expect(cups.map((m) => m.phase).sort()).toEqual(['played', 'upcoming']);
  });

  it('keeps every round of the season inside the season window, in round order', () => {
    const from = SEASON.validFrom.getTime();
    const until = SEASON.validUntil.getTime() + DAY_MS;
    for (const m of current) {
      expect(m.kickoffAt.getTime()).toBeGreaterThanOrEqual(from);
      expect(m.kickoffAt.getTime()).toBeLessThan(until);
    }
    const rounds = league.slice().sort((a, b) => a.round! - b.round!);
    for (let i = 1; i < rounds.length; i += 1) {
      expect(rounds[i].kickoffAt.getTime()).toBeGreaterThan(rounds[i - 1].kickoffAt.getTime());
    }
  });

  it("has last season's 15 league home matches and a cup tie, all played, 52 weeks earlier", () => {
    expect(previous).toHaveLength(16);
    expect(
      previous.every((m) => m.home && m.phase === 'played' && m.status === MatchStatus.FINISHED),
    ).toBe(true);
    expect(previous.every((m) => m.kickoffAt.getTime() < SEASON.validFrom.getTime())).toBe(true);
    expect(previous.filter((m) => m.competition === Competition.NB2)).toHaveLength(15);
  });

  it.each([
    ['a Saturday', '2026-10-17T10:00:00Z'],
    ['a Sunday evening', '2026-12-06T20:30:00Z'],
    ['early in the season', '2026-09-30T08:00:00Z'],
    ['after the winter break', '2027-01-20T12:00:00Z'],
  ])('keeps its shape when run on %s', (_label, iso) => {
    const now = new Date(iso);
    const s = buildSchedule(now, SEASON, '2025/2026');
    const l = s.current.filter((m) => m.competition === Competition.NB2);
    expect(l.filter((m) => m.home)).toHaveLength(15);
    expect(l.filter((m) => m.round! < LIVE_ROUND).every((m) => m.kickoffAt < now)).toBe(true);
    expect(l.filter((m) => m.round! > LIVE_ROUND).every((m) => m.kickoffAt > now)).toBe(true);
    expect(l.filter((m) => m.fullest)).toHaveLength(1);
  });

  it('says so when the season is too far gone for the rounds still to come', () => {
    expect(() => buildSchedule(new Date('2027-05-20T10:00:00Z'), SEASON, '2025/2026')).toThrow(
      /ends too soon/,
    );
  });

  it('says so when the first round would fall before the season starts', () => {
    expect(() => buildSchedule(new Date('2026-07-20T10:00:00Z'), SEASON, '2025/2026')).toThrow(
      /before season/,
    );
  });
});
