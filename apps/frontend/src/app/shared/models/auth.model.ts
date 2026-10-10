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
  readonly role: UserRole;
  readonly loyaltyTier: LoyaltyTier;
  readonly loyaltyPoints: number;
  readonly emailVerified: boolean;
  readonly twoFactorEnabled: boolean;
  readonly lastLoginAt?: string;
  readonly createdAt: string;
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
