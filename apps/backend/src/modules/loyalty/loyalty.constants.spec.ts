import { LoyaltyTier } from '../../database/entities';
import { definitionFor, tierForPoints, TIER_DEFINITIONS } from './loyalty.constants';

describe('LoyaltyConstants', () => {
  it('returns BRONZE for any points below the silver threshold', () => {
    expect(tierForPoints(0).tier).toBe(LoyaltyTier.BRONZE);
    expect(tierForPoints(299).tier).toBe(LoyaltyTier.BRONZE);
  });

  it('returns SILVER between 300 and 999 points', () => {
    expect(tierForPoints(300).tier).toBe(LoyaltyTier.SILVER);
    expect(tierForPoints(999).tier).toBe(LoyaltyTier.SILVER);
  });

  it('returns GOLD between 1000 and 2499 points', () => {
    expect(tierForPoints(1000).tier).toBe(LoyaltyTier.GOLD);
    expect(tierForPoints(2499).tier).toBe(LoyaltyTier.GOLD);
  });

  it('returns PLATINUM at 2500+ points', () => {
    expect(tierForPoints(2500).tier).toBe(LoyaltyTier.PLATINUM);
    expect(tierForPoints(50_000).tier).toBe(LoyaltyTier.PLATINUM);
  });

  it('has the thresholds 300 / 1000 / 2500 and the discounts 0 / 5 / 10 / 15', () => {
    expect(TIER_DEFINITIONS.map((t) => t.minPoints)).toEqual([0, 300, 1000, 2500]);
    expect(TIER_DEFINITIONS.map((t) => t.discountPercent)).toEqual([0, 5, 10, 15]);
  });

  it('exposes a definition for every tier value', () => {
    for (const tier of Object.values(LoyaltyTier)) {
      expect(definitionFor(tier).tier).toBe(tier);
    }
    expect(TIER_DEFINITIONS).toHaveLength(4);
  });

  it('discount percent rises monotonically with tier', () => {
    const percents = TIER_DEFINITIONS.map((t) => t.discountPercent);
    for (let i = 1; i < percents.length; i += 1) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    }
  });
});
