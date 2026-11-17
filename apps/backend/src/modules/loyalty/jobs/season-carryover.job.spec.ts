import { LoyaltyTier } from '../../../database/entities';
import { SeasonCarryoverJob } from './season-carryover.job';

describe('SeasonCarryoverJob', () => {
  interface Fake {
    tier: LoyaltyTier;
    points: number;
    reachedAt: Date | null;
  }

  function setup(user: Fake, carryoverPercent = 70) {
    const row = {
      id: 'u1',
      isActive: true,
      loyaltyPoints: user.points,
      loyaltyTier: user.tier,
      loyaltyTierReachedAt: user.reachedAt,
    };
    const updates: Array<Record<string, unknown>> = [];
    const userRepo = {
      find: jest.fn(async () => [row]),
      findOneOrFail: jest.fn(async () => ({ ...row })),
      update: jest.fn(async (_where: unknown, set: Record<string, unknown>) => {
        updates.push(set);
        Object.assign(row, set);
      }),
    };
    const manager = { getRepository: () => userRepo };
    const dataSource = {
      getRepository: () => userRepo,
      transaction: async (cb: (m: unknown) => unknown) => cb(manager),
    };
    const awards: Array<{ points: number; description?: string }> = [];
    const loyalty = {
      award: jest.fn(async (o: { points: number; description?: string }) => {
        awards.push(o);
        row.loyaltyPoints += o.points;
        return { duplicate: false, newBalance: row.loyaltyPoints };
      }),
    };
    const config = { getOrThrow: () => ({ carryoverPercent }) };
    const job = new SeasonCarryoverJob(dataSource as never, config as never, loyalty as never);
    return { job, row, awards, updates };
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2027-06-30T01:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('keeps 70%: 3,092 points become 2,165 and 927 expire', async () => {
    const { job, row, awards } = setup({
      tier: LoyaltyTier.PLATINUM,
      points: 3092,
      reachedAt: new Date('2026-11-20T12:00:00Z'),
    });
    await job.run();
    expect(awards).toHaveLength(1);
    expect(awards[0].points).toBe(-927);
    expect(awards[0].description).toContain('70%');
    expect(row.loyaltyPoints).toBe(2165);
  });

  it('a Legenda fan whose points fall to 2,165 stays Legenda', async () => {
    const { job, row } = setup({
      tier: LoyaltyTier.PLATINUM,
      points: 3092,
      reachedAt: new Date('2026-11-20T12:00:00Z'),
    });
    await job.run();
    expect(row.loyaltyPoints).toBe(2165);
    expect(row.loyaltyTier).toBe(LoyaltyTier.PLATINUM);
  });

  it('the next year, with the tier neither earned again nor reached that season, it falls to what the points give', async () => {
    const { job, row } = setup({
      tier: LoyaltyTier.PLATINUM,
      points: 2565, // 2,165 plus a quiet season
      reachedAt: new Date('2027-06-30T01:00:00Z'), // stamped at the previous conversion
    });
    jest.setSystemTime(new Date('2028-06-30T01:00:00Z'));
    await job.run();
    expect(row.loyaltyPoints).toBe(1796);
    expect(row.loyaltyTier).toBe(LoyaltyTier.GOLD);
    expect(row.loyaltyTierReachedAt).toBeNull();
  });

  it('never lowers the tier for a user the points still support', async () => {
    const { job, row } = setup({ tier: LoyaltyTier.SILVER, points: 1000, reachedAt: null });
    await job.run();
    expect(row.loyaltyPoints).toBe(700);
    expect(row.loyaltyTier).toBe(LoyaltyTier.SILVER);
  });

  it('a second run on the same day is a no-op: the tier is not decided again from the reduced balance', async () => {
    const { job, row, awards } = setup({
      tier: LoyaltyTier.PLATINUM,
      points: 3092,
      reachedAt: new Date('2026-11-20T12:00:00Z'),
    });
    await job.run();
    // the ledger refuses the same reference the second time
    (
      job as unknown as { loyaltyService: { award: jest.Mock } }
    ).loyaltyService.award.mockResolvedValue({
      duplicate: true,
      newBalance: row.loyaltyPoints,
    });
    await job.run();
    expect(awards).toHaveLength(1);
    expect(row.loyaltyTier).toBe(LoyaltyTier.PLATINUM);
    expect(row.loyaltyPoints).toBe(2165);
  });
});
