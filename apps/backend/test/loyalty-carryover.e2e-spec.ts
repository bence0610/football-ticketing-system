import './setup/test-env';

import { randomUUID } from 'crypto';
import {
  LoyaltyTier,
  LoyaltyTransaction,
  LoyaltyTransactionSource,
  User,
  UserRole,
} from '../src/database/entities';
import { SeasonCarryoverJob } from '../src/modules/loyalty/jobs/season-carryover.job';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { truncateAll } from './helpers/db.helper';

/**
 * The season-end conversion against the real database: 70% of the balance is kept, and a tier
 * reached during the season survives it even when the points drop under its threshold.
 */
describe('Season-end carryover and the kept tier (E2E)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  beforeEach(async () => {
    await truncateAll(ctx.dataSource);
    await ctx.redis.flushdb();
  });

  async function fan(points: number, tier: LoyaltyTier, reachedAt: Date | null): Promise<User> {
    const repo = ctx.dataSource.getRepository(User);
    return repo.save(
      repo.create({
        email: `carry-${randomUUID().slice(0, 8)}@kte.hu`,
        passwordHash: 'x',
        firstName: 'Teszt',
        lastName: 'Fan',
        role: UserRole.FAN,
        loyaltyTier: tier,
        loyaltyTierReachedAt: reachedAt,
        loyaltyPoints: points,
        emailVerified: true,
        twoFactorEnabled: false,
        isActive: true,
      }),
    );
  }

  const reload = (u: User): Promise<User> =>
    ctx.dataSource.getRepository(User).findOneByOrFail({ id: u.id });

  it('keeps 70% of the points and a Legenda fan at 2,165 stays Legenda', async () => {
    const legenda = await fan(3092, LoyaltyTier.PLATINUM, new Date());
    await ctx.app.get(SeasonCarryoverJob).run();

    const after = await reload(legenda);
    expect(after.loyaltyPoints).toBe(2165);
    expect(after.loyaltyTier).toBe(LoyaltyTier.PLATINUM);
    const rows = await ctx.dataSource
      .getRepository(LoyaltyTransaction)
      .find({ where: { userId: legenda.id, source: LoyaltyTransactionSource.SEASON_CARRYOVER } });
    expect(rows).toHaveLength(1);
    expect(rows[0].points).toBe(-927);
    expect(rows[0].balanceAfter).toBe(2165);
  });

  it('running the job twice on one day converts once and decides the tier once', async () => {
    const legenda = await fan(3092, LoyaltyTier.PLATINUM, new Date());
    const job = ctx.app.get(SeasonCarryoverJob);
    await job.run();
    await job.run();
    const after = await reload(legenda);
    expect(after.loyaltyPoints).toBe(2165);
    expect(after.loyaltyTier).toBe(LoyaltyTier.PLATINUM);
  });

  it('a tier whose protection is used up falls to what the points give', async () => {
    // Stamped at the previous conversion, and not earned in the season that is now ending.
    const spent = await fan(
      2300,
      LoyaltyTier.PLATINUM,
      new Date(Date.UTC(new Date().getUTCFullYear() - 1, 5, 30)),
    );
    await ctx.app.get(SeasonCarryoverJob).run();
    const after = await reload(spent);
    expect(after.loyaltyPoints).toBe(1610);
    expect(after.loyaltyTier).toBe(LoyaltyTier.GOLD);
    expect(after.loyaltyTierReachedAt).toBeNull();
  });
});
