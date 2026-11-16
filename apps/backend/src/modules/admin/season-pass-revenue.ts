import { Repository } from 'typeorm';
import { Sector, SeasonPass, Seat, SeasonPassStatus } from '../../database/entities';
import { TIER_LABEL } from '../../database/stadium-layout';

/**
 * Passes whose money counts as revenue: paid and not void. ACTIVE, and EXPIRED
 * (the season is over; the money was earned). PENDING_PAYMENT was never paid and
 * CANCELLED is not counted as earned.
 */
export const PASS_REVENUE_STATUSES: SeasonPassStatus[] = [
  SeasonPassStatus.ACTIVE,
  SeasonPassStatus.EXPIRED,
];

export type PassTier = 'vip' | 'lower' | 'upper' | 'unknown';

export interface PassTierRevenue {
  tier: PassTier;
  label: string;
  passCount: number;
  revenue: number;
}

const tierLabel = (tier: PassTier): string =>
  tier === 'unknown' ? 'Ismeretlen' : TIER_LABEL[tier];
const TIER_ORDER: PassTier[] = ['vip', 'lower', 'upper', 'unknown'];

export interface PassRevenueFilter {
  /** Passes of this season label. */
  seasonLabel?: string;
  /** Passes bought (created) in [from, to]. */
  createdBetween?: { from: Date; to: Date };
  /** Passes bought (created) at or after this instant. */
  createdSince?: Date;
}

/** Revenue and count of passes per price tier, for the filter. Nothing is allocated to matches. */
export async function passRevenueByTier(
  passes: Repository<SeasonPass>,
  filter: PassRevenueFilter,
): Promise<PassTierRevenue[]> {
  const qb = passes
    .createQueryBuilder('sp')
    .leftJoin(Seat, 's', 's.id = sp.seatId')
    .leftJoin(Sector, 'c', 'c.code = s.section')
    .select("COALESCE(c.priceCategory, 'unknown')", 'tier')
    .addSelect('COUNT(sp.id)', 'passCount')
    .addSelect('COALESCE(SUM(sp.pricePaid), 0)', 'revenue')
    .where('sp.status IN (:...statuses)', { statuses: PASS_REVENUE_STATUSES });
  if (filter.seasonLabel !== undefined) {
    qb.andWhere('sp.seasonLabel = :label', { label: filter.seasonLabel });
  }
  if (filter.createdBetween) {
    qb.andWhere('sp.createdAt BETWEEN :from AND :to', filter.createdBetween);
  }
  if (filter.createdSince) {
    qb.andWhere('sp.createdAt >= :since', { since: filter.createdSince });
  }
  const rows = await qb
    .groupBy('tier')
    .getRawMany<{ tier: PassTier; passCount: string | number; revenue: string | number }>();
  return rows
    .map((r) => ({
      tier: r.tier,
      label: tierLabel(r.tier),
      passCount: Number(r.passCount),
      revenue: Math.round(Number(r.revenue)),
    }))
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
}

export const sumTiers = (
  tiers: readonly PassTierRevenue[],
): { revenue: number; passCount: number } => ({
  revenue: tiers.reduce((a, t) => a + t.revenue, 0),
  passCount: tiers.reduce((a, t) => a + t.passCount, 0),
});
