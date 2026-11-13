export type SeatCategory = 'standard' | 'premium' | 'vip' | 'standing';

/** `away`: a seat in the away section, never for sale through the portal. */
export type SeatAvailability =
  | 'available'
  | 'locked'
  | 'sold'
  | 'season_pass'
  | 'disabled'
  | 'away';

export interface SeatStatus {
  readonly id: string;
  readonly section: string;
  readonly row: string;
  readonly number: number;
  readonly category: SeatCategory;
  readonly price: number;
  readonly status: SeatAvailability;
  readonly isAccessible: boolean;
}

export type StadiumArc = 'upper' | 'lower';
/** Three tiers: the whole upper arc, the whole lower arc, and VIP. The away section has none. */
export type PriceCategory = 'vip' | 'upper' | 'lower';

export interface SectorSummary {
  readonly section: string;
  /** Display name from the sectors table ("D/1 szektor", "VIP"): shown as is, never composed. */
  readonly name: string;
  /** Which arc of the stadium; null = no sector data. */
  readonly arc: StadiumArc | null;
  /** Place on the arc, west to east. */
  readonly position: number | null;
  /** Entrance gate 1..4 serving the sector; null = unknown. */
  readonly gate: number | null;
  readonly priceCategory: PriceCategory | null;
  /** The away section: not sold through the portal, no season passes. */
  readonly isAway: boolean;
  /**
   * Is the sector under a roof? From the `sectors` table via the seat map.
   * null = the server has no data: nothing may be claimed about it.
   */
  readonly covered: boolean | null;
  readonly total: number;
  readonly available: number;
  readonly locked: number;
  readonly sold: number;
  readonly occupancyRatio: number;
  /** Lowest / highest seat price in the sector (HUF). Sent by the API. */
  readonly minPrice: number;
  readonly maxPrice: number;
}

export interface MatchSeatsResponse {
  readonly matchId: string;
  readonly seats: readonly SeatStatus[];
  readonly sectorSummary: readonly SectorSummary[];
}

export interface LockSeatResponse {
  readonly matchId: string;
  readonly seatId: string;
  readonly ownerToken: string;
  readonly ttlSeconds: number;
  /** ISO 8601 timestamp */
  readonly expiresAt: string;
}

/** The two arcs of the stadium, as the plan names them. */
export const ARC_LABEL: Readonly<Record<StadiumArc, string>> = {
  upper: 'Felső ív',
  lower: 'Főépület oldala',
};

/** Price tiers, dearest first. The tier is the reading of the map: colour follows it. */
export const PRICE_CATEGORY_LABEL: Readonly<Record<PriceCategory, string>> = {
  vip: 'VIP',
  lower: 'Alsó ív',
  upper: 'Felső ív',
};
