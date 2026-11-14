export type OverviewPeriod = 'season' | '90d' | '30d';

export interface OverviewSeason {
  readonly label: string;
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface OverviewMatch {
  readonly matchId: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly kickoffAt: string;
  readonly status: string;
  /** False while the match is still ahead: sales, and so the figures, can still move. */
  readonly final: boolean;
  readonly ticketCount: number;
  readonly passEntryCount: number;
  readonly occupiedSeats: number;
  readonly capacity: number;
  readonly occupancyPercent: number;
  /** HUF actually charged. */
  readonly revenue: number;
}

export interface OverviewMetrics {
  readonly revenue: number;
  readonly ticketsSold: number;
  readonly passEntries: number;
  readonly averageOccupancyPercent: number | null;
  readonly finalMatchCount: number;
  readonly redemptionPercent: number | null;
  readonly scannedTickets: number;
  readonly playedTickets: number;
}

/**
 * 'season': every pass of the active season. 'purchased_in_period': passes bought
 * in the last 30/90 days - a different basis from match revenue, which counts by kickoff.
 */
export type SeasonPassRevenueBasis = 'season' | 'purchased_in_period';

export type SeasonPassRevenueTier = 'vip' | 'lower' | 'upper' | 'unknown';

export interface SeasonPassTierRevenue {
  readonly tier: SeasonPassRevenueTier;
  readonly label: string;
  readonly passCount: number;
  /** HUF actually charged. */
  readonly revenue: number;
}

/**
 * Season-pass revenue. One payment covers a whole season, so it is never attributed
 * to a match and is kept apart from `OverviewMetrics.revenue` (match tickets).
 */
export interface OverviewSeasonPasses {
  readonly basis: SeasonPassRevenueBasis;
  readonly revenue: number;
  readonly passCount: number;
  readonly byTier: readonly SeasonPassTierRevenue[];
}

export interface Overview {
  readonly season: OverviewSeason | null;
  readonly period: OverviewPeriod;
  readonly generatedAt: string;
  /** Match tickets only. */
  readonly metrics: OverviewMetrics;
  readonly seasonPasses: OverviewSeasonPasses;
  readonly matches: readonly OverviewMatch[];
}

export interface SeatSale {
  readonly section: string;
  readonly row: string;
  readonly number: number;
  /** Played matches this seat was taken for. */
  readonly taken: number;
}

export interface SeatSaleSector {
  readonly code: string;
  /** Display name from the sectors table ("D/1 szektor", "VIP"). */
  readonly name: string;
  readonly arc: 'upper' | 'lower';
  readonly position: number;
  /** The away section is never sold through the portal, so it is left off the scale. */
  readonly isAway: boolean;
}

export interface SeatSales {
  readonly season: OverviewSeason | null;
  readonly generatedAt: string;
  /** Matches played in the season: the denominator of every seat. */
  readonly matchCount: number;
  /** Stadium order: upper arc first, west to east. */
  readonly sectors: readonly SeatSaleSector[];
  readonly seats: readonly SeatSale[];
}
