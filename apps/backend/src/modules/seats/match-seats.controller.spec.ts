import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MatchSeatsController } from './match-seats.controller';
import { SeatsService } from './seats.service';
import { SeatLockService } from '../../redis/seat-lock.service';
import {
  Competition,
  Match,
  MatchStatus,
  Seat,
  SeasonPass,
  SeatCategory,
  Ticket,
  TicketStatus,
} from '../../database/entities';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { ConfigService } from '@nestjs/config';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

// Bootstrapping a Nest TestingModule + supertest server per test can exceed
// the 5 s default on slower CI hosts; bump the timeout for this suite only.
jest.setTimeout(30_000);

/**
 * Integration tests for MatchSeatsController.
 *
 * Strategy: NestJS TestingModule with real controller + real SeatsService
 * logic. Repository and SeatLockService are replaced by deterministic stubs.
 * This validates the full HTTP layer including path-param parsing, DTO
 * serialisation, and HTTP status codes.
 *
 * Scenarios:
 *  GET /matches/:matchId/seats
 *   - 200 with seat list and sector summary (DB + Redis aggregation)
 *   - seats for a sold ticket appear as "sold"
 *   - seats in Redis lock appear as "locked"
 *   - disabled (isActive=false) seats appear as "disabled"
 *   - 404 when matchId is not found
 *   - 400 on invalid (non-UUID) matchId
 *
 *  POST /matches/:matchId/seats/:seatId/lock
 *   - 201 with ownerToken + ttlSeconds on success
 *   - 409 Conflict when seat is already locked
 *   - 400 on invalid seatId
 *
 *  DELETE /matches/:matchId/seats/:seatId/lock
 *   - 204 No Content on successful release
 *   - 404 when ownerToken query param is missing
 */

// ---------------------------------------------------------------------------
// UUIDs
// ---------------------------------------------------------------------------

const MATCH_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SEAT_ID_FREE = 'bbbbbbbb-0000-4000-8000-000000000001';
const SEAT_ID_SOLD = 'bbbbbbbb-0000-4000-8000-000000000002';
const SEAT_ID_LOCKED = 'bbbbbbbb-0000-4000-8000-000000000003';
const SEAT_ID_DISABLED = 'bbbbbbbb-0000-4000-8000-000000000004';
const SEAT_ID_ACCESSIBLE = 'bbbbbbbb-0000-4000-8000-000000000005';
const OWNER_TOKEN = 'dddddddd-0000-4000-8000-000000000001';
const NON_EXISTENT_MATCH_ID = 'ffffffff-ffff-4fff-bfff-ffffffffffff';

// ---------------------------------------------------------------------------
// Entity factories
// ---------------------------------------------------------------------------

function makeMatch(overrides: Partial<Match> = {}): Match {
  const m = new Match();
  m.id = MATCH_ID;
  m.homeTeam = 'Kecskeméti TE';
  m.awayTeam = 'Ferencvárosi TC';
  m.competition = Competition.NB1;
  m.venue = 'Széktói Stadion';
  m.kickoffAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  m.status = MatchStatus.ON_SALE;
  m.capacity = 100;
  m.basePrice = '3500.00';
  m.isSeasonPassEligible = true;
  m.createdAt = new Date();
  m.updatedAt = new Date();
  m.version = 1;
  return Object.assign(m, overrides);
}

function makeSeat(
  id: string,
  section: string,
  row: string,
  number: number,
  overrides: Partial<Seat> = {},
): Seat {
  const s = new Seat();
  s.id = id;
  s.section = section;
  s.row = row;
  s.number = number;
  s.category = SeatCategory.STANDARD;
  s.priceModifier = '1.00';
  s.isAccessible = false;
  s.isActive = true;
  s.createdAt = new Date();
  s.updatedAt = new Date();
  s.version = 1;
  return Object.assign(s, overrides);
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
 * In-memory Redis double for SeatsService.findSeatsForMatch pipeline calls.
 * Returns a pre-configured set of "locked" seat IDs.
 */
function makeRedisMock(lockedSeatIds: string[] = []) {
  // Build a map: key → ownerToken for pipeline GET calls
  return {
    pipeline: jest.fn().mockReturnValue({
      get: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(
        // Each entry is [error, value]; value is non-null for locked seats
        lockedSeatIds.map((id) => [null, `token-${id}`]),
      ),
    }),
    set: jest.fn().mockResolvedValue('OK'),
    exists: jest.fn().mockResolvedValue(0),
    ttl: jest.fn().mockResolvedValue(-2),
    eval: jest.fn().mockResolvedValue(1),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MatchSeatsController – integration', () => {
  let app: INestApplication;

  /**
   * Bootstraps the test application with the given data fixtures.
   *
   * @param match         The Match entity returned by matchRepository.findOne
   * @param seats         Seats returned by seatRepository.find
   * @param tickets       Tickets returned by ticketRepository.find
   * @param lockedSeatIds Seat IDs that are currently locked in Redis
   * @param lockServiceOverrides Override SeatLockService methods per-test
   */
  async function buildApp(
    match: Match | null,
    seats: Seat[] = [],
    tickets: Ticket[] = [],
    lockedSeatIds: string[] = [],
    lockServiceOverrides: Partial<SeatLockService> = {},
  ): Promise<void> {
    const matchRepoMock = {
      findOne: jest.fn().mockResolvedValue(match),
    };

    const seatRepoMock = {
      find: jest.fn().mockResolvedValue(seats),
    };

    const ticketRepoMock = {
      find: jest.fn().mockResolvedValue(tickets),
    };

    const seasonPassRepoMock = {
      find: jest.fn().mockResolvedValue([]),
    };

    const redisMock = makeRedisMock(lockedSeatIds);

    // Default SeatLockService stub (acquire succeeds, release succeeds)
    const defaultLockService = {
      acquire: jest.fn().mockResolvedValue({
        matchId: MATCH_ID,
        seatId: SEAT_ID_FREE,
        ownerToken: OWNER_TOKEN,
        ttlSeconds: 300,
      }),
      release: jest.fn().mockResolvedValue(true),
      isLocked: jest.fn().mockResolvedValue(false),
      getRemainingTtl: jest.fn().mockResolvedValue(300),
      extend: jest.fn().mockResolvedValue(true),
    };

    const seatLockServiceMock = Object.assign(defaultLockService, lockServiceOverrides);

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [MatchSeatsController],
      providers: [
        SeatsService,
        { provide: getRepositoryToken(Seat), useValue: seatRepoMock },
        { provide: getRepositoryToken(Ticket), useValue: ticketRepoMock },
        { provide: getRepositoryToken(Match), useValue: matchRepoMock },
        { provide: getRepositoryToken(SeasonPass), useValue: seasonPassRepoMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
        { provide: SeatLockService, useValue: seatLockServiceMock },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue({ seatLockTtlSeconds: 300 }),
          },
        },
      ],
    })
      .overrideGuard(OptionalJwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  }

  afterEach(async () => {
    await app?.close();
  });

  // -------------------------------------------------------------------------
  // GET /matches/:matchId/seats
  // -------------------------------------------------------------------------

  describe('GET /matches/:matchId/seats', () => {
    it('should return 200 with seats and sector summary', async () => {
      const match = makeMatch();
      const seats = [
        makeSeat(SEAT_ID_FREE, 'A', '1', 1),
        makeSeat(SEAT_ID_SOLD, 'A', '1', 2),
      ];
      const tickets = [makeTicket(MATCH_ID, SEAT_ID_SOLD, TicketStatus.PAID)];

      await buildApp(match, seats, tickets);

      const res = await request(app.getHttpServer())
        .get(`/matches/${MATCH_ID}/seats`)
        .expect(200);

      expect(res.body.matchId).toBe(MATCH_ID);
      expect(Array.isArray(res.body.seats)).toBe(true);
      expect(res.body.seats).toHaveLength(2);
      expect(Array.isArray(res.body.sectorSummary)).toBe(true);
    });

    it('should mark a seat as "sold" when there is a paid ticket for it', async () => {
      const match = makeMatch();
      const seats = [makeSeat(SEAT_ID_SOLD, 'A', '1', 1)];
      const tickets = [makeTicket(MATCH_ID, SEAT_ID_SOLD, TicketStatus.PAID)];

      await buildApp(match, seats, tickets);

      const res = await request(app.getHttpServer())
        .get(`/matches/${MATCH_ID}/seats`)
        .expect(200);

      const soldSeat = res.body.seats.find((s: { id: string }) => s.id === SEAT_ID_SOLD);
      expect(soldSeat).toBeDefined();
      expect(soldSeat.status).toBe('sold');
    });

    it('should mark a seat as "sold" for PENDING_PAYMENT tickets', async () => {
      const match = makeMatch();
      const seats = [makeSeat(SEAT_ID_SOLD, 'A', '1', 1)];
      const tickets = [makeTicket(MATCH_ID, SEAT_ID_SOLD, TicketStatus.PENDING_PAYMENT)];

      await buildApp(match, seats, tickets);

      const res = await request(app.getHttpServer())
        .get(`/matches/${MATCH_ID}/seats`)
        .expect(200);

      const seat = res.body.seats[0];
      expect(seat.status).toBe('sold');
    });

    it('should NOT mark a seat as sold for CANCELLED tickets', async () => {
      const match = makeMatch();
      const seats = [makeSeat(SEAT_ID_FREE, 'A', '1', 1)];
      const tickets = [makeTicket(MATCH_ID, SEAT_ID_FREE, TicketStatus.CANCELLED)];

      await buildApp(match, seats, tickets);

      const res = await request(app.getHttpServer())
        .get(`/matches/${MATCH_ID}/seats`)
        .expect(200);

      expect(res.body.seats[0].status).toBe('available');
    });

    it('should mark a seat as "locked" when its key exists in Redis', async () => {
      const match = makeMatch();
      const seats = [
        makeSeat(SEAT_ID_FREE, 'A', '1', 1),
        makeSeat(SEAT_ID_LOCKED, 'A', '1', 2),
      ];

      // Feed only SEAT_ID_LOCKED as locked in Redis
      await buildApp(match, seats, [], [SEAT_ID_LOCKED]);

      const res = await request(app.getHttpServer())
        .get(`/matches/${MATCH_ID}/seats`)
        .expect(200);

      const freeSeat = res.body.seats.find((s: { id: string }) => s.id === SEAT_ID_FREE);
      const lockedSeat = res.body.seats.find((s: { id: string }) => s.id === SEAT_ID_LOCKED);

      expect(freeSeat.status).toBe('available');
      expect(lockedSeat.status).toBe('locked');
    });

    it('should mark an inactive seat as "disabled" regardless of tickets', async () => {
      const match = makeMatch();
      const seats = [makeSeat(SEAT_ID_DISABLED, 'A', '1', 1, { isActive: false })];

      await buildApp(match, seats, []);

      const res = await request(app.getHttpServer())
        .get(`/matches/${MATCH_ID}/seats`)
        .expect(200);

      expect(res.body.seats[0].status).toBe('disabled');
    });

    it('should include price = basePrice * priceModifier (rounded)', async () => {
      const match = makeMatch({ basePrice: '4000.00' });
      const seat = makeSeat(SEAT_ID_FREE, 'VIP', '1', 1);
      seat.priceModifier = '1.50';

      await buildApp(match, [seat], []);

      const res = await request(app.getHttpServer())
        .get(`/matches/${MATCH_ID}/seats`)
        .expect(200);

      // 4000 * 1.50 = 6000
      expect(res.body.seats[0].price).toBe(6000);
    });

    it('should compute a correct sector summary occupancyRatio', async () => {
      const match = makeMatch();
      const seats = [
        makeSeat(SEAT_ID_FREE, 'A', '1', 1),     // available
        makeSeat(SEAT_ID_SOLD, 'A', '1', 2),     // sold
        makeSeat(SEAT_ID_LOCKED, 'A', '1', 3),   // locked via Redis
      ];
      const tickets = [makeTicket(MATCH_ID, SEAT_ID_SOLD, TicketStatus.PAID)];

      await buildApp(match, seats, tickets, [SEAT_ID_LOCKED]);

      const res = await request(app.getHttpServer())
        .get(`/matches/${MATCH_ID}/seats`)
        .expect(200);

      const summary = res.body.sectorSummary.find((s: { section: string }) => s.section === 'A');
      expect(summary).toBeDefined();
      expect(summary.total).toBe(3);
      expect(summary.available).toBe(1);
      expect(summary.locked).toBe(1);
      expect(summary.sold).toBe(1);
      // (locked + sold) / total = 2/3 ≈ 0.67
      expect(summary.occupancyRatio).toBeCloseTo(0.67, 1);
    });

    it('should sort sectorSummary alphabetically by section', async () => {
      const match = makeMatch();
      const seats = [
        makeSeat(`${SEAT_ID_FREE}-b`, 'B', '1', 1),
        makeSeat(`${SEAT_ID_FREE}-a`, 'A', '1', 1),
        makeSeat(`${SEAT_ID_FREE}-c`, 'C', '1', 1),
      ];

      await buildApp(match, seats, []);

      const res = await request(app.getHttpServer())
        .get(`/matches/${MATCH_ID}/seats`)
        .expect(200);

      const sections = res.body.sectorSummary.map((s: { section: string }) => s.section);
      expect(sections).toEqual([...sections].sort());
    });

    it('should return 404 when the matchId is not found', async () => {
      await buildApp(null, []);

      const res = await request(app.getHttpServer())
        .get(`/matches/${NON_EXISTENT_MATCH_ID}/seats`)
        .expect(404);

      expect(res.body.message).toContain(NON_EXISTENT_MATCH_ID);
    });

    it('should return 400 for a non-UUID matchId', async () => {
      await buildApp(makeMatch(), []);

      await request(app.getHttpServer())
        .get('/matches/not-a-uuid/seats')
        .expect(400);
    });

    it('should include isAccessible field on each seat', async () => {
      const match = makeMatch();
      const seat = makeSeat(SEAT_ID_ACCESSIBLE, 'A', '1', 1, { isAccessible: true });

      await buildApp(match, [seat], []);

      const res = await request(app.getHttpServer())
        .get(`/matches/${MATCH_ID}/seats`)
        .expect(200);

      expect(res.body.seats[0].isAccessible).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // POST /matches/:matchId/seats/:seatId/lock
  // -------------------------------------------------------------------------

  describe('POST /matches/:matchId/seats/:seatId/lock', () => {
    it('should return 201 with ownerToken and ttlSeconds on a successful lock', async () => {
      await buildApp(makeMatch(), [makeSeat(SEAT_ID_FREE, 'A', '1', 1)], []);

      const res = await request(app.getHttpServer())
        .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock`)
        .expect(201);

      expect(res.body.matchId).toBe(MATCH_ID);
      expect(res.body.seatId).toBe(SEAT_ID_FREE);
      expect(res.body.ownerToken).toBe(OWNER_TOKEN);
      expect(res.body.ttlSeconds).toBe(300);
      expect(res.body).toHaveProperty('expiresAt');
    });

    it('should return a valid ISO 8601 expiresAt timestamp', async () => {
      await buildApp(makeMatch(), [makeSeat(SEAT_ID_FREE, 'A', '1', 1)], []);

      const res = await request(app.getHttpServer())
        .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock`)
        .expect(201);

      const expiresAt = new Date(res.body.expiresAt);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
      // expiresAt should be ~300 s in the future (±5 s tolerance)
      const diffSeconds = (expiresAt.getTime() - Date.now()) / 1000;
      expect(diffSeconds).toBeGreaterThan(295);
      expect(diffSeconds).toBeLessThan(305);
    });

    it('should return 409 Conflict when the seat is already locked', async () => {
      // SeatLockService.acquire returns null → already locked
      await buildApp(
        makeMatch(),
        [makeSeat(SEAT_ID_LOCKED, 'A', '1', 1)],
        [],
        [],
        { acquire: jest.fn().mockResolvedValue(null) },
      );

      const res = await request(app.getHttpServer())
        .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_LOCKED}/lock`)
        .expect(409);

      expect(res.body.message).toContain(SEAT_ID_LOCKED);
    });

    it('should call SeatLockService.acquire with the correct matchId and seatId', async () => {
      const acquireSpy = jest.fn().mockResolvedValue({
        matchId: MATCH_ID,
        seatId: SEAT_ID_FREE,
        ownerToken: OWNER_TOKEN,
        ttlSeconds: 300,
      });
      await buildApp(
        makeMatch(),
        [makeSeat(SEAT_ID_FREE, 'A', '1', 1)],
        [],
        [],
        { acquire: acquireSpy },
      );

      await request(app.getHttpServer())
        .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock`)
        .expect(201);

      expect(acquireSpy).toHaveBeenCalledWith(
        expect.objectContaining({ matchId: MATCH_ID, seatId: SEAT_ID_FREE }),
      );
    });

    it('should return 400 for a non-UUID seatId', async () => {
      await buildApp(makeMatch(), []);

      await request(app.getHttpServer())
        .post(`/matches/${MATCH_ID}/seats/not-a-uuid/lock`)
        .expect(400);
    });

    it('should return 400 for a non-UUID matchId', async () => {
      await buildApp(makeMatch(), []);

      await request(app.getHttpServer())
        .post('/matches/not-a-uuid/seats/some-seat/lock')
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /matches/:matchId/seats/:seatId/lock
  // -------------------------------------------------------------------------

  describe('DELETE /matches/:matchId/seats/:seatId/lock', () => {
    it('should return 204 No Content on a successful unlock', async () => {
      const releaseSpy = jest.fn().mockResolvedValue(true);
      await buildApp(makeMatch(), [], [], [], { release: releaseSpy });

      await request(app.getHttpServer())
        .delete(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock?ownerToken=${OWNER_TOKEN}`)
        .expect(204);

      expect(releaseSpy).toHaveBeenCalledWith(MATCH_ID, SEAT_ID_FREE, OWNER_TOKEN);
    });

    it('should return 404 when the ownerToken query param is missing', async () => {
      await buildApp(makeMatch(), []);

      await request(app.getHttpServer())
        .delete(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock`)
        .expect(404);
    });

    it('should still return 204 when the ownerToken does not match (idempotent release)', async () => {
      // SeatLockService.release returns false (token mismatch) but the controller
      // does not throw — DELETE is idempotent as per the API contract.
      const releaseSpy = jest.fn().mockResolvedValue(false);
      await buildApp(makeMatch(), [], [], [], { release: releaseSpy });

      await request(app.getHttpServer())
        .delete(
          `/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock?ownerToken=wrong-token`,
        )
        .expect(204);
    });

    it('should return 400 for non-UUID matchId', async () => {
      await buildApp(makeMatch(), []);

      await request(app.getHttpServer())
        .delete(`/matches/not-a-uuid/seats/${SEAT_ID_FREE}/lock?ownerToken=${OWNER_TOKEN}`)
        .expect(400);
    });

    it('should return 400 for non-UUID seatId', async () => {
      await buildApp(makeMatch(), []);

      await request(app.getHttpServer())
        .delete(`/matches/${MATCH_ID}/seats/not-a-uuid/lock?ownerToken=${OWNER_TOKEN}`)
        .expect(400);
    });
  });
});
