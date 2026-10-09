import { LoyaltyTier } from '../../database/entities';

/**
 * Tier definitions used both server-side (calculation) and surfaced
 * via /api/loyalty/tiers for the frontend dashboard.
 */
export interface TierDefinition {
  tier: LoyaltyTier;
  /** Magyar megjelenített név. */
  label: string;
  /** Inclusive lower bound of points required to reach the tier. */
  minPoints: number;
  /** Discount percent applied at checkout (0-100). */
  discountPercent: number;
  /** Brand colour for UI badges (hex). */
  color: string;
}

export const TIER_DEFINITIONS: readonly TierDefinition[] = [
  { tier: LoyaltyTier.BRONZE, label: 'Kék', minPoints: 0, discountPercent: 0, color: '#4B8EC9' },
  {
    tier: LoyaltyTier.SILVER,
    label: 'Ezüst',
    minPoints: 500,
    discountPercent: 5,
    color: '#AAAAAA',
  },
  {
    tier: LoyaltyTier.GOLD,
    label: 'Arany',
    minPoints: 1500,
    discountPercent: 10,
    color: '#FFD700',
  },
  {
    tier: LoyaltyTier.PLATINUM,
    label: 'KTE Legenda',
    minPoints: 3000,
    discountPercent: 15,
    color: '#C94B1E',
  },
] as const;

export function tierForPoints(points: number): TierDefinition {
  // Iterate from highest tier downwards and pick the first definition whose
  // threshold is satisfied. This keeps tier promotion logic in one place.
  for (let i = TIER_DEFINITIONS.length - 1; i >= 0; i -= 1) {
    if (points >= TIER_DEFINITIONS[i].minPoints) {
      return TIER_DEFINITIONS[i];
    }
  }
  return TIER_DEFINITIONS[0];
}

export function definitionFor(tier: LoyaltyTier): TierDefinition {
  const def = TIER_DEFINITIONS.find((t) => t.tier === tier);
  if (!def) {
    throw new Error(`Unknown loyalty tier: ${tier}`);
  }
  return def;
}
