import { SeatCategory } from './entities/seat.entity';

/**
 * The Széktói Stadion as the portal models it: 19 sectors on two arcs.
 *
 * WHAT IS REAL AND WHAT IS NOT
 *   Real (from the club's plan): the sector codes and their order from west to
 *   east on each arc, which sectors are covered, which one is the away section,
 *   and where the four gates are.
 *   NOT surveyed: every seat count, row count and seats-per-row below. The
 *   layout is a plausible reconstruction (about 5,500 seats, larger sectors
 *   beside each arc's halfway line, smaller ones at the corners), to be
 *   replaced with the club's figures. The same goes for the accessible seats
 *   (see ACCESSIBLE_PLACEHOLDER) and the price tiers and prices, which are a proposal.
 *
 * This file is the one definition the seed generates seats from. The
 * migration `1715400000000-StadiumLayout` writes the sector rows out in its own
 * SQL (a migration must not change when this file does); a spec checks the two
 * agree.
 */

export type StadiumArc = 'upper' | 'lower';
/**
 * Three price tiers: the whole upper arc, the whole lower (main-building) arc
 * except VIP, and VIP. The away section has no tier (`null`): it has no price.
 */
export type PriceCategory = 'vip' | 'upper' | 'lower';

export interface SectorLayout {
  /** Matches `seats.section`. May contain a slash ("D/1"). */
  readonly code: string;
  /** Display name: the UI shows this and never composes "<code> szektor" itself. */
  readonly name: string;
  readonly arc: StadiumArc;
  /** 1-based position within the arc, west to east. */
  readonly position: number;
  readonly rows: number;
  readonly seatsPerRow: number;
  /** `null` only for the away section, which is never sold here. */
  readonly priceCategory: PriceCategory | null;
  /** Entrance gate 1..4. */
  readonly gate: 1 | 2 | 3 | 4;
  /** Under a roof. Stated per sector, never derived. */
  readonly isCovered: boolean;
  /** The away section: not sold through the portal, no season passes. */
  readonly isAway: boolean;
  /** Rows whose seats are reserved for wheelchair users. */
  readonly accessibleRows?: readonly string[];
}

/**
 * PLACEHOLDER, to be confirmed with the club: row 1 of the two lower-arc
 * sectors beside gate 1 (E, F), where the plan shows the wheelchair symbol, and
 * row 1 of one upper-arc sector near gate 4 (A/2).
 */
export const ACCESSIBLE_PLACEHOLDER: readonly string[] = ['1'];

/**
 * Price modifier (applied to the match base price) for each price tier. The
 * upper arc is the cheaper of the two arcs although it is the covered one (it
 * has always been priced that way in Kecskemét); the lower arc, on the
 * main-building side, is dearer; VIP is dearest.
 */
export const PRICE_MODIFIER: Readonly<Record<PriceCategory, string>> = {
  vip: '2.50',
  lower: '1.40',
  upper: '1.00',
};

/**
 * Modifier of a seat in the away section. It has no price and is never sold
 * through the portal; the column is NOT NULL, so it carries the neutral value.
 */
export const AWAY_PRICE_MODIFIER = '1.00';

export const priceModifierFor = (tier: PriceCategory | null): string =>
  tier === null ? AWAY_PRICE_MODIFIER : PRICE_MODIFIER[tier];

/**
 * The seat's `category` column keeps its four old enum values. Only VIP is a
 * category of its own now; every other seat is `standard`, and the price comes
 * from the modifier.
 */
export function seatCategoryFor(tier: PriceCategory | null): SeatCategory {
  return tier === 'vip' ? SeatCategory.VIP : SeatCategory.STANDARD;
}

/**
 * Season-pass price (HUF) per tier. A pass is bought for a tier, not for a
 * sector: the pass price rows are keyed by the tier.
 */
export const SEASON_PASS_TIER_PRICE: Readonly<Record<PriceCategory, number>> = {
  vip: 45000,
  lower: 30000,
  upper: 22000,
};

/** What the pass page calls each tier; also the `season_pass_prices.section_label`. */
export const TIER_LABEL: Readonly<Record<PriceCategory, string>> = {
  vip: 'VIP',
  lower: 'Alsó ív',
  upper: 'Felső ív',
};

/** Dearest first: the order the pass page lists the three options in. */
export const TIERS: readonly PriceCategory[] = ['vip', 'lower', 'upper'];

const sector = (
  code: string,
  name: string,
  arc: StadiumArc,
  position: number,
  rows: number,
  seatsPerRow: number,
  priceCategory: PriceCategory | null,
  gate: 1 | 2 | 3 | 4,
  options: { covered: boolean; away?: boolean; accessible?: boolean },
): SectorLayout => ({
  code,
  name,
  arc,
  position,
  rows,
  seatsPerRow,
  priceCategory,
  gate,
  isCovered: options.covered,
  isAway: options.away ?? false,
  accessibleRows: options.accessible ? ACCESSIBLE_PLACEHOLDER : undefined,
});

/** Upper arc, west to east. The whole arc is covered. */
const UPPER: readonly SectorLayout[] = [
  sector('D/1', 'D/1 szektor', 'upper', 1, 12, 18, 'upper', 2, { covered: true }),
  sector('D/2', 'D/2 szektor', 'upper', 2, 14, 22, 'upper', 2, { covered: true }),
  sector('C/1', 'C/1 szektor', 'upper', 3, 16, 24, 'upper', 2, { covered: true }),
  sector('C/2', 'C/2 szektor', 'upper', 4, 16, 28, 'upper', 2, { covered: true }),
  sector('B/1', 'B/1 szektor', 'upper', 5, 16, 28, 'upper', 4, { covered: true }),
  sector('B/2', 'B/2 szektor', 'upper', 6, 16, 24, 'upper', 4, { covered: true }),
  sector('A/1', 'A/1 szektor', 'upper', 7, 14, 22, 'upper', 4, { covered: true }),
  sector('A/2', 'A/2 szektor', 'upper', 8, 12, 18, 'upper', 4, {
    covered: true,
    accessible: true,
  }),
];

/** Lower arc (main-building side), west to east. Only VIP is covered. */
const LOWER: readonly SectorLayout[] = [
  sector('VENDÉG', 'Vendég szektor', 'lower', 1, 10, 28, null, 3, {
    covered: false,
    away: true,
  }),
  sector('N', 'N szektor', 'lower', 2, 8, 24, 'lower', 2, { covered: false }),
  sector('M', 'M szektor', 'lower', 3, 9, 26, 'lower', 2, { covered: false }),
  sector('L', 'L szektor', 'lower', 4, 10, 28, 'lower', 2, { covered: false }),
  sector('K', 'K szektor', 'lower', 5, 10, 28, 'lower', 2, { covered: false }),
  sector('J', 'J szektor', 'lower', 6, 10, 28, 'lower', 2, { covered: false }),
  sector('VIP', 'VIP', 'lower', 7, 8, 28, 'vip', 1, { covered: true }),
  sector('H', 'H szektor', 'lower', 8, 10, 28, 'lower', 1, { covered: false }),
  sector('G', 'G szektor', 'lower', 9, 10, 28, 'lower', 1, { covered: false }),
  sector('F', 'F szektor', 'lower', 10, 9, 26, 'lower', 1, { covered: false, accessible: true }),
  sector('E', 'E szektor', 'lower', 11, 8, 24, 'lower', 1, { covered: false, accessible: true }),
];

/** Upper arc first, then the lower arc: the order every list in the app uses. */
export const STADIUM_LAYOUT: readonly SectorLayout[] = [...UPPER, ...LOWER];

export const sectorSeatCount = (s: SectorLayout): number => s.rows * s.seatsPerRow;

export const totalSeatCount = (): number =>
  STADIUM_LAYOUT.reduce((sum, s) => sum + sectorSeatCount(s), 0);

/** Sectors a season pass can be bought for: everything except the away section. */
export const seasonPassSectors = (): readonly SectorLayout[] =>
  STADIUM_LAYOUT.filter((s) => !s.isAway);
