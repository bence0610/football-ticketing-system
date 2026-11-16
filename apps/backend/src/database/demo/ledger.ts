import { LoyaltyTier } from '../entities/user.entity';
import {
  LoyaltyTransactionSource,
  LoyaltyTransactionType,
} from '../entities/loyalty-transaction.entity';
import { allocateDiscount } from '../../modules/loyalty/loyalty-discount';
import { definitionFor, tierForPoints } from '../../modules/loyalty/loyalty.constants';
import type { Rng } from './rng';

/**
 * Replays everything that earned or cost loyalty points, per account and in time order,
 * with the application's own rules: the same reference ids (so the unique
 * `(source, reference_id)` key holds), the same tier thresholds, the same discount
 * allocation, and the season-end conversion that keeps half of the balance. The prices the
 * tickets were bought at come out of this too, because the discount depends on the tier the
 * buyer had at that moment.
 */
export interface LoyaltyRules {
  registrationPoints: number;
  profileCompletionPoints: number;
  ticketPointsPerTicket: number;
  seasonPassPoints: number;
  passLoanPoints: number;
  carryoverPercent: number;
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
  balances: Map<string, { points: number; tier: LoyaltyTier }>;
  /** Per order: what each ticket was actually charged, after the buyer's tier discount. */
  orderPrices: Map<string, number[]>;
}

const KIND_ORDER: Record<LoyaltyEvent['kind'], number> = {
  registration: 0,
  profile: 1,
  order: 2,
  pass: 2,
  loan: 2,
};

const floorToSecond = (d: Date): number => Math.floor(d.getTime() / 1000) * 1000;

export function simulateLoyalty(
  events: readonly LoyaltyEvent[],
  rules: LoyaltyRules,
  carryoverAt: Date,
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
  const balances = new Map<string, { points: number; tier: LoyaltyTier }>();
  const orderPrices = new Map<string, number[]>();
  const carryoverMs = floorToSecond(carryoverAt);
  const carryoverDate = new Date(carryoverMs).toISOString().slice(0, 10);

  for (const [userId, userEvents] of byUser) {
    userEvents.sort(
      (a, b) => a.at.getTime() - b.at.getTime() || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
    );
    let balance = 0;
    let tier = LoyaltyTier.BRONZE;
    let carriedOver = false;
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
      tier = tierForPoints(balance).tier;
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

    const carryover = (): void => {
      carriedOver = true;
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
    };

    for (const e of userEvents) {
      const at = floorToSecond(e.at);
      // The yearly conversion runs once, between the events before and after it.
      if (!carriedOver && at > carryoverMs) carryover();
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
          const percent = definitionFor(tier).discountPercent;
          orderPrices.set(e.orderId, allocateDiscount(e.unitPrices, percent).discounts);
          e.ticketIds.forEach((ticketId, i) => {
            // One row per ticket, a second apart, as the application's sequential awards land.
            push(
              at + i * 1000,
              LoyaltyTransactionType.EARN,
              LoyaltyTransactionSource.TICKET_PURCHASE,
              rules.ticketPointsPerTicket,
              `ticket:${ticketId}`,
              'Jegyvásárlás bónusz',
            );
          });
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
    // An account whose every event came before the conversion still gets converted.
    if (!carriedOver && userEvents.length > 0 && now.getTime() > carryoverMs) {
      const last = floorToSecond(userEvents[userEvents.length - 1].at);
      if (last < carryoverMs) carryover();
    }
    balances.set(userId, { points: balance, tier });
  }

  ledger.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.userId.localeCompare(b.userId),
  );
  return { ledger, balances, orderPrices };
}
