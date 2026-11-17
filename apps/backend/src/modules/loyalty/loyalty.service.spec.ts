import { tierForPoints } from './loyalty.constants';
import { LoyaltyTier } from '../../database/entities';

describe('Loyalty tier promotion logic', () => {
  it('promotes a fan from BRONZE to SILVER at exactly 300 points', () => {
    expect(tierForPoints(299).tier).toBe(LoyaltyTier.BRONZE);
    expect(tierForPoints(300).tier).toBe(LoyaltyTier.SILVER);
  });

  it('promotes from SILVER to GOLD at 1000 points', () => {
    expect(tierForPoints(999).tier).toBe(LoyaltyTier.SILVER);
    expect(tierForPoints(1000).tier).toBe(LoyaltyTier.GOLD);
  });

  it('promotes from GOLD to PLATINUM at 2500 points', () => {
    expect(tierForPoints(2499).tier).toBe(LoyaltyTier.GOLD);
    expect(tierForPoints(2500).tier).toBe(LoyaltyTier.PLATINUM);
  });
});
