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
  | 'registration'
  | 'pass_attendance'
  | 'attendance';

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
  /** Internal key of the event (unique with the source); the UI never shows it. */
  referenceId?: string;
  /** The match the row belongs to (attendance, an old ticket purchase, a loan), when there is one. */
  match?: { id: string; homeTeam: string; awayTeam: string; kickoffAt: string };
  createdAt: string;
}

/** The real earning rules, from the server configuration. */
export interface LoyaltyEarningRules {
  registrationPoints: number;
  profileCompletionPoints: number;
  /** Points for entering a match: once per person per match, with a ticket, a pass entry or a borrowed entry. */
  attendancePoints: number;
  seasonPassPoints: number;
  passLoanPoints: number;
  /** Share of the balance kept at the season-end conversion (0-100). */
  carryoverPercent: number;
  /** The tier discount applies to at most this many tickets per buyer per match. */
  discountTicketLimit?: number;
}

export interface LoyaltySnapshotResponse {
  points: number;
  tier: LoyaltyTierResponse;
  nextTier?: LoyaltyTierResponse;
  pointsToNextTier?: number;
  /** Present while the tier is kept without the points to match it: the last day it is kept (yyyy-mm-dd). */
  tierKeptUntil?: string;
  /** With `tierKeptUntil`: how many points the balance is short of the kept tier. */
  pointsToKeepTier?: number;
  /** Absent on older servers; the page then says nothing about the rules. */
  earning?: LoyaltyEarningRules;
  /** Distinct matches entered (a ticket with a gate scan). */
  matchesAttended?: number;
  /** Whole ledger size; `recentTransactions` is only the newest page. */
  totalTransactions?: number;
  recentTransactions: LoyaltyTransactionResponse[];
}

/**
 * Frontend-canonical labels and colors mirroring loyalty.constants.ts on the backend.
 * Keep this in sync if the backend tier list ever changes.
 */
export const TIER_LABELS: Record<LoyaltyTier, string> = {
  bronze: 'Lila',
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
  bronze: '#6B2D96',   // --kte-brand-mid
  silver: '#9D96A8',   // --kte-faint
  gold: '#C9A227',     // --kte-gold (reserved for loyalty tier)
  platinum: '#6B2D96', // --kte-brand-mid
};

/**
 * Readable text colour for each tier swatch (WCAG AA). Silver and gold are
 * light swatches, so white text on them fails; they take --kte-ink instead.
 */
export const TIER_TEXT_COLORS: Record<LoyaltyTier, string> = {
  bronze: '#FFFFFF',
  silver: '#14121A', // --kte-ink
  gold: '#14121A', // --kte-ink
  platinum: '#FFFFFF',
};

export const TRANSACTION_SOURCE_LABELS: Record<LoyaltyTransactionSource, string> = {
  ticket_purchase: 'Jegyvásárlás (régi pontozás)',
  season_pass_purchase: 'Bérletvásárlás',
  promotion: 'Promóció',
  reward_redeem: 'Pontbeváltás',
  admin: 'Adminisztrátori módosítás',
  profile_completion: 'Profil kitöltése',
  pass_loan: 'Bérletkölcsön',
  season_carryover: 'Szezonzáró pontkonverzió',
  registration: 'Regisztráció',
  pass_attendance: 'Belépés bérlettel (régi pontozás)',
  attendance: 'Részvétel',
};
