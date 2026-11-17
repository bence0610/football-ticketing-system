import { MatchStatus, TicketSource, TicketStatus } from '../../database/entities';
import {
  FigureMatch,
  TicketAggregate,
  isHomeRow,
  matchRows,
  overviewMetrics,
} from './overview-figures';

const NOW = new Date('2026-11-16T20:00:00Z');
/** Active seats outside the away section: 5,468 in the stadium, less the 280-seat away section. */
const SELLABLE = 5188;
const PASS_COUNT = 36;

const passSeats = new Set(Array.from({ length: PASS_COUNT }, (_, i) => `pass-seat-${i}`));

const homeMatch = (id: string, over: Partial<FigureMatch> = {}): FigureMatch => ({
  id,
  homeTeam: 'Kecskeméti TE',
  awayTeam: 'Diósgyőri VTK',
  kickoffAt: new Date('2026-11-01T15:00:00Z'),
  status: MatchStatus.FINISHED,
  isHome: true,
  ...over,
});

const awayMatch = (id: string, over: Partial<FigureMatch> = {}): FigureMatch => ({
  id,
  homeTeam: 'Szeged',
  awayTeam: 'Kecskeméti TE',
  kickoffAt: new Date('2026-11-08T15:00:00Z'),
  status: MatchStatus.FINISHED,
  isHome: false,
  ...over,
});

const row = (
  matchId: string,
  source: TicketSource,
  n: number,
  amount: number,
  status = TicketStatus.USED,
): TicketAggregate => ({ matchId, status, source, n, amount });

/** Every home match is one the passes are valid for, unless a test says otherwise. */
const input = (
  matches: FigureMatch[],
  ticketRows: TicketAggregate[],
  validFor: (m: FigureMatch) => boolean = (m) => m.isHome,
) => ({
  matches,
  ticketRows,
  validPassSeats: new Map<string, ReadonlySet<string>>(
    matches.filter(validFor).map((m) => [m.id, passSeats]),
  ),
  passSeatsWithTicket: new Map<string, ReadonlySet<string>>(),
  sellableSeats: SELLABLE,
  now: NOW,
});

describe('admin overview figures: away matches', () => {
  it('shows an away match with no figure at all, not even the pass-held seats as 1%', () => {
    const [away] = matchRows(input([awayMatch('away')], []));
    expect(away.isHome).toBe(false);
    expect(away.ticketCount).toBeNull();
    expect(away.passesValid).toBeNull();
    expect(away.passEntered).toBeNull();
    expect(away.occupiedSeats).toBeNull();
    expect(away.capacity).toBeNull();
    expect(away.occupancyPercent).toBeNull();
    expect(away.revenue).toBeNull();
    // Without the fix this was Math.round(36 / 5468 * 100) = 1.
    expect(Math.round((PASS_COUNT / 5468) * 100)).toBe(1);
  });

  it('keeps the away match in the list, final or not, with its fixture', () => {
    const rows = matchRows(
      input(
        [
          awayMatch('past'),
          awayMatch('next', {
            kickoffAt: new Date('2026-12-01T15:00:00Z'),
            status: MatchStatus.SCHEDULED,
          }),
        ],
        [],
      ),
    );
    expect(rows.map((r) => [r.matchId, r.final, r.awayTeam])).toEqual([
      ['past', true, 'Kecskeméti TE'],
      ['next', false, 'Kecskeméti TE'],
    ]);
  });

  it('adds nothing to any total or average, even if ticket rows existed for it', () => {
    const home = homeMatch('home');
    const away = awayMatch('away');
    // Stray rows for the away match: what a bad import or an old bug could leave behind.
    const tickets = [
      row('home', TicketSource.SINGLE, 1000, 3_000_000),
      row('home', TicketSource.SEASON_PASS, 20, 0),
      row('away', TicketSource.SINGLE, 500, 1_500_000),
      row('away', TicketSource.SEASON_PASS, 36, 0),
    ];
    const rows = matchRows(input([home, away], tickets));
    const alone = matchRows(input([home], tickets.slice(0, 2)));
    expect(overviewMetrics(rows, tickets)).toEqual(overviewMetrics(alone, tickets.slice(0, 2)));

    const metrics = overviewMetrics(rows, tickets);
    expect(metrics.revenue).toBe(3_000_000);
    expect(metrics.ticketsSold).toBe(1000);
    expect(metrics.passEntries).toBe(20);
    expect(metrics.finalMatchCount).toBe(1);
    expect(metrics.playedTickets).toBe(1000);
    expect(metrics.scannedTickets).toBe(1000);
  });

  it('does not drag the season average down: home 100% and an away round average to 100%', () => {
    const full = row('home', TicketSource.SINGLE, SELLABLE - PASS_COUNT, 14_000_000);
    const entries = row('home', TicketSource.SEASON_PASS, PASS_COUNT, 0);
    const rows = matchRows(
      input([homeMatch('home'), awayMatch('a1'), awayMatch('a2')], [full, entries]),
    );
    expect(overviewMetrics(rows, [full, entries]).averageOccupancyPercent).toBe(100);
  });

  it('does not count the seats held by passes as occupied for an away match, but does for a home one', () => {
    const [home, away] = matchRows(input([homeMatch('home'), awayMatch('away')], []));
    expect(home.occupiedSeats).toBe(PASS_COUNT);
    expect(away.occupiedSeats).toBeNull();
  });
});

describe('admin overview figures: the denominator is the sellable seats', () => {
  const soldOut = [
    row('home', TicketSource.SINGLE, SELLABLE - PASS_COUNT, 14_000_000),
    row('home', TicketSource.SEASON_PASS, PASS_COUNT, 0),
  ];

  it('reads exactly 100% for a fully sold home match, not 95%', () => {
    const [m] = matchRows(input([homeMatch('home', { status: MatchStatus.SOLD_OUT })], soldOut));
    expect(isHomeRow(m)).toBe(true);
    expect(m.occupiedSeats).toBe(SELLABLE);
    expect(m.capacity).toBe(SELLABLE);
    expect(m.occupancyPercent).toBe(100);
    // The old denominator was the whole stadium:
    expect(Math.round((SELLABLE / 5468) * 100)).toBe(95);
  });

  it('reads 100% for the season average of a sold-out home match', () => {
    const rows = matchRows(input([homeMatch('home', { status: MatchStatus.SOLD_OUT })], soldOut));
    expect(overviewMetrics(rows, soldOut).averageOccupancyPercent).toBe(100);
  });

  it('never exceeds 100%', () => {
    const over = [row('home', TicketSource.SINGLE, SELLABLE + 300, 1)];
    const [m] = matchRows(input([homeMatch('home')], over));
    expect(m.occupancyPercent).toBe(100);
  });

  it('counts a pass-held seat without a ticket as taken, and one with a ticket once', () => {
    const withTicket = new Map<string, ReadonlySet<string>>([
      ['home', new Set(['pass-seat-0', 'pass-seat-1'])],
    ]);
    const tickets = [row('home', TicketSource.SEASON_PASS, 2, 0)];
    const [m] = matchRows({
      ...input([homeMatch('home')], tickets),
      passSeatsWithTicket: withTicket,
    });
    expect(m.occupiedSeats).toBe(2 + (PASS_COUNT - 2));
  });
});

describe('admin overview figures: pass seats only count where the pass is valid', () => {
  it('leaves the pass seats empty on a match the passes do not cover (a friendly with no tickets reads 0%)', () => {
    const friendly = homeMatch('friendly', {
      status: MatchStatus.SCHEDULED,
      kickoffAt: new Date('2026-12-05T15:00:00Z'),
    });
    const [m] = matchRows(input([friendly], [], () => false));
    expect(m.occupiedSeats).toBe(0);
    expect(m.occupancyPercent).toBe(0);
    expect(m.passesValid).toBe(0);
  });

  it('still counts them on a match the passes cover', () => {
    const league = homeMatch('league', {
      status: MatchStatus.SCHEDULED,
      kickoffAt: new Date('2026-12-05T15:00:00Z'),
    });
    const [m] = matchRows(input([league], []));
    expect(m.occupiedSeats).toBe(PASS_COUNT);
  });
});

describe('admin overview figures: the pass figure of a match', () => {
  const upcoming = homeMatch('up', {
    status: MatchStatus.ON_SALE,
    kickoffAt: new Date('2026-12-05T15:00:00Z'),
  });

  it('is, for a match still ahead, the passes valid for it, whatever tickets exist yet', () => {
    // one pass entry ticket was materialised (a holder opened the QR): the figure is still 36
    const tickets = [row('up', TicketSource.SEASON_PASS, 1, 0, TicketStatus.PAID)];
    const [m] = matchRows(input([upcoming], tickets));
    expect(m.passesValid).toBe(PASS_COUNT);
    expect(m.passEntered).toBeNull();
  });

  it('is, for a match already played, the pass entries that were scanned', () => {
    const tickets = [
      row('home', TicketSource.SEASON_PASS, 30, 0, TicketStatus.USED),
      row('home', TicketSource.SEASON_PASS, 4, 0, TicketStatus.PAID), // materialised, never came
      row('home', TicketSource.LOAN, 2, 0, TicketStatus.USED),
    ];
    const [m] = matchRows(input([homeMatch('home')], tickets));
    expect(m.passEntered).toBe(32);
    expect(m.passesValid).toBeNull();
  });
});
