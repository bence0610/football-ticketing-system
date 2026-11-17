import { LoyaltyTier } from '../../database/entities';
import { LoyaltyService } from './loyalty.service';

/**
 * The cart tells a signed-in user how many points a purchase earns, and the
 * loyalty page states the earning rules. Both are server config, so the
 * snapshot endpoint has to carry them - plus the figures the page computes
 * from real data (matches entered, ledger size).
 */
describe('LoyaltyService.getSnapshot', () => {
  interface Options {
    attendancePoints?: number;
    attended?: number;
    ledgerSize?: number;
    points?: number;
    tier?: LoyaltyTier;
    reachedAt?: Date | null;
  }

  function build(options: Options = {}) {
    const { attendancePoints = 50, attended = 0, ledgerSize = 0 } = options;
    const user = {
      id: 'u1',
      loyaltyPoints: options.points ?? 1000,
      loyaltyTier: options.tier ?? LoyaltyTier.SILVER,
      loyaltyTierReachedAt: options.reachedAt ?? null,
    };
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ count: String(attended) }),
    };
    const dataSource = {
      getRepository: () => ({
        findOne: jest.fn().mockResolvedValue(user),
        createQueryBuilder: () => queryBuilder,
      }),
    };
    const repo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(ledgerSize),
    };
    const config = {
      getOrThrow: (key: string) =>
        key === 'loyalty'
          ? {
              registrationPoints: 100,
              profileCompletionPoints: 50,
              attendancePoints,
              seasonPassPoints: 500,
              passLoanPoints: 25,
              carryoverPercent: 50,
            }
          : { baseUrl: 'http://localhost' },
    };
    const service = new LoyaltyService(
      repo as never,
      dataSource as never,
      config as never,
      {} as never,
    );
    return { service, repo, queryBuilder };
  }

  it('exposes the configured attendance points', async () => {
    const { service } = build({ attendancePoints: 50, points: 700 });
    const snapshot = await service.getSnapshot('u1');
    expect(snapshot.earning.attendancePoints).toBe(50);
    expect(snapshot.tier.tier).toBe(LoyaltyTier.SILVER);
    expect(snapshot.pointsToNextTier).toBe(300);
  });

  it('follows the configuration rather than a constant', async () => {
    const { service } = build({ attendancePoints: 120 });
    const snapshot = await service.getSnapshot('u1');
    expect(snapshot.earning.attendancePoints).toBe(120);
  });

  it('carries every earning rule from the configuration', async () => {
    const { service } = build();
    expect((await service.getSnapshot('u1')).earning).toEqual({
      registrationPoints: 100,
      profileCompletionPoints: 50,
      attendancePoints: 50,
      seasonPassPoints: 500,
      passLoanPoints: 25,
      carryoverPercent: 50,
    });
  });

  it('a tier kept past the points: next tier is the one above it, and the keep date and shortfall are given', async () => {
    // Legenda reached in the 2026/27 season, balance down to 1,751 after the 30 June conversion.
    const { service } = build({
      points: 1751,
      tier: LoyaltyTier.PLATINUM,
      reachedAt: new Date('2026-11-20T12:00:00Z'),
    });
    const snapshot = await service.getSnapshot('u1');
    expect(snapshot.tier.tier).toBe(LoyaltyTier.PLATINUM);
    expect(snapshot.nextTier).toBeUndefined(); // top tier: nothing above it
    expect(snapshot.tierKeptUntil).toBe('2028-06-30'); // end of the season AFTER the one it was reached in
    expect(snapshot.pointsToKeepTier).toBe(2500 - 1751);
  });

  it('a kept tier below the top still points at the tier above it, not at a threshold above the points', async () => {
    const { service } = build({
      points: 700,
      tier: LoyaltyTier.GOLD,
      reachedAt: new Date('2026-11-20T12:00:00Z'),
    });
    const snapshot = await service.getSnapshot('u1');
    expect(snapshot.nextTier?.tier).toBe(LoyaltyTier.PLATINUM);
    expect(snapshot.pointsToNextTier).toBe(2500 - 700);
    expect(snapshot.tierKeptUntil).toBe('2028-06-30');
  });

  it('says nothing about keeping when the points hold the tier', async () => {
    const { service } = build({ points: 1000, tier: LoyaltyTier.SILVER, reachedAt: new Date() });
    const snapshot = await service.getSnapshot('u1');
    expect(snapshot.tierKeptUntil).toBeUndefined();
    expect(snapshot.pointsToKeepTier).toBeUndefined();
  });

  it('counts only distinct matches with a scanned ticket', async () => {
    const { service, queryBuilder } = build({ attended: 3 });
    expect((await service.getSnapshot('u1')).matchesAttended).toBe(3);
    expect(queryBuilder.select).toHaveBeenCalledWith('COUNT(DISTINCT t.match_id)', 'count');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('t.scanned_at IS NOT NULL');
  });

  it('reports the whole ledger size next to the newest page', async () => {
    const { service, repo } = build({ ledgerSize: 40 });
    const snapshot = await service.getSnapshot('u1');
    expect(snapshot.totalTransactions).toBe(40);
    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 25 }));
  });

  it('pages the ledger newest first', async () => {
    const { service, repo } = build();
    await service.getTransactions('u1', 25, 100);
    expect(repo.find).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: 25,
      take: 100,
    });
  });
});
