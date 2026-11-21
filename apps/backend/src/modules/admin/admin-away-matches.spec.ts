/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException } from '@nestjs/common';
import { MatchStatus } from '../../database/entities';
import { AdminOccupancyService } from './admin-occupancy.service';
import { AdminOverviewService } from './admin-overview.service';
import { AdminRevenueService } from './admin-revenue.service';

/**
 * The admin services, run against fake repositories, to show that no figure is taken from an
 * away match: not in the overview, the heatmap, the revenue figures or the occupancy report.
 */
const HOME = 'Kecskeméti TE';
const SELLABLE = 5188;
const PASS_COUNT = 36;
const NOW = new Date('2026-11-16T20:00:00Z');

const config = { getOrThrow: () => ({ homeTeamName: HOME }) } as any;

/** A query builder that records every call and answers the terminal ones with canned data. */
function builder(
  answers: {
    getMany?: unknown[];
    getRawMany?: unknown[];
    getRawOne?: unknown;
    getCount?: number;
  } = {},
) {
  const calls: Array<[string, unknown[]]> = [];
  const proxy: any = new Proxy(
    {},
    {
      get: (_t, name: string) => {
        if (name === 'getMany') return async () => answers.getMany ?? [];
        if (name === 'getRawMany') return async () => answers.getRawMany ?? [];
        if (name === 'getRawOne')
          return async () => answers.getRawOne ?? { amount: 0, ticketCount: 0 };
        if (name === 'getCount') return async () => answers.getCount ?? 0;
        return (...args: unknown[]) => {
          calls.push([name, args]);
          return proxy;
        };
      },
    },
  );
  return { proxy, calls };
}

const wheres = (calls: Array<[string, unknown[]]>): unknown[][] =>
  calls.filter(([n]) => n === 'where' || n === 'andWhere').map(([, a]) => a);

const keepsHomeOnly = (calls: Array<[string, unknown[]]>): boolean =>
  wheres(calls).some(
    (a) => a[0] === 'm.homeTeam = :home' && (a[1] as { home: string }).home === HOME,
  );

const match = (id: string, home: boolean, over: Record<string, unknown> = {}) => ({
  id,
  homeTeam: home ? HOME : 'Szeged',
  awayTeam: home ? 'Diósgyőri VTK' : HOME,
  kickoffAt: new Date('2026-11-01T15:00:00Z'),
  status: MatchStatus.FINISHED,
  isSeasonPassEligible: true,
  ...over,
});

describe('the admin overview', () => {
  const home = match('home-1', true, { status: MatchStatus.SOLD_OUT });
  const away = match('away-1', false);
  const passSeatIds = Array.from({ length: PASS_COUNT }, (_, i) => `pass-seat-${i}`);

  function service() {
    const matchB = builder({ getMany: [home, away] });
    const seatB = builder({ getCount: SELLABLE });
    const ticketB = builder({
      getRawMany: [
        {
          matchId: 'home-1',
          status: 'paid',
          source: 'single',
          n: String(SELLABLE - PASS_COUNT),
          amount: '14000000',
        },
        {
          matchId: 'home-1',
          status: 'paid',
          source: 'season_pass',
          n: String(PASS_COUNT),
          amount: '0',
        },
      ],
    });
    const passB = builder({ getRawMany: [] });
    const ticketFind = jest.fn(async () =>
      passSeatIds.map((seatId) => ({ matchId: 'home-1', seatId })),
    );
    const svc = new AdminOverviewService(
      { createQueryBuilder: () => matchB.proxy } as any,
      { createQueryBuilder: () => seatB.proxy } as any,
      { createQueryBuilder: () => ticketB.proxy, find: ticketFind } as any,
      {
        createQueryBuilder: () => passB.proxy,
        find: async () =>
          passSeatIds.map((seatId) => ({
            seatId,
            validFrom: new Date('2026-07-01'),
            validUntil: new Date('2027-06-30'),
          })),
      } as any,
      {
        current: async () => ({
          label: '2026/2027',
          validFrom: new Date('2026-07-01'),
          validUntil: new Date('2027-06-30'),
        }),
      } as any,
      {} as any,
      config,
    );
    return { svc, ticketB };
  }

  it('lists the away match with dashes and reads a sold-out home match as exactly 100%', async () => {
    const { svc } = service();
    const out = await svc.getOverview('season', NOW);
    const [h, a] = out.matches;
    expect(h.occupancyPercent).toBe(100);
    expect(h.capacity).toBe(SELLABLE);
    expect(h.occupiedSeats).toBe(SELLABLE);
    expect(a.matchId).toBe('away-1');
    expect(a.isHome).toBe(false);
    expect([
      a.ticketCount,
      a.passesValid,
      a.passEntered,
      a.occupiedSeats,
      a.capacity,
      a.occupancyPercent,
      a.revenue,
    ]).toEqual([null, null, null, null, null, null, null]);
  });

  it('measures the season over home matches only', async () => {
    const { svc } = service();
    const { metrics } = await svc.getOverview('season', NOW);
    expect(metrics.averageOccupancyPercent).toBe(100);
    expect(metrics.finalMatchCount).toBe(1);
    expect(metrics.revenue).toBe(14_000_000);
    expect(metrics.ticketsSold).toBe(SELLABLE - PASS_COUNT);
  });

  it('does not even ask for the ticket sales of an away match', async () => {
    const { svc, ticketB } = service();
    await svc.getOverview('season', NOW);
    const ids = wheres(ticketB.calls).find((a) => String(a[0]).includes('IN'))![1] as {
      homeIds: string[];
    };
    expect(ids.homeIds).toEqual(['home-1']);
  });
});

describe('the seat heatmap', () => {
  it('takes only home matches into the played matches it counts', async () => {
    const matchB = builder({ getMany: [] });
    const svc = new AdminOverviewService(
      { createQueryBuilder: () => matchB.proxy } as any,
      { find: async () => [] } as any,
      { find: async () => [] } as any,
      { find: async () => [] } as any,
      { current: async () => null } as any,
      { find: async () => [] } as any,
      config,
    );
    await svc.getSeatSales(NOW);
    expect(keepsHomeOnly(matchB.calls)).toBe(true);
  });
});

describe('the revenue figures', () => {
  it('join the match and keep home matches in the day, month, daily and per-match queries', async () => {
    const ticketB = builder({ getRawMany: [], getRawOne: { amount: 0, ticketCount: 0 } });
    const passB = builder({ getRawMany: [], getRawOne: { amount: 0, passCount: 0 } });
    const svc = new AdminRevenueService(
      { createQueryBuilder: () => ticketB.proxy } as any,
      { createQueryBuilder: () => passB.proxy } as any,
      config,
    );
    await svc.getStats(30);
    // today, month, daily series, per match: four queries, each with the home condition and a match join.
    const homeFilters = wheres(ticketB.calls).filter((a) => a[0] === 'm.homeTeam = :home');
    expect(homeFilters).toHaveLength(4);
    const joins = ticketB.calls.filter(([n]) => n === 'innerJoin');
    expect(joins).toHaveLength(4);
  });
});

describe('the per-match occupancy report', () => {
  const seats = Array.from({ length: 10 }, (_, i) => ({
    id: `s${i}`,
    section: i < 6 ? 'A/1' : 'B/1',
  }));

  function service(m: ReturnType<typeof match>, soldSeatIds: string[]) {
    const seatB = builder({ getMany: seats });
    const pipeline = { get: () => undefined, exec: async () => [] };
    return new AdminOccupancyService(
      { findOne: async () => m } as any,
      { createQueryBuilder: () => seatB.proxy } as any,
      { find: async () => soldSeatIds.map((seatId) => ({ seatId })) } as any,
      { find: async () => [] } as any,
      { pipeline: () => pipeline } as any,
      config,
    );
  }

  it('refuses an away match: there is nothing to measure', async () => {
    await expect(
      service(match('away-1', false), []).getOccupancyForMatch('away-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads exactly 100% when every sellable seat of a home match is taken', async () => {
    const out = await service(
      match('home-1', true),
      seats.map((s) => s.id),
    ).getOccupancyForMatch('home-1');
    expect(out.totalCapacity).toBe(seats.length);
    expect(out.totalSold).toBe(seats.length);
    expect(out.totalAvailable).toBe(0);
    expect(out.occupancyPercent).toBe(100);
    expect(out.sectors.every((s) => s.occupancyPercent === 100)).toBe(true);
  });

  it('asks only for the sellable seats, so the away section is never in the denominator', async () => {
    const seatB = builder({ getMany: seats });
    const svc = new AdminOccupancyService(
      { findOne: async () => match('home-1', true) } as any,
      { createQueryBuilder: () => seatB.proxy } as any,
      { find: async () => [] } as any,
      { find: async () => [] } as any,
      { pipeline: () => ({ get: () => undefined, exec: async () => [] }) } as any,
      config,
    );
    await svc.getOccupancyForMatch('home-1');
    expect(wheres(seatB.calls).map((a) => a[0])).toEqual([
      'seat.isActive = 1',
      '(sector.isAway = 0 OR sector.isAway IS NULL)',
    ]);
  });
});
