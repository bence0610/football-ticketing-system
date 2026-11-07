import { ConfigService } from '@nestjs/config';
import { Match, MatchStatus, SeatCategory, TicketStatus } from '../../database/entities';
import { SeatAvailability } from '../seats/dto';
import { SeatsService } from '../seats/seats.service';
import { ChatbotContextService } from './chatbot-context.service';

const HOME = 'Kecskeméti TE';

function seat(id: string, section: string, row = 1, number = 1) {
  return {
    id,
    section,
    row,
    number,
    category: SeatCategory.STANDARD,
    priceModifier: 1,
    isAccessible: false,
    isActive: true,
  };
}

function makeMatch(id: string, homeTeam: string, awayTeam: string): Match {
  return {
    id,
    homeTeam,
    awayTeam,
    competition: 'NB I',
    venue: 'Széktói Stadion',
    kickoffAt: new Date('2030-01-01T17:00:00Z'),
    status: MatchStatus.ON_SALE,
    basePrice: '5000',
    capacity: 6,
  } as unknown as Match;
}

describe('ChatbotContextService', () => {
  // A: a1 sold, a2 free, a3 free.  B: b1 sold, b2 locked (Redis), b3 free.
  const seats = [
    seat('a1', 'A', 1, 1),
    seat('a2', 'A', 1, 2),
    seat('a3', 'A', 1, 3),
    seat('b1', 'B', 1, 1),
    seat('b2', 'B', 1, 2),
    seat('b3', 'B', 1, 3),
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
    matches = [makeMatch('m-home', HOME, 'Ferencváros'), makeMatch('m-away', 'Újpest', HOME)];

    // The REAL SeatsService (real sector-summary logic) over stubbed storage.
    seatsService = new SeatsService(
      { find: jest.fn(async () => seats) } as never,
      { find: jest.fn(async () => soldTickets) } as never,
      {
        findOne: jest.fn(async ({ where }) => matches.find((m) => m.id === where.id) ?? null),
      } as never,
      { find: jest.fn(async () => []) } as never,
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
        key === 'app' ? { homeTeamName: HOME } : { contextCacheTtlSeconds: 300 },
    } as unknown as ConfigService;
    service = new ChatbotContextService(
      { find: jest.fn(async () => matches) } as never,
      { createQueryBuilder: () => qb } as never,
      redis as never,
      seatsService,
      config,
    );
  });

  it("per-sector free counts equal the seat map's available seats", async () => {
    const snapshot = await service.getUpcomingMatchesSnapshot();

    for (const m of snapshot.upcomingMatches) {
      const map = await seatsService.findSeatsForMatch(m.id);
      expect(m.sectors).not.toBeNull();
      for (const sector of m.sectors!) {
        const onMap = map.seats.filter((s) => s.section === sector.section);
        const count = (status: SeatAvailability) =>
          onMap.filter((s) => s.status === status).length;
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
});
