import './setup/test-env';

import { randomUUID } from 'crypto';
import { hash } from 'bcrypt';
import request from 'supertest';
import { Server } from 'http';
import {
  Competition,
  LoyaltyTier,
  Match,
  MatchStatus,
  Seat,
  SeatCategory,
  Ticket,
  TicketSource,
  TicketStatus,
  User,
  UserRole,
} from '../src/database/entities';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { truncateAll } from './helpers/db.helper';

/**
 * The admin overview and seat-sales endpoints: refused to everyone who is not
 * an admin, read-only, and reporting what was actually charged and scanned.
 *
 * Fixture (4 active seats):
 *   M1, played, FINISHED: 2 single tickets, 2833 + 4667 Ft charged, one scanned
 *   M2, upcoming, ON_SALE: 1 single ticket, 5000 Ft charged
 */
const PASSWORD = 'AdminPass123';

describe('Admin overview (E2E)', () => {
  let ctx: TestContext;
  let server: Server;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.httpServer;
  });

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  beforeEach(async () => {
    await truncateAll(ctx.dataSource);
    await ctx.redis.flushdb();
  });

  async function createUser(role: UserRole): Promise<{ id: string; token: string }> {
    const repo = ctx.dataSource.getRepository(User);
    const email = `${role}-${randomUUID().slice(0, 8)}@kte.hu`;
    const user = await repo.save(
      repo.create({
        email,
        passwordHash: await hash(PASSWORD, 10),
        firstName: 'Teszt',
        lastName: role,
        role,
        loyaltyTier: LoyaltyTier.BRONZE,
        loyaltyPoints: 0,
        emailVerified: true,
        twoFactorEnabled: false,
        isActive: true,
      }),
    );
    const login = await request(server).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
    return { id: user.id, token: login.body.accessToken as string };
  }

  async function seed(buyerId: string): Promise<{ m1: Match; m2: Match }> {
    const matchRepo = ctx.dataSource.getRepository(Match);
    const seatRepo = ctx.dataSource.getRepository(Seat);
    const ticketRepo = ctx.dataSource.getRepository(Ticket);

    const mk = (away: string, kickoffAt: Date, status: MatchStatus): Promise<Match> =>
      matchRepo.save(
        matchRepo.create({
          homeTeam: 'Kecskeméti TE',
          awayTeam: away,
          competition: Competition.NB1,
          venue: 'Széktói Stadion',
          kickoffAt,
          status,
          capacity: 4,
          basePrice: '3333.00',
          isSeasonPassEligible: false,
        }),
      );
    const m1 = await mk('Played FC', new Date(Date.now() - 3 * 86_400_000), MatchStatus.FINISHED);
    const m2 = await mk('Upcoming FC', new Date(Date.now() + 7 * 86_400_000), MatchStatus.ON_SALE);

    const seats: Seat[] = [];
    for (let n = 1; n <= 4; n += 1) {
      seats.push(
        await seatRepo.save(
          seatRepo.create({
            section: 'A',
            row: '1',
            number: n,
            category: SeatCategory.STANDARD,
            priceModifier: '1.00',
            isAccessible: false,
            isActive: true,
          }),
        ),
      );
    }

    const ticket = (match: Match, seat: Seat, pricePaid: string, status: TicketStatus): Ticket =>
      ticketRepo.create({
        matchId: match.id,
        seatId: seat.id,
        userId: buyerId,
        status,
        source: TicketSource.SINGLE,
        pricePaid,
        currency: 'HUF',
        qrCode: `KTE-${randomUUID()}`,
        qrJti: randomUUID(),
      });
    await ticketRepo.save([
      ticket(m1, seats[0], '2833.00', TicketStatus.USED),
      ticket(m1, seats[1], '4667.00', TicketStatus.PAID),
      ticket(m2, seats[0], '5000.00', TicketStatus.PAID),
    ]);
    return { m1, m2 };
  }

  describe.each(['/api/admin/overview', '/api/admin/seat-sales'])('%s', (path) => {
    it('refuses an anonymous caller', async () => {
      const res = await request(server).get(path);
      expect(res.status).toBe(401);
    });

    it('refuses a signed-in fan and a gate steward', async () => {
      const fan = await createUser(UserRole.FAN);
      const gate = await createUser(UserRole.GATE);
      for (const who of [fan, gate]) {
        const res = await request(server).get(path).set('Authorization', `Bearer ${who.token}`);
        expect(res.status).toBe(403);
      }
    });
  });

  it('reports what was charged and scanned, and marks the upcoming match as not final', async () => {
    const admin = await createUser(UserRole.ADMIN);
    const fan = await createUser(UserRole.FAN);
    const { m1, m2 } = await seed(fan.id);

    const res = await request(server)
      .get('/api/admin/overview?period=season')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);

    const { metrics, matches } = res.body as {
      metrics: Record<string, number | null>;
      matches: Array<Record<string, unknown>>;
    };
    expect(metrics.revenue).toBe(2833 + 4667 + 5000);
    expect(metrics.ticketsSold).toBe(3);
    // Only the played match counts towards occupancy and redemption.
    expect(metrics.finalMatchCount).toBe(1);
    expect(metrics.averageOccupancyPercent).toBe(50);
    expect(metrics.playedTickets).toBe(2);
    expect(metrics.scannedTickets).toBe(1);
    expect(metrics.redemptionPercent).toBe(50);

    const row1 = matches.find((m) => m.matchId === m1.id)!;
    const row2 = matches.find((m) => m.matchId === m2.id)!;
    expect(row1).toMatchObject({
      final: true,
      ticketCount: 2,
      revenue: 7500,
      occupancyPercent: 50,
    });
    expect(row2).toMatchObject({
      final: false,
      ticketCount: 1,
      revenue: 5000,
      occupancyPercent: 25,
    });
  });

  it('counts how often each seat was taken across the matches already played', async () => {
    const admin = await createUser(UserRole.ADMIN);
    const fan = await createUser(UserRole.FAN);
    await seed(fan.id);

    const res = await request(server)
      .get('/api/admin/seat-sales')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);

    // The upcoming match is not a played match: it is not in the denominator.
    expect(res.body.matchCount).toBe(1);
    const taken = (res.body.seats as Array<{ number: number; taken: number }>).map((s) => s.taken);
    expect(taken).toEqual([1, 1, 0, 0]);
  });

  it('is read-only: the admin area exposes no write route', async () => {
    const admin = await createUser(UserRole.ADMIN);
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(server)
        [method]('/api/admin/overview')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({});
      expect(res.status).toBe(404);
    }
  });
});
