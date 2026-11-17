import { LoyaltyTier } from '../entities/user.entity';
import {
  LoyaltyTransactionSource,
  LoyaltyTransactionType,
} from '../entities/loyalty-transaction.entity';
import { allocateLimitedDiscount } from '../../modules/loyalty/loyalty-discount';
import { definitionFor } from '../../modules/loyalty/loyalty.constants';
import {
  StoredTier,
  tierAfterAward,
  tierAtSeasonEnd,
} from '../../modules/loyalty/loyalty-tier-keeping';
import type { Rng } from './rng';

/**
 * Replays everything that earned or cost loyalty points, per account and in time order,
 * with the application's own rules: the same reference ids (so the unique
 * `(source, reference_id)` key holds), the same tier thresholds, the same discount
 * allocation, attendance points (once per person per match, as the unique reference enforces),
 * the season-end conversion (LOYALTY_CARRYOVER_PERCENT kept) and the kept tier: a tier
 * reached in a season survives the conversion until the end of the next season. The prices the
 * tickets were bought at come out of this too, because the discount depends on the tier the
 * buyer had at that moment.
 */
export interface LoyaltyRules {
  registrationPoints: number;
  profileCompletionPoints: number;
  attendancePoints: number;
  seasonPassPoints: number;
  passLoanPoints: number;
  carryoverPercent: number;
  /** The tier discount applies to at most this many tickets per buyer per match. */
  discountTicketLimit: number;
}

export type LoyaltyEvent =
  | { kind: 'registration'; userId: string; at: Date }
  | { kind: 'profile'; userId: string; at: Date }
  | {
      kind: 'order';
      userId: string;
      at: Date;
      orderId: string;
      ticketIds: string[];
      unitPrices: number[];
    }
  | { kind: 'pass'; userId: string; at: Date; passId: string }
  /** The first time a person enters a match (a ticket, their pass entry or a borrowed entry). */
  | { kind: 'attend'; userId: string; at: Date; matchId: string }
  | { kind: 'loan'; userId: string; at: Date; loanId: string };

export interface LedgerRow {
  id: string;
  userId: string;
  type: LoyaltyTransactionType;
  source: LoyaltyTransactionSource;
  points: number;
  balanceAfter: number;
  referenceId: string;
  description: string;
  createdAt: Date;
}

export interface LoyaltyOutcome {
  ledger: LedgerRow[];
  balances: Map<string, { points: number; tier: LoyaltyTier; reachedAt: Date | null }>;
  /** Per order: what each ticket was actually charged, after the buyer's tier discount. */
  orderPrices: Map<string, number[]>;
}

const KIND_ORDER: Record<LoyaltyEvent['kind'], number> = {
  registration: 0,
  profile: 1,
  order: 2,
  pass: 2,
  attend: 2,
  loan: 2,
};

const floorToSecond = (d: Date): number => Math.floor(d.getTime() / 1000) * 1000;

export function simulateLoyalty(
  events: readonly LoyaltyEvent[],
  rules: LoyaltyRules,
  /** Every season-end conversion, in any order (30 June each year). */
  carryoverAts: readonly Date[],
  idRng: Rng,
  now: Date,
): LoyaltyOutcome {
  const byUser = new Map<string, LoyaltyEvent[]>();
  for (const e of events) {
    const list = byUser.get(e.userId) ?? [];
    list.push(e);
    byUser.set(e.userId, list);
  }

  const ledger: LedgerRow[] = [];
  const balances = new Map<string, { points: number; tier: LoyaltyTier; reachedAt: Date | null }>();
  const orderPrices = new Map<string, number[]>();
  const conversions = carryoverAts.map(floorToSecond).sort((a, b) => a - b);

  for (const [userId, userEvents] of byUser) {
    userEvents.sort(
      (a, b) => a.at.getTime() - b.at.getTime() || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
    );
    let balance = 0;
    let kept: StoredTier = { tier: LoyaltyTier.BRONZE, reachedAt: null };
    let nextConversion = 0;
    // Two rows of one account never share a second: the application orders a ledger by
    // time and then by (random) id, so a tie would make the running balance read out of order.
    let lastAt = -Infinity;

    const push = (
      at: number,
      type: LoyaltyTransactionType,
      source: LoyaltyTransactionSource,
      points: number,
      referenceId: string,
      description: string,
    ): void => {
      const stamped = Math.max(at, lastAt + 1000);
      lastAt = stamped;
      balance = Math.max(balance + points, 0);
      // An award raises the tier, never lowers it (a kept tier stays above the points).
      const after = tierAfterAward(kept, balance, new Date(stamped));
      kept = { tier: after.tier, reachedAt: after.reachedAt };
      ledger.push({
        id: idRng.uuid(),
        userId,
        type,
        source,
        points,
        balanceAfter: balance,
        referenceId,
        description,
        createdAt: new Date(stamped),
      });
    };

    const carryover = (carryoverMs: number): void => {
      const carryoverDate = new Date(carryoverMs).toISOString().slice(0, 10);
      const before = balance;
      const expiring = Math.floor((balance * (100 - rules.carryoverPercent)) / 100);
      if (balance > 0 && expiring > 0) {
        push(
          carryoverMs,
          LoyaltyTransactionType.EXPIRY,
          LoyaltyTransactionSource.SEASON_CARRYOVER,
          -expiring,
          `season:${carryoverDate}:${userId}`,
          `Szezonzáró pontkonverzió (${rules.carryoverPercent}% megtartva)`,
        );
      }
      // The same decision as the season-end job.
      kept = tierAtSeasonEnd({
        ...kept,
        pointsBefore: before,
        pointsAfter: balance,
        year: new Date(carryoverMs).getUTCFullYear(),
        at: new Date(carryoverMs),
      });
    };

    for (const e of userEvents) {
      const at = floorToSecond(e.at);
      // Each yearly conversion runs once, between the events before and after it.
      while (nextConversion < conversions.length && at > conversions[nextConversion]) {
        carryover(conversions[nextConversion]);
        nextConversion += 1;
      }
      switch (e.kind) {
        case 'registration':
          push(
            at,
            LoyaltyTransactionType.EARN,
            LoyaltyTransactionSource.REGISTRATION,
            rules.registrationPoints,
            `registration:${userId}`,
            'Regisztráció bónusz',
          );
          break;
        case 'profile':
          push(
            at,
            LoyaltyTransactionType.EARN,
            LoyaltyTransactionSource.PROFILE_COMPLETION,
            rules.profileCompletionPoints,
            `profile_completion:${userId}`,
            'Profil kitöltése jutalom',
          );
          break;
        case 'order': {
          const percent = definitionFor(kept.tier).discountPercent;
          // The discount is limited to a few tickets per buyer per match (one order per match here).
          orderPrices.set(
            e.orderId,
            allocateLimitedDiscount(e.unitPrices, percent, rules.discountTicketLimit).discounts,
          );
          // Buying earns no points: only the discount depends on it (the buyer's tier right now).
          break;
        }
        case 'pass':
          push(
            at,
            LoyaltyTransactionType.EARN,
            LoyaltyTransactionSource.SEASON_PASS_PURCHASE,
            rules.seasonPassPoints,
            `season_pass:${e.passId}`,
            'Bérletvásárlás bónusz',
          );
          break;
        case 'attend':
          push(
            at,
            LoyaltyTransactionType.EARN,
            LoyaltyTransactionSource.ATTENDANCE,
            rules.attendancePoints,
            `match:${e.matchId}:${userId}`,
            'Részvétel',
          );
          break;
        case 'loan':
          push(
            at,
            LoyaltyTransactionType.EARN,
            LoyaltyTransactionSource.PASS_LOAN,
            rules.passLoanPoints,
            `loan:${e.loanId}`,
            'Bérlet kölcsönzés jutalom',
          );
          break;
      }
    }
    // Conversions that came after the account's last event still convert it.
    while (
      userEvents.length > 0 &&
      nextConversion < conversions.length &&
      now.getTime() > conversions[nextConversion]
    ) {
      carryover(conversions[nextConversion]);
      nextConversion += 1;
    }
    balances.set(userId, { points: balance, tier: kept.tier, reachedAt: kept.reachedAt });
  }

  ledger.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.userId.localeCompare(b.userId),
  );
  return { ledger, balances, orderPrices };
}
