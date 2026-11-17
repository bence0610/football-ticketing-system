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
  SeasonPass,
  SeasonPassPrice,
  SeasonPassStatus,
  SeatCategory,
  Sector,
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
    // The sold-out test adds two sectors beside the real 19; leaving them breaks the layout suite.
    if (ctx) {
      await ctx.dataSource.query("DELETE FROM sectors WHERE code IN ('A', 'AWAY-T')");
      await closeTestApp(ctx);
    }
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

  describe('away matches', () => {
    /** An away match, listed in the season but never sold here. */
    async function addAwayMatch(): Promise<Match> {
      const matchRepo = ctx.dataSource.getRepository(Match);
      return matchRepo.save(
        matchRepo.create({
          homeTeam: 'Szeged',
          awayTeam: 'Kecskeméti TE',
          competition: Competition.NB2,
          venue: 'Szeged - vendégpálya',
          kickoffAt: new Date(Date.now() - 5 * 86_400_000),
          status: MatchStatus.FINISHED,
          capacity: 0,
          basePrice: '0.00',
          isSeasonPassEligible: false,
        }),
      );
    }

    it('lists an away match with no figures and keeps it out of every total, even with a ticket and a pass on its books', async () => {
      const admin = await createUser(UserRole.ADMIN);
      const fan = await createUser(UserRole.FAN);
      await seed(fan.id);
      const auth = { Authorization: `Bearer ${admin.token}` };
      const overview = async () =>
        (await request(server).get('/api/admin/overview?period=season').set(auth)).body;
      const seatSales = async () =>
        (await request(server).get('/api/admin/seat-sales').set(auth)).body;
      const revenue = async () => (await request(server).get('/api/admin/revenue').set(auth)).body;

      // An active season pass: its seat counted as "occupied" for EVERY match, away ones too.
      const seats = await ctx.dataSource.getRepository(Seat).find({ order: { number: 'ASC' } });
      await ctx.dataSource.getRepository(SeasonPass).save(
        ctx.dataSource.getRepository(SeasonPass).create({
          userId: fan.id,
          holderName: 'Bérletes Teszt',
          seatId: seats[3].id,
          seasonLabel: '2026/2027',
          validFrom: new Date('2026-07-01'),
          validUntil: new Date('2027-06-30'),
          status: SeasonPassStatus.ACTIVE,
          pricePaid: '22000.00',
          currency: 'HUF',
          qrCode: `KTE-SP-${randomUUID()}`,
        }),
      );
      await ctx.dataSource.getRepository(SeasonPassPrice).save(
        ctx.dataSource.getRepository(SeasonPassPrice).create({
          section: 'upper',
          sectionLabel: 'Felső ív',
          seasonLabel: '2026/2027',
          price: 22000,
          currency: 'HUF',
          validFrom: new Date('2026-07-01'),
          validUntil: new Date('2027-06-30'),
          isActive: true,
        }),
      );

      const before = {
        overview: await overview(),
        seatSales: await seatSales(),
        revenue: await revenue(),
      };
      const away = await addAwayMatch();
      // Forged: a ticket on an away match is a state the application never creates, so it
      // proves that even a stray one is not counted anywhere.
      await ctx.dataSource.getRepository(Ticket).save(
        ctx.dataSource.getRepository(Ticket).create({
          matchId: away.id,
          seatId: seats[2].id,
          userId: fan.id,
          status: TicketStatus.PAID,
          source: TicketSource.SINGLE,
          pricePaid: '9999.00',
          currency: 'HUF',
          qrCode: `KTE-${randomUUID()}`,
          qrJti: randomUUID(),
        }),
      );
      const after = {
        overview: await overview(),
        seatSales: await seatSales(),
        revenue: await revenue(),
      };

      const row = (after.overview.matches as Array<Record<string, unknown>>).find(
        (m) => m.matchId === away.id,
      )!;
      expect(row).toMatchObject({
        isHome: false,
        final: true,
        ticketCount: null,
        passesValid: null,
        passEntered: null,
        occupiedSeats: null,
        capacity: null,
        occupancyPercent: null,
        revenue: null,
      });
      expect(after.overview.metrics).toEqual(before.overview.metrics);
      expect(after.overview.matches.filter((m: { isHome: boolean }) => m.isHome)).toEqual(
        before.overview.matches,
      );
      expect(after.seatSales.matchCount).toBe(before.seatSales.matchCount);
      expect(after.seatSales.seats).toEqual(before.seatSales.seats);
      expect(after.revenue.summary).toEqual(before.revenue.summary);
      expect(after.revenue.daily).toEqual(before.revenue.daily);
      expect(after.revenue.byMatch).toEqual(before.revenue.byMatch);
    });

    it('has no occupancy report for an away match', async () => {
      const admin = await createUser(UserRole.ADMIN);
      const away = await addAwayMatch();
      const res = await request(server)
        .get(`/api/admin/matches/${away.id}/occupancy`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(400);
    });
  });

  it('reads a fully sold home match as exactly 100% of the sellable seats, the away section not counted', async () => {
    const admin = await createUser(UserRole.ADMIN);
    const fan = await createUser(UserRole.FAN);
    const { m2 } = await seed(fan.id);
    const sectorRepo = ctx.dataSource.getRepository(Sector);
    const sector = (code: string, arc: 'upper' | 'lower', isAway: boolean): Sector =>
      sectorRepo.create({
        code,
        name: code,
        arc,
        position: 90,
        gate: 1,
        priceCategory: isAway ? null : 'upper',
        isAway,
        isCovered: false,
      });
    await sectorRepo.save([sector('A', 'upper', false), sector('AWAY-T', 'lower', true)]);
    const seatRepo = ctx.dataSource.getRepository(Seat);
    await seatRepo.save(
      seatRepo.create({
        section: 'AWAY-T',
        row: '1',
        number: 1,
        category: SeatCategory.STANDARD,
        priceModifier: '1.00',
        isAccessible: false,
        isActive: true,
      }),
    );
    // Sell the other three sellable seats of the upcoming match: all four are now taken.
    const sellable = await seatRepo.find({ where: { section: 'A' }, order: { number: 'ASC' } });
    const ticketRepo = ctx.dataSource.getRepository(Ticket);
    for (const seat of sellable.slice(1)) {
      await ticketRepo.save(
        ticketRepo.create({
          matchId: m2.id,
          seatId: seat.id,
          userId: fan.id,
          status: TicketStatus.PAID,
          source: TicketSource.SINGLE,
          pricePaid: '3333.00',
          currency: 'HUF',
          qrCode: `KTE-${randomUUID()}`,
          qrJti: randomUUID(),
        }),
      );
    }
    const auth = { Authorization: `Bearer ${admin.token}` };

    const overview = await request(server).get('/api/admin/overview?period=season').set(auth);
    const row = (overview.body.matches as Array<Record<string, unknown>>).find(
      (m) => m.matchId === m2.id,
    )!;
    // 5 active seats in the stadium, 4 sellable: 100%, not 80%.
    expect(row).toMatchObject({ occupiedSeats: 4, capacity: 4, occupancyPercent: 100 });

    const occupancy = await request(server).get(`/api/admin/matches/${m2.id}/occupancy`).set(auth);
    expect(occupancy.status).toBe(200);
    expect(occupancy.body).toMatchObject({ totalCapacity: 4, totalSold: 4, occupancyPercent: 100 });
    expect((occupancy.body.sectors as Array<{ section: string }>).map((s) => s.section)).toEqual([
      'A',
    ]);
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

  describe('season-pass revenue', () => {
    /** Passes in three tiers' real sectors: 2 counted (22 000 upper, 45 000 vip), 2 not (pending, cancelled). */
    async function seedPasses(buyerId: string): Promise<void> {
      const seatRepo = ctx.dataSource.getRepository(Seat);
      const passRepo = ctx.dataSource.getRepository(SeasonPass);
      const priceRepo = ctx.dataSource.getRepository(SeasonPassPrice);
      await priceRepo.save(
        priceRepo.create({
          section: 'upper',
          sectionLabel: 'Felső ív',
          seasonLabel: '2026/2027',
          price: 22000,
          currency: 'HUF',
          validFrom: new Date('2026-07-01'),
          validUntil: new Date('2027-06-30'),
          isActive: true,
        }),
      );
      const seat = (section: string, n: number): Promise<Seat> =>
        seatRepo.save(
          seatRepo.create({
            section,
            row: 'P',
            number: n,
            category: SeatCategory.STANDARD,
            priceModifier: '1.00',
            isAccessible: false,
            isActive: true,
          }),
        );
      const pass = (s: Seat, status: SeasonPassStatus, paid: string): SeasonPass =>
        passRepo.create({
          userId: buyerId,
          holderName: 'Bérletes Teszt',
          seatId: s.id,
          seasonLabel: '2026/2027',
          validFrom: new Date('2026-07-01'),
          validUntil: new Date('2027-06-30'),
          status,
          pricePaid: paid,
          currency: 'HUF',
          qrCode: `KTE-SP-${randomUUID()}`,
        });
      await passRepo.save([
        pass(await seat('D/1', 1), SeasonPassStatus.ACTIVE, '22000.00'),
        pass(await seat('VIP', 1), SeasonPassStatus.ACTIVE, '45000.00'),
        pass(await seat('D/1', 2), SeasonPassStatus.PENDING_PAYMENT, '22000.00'),
        pass(await seat('D/1', 3), SeasonPassStatus.CANCELLED, '22000.00'),
      ]);
    }

    it('reports pass money in its own block and leaves match revenue exactly as it was', async () => {
      const admin = await createUser(UserRole.ADMIN);
      const fan = await createUser(UserRole.FAN);
      const { m1, m2 } = await seed(fan.id);
      await seedPasses(fan.id);

      const res = await request(server)
        .get('/api/admin/overview?period=season')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);

      // match tickets: unchanged, no pass money, no per-match share
      expect(res.body.metrics.revenue).toBe(2833 + 4667 + 5000);
      const matches = res.body.matches as Array<{ matchId: string; revenue: number }>;
      expect(matches.find((m) => m.matchId === m1.id)!.revenue).toBe(7500);
      expect(matches.find((m) => m.matchId === m2.id)!.revenue).toBe(5000);

      expect(res.body.seasonPasses).toMatchObject({
        basis: 'season',
        revenue: 67000,
        passCount: 2,
      });
      const tiers = res.body.seasonPasses.byTier as Array<{
        tier: string;
        passCount: number;
        revenue: number;
      }>;
      expect(tiers.map((t) => [t.tier, t.passCount, t.revenue])).toEqual([
        ['vip', 1, 45000],
        ['upper', 1, 22000],
      ]);
    });

    it('counts passes bought in the window for the 30 day period, and says so', async () => {
      const admin = await createUser(UserRole.ADMIN);
      const fan = await createUser(UserRole.FAN);
      await seed(fan.id);
      await seedPasses(fan.id);

      const res = await request(server)
        .get('/api/admin/overview?period=30d')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.body.seasonPasses).toMatchObject({
        basis: 'purchased_in_period',
        revenue: 67000,
        passCount: 2,
      });
    });

    it('is zero, not an error, when no pass was sold', async () => {
      const admin = await createUser(UserRole.ADMIN);
      const res = await request(server)
        .get('/api/admin/overview?period=season')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.seasonPasses).toMatchObject({ revenue: 0, passCount: 0, byTier: [] });
    });

    it('/admin/revenue keeps ticket revenue and pass revenue apart', async () => {
      const admin = await createUser(UserRole.ADMIN);
      const fan = await createUser(UserRole.FAN);
      await seed(fan.id);
      await seedPasses(fan.id);

      const res = await request(server)
        .get('/api/admin/revenue')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);

      // tickets only: 2833 + 4667 + 5000 were created today, the passes are not in here
      expect(res.body.summary.todayRevenue).toBe(12500);
      expect(res.body.summary.todayTicketCount).toBe(3);
      const byMatchTotal = (res.body.byMatch as Array<{ revenue: number }>).reduce(
        (a, m) => a + m.revenue,
        0,
      );
      expect(byMatchTotal).toBe(12500);
      const dailyTotal = (res.body.daily as Array<{ amount: number }>).reduce(
        (a, d) => a + d.amount,
        0,
      );
      expect(dailyTotal).toBe(12500);

      expect(res.body.seasonPasses).toMatchObject({
        todayRevenue: 67000,
        monthRevenue: 67000,
        todayPassCount: 2,
        monthPassCount: 2,
      });
      const passDaily = res.body.seasonPasses.daily as Array<{ amount: number; passCount: number }>;
      expect(passDaily.reduce((a, d) => a + d.amount, 0)).toBe(67000);
      expect(passDaily.reduce((a, d) => a + d.passCount, 0)).toBe(2);
      expect((res.body.seasonPasses.byTier as Array<{ tier: string }>).map((t) => t.tier)).toEqual([
        'vip',
        'upper',
      ]);
    });
  });
});
