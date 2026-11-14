import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { SeatLockService } from '../../redis/seat-lock.service';
import { RedisKeys } from '../../redis/redis.constants';
import { BestSeatsService } from './best-seats.service';
import { GridSeat, halfwayWithin, sectorWidth } from './best-seats';
import { SeatAvailability } from './dto';
import { SeatsService } from './seats.service';

/**
 * The race is the main case of the best-seats finder, so it is tested against a
 * REAL Redis with REAL concurrency (Promise.all of independent requests, each
 * with its own stale snapshot), not against a mock that would agree with
 * whatever the code does.
 *
 * Only the database side is stubbed: a stand-in SeatsService serves one sector
 * whose "free" flags are read from the real lock keys, exactly as the real
 * service does with MGET. No MySQL needed.
 *
 *   REDIS_RACE_URL=redis://localhost:6379 (default) ; skipped if unreachable.
 */
const REDIS_URL = process.env.REDIS_RACE_URL ?? 'redis://localhost:6379';

const MATCH = randomUUID();
const ROWS = 4;
const WIDTH = 12; // no aisle (<= 14): rows are 12 free seats side by side

function buildSector(): Array<{ id: string; row: string; number: number }> {
  const seats = [];
  for (let r = 1; r <= ROWS; r++) {
    for (let n = 1; n <= WIDTH; n++) seats.push({ id: randomUUID(), row: String(r), number: n });
  }
  return seats;
}

describe('BestSeatsService: concurrent requests (real Redis)', () => {
  let redis: Redis;
  let available = false;
  let sector: ReturnType<typeof buildSector>;
  let service: BestSeatsService;
  let locks: SeatLockService;
  /** lets a test hold every snapshot until all requests have taken theirs (forces stale views) */
  let snapshotGate: Promise<void> | null = null;

  const seatsStub = (isAway: boolean): Partial<SeatsService> => ({
    assertMatchOpenForSale: async () => undefined,
    loadSectorForFinder: (async (matchId: string, code: string) => {
      const keys = sector.map((s) => RedisKeys.seatLock(matchId, s.id));
      const values = await redis.mget(...keys);
      const seats = sector.map((s, i) => ({
        id: s.id,
        section: code,
        row: s.row,
        number: s.number,
        category: 'standard',
        price: 1000,
        isAccessible: false,
        status: values[i] === null ? SeatAvailability.AVAILABLE : SeatAvailability.LOCKED,
        free: values[i] === null,
      }));
      if (snapshotGate) await snapshotGate; // every request now holds a snapshot taken BEFORE any lock
      const grid: GridSeat[] = seats;
      return {
        sector: { code, isAway } as never,
        seats: seats as never,
        width: sectorWidth(grid),
        ideal: halfwayWithin([WIDTH], 0),
      };
    }) as never,
  });

  beforeAll(async () => {
    redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
    try {
      await redis.connect();
      await redis.ping();
      available = true;
    } catch {
      available = false;
    }
  });

  afterAll(async () => {
    if (available) redis.disconnect();
  });

  beforeEach(async () => {
    if (!available) return;
    sector = buildSector();
    snapshotGate = null;
    const config = { getOrThrow: () => ({ seatLockTtlSeconds: 60 }) } as unknown as ConfigService;
    locks = new SeatLockService(redis, config);
    service = new BestSeatsService(seatsStub(false) as SeatsService, locks);
  });

  afterEach(async () => {
    if (!available) return;
    const keys = await redis.keys(`seat-lock*:${MATCH}:*`);
    if (keys.length) await redis.del(...keys);
  });

  const run = (name: string, fn: () => Promise<void>): void => {
    it(name, async () => {
      if (!available) {
        console.warn(`SKIPPED (no Redis at ${REDIS_URL}): ${name}`);
        return;
      }
      await fn();
    });
  };

  const request = (count: number, extra: { allowSplit?: boolean; userId?: string } = {}) =>
    service.findAndLock({ matchId: MATCH, section: 'X', count, allowSplit: extra.allowSplit ?? false, userId: extra.userId });

  run('two simultaneous requests for the same best run never get the same seat', async () => {
    // Both snapshots are taken before either lock: both rank the same run first.
    let release!: () => void;
    snapshotGate = new Promise((r) => (release = r));
    const a = request(4);
    const b = request(4);
    setTimeout(release, 50);
    const [ra, rb] = await Promise.all([a, b]);
    const idsA = ra.runs.flatMap((r) => r.seats.map((s) => s.id));
    const idsB = rb.runs.flatMap((r) => r.seats.map((s) => s.id));
    expect(idsA).toHaveLength(4);
    expect(idsB).toHaveLength(4);
    expect(idsA.filter((id) => idsB.includes(id))).toEqual([]);
    expect(ra.ownerToken).not.toBe(rb.ownerToken);
  });

  run('50 simultaneous requests: every locked seat belongs to exactly one request', async () => {
    let release!: () => void;
    snapshotGate = new Promise((r) => (release = r));
    const requests = Array.from({ length: 50 }, () => request(2));
    setTimeout(release, 100);
    const results = await Promise.allSettled(requests);

    const won = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof request>>> => r.status === 'fulfilled');
    // 48 seats / 2 per party = 24 parties fit; the other requests may only fail, never double-book
    expect(won.length).toBeLessThanOrEqual(24);
    expect(won.length).toBeGreaterThan(0);

    const seen = new Map<string, number>();
    for (const w of won) {
      const seats = w.value.runs.flatMap((r) => r.seats);
      expect(seats).toHaveLength(2);
      // adjacent: same row, consecutive numbers
      expect(seats[0].row).toBe(seats[1].row);
      expect(seats[1].number - seats[0].number).toBe(1);
      for (const s of seats) seen.set(s.id, (seen.get(s.id) ?? 0) + 1);
    }
    expect([...seen.values()].every((n) => n === 1)).toBe(true);

    // what Redis holds is exactly what the winners were told, and nothing else
    const held = await redis.keys(`seat-lock:${MATCH}:*`);
    expect(held).toHaveLength(seen.size);

    // every loser got a plain 409, not a 500 or a silent success
    for (const r of results) {
      if (r.status === 'rejected') {
        expect((r.reason as { getStatus?: () => number }).getStatus?.()).toBe(409);
      }
    }
  });

  run('requests that drain the sector one party at a time end with an honest refusal', async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => request(4)));
    // 4 rows x 12 seats = 12 parties of 4, exactly
    const won = results.filter((r) => r.status === 'fulfilled');
    expect(won).toHaveLength(12);
    await expect(request(4)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'not_enough_seats', freeSeats: 0 }),
    });
  });

  run('a split is locked atomically too: two simultaneous split requests do not share a seat', async () => {
    // fragment the sector: in every row take every third seat, so runs are 2 long
    for (const s of sector) {
      if (s.number % 3 === 0) await redis.set(RedisKeys.seatLock(MATCH, s.id), 'other', 'EX', 60);
    }
    let release!: () => void;
    snapshotGate = new Promise((r) => (release = r));
    const a = request(4, { allowSplit: true });
    const b = request(4, { allowSplit: true });
    setTimeout(release, 50);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.kind).toBe('split');
    expect(rb.kind).toBe('split');
    const idsA = ra.runs.flatMap((r) => r.seats.map((s) => s.id));
    const idsB = rb.runs.flatMap((r) => r.seats.map((s) => s.id));
    expect(idsA).toHaveLength(4);
    expect(idsB).toHaveLength(4);
    expect(idsA.filter((id) => idsB.includes(id))).toEqual([]);
  });

  run('no run long enough: 409 says so, gives the longest run and the split it would lock', async () => {
    for (const s of sector) {
      if (s.number % 3 === 0) await redis.set(RedisKeys.seatLock(MATCH, s.id), 'other', 'EX', 60);
    }
    const err = await request(4).catch((e) => e);
    expect(err.getStatus()).toBe(409);
    const body = err.getResponse();
    expect(body.code).toBe('no_adjacent_run');
    expect(body.longestRun).toBe(2);
    expect(body.alternative.runs).toHaveLength(2);
    // and nothing was locked by the refusal
    const before = (await redis.keys(`seat-lock:${MATCH}:*`)).length;
    expect(before).toBe(sector.filter((s) => s.number % 3 === 0).length);
  });

  run('records the seats under the user for the cart flow', async () => {
    const userId = randomUUID();
    const r = await request(3, { userId });
    const owner = await redis.hgetall(RedisKeys.seatLockOwner(MATCH, userId));
    expect(Object.keys(owner).sort()).toEqual(r.runs.flatMap((x) => x.seats.map((s) => s.id)).sort());
    expect(Object.values(owner).every((t) => t === r.ownerToken)).toBe(true);
    await redis.del(RedisKeys.seatLockOwner(MATCH, userId));
  });

  run('whole-row parties land in different rows', async () => {
    const parties = [await request(12), await request(12), await request(12)];
    expect(new Set(parties.map((x) => x.runs[0].row)).size).toBe(3);
  });
});

describe('BestSeatsService: the away section', () => {
  it('is refused before any lock is attempted', async () => {
    const acquire = jest.fn();
    const stub = {
      assertMatchOpenForSale: async () => undefined,
      loadSectorForFinder: async () => ({ sector: { isAway: true }, seats: [], width: 0, ideal: 0 }),
    } as unknown as SeatsService;
    const service = new BestSeatsService(stub, { acquireFirstFreeGroup: acquire } as unknown as SeatLockService);
    await expect(
      service.findAndLock({ matchId: MATCH, section: 'VENDÉG', count: 2, allowSplit: true }),
    ).rejects.toMatchObject({ status: 403 });
    expect(acquire).not.toHaveBeenCalled();
  });
});
