export type UserRole = 'fan' | 'gate' | 'admin' | 'super_admin';
export type LoyaltyTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: UserRole;
  readonly loyaltyTier: LoyaltyTier;
  readonly loyaltyPoints: number;
  /** Undefined for sessions stored before verification existed: treated as verified. */
  readonly emailVerified?: boolean;
}

export interface AuthResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly user: AuthUser;
}

export interface RegisterPayload {
  readonly email: string;
  readonly password: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly phoneNumber?: string;
}

export interface LoginPayload {
  readonly email: string;
  readonly password: string;
}

export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly phoneNumber?: string;
  /** 'YYYY-MM-DD'. */
  readonly dateOfBirth?: string;
  readonly role: UserRole;
  readonly loyaltyTier: LoyaltyTier;
  readonly loyaltyPoints: number;
  readonly emailVerified: boolean;
  /** A new address waiting for its confirmation link to be opened; `email` stays the old one until then. */
  readonly pendingEmail?: string;
  readonly twoFactorEnabled: boolean;
  readonly lastLoginAt?: string;
  readonly createdAt: string;
}

/** PATCH /users/me: exactly the editable fields. An empty phoneNumber clears it. */
export interface ProfileUpdatePayload {
  readonly firstName: string;
  readonly lastName: string;
  readonly phoneNumber: string;
  /** 'YYYY-MM-DD'; `null` clears a saved date; left out when there was none and none is entered. */
  readonly dateOfBirth?: string | null;
}

export interface ChangePasswordPayload {
  readonly currentPassword: string;
  readonly newPassword: string;
}

export interface EmailChangePayload {
  readonly newEmail: string;
  readonly currentPassword: string;
}

/** 202 of POST /users/me/email-change. */
export interface EmailChangeRequested {
  readonly message: string;
  readonly pendingEmail: string;
}

/** 200 of POST /auth/confirm-email-change. */
export interface EmailVerified {
  readonly message: string;
  readonly email: string;
}

export interface VerificationResent {
  readonly message: string;
  readonly alreadyVerified: boolean;
}

export interface EmailChangeConfirmed {
  readonly message: string;
  readonly email: string;
}

export type TicketStatus =
  | 'pending_payment'
  | 'paid'
  | 'cancelled'
  | 'refunded'
  | 'used';

export interface UserTicket {
  readonly id: string;
  readonly matchId: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly kickoffAt: string;
  readonly venue: string;
  readonly section: string;
  readonly sectorName: string;
  readonly gate: number | null;
  readonly row: string;
  readonly seatNumber: number;
  readonly category: string;
  readonly status: TicketStatus;
  readonly pricePaid: number;
  readonly currency: string;
  readonly qrCode: string;
  readonly purchasedAt: string;
  readonly isActive: boolean;
}

export interface UserTicketsPage {
  readonly items: readonly UserTicket[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}
