export type SeatCategory = 'standard' | 'premium' | 'vip' | 'standing';

export type SeatAvailability = 'available' | 'locked' | 'sold' | 'season_pass' | 'disabled';

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

export interface SectorSummary {
  readonly section: string;
  readonly total: number;
  readonly available: number;
  readonly locked: number;
  readonly sold: number;
  readonly occupancyRatio: number;
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

/**
 * Mapping from logical sector codes to compass labels for the
 * stadium SVG layout (Artboard 02 reference).
 */
export const SECTOR_COMPASS_LABEL: Readonly<Record<string, string>> = {
  A: 'Észak',
  B: 'Dél',
  C: 'Kelet',
  VIP: 'Nyugat',
};
