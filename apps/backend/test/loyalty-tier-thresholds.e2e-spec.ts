import './setup/test-env';

import { randomUUID } from 'crypto';
import { LoyaltyTier, User, UserRole } from '../src/database/entities';
import { LoyaltyTierThresholds1716100000000 } from '../src/database/migrations/1716100000000-LoyaltyTierThresholds';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { truncateAll } from './helpers/db.helper';

/**
 * The thresholds came down to 300 / 1,000 / 2,500. The migration raises the stored tier of a user
 * whose points now reach a higher one (stamping when), and lowers nobody.
 */
describe('Loyalty tier thresholds migration (E2E)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  beforeEach(async () => {
    await truncateAll(ctx.dataSource);
  });

  async function user(points: number, tier: LoyaltyTier): Promise<User> {
    const repo = ctx.dataSource.getRepository(User);
    return repo.save(
      repo.create({
        email: `thr-${randomUUID().slice(0, 8)}@kte.hu`,
        passwordHash: 'x',
        firstName: 'T',
        lastName: 'F',
        role: UserRole.FAN,
        loyaltyTier: tier,
        loyaltyTierReachedAt: null,
        loyaltyPoints: points,
        emailVerified: true,
        twoFactorEnabled: false,
        isActive: true,
      }),
    );
  }

  const reload = (u: User): Promise<User> =>
    ctx.dataSource.getRepository(User).findOneByOrFail({ id: u.id });

  it('raises users whose points now reach a higher tier, and lowers nobody', async () => {
    const lila = await user(250, LoyaltyTier.BRONZE); // still under 300
    const toSilver = await user(350, LoyaltyTier.BRONZE); // was Lila, now Ezüst
    const toGold = await user(1200, LoyaltyTier.SILVER); // was Ezüst, now Arany
    const toLegenda = await user(2600, LoyaltyTier.GOLD); // was Arany, now Legenda
    const jumps = await user(1100, LoyaltyTier.BRONZE); // two tiers up at once
    const kept = await user(100, LoyaltyTier.PLATINUM); // a kept tier above its points
    const already = await user(1500, LoyaltyTier.GOLD); // already right

    const qr = ctx.dataSource.createQueryRunner();
    await qr.connect();
    try {
      await new LoyaltyTierThresholds1716100000000().up(qr);
    } finally {
      await qr.release();
    }

    expect((await reload(lila)).loyaltyTier).toBe(LoyaltyTier.BRONZE);
    expect((await reload(toSilver)).loyaltyTier).toBe(LoyaltyTier.SILVER);
    expect((await reload(toGold)).loyaltyTier).toBe(LoyaltyTier.GOLD);
    expect((await reload(toLegenda)).loyaltyTier).toBe(LoyaltyTier.PLATINUM);
    expect((await reload(jumps)).loyaltyTier).toBe(LoyaltyTier.GOLD);
    expect((await reload(kept)).loyaltyTier).toBe(LoyaltyTier.PLATINUM);
    expect((await reload(already)).loyaltyTier).toBe(LoyaltyTier.GOLD);

    // the raised users are stamped, so the raised tier is kept through the next conversion
    for (const raised of [toSilver, toGold, toLegenda, jumps]) {
      expect((await reload(raised)).loyaltyTierReachedAt).not.toBeNull();
    }
    // untouched users keep their (absent) stamp
    expect((await reload(lila)).loyaltyTierReachedAt).toBeNull();
    expect((await reload(already)).loyaltyTierReachedAt).toBeNull();
  });
});
