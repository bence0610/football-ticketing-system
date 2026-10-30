import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { Match, MatchStatus, Competition, Ticket, TicketStatus } from '../../database/entities';
import { OCCUPYING_TICKET_STATUSES } from '../tickets/ticket-occupancy';

/**
 * Integration tests for MatchesController.
 *
 * Strategy: NestJS TestingModule with real service + real controller logic,
 * but with Repository and ConfigService replaced by lightweight in-memory stubs.
 * This validates the full request→service→DTO pipeline without a live database.
 *
 * Bootstrapping a Nest TestingModule + supertest server is expensive:
 * doing it per-test caused cold-start ts-jest compilation to exceed the
 * default 5 s Jest timeout on slower CI hosts when running in parallel.
 * We compile once in beforeAll and reconfigure shared mocks per test.
 *
 * Scenarios covered:
 *  GET /matches
 *   - returns all matches with availableSeats calculated correctly
 *   - filters by status query param
 *   - filters by date range (from / to)
 *   - returns 200 with empty array when there are no matches
 *
 *  GET /matches/upcoming
 *   - returns only future ON_SALE / SCHEDULED matches
 *   - does NOT include past matches
 *   - does NOT include FINISHED / CANCELLED matches
 *   - limits to max 5 results
 *
 *  GET /matches/:id
 *   - returns 200 with MatchDetailDto for an existing match
 *   - returns 404 when match does not exist
 *   - returns 400 on an invalid (non-UUID) id
 */

// Bootstrapping a Nest TestingModule + supertest server per test can exceed
// the 5 s default on slower CI hosts; bump the timeout for this suite only.
jest.setTimeout(30_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const UUID_2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const NON_EXISTENT_UUID = 'ffffffff-ffff-4fff-bfff-ffffffffffff';

const HOME_TEAM = 'Kecskeméti TE';

function makeMatch(overrides: Partial<Match> = {}): Match {
  const now = new Date();
  const match = new Match();
  match.id = UUID_1;
  match.homeTeam = HOME_TEAM;
  match.awayTeam = 'Ferencvárosi TC';
  match.competition = Competition.NB1;
  match.venue = 'Széktói Stadion, Kecskemét';
  match.kickoffAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // +7 days
  match.status = MatchStatus.ON_SALE;
  match.capacity = 8200;
  match.basePrice = '3500.00';
  match.isSeasonPassEligible = true;
  match.createdAt = now;
  match.updatedAt = now;
  match.version = 1;
  return Object.assign(match, overrides);
}

function makeTicket(matchId: string, seatId: string, status: TicketStatus): Ticket {
  const t = new Ticket();
  t.id = `ticket-${seatId}`;
  t.matchId = matchId;
  t.seatId = seatId;
  t.userId = 'user-1';
  t.status = status;
  t.pricePaid = '3500.00';
  t.currency = 'HUF';
  t.qrCode = `qr-${seatId}`;
  t.createdAt = new Date();
  t.updatedAt = new Date();
  t.version = 1;
  return t;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MatchesController – integration', () => {
  let app: INestApplication;

  // Shared QB stubs — reconfigured per test via setData().
  let matchQb: {
    orderBy: jest.Mock;
    limit: jest.Mock;
    andWhere: jest.Mock;
    where: jest.Mock;
    getMany: jest.Mock;
    getOne: jest.Mock;
  };
  let ticketQb: {
    select: jest.Mock;
    addSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    groupBy: jest.Mock;
    getRawMany: jest.Mock;
  };
  let matchRepoMock: {
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
    _qb: typeof matchQb;
  };
  let ticketRepoMock: {
    createQueryBuilder: jest.Mock;
    _qb: typeof ticketQb;
  };

  // Compile the NestJS module once for the whole suite.
  beforeAll(async () => {
    matchQb = {
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
    };
    ticketQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    matchRepoMock = {
      createQueryBuilder: jest.fn().mockReturnValue(matchQb),
      findOne: jest.fn().mockResolvedValue(null),
      _qb: matchQb,
    };
    ticketRepoMock = {
      createQueryBuilder: jest.fn().mockReturnValue(ticketQb),
      _qb: ticketQb,
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [MatchesController],
      providers: [
        MatchesService,
        { provide: getRepositoryToken(Match), useValue: matchRepoMock },
        { provide: getRepositoryToken(Ticket), useValue: ticketRepoMock },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue({ homeTeamName: HOME_TEAM }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  // Reset mock call histories and restore default return values between tests
  // so assertions on QB calls don't bleed across.
  beforeEach(() => {
    jest.clearAllMocks();
    matchQb.orderBy.mockReturnThis();
    matchQb.limit.mockReturnThis();
    matchQb.andWhere.mockReturnThis();
    matchQb.where.mockReturnThis();
    matchQb.getMany.mockResolvedValue([]);
    matchQb.getOne.mockResolvedValue(null);
    ticketQb.select.mockReturnThis();
    ticketQb.addSelect.mockReturnThis();
    ticketQb.where.mockReturnThis();
    ticketQb.andWhere.mockReturnThis();
    ticketQb.groupBy.mockReturnThis();
    ticketQb.getRawMany.mockResolvedValue([]);
    matchRepoMock.createQueryBuilder.mockReturnValue(matchQb);
    matchRepoMock.findOne.mockResolvedValue(null);
    ticketRepoMock.createQueryBuilder.mockReturnValue(ticketQb);
  });

  /**
   * Configures the shared QB mocks to return the given matches and tickets.
   * No module is created — the app from beforeAll is reused.
   */
  function setData(matches: Match[], tickets: Ticket[] = []): void {
    matchQb.getMany.mockResolvedValue(matches);
    matchRepoMock.findOne.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
      Promise.resolve(matches.find((m) => m.id === id) ?? null),
    );

    const aggregated = Object.values(
      tickets
        .filter((t) => OCCUPYING_TICKET_STATUSES.includes(t.status))
        .reduce<Record<string, { matchId: string; soldCount: number }>>((acc, t) => {
          if (!acc[t.matchId]) acc[t.matchId] = { matchId: t.matchId, soldCount: 0 };
          acc[t.matchId].soldCount += 1;
          return acc;
        }, {}),
    );
    ticketQb.getRawMany.mockResolvedValue(aggregated);
  }

  // -------------------------------------------------------------------------
  // GET /matches
  // -------------------------------------------------------------------------

  describe('GET /matches', () => {
    it('should return 200 with a list of matches and correct availableSeats calculation', async () => {
      const match = makeMatch({ id: UUID_1, capacity: 100 });
      const tickets = [
        makeTicket(UUID_1, 'seat-1', TicketStatus.PAID),
        makeTicket(UUID_1, 'seat-2', TicketStatus.PENDING_PAYMENT),
        makeTicket(UUID_1, 'seat-3', TicketStatus.CANCELLED), // should NOT be counted
      ];

      setData([match], tickets);

      const res = await request(app.getHttpServer()).get('/matches').expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);

      const item = res.body[0];
      // capacity(100) - sold(2 paid/pending) = 98
      expect(item.availableSeats).toBe(98);
      expect(item.capacity).toBe(100);
      expect(item.id).toBe(UUID_1);
    });

    it('should set isHome to true when homeTeam matches HOME_TEAM_NAME', async () => {
      setData([makeMatch({ homeTeam: HOME_TEAM })]);

      const res = await request(app.getHttpServer()).get('/matches').expect(200);
      expect(res.body[0].isHome).toBe(true);
    });

    it('should set isHome to false when homeTeam differs from HOME_TEAM_NAME', async () => {
      setData([makeMatch({ homeTeam: 'Ferencvárosi TC', awayTeam: HOME_TEAM })]);

      const res = await request(app.getHttpServer()).get('/matches').expect(200);
      expect(res.body[0].isHome).toBe(false);
    });

    it('should return 200 with an empty array when there are no matches', async () => {
      setData([]);

      const res = await request(app.getHttpServer()).get('/matches').expect(200);
      expect(res.body).toEqual([]);
    });

    it('should pass status filter through to the query builder', async () => {
      const onSaleMatch = makeMatch({ id: UUID_1, status: MatchStatus.ON_SALE });
      setData([onSaleMatch]);

      const res = await request(app.getHttpServer()).get('/matches?status=on_sale').expect(200);

      const qb = matchRepoMock._qb;
      expect(qb.andWhere).toHaveBeenCalledWith(
        'match.status = :status',
        expect.objectContaining({ status: MatchStatus.ON_SALE }),
      );
      expect(res.body[0].status).toBe('on_sale');
    });

    it('should reject an invalid status value with 400', async () => {
      await request(app.getHttpServer()).get('/matches?status=invalid_status').expect(400);
    });

    it('should apply the from date filter through to the query builder', async () => {
      setData([makeMatch()]);

      const fromDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await request(app.getHttpServer()).get(`/matches?from=${fromDate}`).expect(200);

      const qb = matchRepoMock._qb;
      expect(qb.andWhere).toHaveBeenCalledWith(
        'match.kickoffAt >= :from',
        expect.objectContaining({ from: expect.any(Date) }),
      );
    });

    it('should cap results at the requested limit', async () => {
      setData([makeMatch()]);

      await request(app.getHttpServer()).get('/matches?limit=10').expect(200);

      expect(matchRepoMock._qb.limit).toHaveBeenCalledWith(10);
    });

    it('should return 400 when limit exceeds max (100)', async () => {
      await request(app.getHttpServer()).get('/matches?limit=200').expect(400);
    });

    it('should contain all required DTO fields in each response item', async () => {
      setData([makeMatch()]);

      const res = await request(app.getHttpServer()).get('/matches').expect(200);
      const item = res.body[0];

      const requiredFields = [
        'id',
        'homeTeam',
        'awayTeam',
        'competition',
        'venue',
        'kickoffAt',
        'status',
        'basePrice',
        'capacity',
        'availableSeats',
        'isHome',
        'isSeasonPassEligible',
      ];
      for (const field of requiredFields) {
        expect(item).toHaveProperty(field);
      }
    });

    it('should return availableSeats = capacity when there are no sold tickets', async () => {
      setData([makeMatch({ id: UUID_1, capacity: 50 })], []);

      const res = await request(app.getHttpServer()).get('/matches').expect(200);
      expect(res.body[0].availableSeats).toBe(50);
    });

    it('should clamp availableSeats to 0 when sold > capacity', async () => {
      const match = makeMatch({ id: UUID_1, capacity: 2 });
      const tickets = [
        makeTicket(UUID_1, 'seat-1', TicketStatus.PAID),
        makeTicket(UUID_1, 'seat-2', TicketStatus.PAID),
        makeTicket(UUID_1, 'seat-3', TicketStatus.PAID), // oversold edge case
      ];
      setData([match], tickets);

      const res = await request(app.getHttpServer()).get('/matches').expect(200);
      expect(res.body[0].availableSeats).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // GET /matches/upcoming
  // -------------------------------------------------------------------------

  describe('GET /matches/upcoming', () => {
    it('should return only future ON_SALE and SCHEDULED matches', async () => {
      const futureOnSale = makeMatch({
        id: UUID_1,
        status: MatchStatus.ON_SALE,
        kickoffAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
      });
      const futureScheduled = makeMatch({
        id: UUID_2,
        status: MatchStatus.SCHEDULED,
        kickoffAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      });

      setData([futureOnSale, futureScheduled]);

      const res = await request(app.getHttpServer()).get('/matches/upcoming').expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const qb = matchRepoMock._qb;
      expect(qb.where).toHaveBeenCalledWith(
        'match.status IN (:...statuses)',
        expect.objectContaining({
          statuses: expect.arrayContaining([MatchStatus.ON_SALE, MatchStatus.SCHEDULED]),
        }),
      );
    });

    it('should NOT include FINISHED matches in upcoming results', async () => {
      // Mock returns empty list, simulating the DB filtering out finished matches.
      // matchQb.getMany already resolves to [] from beforeEach.

      const res = await request(app.getHttpServer()).get('/matches/upcoming').expect(200);
      expect(res.body).toHaveLength(0);
      expect(matchRepoMock._qb.andWhere).toHaveBeenCalledWith(
        'match.kickoffAt > :now',
        expect.objectContaining({ now: expect.any(Date) }),
      );
    });

    it('should limit results to at most 5 matches', async () => {
      const matches = Array.from({ length: 6 }, (_, i) =>
        makeMatch({
          id: `aaaaaaaa-0000-4000-8000-00000000000${i + 1}`,
          kickoffAt: new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000),
        }),
      );

      setData(matches);

      await request(app.getHttpServer()).get('/matches/upcoming').expect(200);

      expect(matchRepoMock._qb.limit).toHaveBeenCalledWith(5);
    });

    it('should return an empty array when there are no upcoming matches', async () => {
      // matchQb.getMany already resolves to [] from beforeEach.
      const res = await request(app.getHttpServer()).get('/matches/upcoming').expect(200);
      expect(res.body).toEqual([]);
    });

    it('should return items ordered by kickoffAt ASC', async () => {
      const match1 = makeMatch({
        id: UUID_1,
        kickoffAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      });
      const match2 = makeMatch({
        id: UUID_2,
        kickoffAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      });
      setData([match1, match2]);

      await request(app.getHttpServer()).get('/matches/upcoming').expect(200);

      expect(matchRepoMock._qb.orderBy).toHaveBeenCalledWith('match.kickoffAt', 'ASC');
    });
  });

  // -------------------------------------------------------------------------
  // GET /matches/:id
  // -------------------------------------------------------------------------

  describe('GET /matches/:id', () => {
    it('should return 200 with a MatchDetailDto for an existing match', async () => {
      const match = makeMatch({ id: UUID_1 });
      setData([match]);

      const res = await request(app.getHttpServer()).get(`/matches/${UUID_1}`).expect(200);

      expect(res.body.id).toBe(UUID_1);
      expect(res.body.homeTeam).toBe(match.homeTeam);
      expect(res.body.awayTeam).toBe(match.awayTeam);
      expect(res.body).toHaveProperty('createdAt');
      expect(res.body).toHaveProperty('updatedAt');
    });

    it('should calculate availableSeats correctly for a single match', async () => {
      const match = makeMatch({ id: UUID_1, capacity: 50 });
      const tickets = [
        makeTicket(UUID_1, 'seat-1', TicketStatus.PAID),
        makeTicket(UUID_1, 'seat-2', TicketStatus.PAID),
      ];
      setData([match], tickets);

      const res = await request(app.getHttpServer()).get(`/matches/${UUID_1}`).expect(200);

      expect(res.body.availableSeats).toBe(48); // 50 - 2
    });

    it('should return 404 when the match does not exist', async () => {
      // matchRepoMock.findOne already returns null from beforeEach.
      const res = await request(app.getHttpServer())
        .get(`/matches/${NON_EXISTENT_UUID}`)
        .expect(404);

      expect(res.body.message).toContain(NON_EXISTENT_UUID);
    });

    it('should return 400 for a non-UUID id', async () => {
      await request(app.getHttpServer()).get('/matches/not-a-uuid').expect(400);
    });

    it('should include isHome flag correctly', async () => {
      const match = makeMatch({ id: UUID_1, homeTeam: HOME_TEAM });
      setData([match]);

      const res = await request(app.getHttpServer()).get(`/matches/${UUID_1}`).expect(200);

      expect(res.body.isHome).toBe(true);
    });

    it('should round basePrice to an integer in the response', async () => {
      const match = makeMatch({ id: UUID_1, basePrice: '3500.99' });
      setData([match]);

      const res = await request(app.getHttpServer()).get(`/matches/${UUID_1}`).expect(200);

      expect(Number.isInteger(res.body.basePrice)).toBe(true);
      expect(res.body.basePrice).toBe(3501);
    });
  });
});
