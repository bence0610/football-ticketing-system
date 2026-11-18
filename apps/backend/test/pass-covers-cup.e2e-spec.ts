import './setup/test-env';

import { randomUUID } from 'crypto';
import { hash } from 'bcrypt';
import request from 'supertest';
import { Server } from 'http';
import {
  Competition,
  LoyaltyTier,
  LoyaltyTransaction,
  LoyaltyTransactionSource,
  Match,
  MatchStatus,
  Seat,
  SeatCategory,
  SeasonPassPrice,
  User,
  UserRole,
} from '../src/database/entities';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { createGateUser, seedSeasonPass, truncateAll } from './helpers/db.helper';

/**
 * A season pass covers every HOME match of its season in the league and the Magyar Kupa;
 * friendlies are not covered. Matches here are created WITHOUT an explicit
 * `isSeasonPassEligible`, the way a cup tie scheduled after the passes were sold would be: the
 * Match entity decides the flag on insert (isPassEligibleMatch), so the cover starts at once.
 */
const PASSWORD = 'FanPass123';
const DAY = 86_400_000;

describe('A season pass covers the home cup ties (E2E)', () => {
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

  async function createUser(role: UserRole): Promise<{ id: string; email: string; token: string }> {
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
    return { id: user.id, email, token: login.body.accessToken as string };
  }

  /** No `isSeasonPassEligible`: the entity decides it from the competition and the home side. */
  async function seedMatch(
    competition: Competition,
    kickoffInDays: number,
    homeTeam = 'Kecskeméti TE',
  ): Promise<Match> {
    const repo = ctx.dataSource.getRepository(Match);
    return repo.save(
      repo.create({
        homeTeam,
        awayTeam: homeTeam === 'Kecskeméti TE' ? 'Teszt FC' : 'Kecskeméti TE',
        competition,
        venue: 'Széktói Stadion',
        kickoffAt: new Date(Date.now() + kickoffInDays * DAY),
        status: MatchStatus.ON_SALE,
        capacity: 10,
        basePrice: '3000.00',
      }),
    );
  }

  async function seedPassSeat(): Promise<{
    passSeat: Seat;
    holder: Awaited<ReturnType<typeof createUser>>;
    passId: string;
  }> {
    const repo = ctx.dataSource.getRepository(Seat);
    const make = (number: number): Promise<Seat> =>
      repo.save(
        repo.create({
          section: 'D/1',
          row: '1',
          number,
          category: SeatCategory.STANDARD,
          priceModifier: '1.00',
          isAccessible: false,
          isActive: true,
        }),
      );
    const passSeat = await make(1);
    await make(2);
    const holder = await createUser(UserRole.FAN);
    const pass = await seedSeasonPass(ctx.dataSource, { userId: holder.id, seatId: passSeat.id });
    return { passSeat, holder, passId: pass.id };
  }

  const seatStatus = async (matchId: string, seatId: string): Promise<string> => {
    const res = await request(server).get(`/api/matches/${matchId}/seats`);
    expect(res.status).toBe(200);
    return (res.body.seats as Array<{ id: string; status: string }>).find((s) => s.id === seatId)!
      .status;
  };

  it('the entity decides the flag on creation: home league and cup yes, friendly and away no', async () => {
    const flag = async (m: Match): Promise<boolean> =>
      (await ctx.dataSource.getRepository(Match).findOneByOrFail({ id: m.id }))
        .isSeasonPassEligible;
    expect(await flag(await seedMatch(Competition.NB2, 5))).toBe(true);
    expect(await flag(await seedMatch(Competition.MAGYAR_KUPA, 5))).toBe(true);
    expect(await flag(await seedMatch(Competition.FRIENDLY, 5))).toBe(false);
    expect(await flag(await seedMatch(Competition.MAGYAR_KUPA, 5, 'Újpest FC'))).toBe(false);
  });

  it('an insert that bypasses the entity (raw SQL) is NOT covered: the column default is 0', async () => {
    const id = randomUUID();
    await ctx.dataSource.query(
      "INSERT INTO matches (id, home_team, away_team, competition, venue, kickoff_at, status, capacity, base_price) VALUES (?, 'Kecskeméti TE', 'Teszt FC', 'magyar_kupa', 'Széktói', DATE_ADD(NOW(), INTERVAL 5 DAY), 'on_sale', 10, 3000)",
      [id],
    );
    const row = await ctx.dataSource.getRepository(Match).findOneByOrFail({ id });
    expect(row.isSeasonPassEligible).toBe(false);
  });

  it('a pass holder enters a home cup tie with the pass (and earns the attendance points)', async () => {
    const { holder, passId } = await seedPassSeat();
    const cup = await seedMatch(Competition.MAGYAR_KUPA, 7);
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-cup-1@kte.hu' });
    const gateLogin = await request(server)
      .post('/api/auth/login')
      .send({ email: gate.user.email, password: gate.plainPassword });
    const gateToken = gateLogin.body.accessToken as string;

    const qr = await request(server)
      .get(`/api/season-passes/${passId}/qr/${cup.id}`)
      .set('Authorization', `Bearer ${holder.token}`);
    expect(qr.status).toBe(200);

    const scan = await request(server)
      .patch(`/api/tickets/${qr.body.ticketId}/scan`)
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: qr.body.token });
    expect(scan.status).toBe(200);
    expect(scan.body.success).toBe(true);
    expect(scan.body.result).toBe('ok');

    const rows = await ctx.dataSource.getRepository(LoyaltyTransaction).find({
      where: { userId: holder.id, source: LoyaltyTransactionSource.ATTENDANCE },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].referenceId).toBe(`match:${cup.id}:${holder.id}`);
  });

  it('a single ticket for a pass seat on a home cup tie is refused', async () => {
    const { passSeat } = await seedPassSeat();
    const cup = await seedMatch(Competition.MAGYAR_KUPA, 7);
    const buyer = await createUser(UserRole.FAN);
    const auth = { Authorization: `Bearer ${buyer.token}` };

    expect(await seatStatus(cup.id, passSeat.id)).toBe('season_pass');
    const lock = await request(server)
      .post(`/api/matches/${cup.id}/seats/${passSeat.id}/lock`)
      .set(auth);
    expect(lock.status).toBe(409);
    // the finder does not offer the pass seat either: two together are impossible in a 2-seat sector
    const best = await request(server)
      .post(`/api/matches/${cup.id}/seats/best`)
      .set(auth)
      .send({ section: 'D/1', count: 2 });
    expect(best.status).toBe(409);
  });

  it('a cup match created after the pass was bought is covered from the moment it exists', async () => {
    const { passSeat, holder, passId } = await seedPassSeat();
    // the pass is already sold and a league match is on the calendar; the cup tie comes later
    await seedMatch(Competition.NB2, 3);
    const lateCup = await seedMatch(Competition.MAGYAR_KUPA, 20);

    expect(await seatStatus(lateCup.id, passSeat.id)).toBe('season_pass');
    const stranger = await createUser(UserRole.FAN);
    const lock = await request(server)
      .post(`/api/matches/${lateCup.id}/seats/${passSeat.id}/lock`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(lock.status).toBe(409);

    // and the season overview (the page headline and fixture list) counts it, as a cup tie
    await ctx.dataSource.getRepository(SeasonPassPrice).save(
      ctx.dataSource.getRepository(SeasonPassPrice).create({
        section: 'D/1',
        sectionLabel: 'D/1 szektor',
        seasonLabel: '2026/2027',
        price: 30000,
        currency: 'HUF',
        validFrom: new Date('2026-07-01'),
        validUntil: new Date('2027-06-30'),
        isActive: true,
      }),
    );
    const season = await request(server).get('/api/season-passes/season').expect(200);
    const fixtures = season.body.homeMatches as Array<{ id: string; competition: string }>;
    expect(fixtures.find((m) => m.id === lateCup.id)?.competition).toBe('magyar_kupa');
    expect(fixtures).toHaveLength(2); // the league match and the late cup tie
    const qr = await request(server)
      .get(`/api/season-passes/${passId}/qr/${lateCup.id}`)
      .set('Authorization', `Bearer ${holder.token}`);
    expect(qr.status).toBe(200);
  });

  it('a friendly is not covered: its pass seat is sold like any other and the QR is refused', async () => {
    const { passSeat, holder, passId } = await seedPassSeat();
    const friendly = await seedMatch(Competition.FRIENDLY, 7);
    const buyer = await createUser(UserRole.FAN);

    expect(await seatStatus(friendly.id, passSeat.id)).toBe('available');
    const lock = await request(server)
      .post(`/api/matches/${friendly.id}/seats/${passSeat.id}/lock`)
      .set('Authorization', `Bearer ${buyer.token}`);
    expect(lock.status).toBe(201);

    const qr = await request(server)
      .get(`/api/season-passes/${passId}/qr/${friendly.id}`)
      .set('Authorization', `Bearer ${holder.token}`);
    expect(qr.status).toBe(400);
    expect(qr.body.code).toBe('match_not_pass_eligible');
  });
});
