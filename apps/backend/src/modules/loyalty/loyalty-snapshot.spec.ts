import { LoyaltyTier } from '../../database/entities';
import { LoyaltyService } from './loyalty.service';

/**
 * The cart tells a signed-in user how many points a purchase earns. That
 * number is server config, so the snapshot endpoint has to carry it.
 */
describe('LoyaltyService.getSnapshot', () => {
  function build(ticketPointsPerTicket: number): LoyaltyService {
    const user = { id: 'u1', loyaltyPoints: 1000, loyaltyTier: LoyaltyTier.SILVER };
    const dataSource = { getRepository: () => ({ findOne: jest.fn().mockResolvedValue(user) }) };
    const repo = { find: jest.fn().mockResolvedValue([]) };
    const config = {
      getOrThrow: (key: string) =>
        key === 'loyalty' ? { ticketPointsPerTicket } : { baseUrl: 'http://localhost' },
    };
    return new LoyaltyService(repo as never, dataSource as never, config as never, {} as never);
  }

  it('exposes the configured points per ticket', async () => {
    const snapshot = await build(50).getSnapshot('u1');
    expect(snapshot.ticketPointsPerTicket).toBe(50);
    expect(snapshot.tier.tier).toBe(LoyaltyTier.SILVER);
    expect(snapshot.pointsToNextTier).toBe(500);
  });

  it('follows the configuration rather than a constant', async () => {
    expect((await build(120).getSnapshot('u1')).ticketPointsPerTicket).toBe(120);
  });
});
