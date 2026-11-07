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
  seatLabel?: string;
  section?: string;
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
}

export interface PurchaseSeasonPassPayload {
  sectionId: string;
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
