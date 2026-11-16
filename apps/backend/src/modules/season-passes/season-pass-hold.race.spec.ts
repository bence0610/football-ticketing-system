import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { RedisKeys } from '../../redis/redis.constants';
import { SeasonPassHoldService } from '../../redis/season-pass-hold.service';

/**
 * Season-pass seat holds against a REAL Redis with REAL concurrency: the Lua
 * scripts are the race-safety argument, so a mock that agrees with the code
 * would prove nothing. Each run uses its own key prefix and season label.
 *
 *   REDIS_RACE_URL=redis://localhost:6379 (default) ; skipped if unreachable.
 */
const REDIS_URL = process.env.REDIS_RACE_URL ?? 'redis://localhost:6379';

describe('SeasonPassHoldService (real Redis)', () => {
  let redis: Redis;
  let available = false;
  let holds: SeasonPassHoldService;
  const prefix = `kte-unit-${randomUUID()}:`;
  let season: string;

  const config = {
    get: () => ({ seasonPassHoldTtlSeconds: 900 }),
  } as unknown as ConfigService;

  beforeAll(async () => {
    redis = new Redis(REDIS_URL, {
      lazyConnect: true,
      keyPrefix: prefix,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    try {
      await redis.connect();
      await redis.ping();
      available = true;
    } catch {
      available = false;
    }
    holds = new SeasonPassHoldService(redis, config);
  });

  afterAll(async () => {
    if (!available) return;
    // ioredis does not prefix KEYS patterns' results for DEL, so strip and re-add.
    const keys = await redis.keys('*');
    const own = keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    if (own.length > 0) await redis.del(...own);
    redis.disconnect();
  });

  beforeEach(() => {
    season = `test-${randomUUID()}`;
  });

  const itRedis = (name: string, fn: () => Promise<void>): void =>
    it(name, async () => {
      if (!available) {
        // eslint-disable-next-line no-console -- visible reason for a skipped real-Redis test
        console.warn(`Redis not reachable at ${REDIS_URL}; skipping "${name}"`);
        return;
      }
      await fn();
    });

  itRedis('20 users holding the same seat at once: exactly one wins', async () => {
    const seat = randomUUID();
    const users = Array.from({ length: 20 }, () => randomUUID());
    const results = await Promise.all(users.map((u) => holds.hold(season, seat, u)));
    const winners = results.filter((r) => r.kind === 'held');
    expect(winners).toHaveLength(1);
    const token = await redis.get(RedisKeys.seasonPassHold(season, seat));
    expect(winners[0]).toMatchObject({ holdToken: token, ttlSeconds: 900, renewed: false });
    const ttl = await redis.ttl(RedisKeys.seasonPassHold(season, seat));
    expect(ttl).toBeGreaterThan(890);
  });

  itRedis('the seat key stores only the token, never the user', async () => {
    const seat = randomUUID();
    const user = randomUUID();
    const r = await holds.hold(season, seat, user);
    expect(r.kind).toBe('held');
    const value = await redis.get(RedisKeys.seasonPassHold(season, seat));
    expect(value).not.toContain(user);
  });

  itRedis('one hold per user: choosing another seat releases the previous one', async () => {
    const user = randomUUID();
    const a = randomUUID();
    const b = randomUUID();
    const first = await holds.hold(season, a, user);
    const second = await holds.hold(season, b, user);
    expect(first.kind).toBe('held');
    expect(second.kind).toBe('held');
    expect(await redis.exists(RedisKeys.seasonPassHold(season, a))).toBe(0);
    expect(await redis.exists(RedisKeys.seasonPassHold(season, b))).toBe(1);
    // someone else can now take A
    expect((await holds.hold(season, a, randomUUID())).kind).toBe('held');
  });

  itRedis('one user firing holds for 10 seats at once ends up holding exactly one', async () => {
    const user = randomUUID();
    const seats = Array.from({ length: 10 }, () => randomUUID());
    await Promise.all(seats.map((s) => holds.hold(season, s, user)));
    const values = await redis.mget(...seats.map((s) => RedisKeys.seasonPassHold(season, s)));
    expect(values.filter((v) => v !== null)).toHaveLength(1);
    const owner = await redis.get(RedisKeys.seasonPassHoldOwner(season, user));
    const heldSeat = seats[values.findIndex((v) => v !== null)];
    expect(owner).toBe(`${heldSeat}|${values.find((v) => v !== null)}`);
  });

  itRedis("re-holding one's own seat is idempotent: same token, TTL restarted", async () => {
    const user = randomUUID();
    const seat = randomUUID();
    const first = await holds.hold(season, seat, user);
    await redis.expire(RedisKeys.seasonPassHold(season, seat), 30);
    const again = await holds.hold(season, seat, user);
    expect(first.kind === 'held' && again.kind === 'held').toBe(true);
    if (first.kind !== 'held' || again.kind !== 'held') return;
    expect(again.holdToken).toBe(first.holdToken);
    expect(again.renewed).toBe(true);
    expect(await redis.ttl(RedisKeys.seasonPassHold(season, seat))).toBeGreaterThan(890);
  });

  itRedis(
    "a seat held by someone else is refused, and does not move the requester's own hold",
    async () => {
      const seat = randomUUID();
      const mine = randomUUID();
      const me = randomUUID();
      await holds.hold(season, seat, randomUUID());
      await holds.hold(season, mine, me);
      expect((await holds.hold(season, seat, me)).kind).toBe('held_by_other');
      expect(await redis.exists(RedisKeys.seasonPassHold(season, mine))).toBe(1);
    },
  );

  itRedis('verifyAndExtend is bound to token AND user', async () => {
    const user = randomUUID();
    const seat = randomUUID();
    const r = await holds.hold(season, seat, user);
    if (r.kind !== 'held') throw new Error('expected a hold');
    expect(await holds.verifyAndExtend(season, seat, user, r.holdToken)).toBe(true);
    expect(await holds.verifyAndExtend(season, seat, user, 'wrong')).toBe(false);
    expect(await holds.verifyAndExtend(season, seat, randomUUID(), r.holdToken)).toBe(false);
  });

  itRedis('release is compare-and-delete and idempotent', async () => {
    const user = randomUUID();
    const seat = randomUUID();
    const r = await holds.hold(season, seat, user);
    if (r.kind !== 'held') throw new Error('expected a hold');
    expect(await holds.release(season, seat, user, 'wrong')).toBe(false);
    expect(await redis.exists(RedisKeys.seasonPassHold(season, seat))).toBe(1);
    expect(await holds.release(season, seat, user, r.holdToken)).toBe(true);
    expect(await holds.release(season, seat, user, r.holdToken)).toBe(false);
    expect(await redis.exists(RedisKeys.seasonPassHold(season, seat))).toBe(0);
    expect(await redis.exists(RedisKeys.seasonPassHoldOwner(season, user))).toBe(0);
  });

  itRedis('releaseForOwner drops only the hold on that seat', async () => {
    const user = randomUUID();
    const seat = randomUUID();
    await holds.hold(season, seat, user);
    await holds.releaseForOwner(season, randomUUID(), user); // another seat: no-op
    expect(await redis.exists(RedisKeys.seasonPassHold(season, seat))).toBe(1);
    await holds.releaseForOwner(season, seat, user);
    expect(await redis.exists(RedisKeys.seasonPassHold(season, seat))).toBe(0);
  });

  itRedis('heldSeatIds reports held seats only', async () => {
    const held = randomUUID();
    const free = randomUUID();
    await holds.hold(season, held, randomUUID());
    expect(await holds.heldSeatIds(season, [held, free])).toEqual(new Set([held]));
  });
});
