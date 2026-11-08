import { SeatCategory } from './seat.model';

/**
 * One row in the cart. The `lockExpiresAt` and `ownerToken` are returned
 * by `POST /matches/:matchId/seats/:seatId/lock` and drive the per-item
 * countdown shown on the cart page.
 */
export interface CartItem {
  readonly seatId: string;
  readonly matchId: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly kickoffAt: string;
  readonly section: string;
  readonly row: string;
  readonly seatNumber: number;
  readonly category: SeatCategory;
  readonly price: number;
  readonly ownerToken: string;
  /** Epoch ms */
  readonly lockExpiresAtMs: number;
  /** Hold length granted by the server (`ttlSeconds`); absent on carts persisted before this field existed. */
  readonly lockTtlSeconds?: number;
  readonly addedAtMs: number;
}

export interface CartSnapshot {
  readonly items: readonly CartItem[];
  readonly matchId: string | null;
}

export const MAX_CART_ITEMS = 6;
