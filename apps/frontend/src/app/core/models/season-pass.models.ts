import type { SeatStatus, StadiumArc } from '../../shared/models/seat.model';

export type SeasonPassStatus = 'active' | 'expired' | 'cancelled' | 'pending_payment';
export type PassLoanStatus =
  | 'pending'
  | 'accepted'
  | 'revoked'
  | 'owner_entered'
  | 'expired'
  | 'used'
  | 'cancelled'
  | 'completed';

export interface PassLoanResponse {
  id: string;
  status: PassLoanStatus;
  borrowerEmail: string;
  borrowerUserId?: string;
  /** The borrower's name when they have an account; otherwise only the email is known. */
  borrowerName?: string;
  matchId: string;
  matchTitle?: string;
  kickoffAt?: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string;
  cancelledAt?: string;
  completedAt?: string;
}

export interface LoanPreview {
  matchTitle: string;
  matchVenue: string;
  kickoffAt: string;
  seatSection: string;
  seatRow: string;
  seatNumber: number;
  lenderName: string;
  expiresAt: string;
}

/** A pending, still-acceptable invitation addressed to the signed-in user. */
export interface IncomingLoan {
  id: string;
  invitationToken: string;
  lenderName: string;
  matchTitle: string;
  kickoffAt: string;
  seatSection: string;
  seatRow: string;
  seatNumber: number;
  expiresAt: string;
}

export interface SeasonPassResponse {
  id: string;
  /** The person who occupies the seat (shown at the gate). */
  holderName: string;
  /** The current user bought this pass. */
  isBuyer: boolean;
  /** The current user is the holder (linked account). */
  isHolder: boolean;
  /** Set when someone else bought the pass for the current user. */
  buyerName?: string;
  status: SeasonPassStatus;
  seasonLabel: string;
  validFrom: string;
  validUntil: string;
  /**
   * The pass's coverage as instants, computed by the server in the stadium's
   * timezone: a match is covered when `coversFrom <= kickoff < coversBefore`.
   * `validUntil` is a bare date (UTC midnight) and must not be compared to a
   * kickoff directly: that would drop the whole last day.
   */
  coversFrom: string;
  coversBefore: string;
  seatLabel?: string;
  section?: string;
  /** Display name from the sectors table; falls back to the code. */
  sectorName?: string;
  /** Entrance gate 1..4; null = unknown. */
  gate?: number | null;
  purchasedAt?: string;
  pricePaid?: string;
  currency?: string;
  loans: PassLoanResponse[];
}

export const PASS_LOAN_STATUS_LABELS: Record<PassLoanStatus, string> = {
  pending: 'Visszaigazolásra vár',
  accepted: 'Elfogadva',
  revoked: 'Visszavonva',
  owner_entered: 'Nem átadható – a tulajdonos már belépett',
  expired: 'Lejárt',
  used: 'Felhasznált',
  cancelled: 'Visszavont',
  completed: 'Lezárt',
};

export interface SeasonPassPrice {
  sectionId: string;
  sectionName: string;
  price: number;
  currency: string;
  seasonLabel: string;
  /**
   * The fields below describe the sector's availability and the single-match
   * alternative. They are optional on purpose: the page must still work, and
   * must not guess, when the API does not supply them.
   */
  /** Seats that can still be issued as a pass (same rule as the purchase). */
  freeSeats?: number;
  totalSeats?: number;
  /** Active passes sold for the season in this sector. */
  passesSold?: number;
  /** `null` = unknown. */
  isCovered?: boolean | null;
  /** Price tier (`vip`, `lower`, `upper`); the same as `sectionId`. */
  priceCategory?: 'vip' | 'upper' | 'lower' | null;
  arc?: 'upper' | 'lower' | null;
  /** Place on the arc, west to east. */
  position?: number | null;
  /** Entrance gate 1..4. */
  gate?: number | null;
  /** Home matches still to be played that the pass is valid for. */
  upcomingHomeMatches?: number;
  /** The same seat bought match by match for those fixtures; `null` = not derivable. */
  singleMatchTotal?: number | null;
}

export interface SeasonHomeMatch {
  id: string;
  awayTeam: string;
  kickoffAt: string;
  status: string;
  competition?: string;
}

export interface SeasonOverview {
  seasonLabel: string;
  /** Loyalty points awarded for buying a pass. */
  loyaltyPoints: number;
  homeMatches: SeasonHomeMatch[];
}

/** One sector of a price tier, as the season-pass seat picker lists it (the away section is never included). */
export interface SeasonPassSector {
  readonly section: string;
  /** Display name from the sectors table ("D/1 szektor", "VIP"). */
  readonly name: string;
  readonly arc: StadiumArc | null;
  /** Place on the arc, west to east. */
  readonly position: number | null;
  /** Entrance gate 1..4; null = unknown. */
  readonly gate: number | null;
  /** null = unknown: nothing is claimed. */
  readonly covered: boolean | null;
  readonly total: number;
  /** Seats that can still be chosen for a pass this season. */
  readonly freeSeats: number;
}

/** `GET /season-passes/tiers/:tier/sectors`. */
export interface SeasonPassTierSectors {
  readonly tier: string;
  readonly seasonLabel: string;
  readonly price: number;
  readonly sectors: readonly SeasonPassSector[];
}

/**
 * Season state of one seat. Never `sold`: a single-match sale says nothing about
 * the season. `locked` = another buyer is paying for it right now. `ticketed` = the seat
 * has a ticket for an upcoming match of the season: a pass on it could not be honoured
 * at that match, so it cannot be bought as a season seat.
 */
export type SeasonSeatAvailability = 'available' | 'season_pass' | 'ticketed' | 'locked' | 'disabled';

/** `GET /season-passes/seats?section=`: the seat board of one sector, in season terms. */
export interface SeasonPassSeatMap {
  readonly section: string;
  readonly name: string;
  readonly arc: StadiumArc | null;
  readonly gate: number | null;
  readonly covered: boolean | null;
  readonly tier: string;
  /** The tier's season price: every seat of the sector costs this. */
  readonly price: number;
  readonly seasonLabel: string;
  readonly aisles: readonly number[];
  readonly longestRun: number;
  /** `status` is a {@link SeasonSeatAvailability}; typed as the shared seat so the one seat grid renders it. */
  readonly seats: readonly SeatStatus[];
}

/** `POST /season-passes/seats/:seatId/hold`: the seat is the buyer's for `ttlSeconds` while they pay. */
export interface SeasonSeatHold {
  readonly seatId: string;
  readonly holdToken: string;
  readonly ttlSeconds: number;
  /** ISO 8601 */
  readonly expiresAt: string;
}

export interface PurchaseSeasonPassPayload {
  /** The price tier (`vip`, `lower`, `upper`). */
  sectionId: string;
  /** The seat the buyer chose and holds. */
  seatId: string;
  holdToken: string;
  /** Who the pass is for; omit both for the buyer. A name alone = holder without account. */
  holderName?: string;
  /** Email of the holder's registered account (links the pass to their profile). */
  holderEmail?: string;
  paymentMethodId?: string;
}

export interface PurchaseSeasonPassResponse {
  paymentIntentId: string;
  clientSecret: string | null;
  status: string;
  seasonPassId: string | null;
  succeeded: boolean;
  seasonLabel: string;
  amount: number;
  currency: string;
}
