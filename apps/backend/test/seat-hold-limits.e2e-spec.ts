import './setup/test-env';

import { randomUUID } from 'crypto';
import request from 'supertest';
import { Server } from 'http';
import { Competition, Match, MatchStatus, Seat, SeatCategory } from '../src/database/entities';
import { SeatLockService } from '../src/redis/seat-lock.service';
import { MAX_SEATS_PER_ORDER } from '../src/modules/payments/dto/create-payment-intent.dto';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { seedMinimalFixture, truncateAll } from './helpers/db.helper';

/**
 * Locking a seat against the real application and Redis (F8): signed-in only, at most
 * MAX_SEATS_PER_ORDER seats held per user per match at a time, an extend never pushes the hold
 * beyond the maximum counted from the first lock, and the lock / best / extend routes are rate
 * limited.
 */
describe('Seat hold limits (E2E)', () => {
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

  async function fan(): Promise<{ token: string; userId: string }> {
    const res = await request(server)
      .post('/api/auth/register')
      .send({
        email: `hold-${randomUUID().slice(0, 8)}@kte.hu`,
        password: 'Teszt1234!',
        firstName: 'Teszt',
        lastName: 'Elek',
      });
    expect(res.status).toBe(201);
    return { token: res.body.accessToken as string, userId: res.body.user.id as string };
  }

  /** A match with `count` free seats in one row of section A. */
  async function seatsFor(count: number): Promise<{ matchId: string; seatIds: string[] }> {
    const { match, seatA, seatB } = await seedMinimalFixture(ctx.dataSource);
    const repo = ctx.dataSource.getRepository(Seat);
    const ids = [seatA.id, seatB.id];
    for (let n = 3; n <= count; n++) {
      const seat = await repo.save(
        repo.create({
          section: 'A',
          row: '1',
          number: n,
          category: SeatCategory.STANDARD,
          priceModifier: '1.00',
          isAccessible: false,
          isActive: true,
        }),
      );
      ids.push(seat.id);
    }
    return { matchId: match.id, seatIds: ids.slice(0, count) };
  }

  const lock = (token: string | null, matchId: string, seatId: string) => {
    const req = request(server).post(`/api/matches/${matchId}/seats/${seatId}/lock`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('refuses a guest on lock, best and extend (401)', async () => {
    const { matchId, seatIds } = await seatsFor(2);
    expect((await lock(null, matchId, seatIds[0])).status).toBe(401);
    const best = await request(server)
      .post(`/api/matches/${matchId}/seats/best`)
      .send({ section: 'A', count: 1 });
    expect(best.status).toBe(401);
    const extend = await request(server)
      .post(`/api/matches/${matchId}/seats/${seatIds[0]}/lock/extend`)
      .query({ ownerToken: 'x' });
    expect(extend.status).toBe(401);
  });

  it('lets a user hold MAX_SEATS_PER_ORDER seats and refuses the next one', async () => {
    const { matchId, seatIds } = await seatsFor(MAX_SEATS_PER_ORDER + 2);
    const user = await fan();
    const held: Array<{ seatId: string; ownerToken: string }> = [];
    for (const seatId of seatIds.slice(0, MAX_SEATS_PER_ORDER)) {
      const res = await lock(user.token, matchId, seatId);
      expect(res.status).toBe(201);
      held.push({ seatId, ownerToken: res.body.ownerToken as string });
    }

    const over = await lock(user.token, matchId, seatIds[MAX_SEATS_PER_ORDER]);
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('seat_limit_reached');
    // The refused seat was not locked: someone else can take it.
    const other = await fan();
    expect((await lock(other.token, matchId, seatIds[MAX_SEATS_PER_ORDER])).status).toBe(201);

    // Letting one go frees a place for the same user.
    const released = await request(server)
      .delete(`/api/matches/${matchId}/seats/${held[0].seatId}/lock`)
      .query({ ownerToken: held[0].ownerToken });
    expect(released.status).toBe(204);
    expect((await lock(user.token, matchId, seatIds[MAX_SEATS_PER_ORDER + 1])).status).toBe(201);
  });

  it('counts per user and per match: another user, and another match, are not affected', async () => {
    const first = await seatsFor(MAX_SEATS_PER_ORDER + 1);
    const user = await fan();
    for (const seatId of first.seatIds.slice(0, MAX_SEATS_PER_ORDER)) {
      expect((await lock(user.token, first.matchId, seatId)).status).toBe(201);
    }
    // The same user on a different match is under the limit there.
    const matchRepo = ctx.dataSource.getRepository(Match);
    const second = await matchRepo.save(
      matchRepo.create({
        homeTeam: 'Kecskeméti TE',
        awayTeam: 'Másik Ellenfél',
        competition: Competition.NB1,
        venue: 'Széktói Stadion',
        kickoffAt: new Date(Date.now() + 14 * 86_400_000),
        status: MatchStatus.ON_SALE,
        capacity: 2,
        basePrice: '5000.00',
      }),
    );
    expect((await lock(user.token, second.id, first.seatIds[0])).status).toBe(201);
  });

  it('does not count a lapsed hold against the limit', async () => {
    const { matchId, seatIds } = await seatsFor(MAX_SEATS_PER_ORDER + 1);
    const user = await fan();
    for (const seatId of seatIds.slice(0, MAX_SEATS_PER_ORDER)) {
      expect((await lock(user.token, matchId, seatId)).status).toBe(201);
    }
    // One hold runs out (Redis drops the key).
    await ctx.redis.del(`seat-lock:${matchId}:${seatIds[0]}`);
    expect((await lock(user.token, matchId, seatIds[MAX_SEATS_PER_ORDER])).status).toBe(201);
  });

  it('never extends a hold beyond the maximum counted from the first lock', async () => {
    const { matchId, seatIds } = await seatsFor(2);
    const user = await fan();
    const res = await lock(user.token, matchId, seatIds[0]);
    expect(res.status).toBe(201);
    const ownerToken = res.body.ownerToken as string;
    const extend = () =>
      request(server)
        .post(`/api/matches/${matchId}/seats/${seatIds[0]}/lock/extend`)
        .set('Authorization', `Bearer ${user.token}`)
        .query({ ownerToken });

    // Early in the hold an extend restarts the full 300 s.
    const early = await extend();
    expect(early.status).toBe(200);
    expect(early.body.ttlSeconds).toBeGreaterThan(290);

    // 1195 s after the first lock (the hold itself has 3 s left) only 5 s of the 1200 s maximum
    // remain: an extend may give 5 s, not another 300 s.
    await ctx.redis.set(`seat-lock-born:${matchId}:${seatIds[0]}`, Date.now() - 1195_000);
    await ctx.redis.expire(`seat-lock:${matchId}:${seatIds[0]}`, 3);
    const late = await extend();
    expect(late.status).toBe(200);
    expect(late.body.ttlSeconds).toBeLessThanOrEqual(5);

    // Nothing more can be gained: the hold lapses on its own.
    const spent = await extend();
    expect(spent.status).toBe(409);
    expect(spent.body.code).toBe('hold_limit_reached');
    const ttl = await ctx.redis.ttl(`seat-lock:${matchId}:${seatIds[0]}`);
    expect(ttl).toBeLessThanOrEqual(5);
  });

  it('refuses an extend for a lock that is not the caller’s', async () => {
    const { matchId, seatIds } = await seatsFor(2);
    const user = await fan();
    await lock(user.token, matchId, seatIds[0]);
    const res = await request(server)
      .post(`/api/matches/${matchId}/seats/${seatIds[0]}/lock/extend`)
      .set('Authorization', `Bearer ${user.token}`)
      .query({ ownerToken: 'not-the-token' });
    expect(res.status).toBe(409);
  });

  it('the best-seats finder respects the same limit and needs no more than the places left', async () => {
    const { matchId, seatIds } = await seatsFor(MAX_SEATS_PER_ORDER + 3);
    const user = await fan();
    for (const seatId of seatIds.slice(0, MAX_SEATS_PER_ORDER - 1)) {
      expect((await lock(user.token, matchId, seatId)).status).toBe(201);
    }
    const locks = ctx.app.get(SeatLockService);
    const rest = seatIds.slice(MAX_SEATS_PER_ORDER - 1);
    // Two more would be one over the limit: nothing is locked.
    await expect(
      locks.acquireFirstFreeGroup(matchId, [rest.slice(0, 2)], {
        userId: user.userId,
        maxHeldSeats: MAX_SEATS_PER_ORDER,
      }),
    ).rejects.toMatchObject({ response: { code: 'seat_limit_reached' } });
    expect(await ctx.redis.exists(`seat-lock:${matchId}:${rest[0]}`)).toBe(0);

    // One more is exactly the limit.
    const one = await locks.acquireFirstFreeGroup(matchId, [[rest[0]]], {
      userId: user.userId,
      maxHeldSeats: MAX_SEATS_PER_ORDER,
    });
    expect(one).not.toBeNull();
    // ...and now the user is at it, for single locks too.
    expect((await lock(user.token, matchId, rest[1])).status).toBe(409);
  });

  it('rate-limits the lock endpoint per user (429), without touching other users', async () => {
    const { matchId, seatIds } = await seatsFor(2);
    const user = await fan();
    // Locking the same seat again is a 409, but every call counts against the budget.
    await lock(user.token, matchId, seatIds[0]);
    let limited = 0;
    for (let i = 0; i < 35; i++) {
      const res = await lock(user.token, matchId, seatIds[0]);
      if (res.status === 429) {
        limited++;
        expect(res.body.code).toBe('rate_limited');
      }
    }
    expect(limited).toBeGreaterThan(0);

    const other = await fan();
    expect((await lock(other.token, matchId, seatIds[1])).status).toBe(201);
  });
});
