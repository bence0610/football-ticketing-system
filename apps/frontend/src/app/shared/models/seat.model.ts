export type SeatCategory = 'standard' | 'premium' | 'vip' | 'standing';

/**
 * `away`: a seat in the away section, never for sale through the portal.
 * `ticketed`: season map only: the seat has a ticket for an upcoming match of the season,
 * so no pass can be bought for it (a match board never sends it).
 */
export type SeatAvailability =
  | 'available'
  | 'locked'
  | 'sold'
  | 'season_pass'
  | 'disabled'
  | 'away'
  | 'ticketed';

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
  /** Longest stretch of side-by-side free seats in one row, an aisle breaking it; 0 = none, always 0 for the away section. */
  readonly longestRun: number;
  /** Seat numbers after which an aisle sits in the rows of this sector. */
  readonly aisles: readonly number[];
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

/** One request to the best-seats finder. */
export interface BestSeatsRequest {
  readonly section: string;
  readonly count: number;
  /** Accept two shorter runs when no single run is long enough. */
  readonly allowSplit?: boolean;
}

export interface BestSeatsRun {
  readonly row: string;
  readonly seats: readonly SeatStatus[];
}

/** The seats are locked by the time this arrives; every one carries the same owner token. */
export interface BestSeatsResponse {
  readonly matchId: string;
  readonly section: string;
  readonly kind: 'together' | 'split';
  readonly runs: readonly BestSeatsRun[];
  readonly ownerToken: string;
  readonly ttlSeconds: number;
  readonly expiresAt: string;
}

/** Body of the finder's 409: what is not possible, and what the server can deliver instead. */
export interface BestSeatsRefusal {
  readonly code: 'no_adjacent_run' | 'not_enough_seats' | 'contended' | 'match_started';
  readonly message: string;
  readonly requested?: number;
  readonly longestRun?: number;
  readonly freeSeats?: number;
  readonly alternative?: {
    readonly runs: ReadonlyArray<{ row: string; firstNumber: number; lastNumber: number; length: number }>;
  } | null;
}
