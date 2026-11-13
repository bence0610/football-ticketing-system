import './setup/test-env';

import { randomUUID } from 'crypto';
import request from 'supertest';
import { Server } from 'http';
import { Competition, Match, MatchStatus, Seat, SeatCategory } from '../src/database/entities';
import { RedisKeys } from '../src/redis/redis.constants';
import { SeatsService } from '../src/modules/seats/seats.service';
import { STADIUM_LAYOUT, totalSeatCount } from '../src/database/stadium-layout';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { truncateAll } from './helpers/db.helper';

/**
 * Measures the seat-map endpoint (GET /api/matches/:id/seats) and the Redis step
 * inside it, for the old 524-seat stadium and the new 5,468-seat one.
 *
 * It is a measurement, not a regression test: it asserts only that the endpoint
 * answers, and prints one `PERF` line per measurement. It is skipped unless
 * SEAT_MAP_PERF=1, so the normal suite stays fast:
 *
 *   SEAT_MAP_PERF=1 npx jest --config ./test/jest-e2e.json --runInBand test/seat-map-perf
 *
 * The Redis comparison runs a pipeline of N GETs and one MGET of N keys over
 * the SAME keys in the same process, so the two strategies see identical data.
 */
const RUN = process.env.SEAT_MAP_PERF === '1';
const SAMPLES = 30;
const WARMUP = 3;

interface Block {
  section: string;
  rows: number;
  perRow: number;
  modifier: string;
}

/** The four-sector stadium this work replaces (524 seats), as it was seeded. */
const OLD_LAYOUT: Block[] = [
  { section: 'A', rows: 5, perRow: 20, modifier: '1.50' },
  { section: 'B', rows: 8, perRow: 25, modifier: '1.00' },
  { section: 'C', rows: 8, perRow: 25, modifier: '1.00' },
  { section: 'VIP', rows: 2, perRow: 12, modifier: '2.50' },
];

const NEW_LAYOUT: Block[] = STADIUM_LAYOUT.map((s) => ({
  section: s.code,
  rows: s.rows,
  perRow: s.seatsPerRow,
  modifier: '1.00',
}));

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p95 = (xs: number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)];
const fmt = (n: number): string => n.toFixed(1);

(RUN ? describe : describe.skip)('Seat-map size and latency (measurement)', () => {
  let ctx: TestContext;
  let server: Server;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.httpServer;
  });

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  /**
   * The seat map as it was before this work, re-created in place so old and new can
   * be measured in the same process, on the same data, alternating request by
   * request (any drift in machine load then hits both equally):
   *   - the lock lookup is the original pipeline of one GET per seat, with the
   *     original cross-check of every locked value against every seat id;
   *   - the seat query selects every column (the original entity hydration).
   * What it does not reproduce is the old SQL ORDER BY, which the service no longer uses.
   */
  function useBaseline(on: boolean): void {
    const svc = ctx.app.get(SeatsService) as unknown as {
      fetchLockedSeatIds: (matchId: string, seatIds: string[]) => Promise<Set<string>>;
      seatRepository: { find: (opts?: Record<string, unknown>) => Promise<Seat[]> };
    };
    const repo = svc.seatRepository as unknown as {
      find: (opts?: Record<string, unknown>) => Promise<Seat[]>;
      __find?: (opts?: Record<string, unknown>) => Promise<Seat[]>;
    };
    const proto = SeatsService.prototype as unknown as {
      fetchLockedSeatIds: (matchId: string, seatIds: string[]) => Promise<Set<string>>;
    };
    if (!repo.__find) repo.__find = repo.find.bind(repo);

    if (!on) {
      delete (svc as Partial<typeof svc>).fetchLockedSeatIds;
      repo.find = repo.__find;
      return;
    }
    svc.fetchLockedSeatIds = async (matchId: string, seatIds: string[]): Promise<Set<string>> => {
      const keys = seatIds.map((id) => RedisKeys.seatLock(matchId, id));
      const pipeline = ctx.redis.pipeline();
      keys.forEach((key) => pipeline.get(key));
      const results = (await pipeline.exec()) ?? [];
      const locked = new Set<string>();
      results.forEach(([err, value], index) => {
        if (err || value === null || value === undefined) return;
        const valueStr = String(value);
        let resolved: string | undefined;
        for (const candidate of seatIds) {
          if (valueStr.includes(candidate)) {
            resolved = candidate;
            break;
          }
        }
        if (!resolved && index < seatIds.length) resolved = seatIds[index];
        if (resolved) locked.add(resolved);
      });
      return locked;
    };
    void proto;
    repo.find = (opts) => {
      const { select: _select, ...rest } = opts ?? {};
      void _select;
      return repo.__find!(rest);
    };
  }

  async function seed(layout: Block[]): Promise<{ match: Match; seats: Seat[] }> {
    await truncateAll(ctx.dataSource);
    await ctx.redis.flushdb();
    const seatRepo = ctx.dataSource.getRepository(Seat);
    const entities: Seat[] = [];
    for (const block of layout) {
      for (let r = 1; r <= block.rows; r += 1) {
        for (let n = 1; n <= block.perRow; n += 1) {
          entities.push(
            seatRepo.create({
              id: randomUUID(),
              section: block.section,
              row: String(r),
              number: n,
              category: SeatCategory.STANDARD,
              priceModifier: block.modifier,
              isAccessible: false,
              isActive: true,
            }),
          );
        }
      }
    }
    const seats = await seatRepo.save(entities, { chunk: 500 });
    const matchRepo = ctx.dataSource.getRepository(Match);
    const match = await matchRepo.save(
      matchRepo.create({
        homeTeam: 'Kecskeméti TE',
        awayTeam: 'Perf FC',
        competition: Competition.NB1,
        venue: 'Széktói Stadion',
        kickoffAt: new Date(Date.now() + 7 * 86_400_000),
        status: MatchStatus.ON_SALE,
        capacity: seats.length,
        basePrice: '3500.00',
        isSeasonPassEligible: false,
      }),
    );
    return { match, seats };
  }

  async function measure(label: string, layout: Block[], locked: number): Promise<void> {
    const { match, seats } = await seed(layout);
    for (const seat of seats.slice(0, locked)) {
      await ctx.redis.set(RedisKeys.seatLock(match.id, seat.id), 'tok', 'EX', 600);
    }

    const get = async (): Promise<{ ms: number; bytes: number }> => {
      const started = process.hrtime.bigint();
      const res = await request(server).get(`/api/matches/${match.id}/seats`);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      expect(res.status).toBe(200);
      return { ms, bytes: Buffer.byteLength(res.text) };
    };
    for (let i = 0; i < WARMUP; i += 1) {
      useBaseline(true);
      await get();
      useBaseline(false);
      await get();
    }
    const endpoint: number[] = [];
    const before: number[] = [];
    let bytes = 0;
    for (let i = 0; i < SAMPLES; i += 1) {
      useBaseline(true);
      before.push((await get()).ms);
      useBaseline(false);
      const r = await get();
      endpoint.push(r.ms);
      bytes = r.bytes;
    }

    // The Redis step alone, both ways, over the same keys.
    const keys = seats.map((s) => RedisKeys.seatLock(match.id, s.id));
    const piped: number[] = [];
    const mgot: number[] = [];
    for (let i = 0; i < SAMPLES + WARMUP; i += 1) {
      let t = process.hrtime.bigint();
      const pipeline = ctx.redis.pipeline();
      keys.forEach((k) => pipeline.get(k));
      await pipeline.exec();
      const a = Number(process.hrtime.bigint() - t) / 1e6;
      t = process.hrtime.bigint();
      await ctx.redis.mget(...keys);
      const b = Number(process.hrtime.bigint() - t) / 1e6;
      if (i >= WARMUP) {
        piped.push(a);
        mgot.push(b);
      }
    }

    // Where the time goes: the seat query alone, the whole service call (no HTTP),
    // and serialising the answer. Whatever is left of the endpoint time is HTTP and Nest.
    useBaseline(false);
    const seatsService = ctx.app.get(SeatsService);
    const dbOnly: number[] = [];
    const service: number[] = [];
    const serialise: number[] = [];
    let last: unknown;
    for (let i = 0; i < SAMPLES + WARMUP; i += 1) {
      let t = process.hrtime.bigint();
      await ctx.dataSource.getRepository(Seat).find();
      const a = Number(process.hrtime.bigint() - t) / 1e6;
      t = process.hrtime.bigint();
      last = await seatsService.findSeatsForMatch(match.id);
      const b = Number(process.hrtime.bigint() - t) / 1e6;
      t = process.hrtime.bigint();
      JSON.stringify(last);
      const c = Number(process.hrtime.bigint() - t) / 1e6;
      if (i >= WARMUP) {
        dbOnly.push(a);
        service.push(b);
        serialise.push(c);
      }
    }

    console.log(
      `PERF ${JSON.stringify({
        label,
        seats: seats.length,
        locked,
        payloadKB: Math.round(bytes / 1024),
        beforeMedianMs: fmt(median(before)),
        beforeP95Ms: fmt(p95(before)),
        afterMedianMs: fmt(median(endpoint)),
        afterP95Ms: fmt(p95(endpoint)),
        redisPipelineMedianMs: fmt(median(piped)),
        redisMgetMedianMs: fmt(median(mgot)),
        seatQueryMedianMs: fmt(median(dbOnly)),
        serviceCallMedianMs: fmt(median(service)),
        serialiseMedianMs: fmt(median(serialise)),
      })}`,
    );
  }

  it('is measured at the old size and the new size', async () => {
    expect(totalSeatCount()).toBe(5468);
    await measure('old layout (524 seats), 40 locks', OLD_LAYOUT, 40);
    await measure('new layout (5468 seats), no locks', NEW_LAYOUT, 0);
    await measure('new layout (5468 seats), 400 locks', NEW_LAYOUT, 400);
  }, 600_000);
});
