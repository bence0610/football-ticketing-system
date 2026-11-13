import {
  PRICE_CATEGORY_LABEL,
  PriceCategory,
  SectorSummary,
} from '../../../shared/models/seat.model';

export interface TierPrice {
  readonly tier: PriceCategory;
  /** The tier's name as the rest of the app says it ("Felső ív", "Alsó ív", "VIP"). */
  readonly label: string;
  readonly minPrice: number;
  readonly maxPrice: number;
}

const TIER_ORDER: readonly PriceCategory[] = ['vip', 'lower', 'upper'];

/**
 * One row per price tier for a match, instead of one per sector: the sectors of a
 * tier share a price. The away section (no tier) is never in it. Dearest tier first;
 * a tier with no sector in the data is left out, never guessed.
 */
export function tierPrices(sectors: readonly SectorSummary[]): readonly TierPrice[] {
  return TIER_ORDER.flatMap((tier) => {
    const members = sectors.filter(
      (s) => !s.isAway && s.priceCategory === tier && Number.isFinite(s.minPrice),
    );
    if (members.length === 0) {
      return [];
    }
    return [
      {
        tier,
        label: PRICE_CATEGORY_LABEL[tier],
        minPrice: Math.min(...members.map((s) => s.minPrice)),
        maxPrice: Math.max(...members.map((s) => s.maxPrice)),
      },
    ];
  });
}
