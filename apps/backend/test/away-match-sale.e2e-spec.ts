import './setup/test-env';

import request from 'supertest';
import { Server } from 'http';
import {
  Competition,
  Match,
  MatchStatus,
  Seat,
  SeatCategory,
  Ticket,
  TicketSource,
  TicketStatus,
  Waitlist,
  WaitlistStatus,
} from '../src/database/entities';
import { RedisKeys } from '../src/redis/redis.constants';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { truncateAll } from './helpers/db.helper';

/**
 * Tickets are sold only for HOME matches. The refusal lives in one place (assertMatchOpenForSale
 * and assertMatchIsHome in matches/match-sale.ts), so every path that loads a match for a sale
 * gets it: the seat map, the lock, the best-seats finder, the payment intent, the waitlist join
 * and the waitlist claim. One test per path: refused (409 match_away) for an away match, and
 * still accepted for a home one.
 */
const PASSWORD = 'FanPass123';
const HOME = 'Kecskeméti TE';

describe('Away matches are not for sale (E2E)', () => {
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

  async function registerFan(): Promise<{ userId: string; token: string }> {
    const email = `away-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@kte.hu`;
    const res = await request(server)
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, firstName: 'Teszt', lastName: 'Felhasználó' });
    expect(res.status).toBe(201);
    return { userId: res.body.user.id, token: res.body.accessToken };
  }

  async function seedMatch(home: boolean, capacity = 10): Promise<Match> {
    const repo = ctx.dataSource.getRepository(Match);
    return repo.save(
      repo.create({
        homeTeam: home ? HOME : 'Ferencváros',
        awayTeam: home ? 'Ferencváros' : HOME,
        competition: Competition.NB2,
        venue: home ? 'Széktói Stadion' : 'Groupama Aréna',
        kickoffAt: new Date(Date.now() + 7 * 86_400_000),
        status: MatchStatus.ON_SALE,
        // An away match carries no capacity and no price, as the demo data has it.
        capacity: home ? capacity : 0,
        basePrice: home ? '5000.00' : '0.00',
        isSeasonPassEligible: home,
      }),
    );
  }

  /** A seat in a real, non-away sector (the finder reads the sectors table). */
  async function seedSeat(number = 1): Promise<Seat> {
    const repo = ctx.dataSource.getRepository(Seat);
    return repo.save(
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
  }

  const expectAway = (res: request.Response): void => {
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('match_away');
  };

  it('GET /matches/:id/seats: no sellable map for an away match, a map for a home one', async () => {
    await seedSeat();
    const away = await seedMatch(false);
    const home = await seedMatch(true);

    expectAway(await request(server).get(`/api/matches/${away.id}/seats`));

    const ok = await request(server).get(`/api/matches/${home.id}/seats`);
    expect(ok.status).toBe(200);
    expect(ok.body.seats.length).toBe(1);
  });

  it('POST /matches/:id/seats/:seatId/lock: refused for an away match, accepted for a home one', async () => {
    const seat = await seedSeat();
    const away = await seedMatch(false);
    const home = await seedMatch(true);
    const fan = await registerFan();

    expectAway(
      await request(server)
        .post(`/api/matches/${away.id}/seats/${seat.id}/lock`)
        .set('Authorization', `Bearer ${fan.token}`),
    );
    // and nothing was locked
    expect(await ctx.redis.get(RedisKeys.seatLock(away.id, seat.id))).toBeNull();

    const ok = await request(server)
      .post(`/api/matches/${home.id}/seats/${seat.id}/lock`)
      .set('Authorization', `Bearer ${fan.token}`);
    expect(ok.status).toBe(201);
  });

  it('POST /matches/:id/seats/best: refused for an away match, accepted for a home one', async () => {
    await seedSeat(1);
    await seedSeat(2);
    const away = await seedMatch(false);
    const home = await seedMatch(true);
    const fan = await registerFan();

    expectAway(
      await request(server)
        .post(`/api/matches/${away.id}/seats/best`)
        .set('Authorization', `Bearer ${fan.token}`)
        .send({ section: 'D/1', count: 1 }),
    );

    const ok = await request(server)
      .post(`/api/matches/${home.id}/seats/best`)
      .set('Authorization', `Bearer ${fan.token}`)
      .send({ section: 'D/1', count: 1 });
    expect(ok.status).toBe(201);
  });

  it('POST /payments/create-intent: refused for an away match, accepted for a home one', async () => {
    const seat = await seedSeat();
    const away = await seedMatch(false);
    const home = await seedMatch(true);
    const fan = await registerFan();

    // The match is refused before the seats are even looked at, so any token will do.
    expectAway(
      await request(server)
        .post('/api/payments/create-intent')
        .set('Authorization', `Bearer ${fan.token}`)
        .send({ matchId: away.id, seats: [{ seatId: seat.id, ownerToken: 'not-a-real-token' }] }),
    );

    const lock = await request(server)
      .post(`/api/matches/${home.id}/seats/${seat.id}/lock`)
      .set('Authorization', `Bearer ${fan.token}`);
    expect(lock.status).toBe(201);
    const ok = await request(server)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${fan.token}`)
      .send({ matchId: home.id, seats: [{ seatId: seat.id, ownerToken: lock.body.ownerToken }] });
    expect(ok.status).toBe(201);
  });

  it('POST /waitlist: no entry for an away match, an entry for a sold-out home one', async () => {
    const seat = await seedSeat();
    const away = await seedMatch(false);
    const home = await seedMatch(true, 1);
    const fan = await registerFan();
    // The home match is sold out: its one seat has a ticket.
    await ctx.dataSource.getRepository(Ticket).save(
      ctx.dataSource.getRepository(Ticket).create({
        matchId: home.id,
        seatId: seat.id,
        userId: fan.userId,
        status: TicketStatus.PAID,
        source: TicketSource.SINGLE,
        pricePaid: '5000.00',
        qrCode: 'qr-away-test',
        qrJti: 'jti-away-test',
      }),
    );

    expectAway(
      await request(server)
        .post('/api/waitlist')
        .set('Authorization', `Bearer ${fan.token}`)
        .send({ matchId: away.id }),
    );
    expect(
      await ctx.dataSource.getRepository(Waitlist).count({ where: { matchId: away.id } }),
    ).toBe(0);

    const ok = await request(server)
      .post('/api/waitlist')
      .set('Authorization', `Bearer ${fan.token}`)
      .send({ matchId: home.id });
    expect(ok.status).toBe(201);
  });

  it('POST /waitlist/:matchId/claim: refused for an away match, accepted for a home one', async () => {
    const away = await seedMatch(false);
    const home = await seedMatch(true);
    const fan = await registerFan();
    const repo = ctx.dataSource.getRepository(Waitlist);
    for (const match of [away, home]) {
      const entry = await repo.save(
        repo.create({ userId: fan.userId, matchId: match.id, status: WaitlistStatus.NOTIFIED }),
      );
      await ctx.redis.set(RedisKeys.waitlistClaim(match.id, fan.userId), entry.id, 'EX', 300);
    }

    expectAway(
      await request(server)
        .post(`/api/waitlist/${away.id}/claim`)
        .set('Authorization', `Bearer ${fan.token}`),
    );

    const ok = await request(server)
      .post(`/api/waitlist/${home.id}/claim`)
      .set('Authorization', `Bearer ${fan.token}`);
    expect(ok.status).toBe(200);
  });
});
