import { ConfigService } from '@nestjs/config';
import { Match, MatchStatus, SeatCategory, TicketStatus } from '../../database/entities';
import { SeatAvailability } from '../seats/dto';
import { TIER_DEFINITIONS } from '../loyalty/loyalty.constants';
import { seatUnitPrice } from '../seats/seat-pricing';
import { MAX_SEATS_PER_ORDER } from '../payments/dto/create-payment-intent.dto';
import { SeatsService } from '../seats/seats.service';
import { ChatbotContextService } from './chatbot-context.service';

const HOME = 'Kecskeméti TE';
const LOYALTY_CONFIG = {
  registrationPoints: 11,
  profileCompletionPoints: 22,
  ticketPointsPerTicket: 33,
  seasonPassPoints: 44,
  passLoanPoints: 55,
  carryoverPercent: 66,
};

function seat(id: string, section: string, row = 1, number = 1, priceModifier = 1) {
  return {
    id,
    section,
    row,
    number,
    category: SeatCategory.STANDARD,
    priceModifier,
    isAccessible: false,
    isActive: true,
  };
}

function makeMatch(
  id: string,
  homeTeam: string,
  awayTeam: string,
  kickoffAt = new Date('2030-01-01T17:00:00Z'),
  description?: string,
): Match {
  return {
    id,
    homeTeam,
    awayTeam,
    competition: 'NB I',
    venue: 'Széktói Stadion',
    kickoffAt,
    description,
    status: MatchStatus.ON_SALE,
    basePrice: '5000',
    capacity: 6,
  } as unknown as Match;
}

describe('ChatbotContextService', () => {
  // A: a1 sold, a2 free, a3 free.  B: b1 sold, b2 locked (Redis), b3 free.
  const seats = [
    seat('a1', 'A', 1, 1, 1.5),
    seat('a2', 'A', 1, 2, 1.5),
    seat('a3', 'A', 1, 3, 1.5),
    seat('b1', 'B', 1, 1),
    seat('b2', 'B', 1, 2),
    seat('b3', 'B', 1, 3),
    // A sector with two price points, to exercise the min–max range.
    seat('c1', 'C', 1, 1, 1),
    seat('c2', 'C', 1, 2, 2.5),
  ];
  const soldTickets = [
    { seatId: 'a1', status: TicketStatus.PAID },
    { seatId: 'b1', status: TicketStatus.USED },
  ];

  let cache: Map<string, string>;
  let redis: { get: jest.Mock; set: jest.Mock; pipeline: jest.Mock };
  let matches: Match[];
  let seatsService: SeatsService;
  let service: ChatbotContextService;
  let seasonPasses: { listPrices: jest.Mock };
  let weather: { getForMatch: jest.Mock };

  beforeEach(() => {
    cache = new Map();
    redis = {
      get: jest.fn(async (k: string) => cache.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        cache.set(k, v);
        return 'OK';
      }),
      pipeline: jest.fn(() => {
        const keys: string[] = [];
        const pipe = {
          get: (k: string) => {
            keys.push(k);
            return pipe;
          },
          // Only b2 is locked; the value carries the seat id like the real lock.
          exec: async () => keys.map((k) => [null, k.includes('b2') ? 'owner:b2' : null]),
        };
        return pipe;
      }),
    };
    const soon = new Date(Date.now() + 48 * 3_600_000);
    seasonPasses = {
      listPrices: jest.fn(async () => [
        {
          sectionId: 'VIP',
          sectionName: 'VIP szektor',
          price: 45000,
          currency: 'HUF',
          seasonLabel: '2026/2027',
          validFrom: '2026-08-01',
          validUntil: '2027-06-30',
        },
        {
          sectionId: 'B',
          sectionName: 'B szektor',
          price: 30000,
          currency: 'HUF',
          seasonLabel: '2026/2027',
          validFrom: '2026-08-01',
          validUntil: '2027-06-30',
        },
      ]),
    };
    weather = {
      getForMatch: jest.fn(async (id: string) => ({
        matchId: id,
        city: 'Kecskemet,HU',
        forecastFor: 'x',
        summary: 'Gyenge eső',
        temperatureCelsius: 11.6,
        precipitationMmPerHour: 1,
        precipitationProbability: 0.65,
        windSpeedMs: 3,
        rainWarning: true,
        fallback: false,
      })),
    };
    matches = [
      makeMatch('m-home', HOME, 'Ferencváros', soon, 'x'.repeat(500)),
      makeMatch('m-away', 'Újpest', HOME),
    ];

    // The REAL SeatsService (real sector-summary logic) over stubbed storage.
    seatsService = new SeatsService(
      { find: jest.fn(async () => seats) } as never,
      { find: jest.fn(async () => soldTickets) } as never,
      {
        findOne: jest.fn(async ({ where }) => matches.find((m) => m.id === where.id) ?? null),
      } as never,
      { find: jest.fn(async () => []) } as never,
      // sectors table: B is covered, A is open, C has no row (unknown)
      {
        find: jest.fn(async () => [
          { code: 'A', name: 'A szektor', isCovered: false },
          { code: 'B', name: 'B szektor', isCovered: true },
        ]),
      } as never,
      redis as never,
    );

    const qb = {
      select: () => qb,
      addSelect: () => qb,
      where: () => qb,
      andWhere: () => qb,
      groupBy: () => qb,
      getRawMany: async () => [
        { matchId: 'm-home', soldCount: '2' },
        { matchId: 'm-away', soldCount: '2' },
      ],
    };
    const config = {
      getOrThrow: (key: string) =>
        key === 'app'
          ? { homeTeamName: HOME }
          : key === 'loyalty'
            ? LOYALTY_CONFIG
            : key === 'redis'
              ? { seatLockTtlSeconds: 300 }
              : key === 'cron'
                ? { loanInvitationTtlHours: 72 }
                : key === 'waitlist'
                  ? { claimTtlSeconds: 600 }
                  : { contextCacheTtlSeconds: 300 },
    } as unknown as ConfigService;
    service = new ChatbotContextService(
      { find: jest.fn(async () => matches) } as never,
      { createQueryBuilder: () => qb } as never,
      redis as never,
      seatsService,
      seasonPasses as never,
      weather as never,
      config,
    );
  });

  it("includes each sector's coverage, from the same data as the seat map", async () => {
    const snapshot = await service.getUpcomingMatchesSnapshot();

    for (const m of snapshot.upcomingMatches) {
      const map = await seatsService.findSeatsForMatch(m.id);
      for (const sector of m.sectors!) {
        const onMap = map.sectorSummary.find((s) => s.section === sector.section)!;
        expect(sector.covered).toBe(onMap.covered);
      }
      const by = (n: string) => m.sectors!.find((s) => s.section === n)!;
      expect(by('B').covered).toBe(true);
      expect(by('A').covered).toBe(false);
      expect(by('C').covered).toBeNull(); // no row: unknown, not "open"
    }
  });

  it("per-sector free counts equal the seat map's available seats", async () => {
    const snapshot = await service.getUpcomingMatchesSnapshot();

    for (const m of snapshot.upcomingMatches) {
      const map = await seatsService.findSeatsForMatch(m.id);
      expect(m.sectors).not.toBeNull();
      for (const sector of m.sectors!) {
        const onMap = map.seats.filter((s) => s.section === sector.section);
        const count = (status: SeatAvailability) => onMap.filter((s) => s.status === status).length;
        expect(sector.free).toBe(count(SeatAvailability.AVAILABLE));
        expect(sector.sold).toBe(count(SeatAvailability.SOLD));
        expect(sector.locked).toBe(count(SeatAvailability.LOCKED));
        expect(sector.total).toBe(onMap.length);
      }
    }
    // Concrete numbers, so a shared bug on both sides cannot hide.
    const sectors = snapshot.upcomingMatches[0].sectors!;
    expect(sectors.find((s) => s.section === 'A')).toMatchObject({ free: 2, sold: 1, locked: 0 });
    expect(sectors.find((s) => s.section === 'B')).toMatchObject({ free: 1, sold: 1, locked: 1 });
  });

  it('sector prices equal what the seat map reports for the same seats', async () => {
    const snapshot = await service.getUpcomingMatchesSnapshot();
    for (const m of snapshot.upcomingMatches) {
      const map = await seatsService.findSeatsForMatch(m.id);
      for (const sector of m.sectors!) {
        const prices = map.seats.filter((s) => s.section === sector.section).map((s) => s.price);
        expect(sector.minPrice).toBe(Math.min(...prices));
        expect(sector.maxPrice).toBe(Math.max(...prices));
      }
    }
    // Concrete: basePrice 5000 × modifier, rounded — same rule as checkout.
    const sectors = snapshot.upcomingMatches[0].sectors!;
    const by = (n: string) => sectors.find((s) => s.section === n)!;
    expect(by('A')).toMatchObject({ minPrice: 7500, maxPrice: 7500 });
    expect(by('B')).toMatchObject({ minPrice: 5000, maxPrice: 5000 });
    expect(by('C')).toMatchObject({ minPrice: 5000, maxPrice: 12500 });
    for (const s of sectors) {
      expect(s.minPrice).toBe(seatUnitPrice(5000, s.section === 'A' ? 1.5 : 1));
    }
  });

  it('flags home and away matches with the shared home-team rule', async () => {
    const snapshot = await service.getUpcomingMatchesSnapshot();
    expect(snapshot.upcomingMatches.find((m) => m.id === 'm-home')!.isHome).toBe(true);
    expect(snapshot.upcomingMatches.find((m) => m.id === 'm-away')!.isHome).toBe(false);
  });

  it('marks sectors unavailable (null) instead of empty when the seat map fails', async () => {
    jest.spyOn(seatsService, 'findSeatsForMatch').mockRejectedValue(new Error('db down'));
    const snapshot = await service.getUpcomingMatchesSnapshot();
    expect(snapshot.upcomingMatches.every((m) => m.sectors === null)).toBe(true);
  });

  it('serves the second call from the Redis cache', async () => {
    const spy = jest.spyOn(seatsService, 'findSeatsForMatch');
    await service.getUpcomingMatchesSnapshot();
    const calls = spy.mock.calls.length;
    const again = await service.getUpcomingMatchesSnapshot();
    expect(spy.mock.calls.length).toBe(calls);
    expect(again.upcomingMatches).toHaveLength(2);
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 300);
  });

  describe('loyalty rules', () => {
    it('tier names, thresholds and discounts equal loyalty.constants (no hand-typed copy)', async () => {
      const { loyalty } = await service.getUpcomingMatchesSnapshot();
      expect(loyalty.tiers).toEqual(
        TIER_DEFINITIONS.map((t) => ({
          tier: t.tier,
          label: t.label,
          minPoints: t.minPoints,
          discountPercent: t.discountPercent,
        })),
      );
      expect(loyalty.tiers.map((t) => t.minPoints)).toEqual(
        TIER_DEFINITIONS.map((t) => t.minPoints),
      );
    });

    it('earning amounts come from the loyalty config', async () => {
      const { loyalty } = await service.getUpcomingMatchesSnapshot();
      expect(loyalty.earning).toEqual({
        registration: 11,
        profileCompletion: 22,
        perTicket: 33,
        seasonPass: 44,
        passLoan: 55,
      });
      expect(loyalty.carryoverPercent).toBe(66);
    });

    it('is present, and current, also when the matches come from the Redis cache', async () => {
      await service.getUpcomingMatchesSnapshot(); // fills the cache
      // A cache entry written before the loyalty section existed.
      for (const [k, v] of cache) {
        const { loyalty: _drop, ...old } = JSON.parse(v);
        cache.set(k, JSON.stringify(old));
      }
      const cached = await service.getUpcomingMatchesSnapshot();
      expect(cached.loyalty.tiers).toHaveLength(TIER_DEFINITIONS.length);
    });

    it('never stores the loyalty rules in the cache', async () => {
      await service.getUpcomingMatchesSnapshot();
      const stored = JSON.parse([...cache.values()][0]);
      expect(stored.loyalty).toBeUndefined();
    });
  });

  describe('season pass, weather, rules', () => {
    it('season-pass prices are exactly what SeasonPassesService.listPrices returns', async () => {
      const { seasonPass } = await service.getUpcomingMatchesSnapshot();
      const source = await seasonPasses.listPrices();
      expect(seasonPass).toEqual({
        seasonLabel: '2026/2027',
        validFrom: '2026-08-01',
        validUntil: '2027-06-30',
        prices: source.map((p) => ({
          section: p.sectionId,
          sectionName: p.sectionName,
          price: p.price,
        })),
      });
    });

    it('seasonPass is null (not an empty list) when the price list fails or is empty', async () => {
      seasonPasses.listPrices.mockRejectedValueOnce(new Error('db'));
      expect((await service.getUpcomingMatchesSnapshot()).seasonPass).toBeNull();
      cache.clear();
      seasonPasses.listPrices.mockResolvedValueOnce([]);
      expect((await service.getUpcomingMatchesSnapshot()).seasonPass).toBeNull();
    });

    it('weather is included inside the forecast horizon and rounded', async () => {
      const { upcomingMatches } = await service.getUpcomingMatchesSnapshot();
      expect(upcomingMatches.find((m) => m.id === 'm-home')!.weather).toEqual({
        summary: 'Gyenge eső',
        temperatureCelsius: 12,
        precipitationProbabilityPercent: 65,
        rainWarning: true,
      });
    });

    it('never asks for, nor shows, a forecast for a match beyond the horizon', async () => {
      const { upcomingMatches } = await service.getUpcomingMatchesSnapshot();
      expect(upcomingMatches.find((m) => m.id === 'm-away')!.weather).toBeNull();
      expect(weather.getForMatch).not.toHaveBeenCalledWith('m-away');
    });

    it('drops the weather when the weather service only has its fallback or fails', async () => {
      weather.getForMatch.mockResolvedValueOnce({ fallback: true });
      expect(
        (await service.getUpcomingMatchesSnapshot()).upcomingMatches.find((m) => m.id === 'm-home')!
          .weather,
      ).toBeNull();
      cache.clear();
      weather.getForMatch.mockRejectedValueOnce(new Error('timeout'));
      expect(
        (await service.getUpcomingMatchesSnapshot()).upcomingMatches.find((m) => m.id === 'm-home')!
          .weather,
      ).toBeNull();
    });

    it('operational rules come from the configuration, not from literals', async () => {
      const { rules } = await service.getUpcomingMatchesSnapshot();
      expect(rules).toEqual({
        seatHoldMinutes: 5,
        maxSeatsPerOrder: MAX_SEATS_PER_ORDER,
        loanInvitationTtlHours: 72,
        waitlistClaimMinutes: 10,
      });
    });

    it('truncates long match descriptions to keep the prompt small', async () => {
      const m = (await service.getUpcomingMatchesSnapshot()).upcomingMatches.find(
        (x) => x.id === 'm-home',
      )!;
      expect(m.description!.length).toBeLessThanOrEqual(240);
      expect(m.description!.endsWith('…')).toBe(true);
    });

    it('contains only whitelisted, non-personal fields', async () => {
      const snap = await service.getUpcomingMatchesSnapshot();
      expect(Object.keys(snap).sort()).toEqual(
        ['generatedAt', 'loyalty', 'rules', 'seasonPass', 'upcomingMatches'].sort(),
      );
      expect(Object.keys(snap.upcomingMatches[0]).sort()).toEqual(
        [
          'id',
          'isHome',
          'homeTeam',
          'awayTeam',
          'competition',
          'venue',
          'kickoffAt',
          'status',
          'basePrice',
          'capacity',
          'soldSeats',
          'availableSeats',
          'occupancyPercent',
          'sectors',
          'description',
          'weather',
        ].sort(),
      );
      // Belt and braces: nothing that looks like an email or a user/ticket/payment id.
      expect(JSON.stringify(snap)).not.toMatch(/@|userId|ticketId|paymentIntent|email/i);
    });

    it('serves old cache entries (no seasonPass/weather yet) without crashing', async () => {
      await service.getUpcomingMatchesSnapshot();
      for (const [k, v] of cache) {
        const old = JSON.parse(v);
        delete old.seasonPass;
        cache.set(k, JSON.stringify(old));
      }
      const snap = await service.getUpcomingMatchesSnapshot();
      expect(snap.seasonPass).toBeNull();
      expect(snap.rules.maxSeatsPerOrder).toBe(MAX_SEATS_PER_ORDER);
    });
  });
});
