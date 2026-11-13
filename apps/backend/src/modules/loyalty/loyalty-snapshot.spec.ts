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
    ticketPointsPerTicket?: number;
    attended?: number;
    ledgerSize?: number;
  }

  function build(options: Options = {}) {
    const { ticketPointsPerTicket = 50, attended = 0, ledgerSize = 0 } = options;
    const user = { id: 'u1', loyaltyPoints: 1000, loyaltyTier: LoyaltyTier.SILVER };
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
              ticketPointsPerTicket,
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

  it('exposes the configured points per ticket', async () => {
    const { service } = build({ ticketPointsPerTicket: 50 });
    const snapshot = await service.getSnapshot('u1');
    expect(snapshot.ticketPointsPerTicket).toBe(50);
    expect(snapshot.tier.tier).toBe(LoyaltyTier.SILVER);
    expect(snapshot.pointsToNextTier).toBe(500);
  });

  it('follows the configuration rather than a constant', async () => {
    const { service } = build({ ticketPointsPerTicket: 120 });
    const snapshot = await service.getSnapshot('u1');
    expect(snapshot.ticketPointsPerTicket).toBe(120);
    expect(snapshot.earning.ticketPointsPerTicket).toBe(120);
  });

  it('carries every earning rule from the configuration', async () => {
    const { service } = build();
    expect((await service.getSnapshot('u1')).earning).toEqual({
      registrationPoints: 100,
      profileCompletionPoints: 50,
      ticketPointsPerTicket: 50,
      seasonPassPoints: 500,
      passLoanPoints: 25,
      carryoverPercent: 50,
    });
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
