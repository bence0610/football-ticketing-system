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
  Sector,
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
 * Module is compiled ONCE in beforeAll; shared mocks are reconfigured per
 * test via setData() to avoid ts-jest cold-start timeouts under parallel load.
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

import { STADIUM_LAYOUT } from '../../database/stadium-layout';

/** The sectors table as the migration leaves it: the 19 sectors of the real stadium. */
function layoutSectors(): Array<Record<string, unknown>> {
  return STADIUM_LAYOUT.map((l) => ({
    code: l.code,
    name: l.name,
    isCovered: l.isCovered,
    arc: l.arc,
    position: l.position,
    gate: l.gate,
    priceCategory: l.priceCategory,
    isAway: l.isAway,
  }));
}

// ---------------------------------------------------------------------------
// UUIDs
// ---------------------------------------------------------------------------

const MATCH_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SEAT_ID_FREE = 'bbbbbbbb-0000-4000-8000-000000000001';
const SEAT_ID_SOLD = 'bbbbbbbb-0000-4000-8000-000000000002';
const SEAT_ID_LOCKED = 'bbbbbbbb-0000-4000-8000-000000000003';
const SEAT_ID_DISABLED = 'bbbbbbbb-0000-4000-8000-000000000004';
const SEAT_ID_ACCESSIBLE = 'bbbbbbbb-0000-4000-8000-000000000005';
const SEAT_ID_SEASON_PASS = 'bbbbbbbb-0000-4000-8000-000000000006';
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
// Test suite
// ---------------------------------------------------------------------------

describe('MatchSeatsController – integration', () => {
  let app: INestApplication;

  // Shared repo mocks — reconfigured per test via setData().
  let matchRepoMock: { findOne: jest.Mock };
  let seatRepoMock: { find: jest.Mock };
  let ticketRepoMock: { find: jest.Mock };
  let seasonPassRepoMock: { find: jest.Mock };
  let sectorRepoMock: { find: jest.Mock };

  // Shared Redis mock — mget is reconfigured per test via setData().
  let redisMock: {
    mget: jest.Mock;
    set: jest.Mock;
    exists: jest.Mock;
    ttl: jest.Mock;
    eval: jest.Mock;
  };

  // Shared SeatLockService mock methods — exposed individually for per-test override.
  let seatLockAcquire: jest.Mock;
  let seatLockRelease: jest.Mock;
  let seatLockIsLocked: jest.Mock;
  let seatLockGetRemainingTtl: jest.Mock;
  let seatLockExtend: jest.Mock;

  // Compile the NestJS module once for the whole suite.
  beforeAll(async () => {
    matchRepoMock = { findOne: jest.fn() };
    seatRepoMock = { find: jest.fn() };
    ticketRepoMock = { find: jest.fn() };
    seasonPassRepoMock = { find: jest.fn() };
    sectorRepoMock = { find: jest.fn() };

    redisMock = {
      mget: jest.fn().mockImplementation(async (...keys: string[]) => keys.map(() => null)),
      set: jest.fn().mockResolvedValue('OK'),
      exists: jest.fn().mockResolvedValue(0),
      ttl: jest.fn().mockResolvedValue(-2),
      eval: jest.fn().mockResolvedValue(1),
    };

    seatLockAcquire = jest.fn();
    seatLockRelease = jest.fn();
    seatLockIsLocked = jest.fn();
    seatLockGetRemainingTtl = jest.fn();
    seatLockExtend = jest.fn();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [MatchSeatsController],
      providers: [
        SeatsService,
        { provide: getRepositoryToken(Seat), useValue: seatRepoMock },
        { provide: getRepositoryToken(Ticket), useValue: ticketRepoMock },
        { provide: getRepositoryToken(Match), useValue: matchRepoMock },
        { provide: getRepositoryToken(SeasonPass), useValue: seasonPassRepoMock },
        { provide: getRepositoryToken(Sector), useValue: sectorRepoMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
        {
          provide: SeatLockService,
          useValue: {
            acquire: seatLockAcquire,
            release: seatLockRelease,
            isLocked: seatLockIsLocked,
            getRemainingTtl: seatLockGetRemainingTtl,
            extend: seatLockExtend,
          },
        },
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
  });

  afterAll(async () => {
    await app?.close();
  });

  // Reset mock call histories and restore default return values between tests
  // so assertions and side-effects don't bleed across tests.
  beforeEach(() => {
    jest.clearAllMocks();
    matchRepoMock.findOne.mockResolvedValue(null);
    seatRepoMock.find.mockResolvedValue([]);
    ticketRepoMock.find.mockResolvedValue([]);
    seasonPassRepoMock.find.mockResolvedValue([]);
    // the real stadium: 19 sectors, as the StadiumLayout migration writes them
    sectorRepoMock.find.mockResolvedValue(layoutSectors());
    redisMock.mget.mockImplementation(async (...keys: string[]) => keys.map(() => null));
    redisMock.set.mockResolvedValue('OK');
    redisMock.exists.mockResolvedValue(0);
    redisMock.ttl.mockResolvedValue(-2);
    redisMock.eval.mockResolvedValue(1);
    seatLockAcquire.mockResolvedValue({
      matchId: MATCH_ID,
      seatId: SEAT_ID_FREE,
      ownerToken: OWNER_TOKEN,
      ttlSeconds: 300,
    });
    seatLockRelease.mockResolvedValue(true);
    seatLockIsLocked.mockResolvedValue(false);
    seatLockGetRemainingTtl.mockResolvedValue(300);
    seatLockExtend.mockResolvedValue(true);
  });

  /**
   * Configures the shared repo and Redis mocks to return the given fixtures.
   * No module is created — the app from beforeAll is reused.
   */
  function setData(
    match: Match | null,
    seats: Seat[] = [],
    tickets: Ticket[] = [],
    lockedSeatIds: string[] = [],
    seasonPassSeatIds: string[] = [],
  ): void {
    matchRepoMock.findOne.mockResolvedValue(match);
    seatRepoMock.find.mockResolvedValue(seats);
    ticketRepoMock.find.mockResolvedValue(tickets);
    seasonPassRepoMock.find.mockResolvedValue(seasonPassSeatIds.map((id) => ({ seatId: id })));
    // MGET returns one value per requested key, in order: a token for a locked seat, else null.
    redisMock.mget.mockImplementation(async (...keys: string[]) =>
      keys.map((key) => {
        const id = lockedSeatIds.find((candidate) => key.includes(candidate));
        return id ? `token-${id}` : null;
      }),
    );
  }

  // -------------------------------------------------------------------------
  // GET /matches/:matchId/seats
  // -------------------------------------------------------------------------

  describe('GET /matches/:matchId/seats', () => {
    it('should return 200 with seats and sector summary', async () => {
      const match = makeMatch();
      const seats = [makeSeat(SEAT_ID_FREE, 'A', '1', 1), makeSeat(SEAT_ID_SOLD, 'A', '1', 2)];
      const tickets = [makeTicket(MATCH_ID, SEAT_ID_SOLD, TicketStatus.PAID)];

      setData(match, seats, tickets);

      const res = await request(app.getHttpServer()).get(`/matches/${MATCH_ID}/seats`).expect(200);

      expect(res.body.matchId).toBe(MATCH_ID);
      expect(Array.isArray(res.body.seats)).toBe(true);
      expect(res.body.seats).toHaveLength(2);
      expect(Array.isArray(res.body.sectorSummary)).toBe(true);
    });

    it('should mark a seat as "sold" when there is a paid ticket for it', async () => {
      const match = makeMatch();
      const seats = [makeSeat(SEAT_ID_SOLD, 'A', '1', 1)];
      const tickets = [makeTicket(MATCH_ID, SEAT_ID_SOLD, TicketStatus.PAID)];

      setData(match, seats, tickets);

      const res = await request(app.getHttpServer()).get(`/matches/${MATCH_ID}/seats`).expect(200);

      const soldSeat = res.body.seats.find((s: { id: string }) => s.id === SEAT_ID_SOLD);
      expect(soldSeat).toBeDefined();
      expect(soldSeat.status).toBe('sold');
    });

    it('should mark a seat as "sold" for PENDING_PAYMENT tickets', async () => {
      const match = makeMatch();
      const seats = [makeSeat(SEAT_ID_SOLD, 'A', '1', 1)];
      const tickets = [makeTicket(MATCH_ID, SEAT_ID_SOLD, TicketStatus.PENDING_PAYMENT)];

      setData(match, seats, tickets);

      const res = await request(app.getHttpServer()).get(`/matches/${MATCH_ID}/seats`).expect(200);

      const seat = res.body.seats[0];
      expect(seat.status).toBe('sold');
    });

    it('should NOT mark a seat as sold for CANCELLED tickets', async () => {
      const match = makeMatch();
      const seats = [makeSeat(SEAT_ID_FREE, 'A', '1', 1)];
      const tickets = [makeTicket(MATCH_ID, SEAT_ID_FREE, TicketStatus.CANCELLED)];

      setData(match, seats, tickets);

      const res = await request(app.getHttpServer()).get(`/matches/${MATCH_ID}/seats`).expect(200);

      expect(res.body.seats[0].status).toBe('available');
    });

    it('should mark a seat as "locked" when its key exists in Redis', async () => {
      const match = makeMatch();
      const seats = [makeSeat(SEAT_ID_FREE, 'A', '1', 1), makeSeat(SEAT_ID_LOCKED, 'A', '1', 2)];

      setData(match, seats, [], [SEAT_ID_LOCKED]);

      const res = await request(app.getHttpServer()).get(`/matches/${MATCH_ID}/seats`).expect(200);

      const freeSeat = res.body.seats.find((s: { id: string }) => s.id === SEAT_ID_FREE);
      const lockedSeat = res.body.seats.find((s: { id: string }) => s.id === SEAT_ID_LOCKED);

      expect(freeSeat.status).toBe('available');
      expect(lockedSeat.status).toBe('locked');
    });

    it('should mark an inactive seat as "disabled" regardless of tickets', async () => {
      const match = makeMatch();
      const seats = [makeSeat(SEAT_ID_DISABLED, 'A', '1', 1, { isActive: false })];

      setData(match, seats, []);

      const res = await request(app.getHttpServer()).get(`/matches/${MATCH_ID}/seats`).expect(200);

      expect(res.body.seats[0].status).toBe('disabled');
    });

    it('should include price = basePrice * priceModifier (rounded)', async () => {
      const match = makeMatch({ basePrice: '4000.00' });
      const seat = makeSeat(SEAT_ID_FREE, 'VIP', '1', 1);
      seat.priceModifier = '1.50';

      setData(match, [seat], []);

      const res = await request(app.getHttpServer()).get(`/matches/${MATCH_ID}/seats`).expect(200);

      // 4000 * 1.50 = 6000
      expect(res.body.seats[0].price).toBe(6000);
    });

    it('should compute a correct sector summary occupancyRatio', async () => {
      const match = makeMatch();
      const seats = [
        makeSeat(SEAT_ID_FREE, 'A', '1', 1), // available
        makeSeat(SEAT_ID_SOLD, 'A', '1', 2), // sold
        makeSeat(SEAT_ID_LOCKED, 'A', '1', 3), // locked via Redis
      ];
      const tickets = [makeTicket(MATCH_ID, SEAT_ID_SOLD, TicketStatus.PAID)];

      setData(match, seats, tickets, [SEAT_ID_LOCKED]);

      const res = await request(app.getHttpServer()).get(`/matches/${MATCH_ID}/seats`).expect(200);

      const summary = res.body.sectorSummary.find((s: { section: string }) => s.section === 'A');
      expect(summary).toBeDefined();
      expect(summary.total).toBe(3);
      expect(summary.available).toBe(1);
      expect(summary.locked).toBe(1);
      expect(summary.sold).toBe(1);
      // (locked + sold) / total = 2/3 ≈ 0.67
      expect(summary.occupancyRatio).toBeCloseTo(0.67, 1);
    });

    it("carries each sector's covered flag from the sectors table (the upper arc and VIP covered, the rest open)", async () => {
      setData(makeMatch(), [
        makeSeat('s-d1', 'D/1', '1', 1),
        makeSeat('s-b2', 'B/2', '1', 1),
        makeSeat('s-j', 'J', '1', 1),
        makeSeat('s-vip', 'VIP', '1', 1),
        makeSeat('s-e', 'E', '1', 1),
      ]);

      const res = await request(app.getHttpServer()).get(`/matches/${MATCH_ID}/seats`).expect(200);

      const covered = Object.fromEntries(
        res.body.sectorSummary.map((s: { section: string; covered: boolean | null }) => [
          s.section,
          s.covered,
        ]),
      );
      expect(covered).toEqual({ 'D/1': true, 'B/2': true, J: false, VIP: true, E: false });
    });

    it('reports a sector with no row in the sectors table as unknown, never as open and never with a gate', async () => {
      sectorRepoMock.find.mockResolvedValue([
        {
          code: 'K',
          name: 'K szektor',
          isCovered: false,
          arc: 'lower',
          position: 5,
          gate: 2,
          priceCategory: 'lower',
          isAway: false,
        },
      ]);
      setData(makeMatch(), [makeSeat('k-1', 'K', '1', 1), makeSeat('x-1', 'X', '1', 1)]);

      const res = await request(app.getHttpServer()).get(`/matches/${MATCH_ID}/seats`).expect(200);

      const by = Object.fromEntries(
        res.body.sectorSummary.map((s: Record<string, unknown>) => [s.section, s]),
      );
      expect(by.K).toMatchObject({ covered: false, gate: 2 });
      expect(by.X).toMatchObject({ covered: null, gate: null, name: 'X', isAway: false });
    });

    it('sorts the sector summary in stadium order (upper arc first, west to east), not alphabetically', async () => {
      setData(makeMatch(), [
        makeSeat('s-vip', 'VIP', '1', 1),
        makeSeat('s-k', 'K', '1', 1),
        makeSeat('s-c2', 'C/2', '1', 1),
        makeSeat('s-d1', 'D/1', '1', 1),
        makeSeat('s-a2', 'A/2', '1', 1),
      ]);

      const res = await request(app.getHttpServer()).get(`/matches/${MATCH_ID}/seats`).expect(200);

      const sections = res.body.sectorSummary.map((s: { section: string }) => s.section);
      expect(sections).toEqual(['D/1', 'C/2', 'A/2', 'K', 'VIP']);
      expect(sections).not.toEqual([...sections].sort());
      // the seats follow the same order
      expect(res.body.seats.map((s: { section: string }) => s.section)).toEqual(sections);
    });

    it('orders rows as numbers within a sector: 1, 2, 10, 11 - not 1, 10, 11, 2', async () => {
      setData(makeMatch(), [
        makeSeat('r10', 'K', '10', 1),
        makeSeat('r2', 'K', '2', 1),
        makeSeat('r11', 'K', '11', 1),
        makeSeat('r1', 'K', '1', 1),
      ]);

      const res = await request(app.getHttpServer()).get(`/matches/${MATCH_ID}/seats`).expect(200);

      expect(res.body.seats.map((s: { row: string }) => s.row)).toEqual(['1', '2', '10', '11']);
    });

    it('carries name, arc, position, gate and price tier for every sector', async () => {
      setData(makeMatch(), [makeSeat('s-f', 'F', '1', 1), makeSeat('s-vip', 'VIP', '1', 1)]);

      const res = await request(app.getHttpServer()).get(`/matches/${MATCH_ID}/seats`).expect(200);

      const by = Object.fromEntries(
        res.body.sectorSummary.map((s: Record<string, unknown>) => [s.section, s]),
      );
      expect(by.F).toMatchObject({
        name: 'F szektor',
        arc: 'lower',
        position: 10,
        gate: 1,
        priceCategory: 'lower',
        isAway: false,
      });
      expect(by.VIP).toMatchObject({
        name: 'VIP',
        arc: 'lower',
        position: 7,
        gate: 1,
        priceCategory: 'vip',
      });
    });

    describe('the away section (VENDÉG)', () => {
      it('shows its seats as "away" with nothing available, and marks the sector', async () => {
        setData(makeMatch(), [makeSeat('v-1', 'VENDÉG', '1', 1), makeSeat('k-1', 'K', '1', 1)]);

        const res = await request(app.getHttpServer())
          .get(`/matches/${MATCH_ID}/seats`)
          .expect(200);

        const statusOf = (id: string): string =>
          res.body.seats.find((s: { id: string }) => s.id === id).status;
        expect(statusOf('v-1')).toBe('away');
        expect(statusOf('k-1')).toBe('available');
        const by = Object.fromEntries(
          res.body.sectorSummary.map((s: Record<string, unknown>) => [s.section, s]),
        );
        expect(by['VENDÉG']).toMatchObject({ isAway: true, available: 0, gate: 3 });
        expect(by.K).toMatchObject({ isAway: false, available: 1 });
      });

      it('is away even if the seat was somehow marked sold or held by a pass', async () => {
        setData(
          makeMatch(),
          [makeSeat('v-1', 'VENDÉG', '1', 1)],
          [makeTicket(MATCH_ID, 'v-1', TicketStatus.PAID)],
          [],
          ['v-1'],
        );

        const res = await request(app.getHttpServer())
          .get(`/matches/${MATCH_ID}/seats`)
          .expect(200);

        expect(res.body.seats[0].status).toBe('away');
      });

      it('cannot be locked: 403, and no lock is taken', async () => {
        setData(makeMatch(), [makeSeat(SEAT_ID_FREE, 'VENDÉG', '1', 1)], []);

        const res = await request(app.getHttpServer())
          .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock`)
          .expect(403);

        expect(res.body.message).toContain('vendégszektor');
        expect(seatLockAcquire).not.toHaveBeenCalled();
      });
    });

    it('should return 404 when the matchId is not found', async () => {
      setData(null, []);

      const res = await request(app.getHttpServer())
        .get(`/matches/${NON_EXISTENT_MATCH_ID}/seats`)
        .expect(404);

      expect(res.body.message).toContain(NON_EXISTENT_MATCH_ID);
    });

    it('should return 400 for a non-UUID matchId', async () => {
      await request(app.getHttpServer()).get('/matches/not-a-uuid/seats').expect(400);
    });

    it('should include isAccessible field on each seat', async () => {
      const match = makeMatch();
      const seat = makeSeat(SEAT_ID_ACCESSIBLE, 'A', '1', 1, { isAccessible: true });

      setData(match, [seat], []);

      const res = await request(app.getHttpServer()).get(`/matches/${MATCH_ID}/seats`).expect(200);

      expect(res.body.seats[0].isAccessible).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // POST /matches/:matchId/seats/:seatId/lock
  // -------------------------------------------------------------------------

  describe('POST /matches/:matchId/seats/:seatId/lock', () => {
    it('should return 201 with ownerToken and ttlSeconds on a successful lock', async () => {
      setData(makeMatch(), [makeSeat(SEAT_ID_FREE, 'A', '1', 1)], []);

      const res = await request(app.getHttpServer())
        .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock`)
        .expect(201);

      expect(res.body.matchId).toBe(MATCH_ID);
      expect(res.body.seatId).toBe(SEAT_ID_FREE);
      expect(res.body.ownerToken).toBe(OWNER_TOKEN);
      expect(res.body.ttlSeconds).toBe(300);
      expect(res.body).toHaveProperty('expiresAt');
    });

    describe('a match that has kicked off', () => {
      it('cannot be locked: 409 match_started, and no lock is taken', async () => {
        setData(
          makeMatch({ kickoffAt: new Date(Date.now() - 60 * 1000) }),
          [makeSeat(SEAT_ID_FREE, 'A', '1', 1)],
          [],
        );

        const res = await request(app.getHttpServer())
          .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock`)
          .expect(409);

        expect(res.body.code).toBe('match_started');
        expect(seatLockAcquire).not.toHaveBeenCalled();
      });

      it('is refused at the very instant of kickoff, but not a minute before it', async () => {
        setData(
          makeMatch({ kickoffAt: new Date(Date.now() + 60 * 1000) }),
          [makeSeat(SEAT_ID_FREE, 'A', '1', 1)],
          [],
        );
        await request(app.getHttpServer())
          .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock`)
          .expect(201);

        setData(makeMatch({ kickoffAt: new Date() }), [makeSeat(SEAT_ID_FREE, 'A', '1', 1)], []);
        await request(app.getHttpServer())
          .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock`)
          .expect(409);
      });

      it('is a 404, and takes no lock, when the match does not exist', async () => {
        setData(null, [makeSeat(SEAT_ID_FREE, 'A', '1', 1)], []);

        await request(app.getHttpServer())
          .post(`/matches/${NON_EXISTENT_MATCH_ID}/seats/${SEAT_ID_FREE}/lock`)
          .expect(404);
        expect(seatLockAcquire).not.toHaveBeenCalled();
      });
    });

    it('should return a valid ISO 8601 expiresAt timestamp', async () => {
      setData(makeMatch(), [makeSeat(SEAT_ID_FREE, 'A', '1', 1)], []);

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
      setData(makeMatch(), [makeSeat(SEAT_ID_LOCKED, 'A', '1', 1)], []);
      // SeatLockService.acquire returns null → already locked
      seatLockAcquire.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_LOCKED}/lock`)
        .expect(409);

      expect(res.body.message).toContain(SEAT_ID_LOCKED);
    });

    it('should call SeatLockService.acquire with the correct matchId and seatId', async () => {
      setData(makeMatch(), [makeSeat(SEAT_ID_FREE, 'A', '1', 1)], []);

      await request(app.getHttpServer())
        .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock`)
        .expect(201);

      expect(seatLockAcquire).toHaveBeenCalledWith(
        expect.objectContaining({ matchId: MATCH_ID, seatId: SEAT_ID_FREE }),
      );
    });

    it('should return 409 when trying to lock a sold seat', async () => {
      const tickets = [makeTicket(MATCH_ID, SEAT_ID_SOLD, TicketStatus.PAID)];
      setData(makeMatch(), [makeSeat(SEAT_ID_SOLD, 'A', '1', 2)], tickets);

      const res = await request(app.getHttpServer())
        .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_SOLD}/lock`)
        .expect(409);

      expect(res.body.message).toBe('Ez a hely már elkelt.');
    });

    it('should return 409 when trying to lock a season-pass seat', async () => {
      setData(
        makeMatch(),
        [makeSeat(SEAT_ID_SEASON_PASS, 'A', '1', 6)],
        [],
        [],
        [SEAT_ID_SEASON_PASS],
      );

      const res = await request(app.getHttpServer())
        .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_SEASON_PASS}/lock`)
        .expect(409);

      expect(res.body.message).toBe('Ez a hely bérletes hely.');
    });

    it('should return 409 when trying to lock an inactive seat', async () => {
      setData(makeMatch(), [makeSeat(SEAT_ID_DISABLED, 'A', '1', 4, { isActive: false })], []);

      const res = await request(app.getHttpServer())
        .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_DISABLED}/lock`)
        .expect(409);

      expect(res.body.message).toContain('Ez a hely nem foglalható');
    });

    it('should return 400 for a non-UUID seatId', async () => {
      await request(app.getHttpServer())
        .post(`/matches/${MATCH_ID}/seats/not-a-uuid/lock`)
        .expect(400);
    });

    it('should return 400 for a non-UUID matchId', async () => {
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
      setData(makeMatch());

      await request(app.getHttpServer())
        .delete(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock?ownerToken=${OWNER_TOKEN}`)
        .expect(204);

      expect(seatLockRelease).toHaveBeenCalledWith(MATCH_ID, SEAT_ID_FREE, OWNER_TOKEN);
    });

    it('should return 404 when the ownerToken query param is missing', async () => {
      await request(app.getHttpServer())
        .delete(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock`)
        .expect(404);
    });

    it('should still return 204 when the ownerToken does not match (idempotent release)', async () => {
      // SeatLockService.release returns false (token mismatch) but the controller
      // does not throw — DELETE is idempotent as per the API contract.
      setData(makeMatch());
      seatLockRelease.mockResolvedValue(false);

      await request(app.getHttpServer())
        .delete(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock?ownerToken=wrong-token`)
        .expect(204);
    });

    it('should return 400 for non-UUID matchId', async () => {
      await request(app.getHttpServer())
        .delete(`/matches/not-a-uuid/seats/${SEAT_ID_FREE}/lock?ownerToken=${OWNER_TOKEN}`)
        .expect(400);
    });

    it('should return 400 for non-UUID seatId', async () => {
      await request(app.getHttpServer())
        .delete(`/matches/${MATCH_ID}/seats/not-a-uuid/lock?ownerToken=${OWNER_TOKEN}`)
        .expect(400);
    });
  });

  describe('POST /matches/:matchId/seats/:seatId/lock/extend', () => {
    it('restarts the lock at the configured hold and ignores any client-supplied TTL', async () => {
      setData(makeMatch());

      await request(app.getHttpServer())
        .post(
          `/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock/extend?ownerToken=${OWNER_TOKEN}&ttlSeconds=99999`,
        )
        .expect(200);

      // (match, seat, token) only: no TTL is passed, the lock service applies its configured default
      expect(seatLockExtend).toHaveBeenCalledWith(MATCH_ID, SEAT_ID_FREE, OWNER_TOKEN);
    });

    it('returns the remaining hold read back from Redis', async () => {
      setData(makeMatch());
      seatLockGetRemainingTtl.mockResolvedValue(300);

      const res = await request(app.getHttpServer())
        .post(`/matches/${MATCH_ID}/seats/${SEAT_ID_FREE}/lock/extend?ownerToken=${OWNER_TOKEN}`)
        .expect(200);

      expect(res.body.ttlSeconds).toBe(300);
    });
  });
});
