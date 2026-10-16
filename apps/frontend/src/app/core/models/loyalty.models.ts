export type LoyaltyTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export type LoyaltyTransactionType = 'earn' | 'redeem' | 'adjustment' | 'expiry';

export type LoyaltyTransactionSource =
  | 'ticket_purchase'
  | 'season_pass_purchase'
  | 'promotion'
  | 'reward_redeem'
  | 'admin'
  | 'profile_completion'
  | 'pass_loan'
  | 'season_carryover'
  | 'registration';

export interface LoyaltyTierResponse {
  tier: LoyaltyTier;
  label: string;
  minPoints: number;
  discountPercent: number;
  color: string;
}

export interface LoyaltyTransactionResponse {
  id: string;
  type: LoyaltyTransactionType;
  source: LoyaltyTransactionSource;
  points: number;
  balanceAfter: number;
  description?: string;
  createdAt: string;
}

export interface LoyaltySnapshotResponse {
  points: number;
  tier: LoyaltyTierResponse;
  nextTier?: LoyaltyTierResponse;
  pointsToNextTier?: number;
  recentTransactions: LoyaltyTransactionResponse[];
}

/**
 * Frontend-canonical labels and colors mirroring loyalty.constants.ts on the backend.
 * Keep this in sync if the backend tier list ever changes.
 */
export const TIER_LABELS: Record<LoyaltyTier, string> = {
  bronze: 'Kék',
  silver: 'Ezüst',
  gold: 'Arany',
  platinum: 'KTE Legenda',
};

/**
 * Loyalty tier swatch colors. Values mirror design tokens from styles.scss
 * (--kte-seat-pass, --kte-faint, --kte-gold, --kte-brand-mid). Kept as raw
 * hex because tier colors are bound via `[style.background]` inline, which
 * does not resolve CSS custom properties cross-browser. The gold value is
 * reserved exclusively for the loyalty tier badge/card (--kte-gold).
 */
export const TIER_COLORS: Record<LoyaltyTier, string> = {
  bronze: '#1F5C8B',   // --kte-seat-pass
  silver: '#9D96A8',   // --kte-faint
  gold: '#C9A227',     // --kte-gold (reserved for loyalty tier)
  platinum: '#6B2D96', // --kte-brand-mid
};

export const TRANSACTION_SOURCE_LABELS: Record<LoyaltyTransactionSource, string> = {
  ticket_purchase: 'Jegyvásárlás',
  season_pass_purchase: 'Bérletvásárlás',
  promotion: 'Promóció',
  reward_redeem: 'Pontbeváltás',
  admin: 'Adminisztrátori módosítás',
  profile_completion: 'Profil kitöltése',
  pass_loan: 'Bérletkölcsön',
  season_carryover: 'Szezonzáró pontkonverzió',
  registration: 'Regisztráció',
};
