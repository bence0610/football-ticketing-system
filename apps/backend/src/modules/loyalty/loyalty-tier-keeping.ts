import { LoyaltyTier } from '../../database/entities';
import { TIER_DEFINITIONS, tierForPoints } from './loyalty.constants';

/**
 * Keeping a tier across the season-end carryover.
 *
 * A tier reached during a season is KEPT until the end of the next season, even if the carryover
 * at 30 June drops the points below its threshold. So the tier is stored (`users.loyalty_tier`)
 * together with when it was reached (`users.loyalty_tier_reached_at`) instead of being derived
 * from the points alone. Everything here is pure: the award, the season-end job and the tests
 * all decide through these functions, so they cannot disagree.
 *
 * - An award never lowers the tier; it can only raise it (to the tier the points reach), and
 *   that stamps `reachedAt`.
 * - Only the season-end conversion can lower a tier, and only when the tier was neither earned
 *   during the season that is ending nor reached in it (see {@link tierAtSeasonEnd}).
 *
 * Seasons run 1 July to 30 June, as the season-end job does.
 */
export const tierRank = (tier: LoyaltyTier): number =>
  TIER_DEFINITIONS.findIndex((t) => t.tier === tier);

/** The calendar year in which the season that contains `at` ends (the 30 June after it). */
export function seasonEndYear(at: Date): number {
  return at.getUTCMonth() >= 6 ? at.getUTCFullYear() + 1 : at.getUTCFullYear();
}

/**
 * The last day a tier reached at `reachedAt` is kept without the points: the end (30 June) of the
 * season AFTER the one it was reached in. At that day's conversion it is re-derived.
 */
export function tierKeptUntil(reachedAt: Date): Date {
  return new Date(Date.UTC(seasonEndYear(reachedAt) + 1, 5, 30));
}

export interface StoredTier {
  tier: LoyaltyTier;
  /** When the stored tier was reached; null for a tier held by points alone (or never stamped). */
  reachedAt: Date | null;
}

export interface TierAfterAward extends StoredTier {
  upgraded: boolean;
}

/** The tier after points were added or taken away: raised if the points reach a higher one, never lowered. */
export function tierAfterAward(stored: StoredTier, points: number, now: Date): TierAfterAward {
  const derived = tierForPoints(points).tier;
  if (tierRank(derived) > tierRank(stored.tier)) {
    return { tier: derived, reachedAt: now, upgraded: true };
  }
  return { ...stored, upgraded: false };
}

export interface SeasonEndInput extends StoredTier {
  /** Balance just before the conversion. */
  pointsBefore: number;
  /** Balance just after it. */
  pointsAfter: number;
  /** The year in which the season that is ending ends (the year of the 30 June being run). */
  year: number;
  /** The moment of the conversion. */
  at: Date;
}

/**
 * The tier after the 30 June conversion.
 *
 * - The points after the conversion still reach the stored tier: nothing changes.
 * - They do not, but the tier is protected: either the balance before the conversion still
 *   supported it (it was earned, or earned again, during the season that is ending) or it was
 *   reached during that season. It is kept, and stamped with this season so it lasts through the
 *   whole next one.
 * - Otherwise its protection is used up (it was kept through last season's conversion): the tier
 *   falls to what the points give, which holds no protection of its own (`reachedAt` null).
 */
export function tierAtSeasonEnd(input: SeasonEndInput): StoredTier {
  const stored = tierRank(input.tier);
  const afterRank = tierRank(tierForPoints(input.pointsAfter).tier);
  if (afterRank >= stored) {
    return { tier: input.tier, reachedAt: input.reachedAt };
  }
  const earnedThisSeason = tierRank(tierForPoints(input.pointsBefore).tier) >= stored;
  const reachedThisSeason =
    input.reachedAt !== null && seasonEndYear(input.reachedAt) === input.year;
  if (earnedThisSeason || reachedThisSeason) {
    return { tier: input.tier, reachedAt: earnedThisSeason ? input.at : input.reachedAt };
  }
  return { tier: tierForPoints(input.pointsAfter).tier, reachedAt: null };
}

/** The points a tier needs. */
export const minPointsOf = (tier: LoyaltyTier): number =>
  TIER_DEFINITIONS[tierRank(tier)].minPoints;
