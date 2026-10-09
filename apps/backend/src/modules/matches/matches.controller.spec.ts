import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { Match, MatchStatus, Competition, Ticket, TicketStatus } from '../../database/entities';

/**
 * Integration tests for MatchesController.
 *
 * Strategy: NestJS TestingModule with real service + real controller logic,
 * but with Repository and ConfigService replaced by lightweight in-memory stubs.
 * This validates the full request→service→DTO pipeline without a live database.
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
// Repository mock factory
// ---------------------------------------------------------------------------

/**
 * Creates a mock TypeORM repository whose QueryBuilder returns the supplied
 * items.  The mock is intentionally minimal — only the surface area used by
 * MatchesService is implemented.
 */
function makeMatchRepoMock(matches: Match[]) {
  const qb = {
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(matches),
    getOne: jest.fn().mockResolvedValue(matches[0] ?? null),
  };
  return {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    findOne: jest
      .fn()
      .mockImplementation(({ where: { id } }) =>
        Promise.resolve(matches.find((m) => m.id === id) ?? null),
      ),
    _qb: qb, // expose for per-test overrides
  };
}

function makeTicketRepoMock(tickets: Ticket[]) {
  const qb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(
      // Aggregate by matchId — mirrors the SQL GROUP BY the service executes
      Object.values(
        tickets
          .filter((t) => [TicketStatus.PAID, TicketStatus.PENDING_PAYMENT].includes(t.status))
          .reduce<Record<string, { matchId: string; soldCount: number }>>((acc, t) => {
            if (!acc[t.matchId]) acc[t.matchId] = { matchId: t.matchId, soldCount: 0 };
            acc[t.matchId].soldCount += 1;
            return acc;
          }, {}),
      ),
    ),
  };
  return {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    _qb: qb,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MatchesController – integration', () => {
  let app: INestApplication;
  let matchRepoMock: ReturnType<typeof makeMatchRepoMock>;
  let ticketRepoMock: ReturnType<typeof makeTicketRepoMock>;

  async function buildApp(matches: Match[], tickets: Ticket[] = []): Promise<void> {
    matchRepoMock = makeMatchRepoMock(matches);
    ticketRepoMock = makeTicketRepoMock(tickets);

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
    // Enable the same validation pipe the production app uses
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  }

  afterEach(async () => {
    await app?.close();
  });

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

      await buildApp([match], tickets);

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
      await buildApp([makeMatch({ homeTeam: HOME_TEAM })]);

      const res = await request(app.getHttpServer()).get('/matches').expect(200);
      expect(res.body[0].isHome).toBe(true);
    });

    it('should set isHome to false when homeTeam differs from HOME_TEAM_NAME', async () => {
      await buildApp([makeMatch({ homeTeam: 'Ferencvárosi TC', awayTeam: HOME_TEAM })]);

      const res = await request(app.getHttpServer()).get('/matches').expect(200);
      expect(res.body[0].isHome).toBe(false);
    });

    it('should return 200 with an empty array when there are no matches', async () => {
      matchRepoMock = makeMatchRepoMock([]);
      ticketRepoMock = makeTicketRepoMock([]);

      await buildApp([]);

      const res = await request(app.getHttpServer()).get('/matches').expect(200);
      expect(res.body).toEqual([]);
    });

    it('should pass status filter through to the query builder', async () => {
      const onSaleMatch = makeMatch({ id: UUID_1, status: MatchStatus.ON_SALE });
      await buildApp([onSaleMatch]);

      const res = await request(app.getHttpServer()).get('/matches?status=on_sale').expect(200);

      // The mock returns the single match regardless, but we verify the QB
      // received the andWhere call with the correct parameter.
      const qb = matchRepoMock._qb;
      expect(qb.andWhere).toHaveBeenCalledWith(
        'match.status = :status',
        expect.objectContaining({ status: MatchStatus.ON_SALE }),
      );
      expect(res.body[0].status).toBe('on_sale');
    });

    it('should reject an invalid status value with 400', async () => {
      await buildApp([]);

      await request(app.getHttpServer()).get('/matches?status=invalid_status').expect(400);
    });

    it('should apply the from date filter through to the query builder', async () => {
      await buildApp([makeMatch()]);

      const fromDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await request(app.getHttpServer()).get(`/matches?from=${fromDate}`).expect(200);

      const qb = matchRepoMock._qb;
      expect(qb.andWhere).toHaveBeenCalledWith(
        'match.kickoffAt >= :from',
        expect.objectContaining({ from: expect.any(Date) }),
      );
    });

    it('should cap results at the requested limit', async () => {
      await buildApp([makeMatch()]);

      await request(app.getHttpServer()).get('/matches?limit=10').expect(200);

      expect(matchRepoMock._qb.limit).toHaveBeenCalledWith(10);
    });

    it('should return 400 when limit exceeds max (100)', async () => {
      await buildApp([]);
      await request(app.getHttpServer()).get('/matches?limit=200').expect(400);
    });

    it('should contain all required DTO fields in each response item', async () => {
      await buildApp([makeMatch()]);

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
      await buildApp([makeMatch({ id: UUID_1, capacity: 50 })], []);

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
      await buildApp([match], tickets);

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

      // The mock returns both; the service filters via the QBs where clause.
      // We seed both into the mock so they're returned.
      await buildApp([futureOnSale, futureScheduled]);

      const res = await request(app.getHttpServer()).get('/matches/upcoming').expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // Verify the QBs where was invoked with the correct statuses
      const qb = matchRepoMock._qb;
      expect(qb.where).toHaveBeenCalledWith(
        'match.status IN (:...statuses)',
        expect.objectContaining({
          statuses: expect.arrayContaining([MatchStatus.ON_SALE, MatchStatus.SCHEDULED]),
        }),
      );
    });

    it('should NOT include FINISHED matches in upcoming results', async () => {
      // Mock returns empty list, simulating the DB filtering out finished matches
      matchRepoMock = makeMatchRepoMock([]);
      ticketRepoMock = makeTicketRepoMock([]);

      const moduleRef = await Test.createTestingModule({
        controllers: [MatchesController],
        providers: [
          MatchesService,
          { provide: getRepositoryToken(Match), useValue: matchRepoMock },
          { provide: getRepositoryToken(Ticket), useValue: ticketRepoMock },
          {
            provide: ConfigService,
            useValue: { getOrThrow: jest.fn().mockReturnValue({ homeTeamName: HOME_TEAM }) },
          },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      await app.init();

      const res = await request(app.getHttpServer()).get('/matches/upcoming').expect(200);
      // The mock simulates the DB NOT returning the finished match
      expect(res.body).toHaveLength(0);
      // Confirm the QBs andWhere (kickoffAt > now) was applied
      expect(matchRepoMock._qb.andWhere).toHaveBeenCalledWith(
        'match.kickoffAt > :now',
        expect.objectContaining({ now: expect.any(Date) }),
      );
    });

    it('should limit results to at most 5 matches', async () => {
      // Seed 6 matches; the service calls findUpcoming(5) → limit(5) on the QBs
      const matches = Array.from({ length: 6 }, (_, i) =>
        makeMatch({
          id: `aaaaaaaa-0000-4000-8000-00000000000${i + 1}`,
          kickoffAt: new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000),
        }),
      );

      // The mock QBs limit is verified rather than filtering in-memory
      await buildApp(matches);

      await request(app.getHttpServer()).get('/matches/upcoming').expect(200);

      expect(matchRepoMock._qb.limit).toHaveBeenCalledWith(5);
    });

    it('should return an empty array when there are no upcoming matches', async () => {
      // Override QBs getMany to return empty list
      const emptyMock = makeMatchRepoMock([]);
      const emptyTicketMock = makeTicketRepoMock([]);
      emptyMock._qb.getMany.mockResolvedValue([]);

      const moduleRef = await Test.createTestingModule({
        controllers: [MatchesController],
        providers: [
          MatchesService,
          { provide: getRepositoryToken(Match), useValue: emptyMock },
          { provide: getRepositoryToken(Ticket), useValue: emptyTicketMock },
          {
            provide: ConfigService,
            useValue: { getOrThrow: jest.fn().mockReturnValue({ homeTeamName: HOME_TEAM }) },
          },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      await app.init();

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
      // Mock returns [match1, match2] — the QBs orderBy call enforces ASC in reality
      await buildApp([match1, match2]);

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
      await buildApp([match]);

      const res = await request(app.getHttpServer()).get(`/matches/${UUID_1}`).expect(200);

      expect(res.body.id).toBe(UUID_1);
      expect(res.body.homeTeam).toBe(match.homeTeam);
      expect(res.body.awayTeam).toBe(match.awayTeam);
      // MatchDetailDto includes description, createdAt, updatedAt
      expect(res.body).toHaveProperty('createdAt');
      expect(res.body).toHaveProperty('updatedAt');
    });

    it('should calculate availableSeats correctly for a single match', async () => {
      const match = makeMatch({ id: UUID_1, capacity: 50 });
      const tickets = [
        makeTicket(UUID_1, 'seat-1', TicketStatus.PAID),
        makeTicket(UUID_1, 'seat-2', TicketStatus.PAID),
      ];
      await buildApp([match], tickets);

      const res = await request(app.getHttpServer()).get(`/matches/${UUID_1}`).expect(200);

      expect(res.body.availableSeats).toBe(48); // 50 - 2
    });

    it('should return 404 when the match does not exist', async () => {
      await buildApp([]);

      const res = await request(app.getHttpServer())
        .get(`/matches/${NON_EXISTENT_UUID}`)
        .expect(404);

      expect(res.body.message).toContain(NON_EXISTENT_UUID);
    });

    it('should return 400 for a non-UUID id', async () => {
      await buildApp([]);

      await request(app.getHttpServer()).get('/matches/not-a-uuid').expect(400);
    });

    it('should include isHome flag correctly', async () => {
      const match = makeMatch({ id: UUID_1, homeTeam: HOME_TEAM });
      await buildApp([match]);

      const res = await request(app.getHttpServer()).get(`/matches/${UUID_1}`).expect(200);

      expect(res.body.isHome).toBe(true);
    });

    it('should round basePrice to an integer in the response', async () => {
      const match = makeMatch({ id: UUID_1, basePrice: '3500.99' });
      await buildApp([match]);

      const res = await request(app.getHttpServer()).get(`/matches/${UUID_1}`).expect(200);

      expect(Number.isInteger(res.body.basePrice)).toBe(true);
      expect(res.body.basePrice).toBe(3501);
    });
  });
});
