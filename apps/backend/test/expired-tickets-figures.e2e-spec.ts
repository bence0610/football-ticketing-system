import './setup/test-env';

import { randomUUID } from 'crypto';
import { hash } from 'bcrypt';
import request from 'supertest';
import { Server } from 'http';
import {
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
 * A paid ticket that was never scanned is EXPIRED by the nightly job after the match. The money was
 * received and the seat was taken: the admin revenue, tickets sold, occupancy and the heatmap must
 * give the same figures before and after that job; in the redemption the expired ticket is sold
 * but not entered.
 */
describe('Admin figures keep expired (paid, unused) tickets (E2E)', () => {
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

  async function makeUser(role: UserRole, email: string): Promise<User> {
    const repo = ctx.dataSource.getRepository(User);
    return repo.save(
      repo.create({
        email,
        passwordHash: await hash('AdminPass123', 10),
        firstName: 'T',
        lastName: role,
        role,
        loyaltyTier: LoyaltyTier.BRONZE,
        loyaltyPoints: 0,
        emailVerified: true,
        twoFactorEnabled: false,
        isActive: true,
      }),
    );
  }

  async function adminToken(): Promise<string> {
    const email = `admin-${randomUUID().slice(0, 6)}@kte.hu`;
    await makeUser(UserRole.ADMIN, email);
    const login = await request(server)
      .post('/api/auth/login')
      .send({ email, password: 'AdminPass123' });
    return login.body.accessToken as string;
  }

  async function seed(): Promise<Match> {
    const seatRepo = ctx.dataSource.getRepository(Seat);
    const seats: Seat[] = [];
    for (let n = 1; n <= 4; n += 1) {
      seats.push(
        await seatRepo.save(
          seatRepo.create({
            section: 'D/1',
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
    const matchRepo = ctx.dataSource.getRepository(Match);
    const match = await matchRepo.save(
      matchRepo.create({
        homeTeam: 'Kecskeméti TE',
        awayTeam: 'Teszt FC',
        venue: 'Széktói',
        kickoffAt: new Date(Date.now() - 3 * 86_400_000),
        status: MatchStatus.FINISHED,
        capacity: 4,
        basePrice: '3000.00',
      }),
    );
    const fan = await makeUser(UserRole.FAN, `fan-${randomUUID().slice(0, 6)}@kte.hu`);
    const tickets = ctx.dataSource.getRepository(Ticket);
    const statuses = [TicketStatus.USED, TicketStatus.USED, TicketStatus.PAID, TicketStatus.PAID];
    for (let i = 0; i < 4; i += 1) {
      await tickets.save(
        tickets.create({
          matchId: match.id,
          seatId: seats[i].id,
          userId: fan.id,
          status: statuses[i],
          source: TicketSource.SINGLE,
          pricePaid: '3000.00',
          currency: 'HUF',
          qrCode: `KTE-${randomUUID()}`,
          qrJti: randomUUID().slice(0, 21),
        }),
      );
    }
    return match;
  }

  async function figures(token: string, matchId: string) {
    const auth = { Authorization: `Bearer ${token}` };
    const overview = (await request(server).get('/api/admin/overview?period=30d').set(auth)).body;
    const row = (overview.matches as Array<Record<string, unknown>>).find(
      (r) => r.matchId === matchId,
    )!;
    const revenue = (await request(server).get('/api/admin/revenue').set(auth)).body;
    const occupancy = (
      await request(server).get(`/api/admin/matches/${matchId}/occupancy`).set(auth)
    ).body;
    const sales = (await request(server).get('/api/admin/seat-sales').set(auth)).body;
    return {
      row: { ticketCount: row.ticketCount, revenue: row.revenue, occupied: row.occupiedSeats },
      metrics: {
        redemption: overview.metrics.redemptionPercent,
        sold: overview.metrics.ticketsSold,
        revenue: overview.metrics.revenue,
        scanned: overview.metrics.scannedTickets,
        played: overview.metrics.playedTickets,
      },
      topMatch: revenue.byMatch?.[0]?.revenue,
      totalSold: occupancy.totalSold,
      heatmapTaken: (sales.seats as Array<{ taken: number }>).reduce((a, s) => a + s.taken, 0),
    };
  }

  it('gives the same figures before and after the nightly expiry; the expired are sold but not entered', async () => {
    const token = await adminToken();
    const match = await seed();
    const before = await figures(token, match.id);

    await ctx.dataSource
      .getRepository(Ticket)
      .update({ matchId: match.id, status: TicketStatus.PAID }, { status: TicketStatus.EXPIRED });
    const after = await figures(token, match.id);

    expect(after).toEqual(before);
    expect(after.row).toEqual({ ticketCount: 4, revenue: 12000, occupied: 4 });
    expect(after.metrics).toMatchObject({
      sold: 4,
      revenue: 12000,
      scanned: 2,
      played: 4,
      redemption: 50,
    });
    expect(after.topMatch).toBe(12000);
    expect(after.totalSold).toBe(4);
    expect(after.heatmapTaken).toBe(4);
  });
});
