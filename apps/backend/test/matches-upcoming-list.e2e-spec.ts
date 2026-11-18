import './setup/test-env';

import request from 'supertest';
import { Server } from 'http';
import { Competition, Match, MatchStatus } from '../src/database/entities';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { truncateAll } from './helpers/db.helper';

/**
 * GET /matches is capped (50 by default, 100 at most) and counted from the OLDEST match. Once the
 * club has played more than a page of matches, an unbounded request returns only the past and
 * every upcoming match falls off the end: the home page then claims there is no match at all.
 *
 * The public pages therefore ask `?from=<now>&limit=100` (upcomingMatchesParams in the frontend's
 * matches.api.service.ts). This seeds more than a page of past matches plus one upcoming match and
 * checks that exact request still returns the upcoming one; the unbounded request is asserted
 * too, so the test shows what the `from` is for.
 */
const HOME = 'Kecskeméti TE';
const DAY = 86_400_000;

describe('Upcoming matches reach the public list (E2E)', () => {
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

  async function seed(pastCount: number): Promise<Match> {
    const repo = ctx.dataSource.getRepository(Match);
    const make = (offsetDays: number, status: MatchStatus): Match =>
      repo.create({
        homeTeam: HOME,
        awayTeam: 'Ferencváros',
        competition: Competition.NB1,
        venue: 'Széktói Stadion',
        kickoffAt: new Date(Date.now() + offsetDays * DAY),
        status,
        capacity: 100,
        basePrice: '5000.00',
        isSeasonPassEligible: true,
      });
    const past = Array.from({ length: pastCount }, (_, i) =>
      make(-(i + 1) * 3, MatchStatus.FINISHED),
    );
    await repo.save(past);
    return repo.save(make(5, MatchStatus.ON_SALE));
  }

  it('returns the upcoming match when asked from now, however many past matches exist', async () => {
    const upcoming = await seed(60);

    const res = await request(server)
      .get('/api/matches')
      .query({ from: new Date().toISOString(), limit: 100 })
      .expect(200);

    expect(res.body.map((m: { id: string }) => m.id)).toEqual([upcoming.id]);
  });

  it('would lose it without `from`: the first 50 are all past (why the pages must pass it)', async () => {
    const upcoming = await seed(60);

    const res = await request(server).get('/api/matches').expect(200);

    expect(res.body).toHaveLength(50);
    expect(res.body.map((m: { id: string }) => m.id)).not.toContain(upcoming.id);
  });
});
