import type { LoyaltyTier, UserRole } from '../entities/user.entity';
import type { MatchStatus, Competition } from '../entities/match.entity';
import type { SeatRef } from './demand';

/** How often an account comes to matches. Drives who is picked for which order. */
export type FanClass =
  /** Staff: no tickets, no loyalty account. */
  | 'staff'
  /** Registered and never bought. */
  | 'idle'
  /** Once or twice a season. */
  | 'casual'
  /** Several matches a season. */
  | 'frequent'
  /** Most matches. */
  | 'devoted'
  /** A handful: nearly every match, in a big group. */
  | 'regular'
  /** A named demo account whose history is written by hand. */
  | 'scripted';

export interface ForcedOrder {
  /** `cur:r05`, `cur:cup1`, `prev:l03` ... */
  matchKey: string;
  size: number;
  /** Played matches: did they come? (default yes) */
  scanned?: boolean;
}

export interface DemoUser {
  id: string;
  /** Named accounts only: `admin`, `berletes` ... */
  key?: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  fanClass: FanClass;
  /** The group size this person usually buys for. */
  groupPref: number;
  createdAt: Date;
  phoneNumber: string | null;
  dateOfBirth: Date | null;
  profileCompletedAt: Date | null;
  lastLoginAt: Date | null;
  forced: ForcedOrder[];
  /** Named tier accounts: the tier the script insists they end in. */
  expectedTier?: LoyaltyTier;
  /** Named accounts: what the account is good for (printed at the end). */
  purpose?: string;
  /** Holds a season pass this season: buys fewer single tickets. */
  passHolder?: boolean;
}

export type PassTier = 'vip' | 'lower' | 'upper';

export interface DemoPass {
  id: string;
  season: 'current' | 'previous' | 'older';
  seasonLabel: string;
  tier: PassTier;
  buyerId: string;
  /** The holder's account, or null for a holder without one (a child, a guest). */
  holderId: string | null;
  holderName: string;
  seat: SeatRef;
  createdAt: Date;
  price: number;
  validFrom: Date;
  validUntil: Date;
  status: 'active' | 'expired';
  qrCode: string;
  /** The holder is one of the named demo accounts: they attend every home match. */
  alwaysAttends?: boolean;
}

export type LoanOutcome =
  | 'used'
  | 'completed'
  | 'expired'
  | 'cancelled_pending'
  | 'cancelled_accepted'
  | 'accepted'
  | 'pending';

export interface DemoLoan {
  id: string;
  pass: DemoPass;
  matchKey: string;
  lenderId: string;
  borrowerId: string | null;
  borrowerEmail: string;
  outcome: LoanOutcome;
}

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  dateOfBirth: Date | null;
  role: UserRole;
  loyaltyTier: LoyaltyTier;
  loyaltyTierReachedAt: Date | null;
  loyaltyPoints: number;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: Date | null;
  profileCompletedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface MatchRow {
  id: string;
  homeTeam: string;
  awayTeam: string;
  competition: Competition;
  venue: string;
  kickoffAt: Date;
  status: MatchStatus;
  capacity: number;
  basePrice: string;
  description: string;
  isSeasonPassEligible: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface PriceRow {
  id: string;
  section: string;
  sectionLabel: string;
  seasonLabel: string;
  price: number;
  currency: string;
  validFrom: Date;
  validUntil: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface PassRow {
  id: string;
  userId: string;
  holderName: string;
  holderUserId: string | null;
  seatId: string;
  seasonLabel: string;
  validFrom: Date;
  validUntil: Date;
  status: 'active' | 'expired';
  pricePaid: string;
  currency: string;
  qrCode: string;
  autoRenew: boolean;
  stripePaymentIntentId: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface LoanRow {
  id: string;
  seasonPassId: string;
  lenderUserId: string;
  borrowerUserId: string | null;
  matchId: string;
  borrowerEmail: string;
  status: string;
  invitationToken: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  qrJti: string | null;
  qrRevokedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface TicketRow {
  id: string;
  matchId: string;
  seatId: string;
  userId: string;
  seasonPassId: string | null;
  status: string;
  source: string;
  pricePaid: string;
  currency: string;
  qrCode: string;
  qrJti: string;
  stripePaymentIntentId: string | null;
  usedAt: Date | null;
  scannedAt: Date | null;
  scannedByUserId: string | null;
  expiredAt: Date | null;
  confirmationEmailSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface WaitlistRow {
  id: string;
  userId: string;
  matchId: string;
  status: string;
  requestedQuantity: number;
  preferredSection: string | null;
  notifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface NamedAccount {
  email: string;
  name: string;
  role: string;
  purpose: string;
}

export type { LoyaltyTier };
