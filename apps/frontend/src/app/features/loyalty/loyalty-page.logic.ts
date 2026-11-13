import {
  LoyaltyEarningRules,
  LoyaltyTier,
  LoyaltyTransactionResponse,
  TRANSACTION_SOURCE_LABELS,
} from '../../core/models/loyalty.models';
import { discountAmount } from '../cart/logic/cart-logic';

/** Tiers in ladder order, lowest first. */
export const TIER_LADDER: readonly LoyaltyTier[] = ['bronze', 'silver', 'gold', 'platinum'];

export interface CheckoutExample {
  readonly price: number;
  readonly percent: number;
  readonly discount: number;
  readonly pay: number;
}

/**
 * What a ticket costs a user at a tier. Rounds the discount exactly the way the
 * cart and the payment server do (`discountAmount`), so the example is the
 * number the checkout really shows.
 */
export function checkoutExample(price: number, percent: number): CheckoutExample {
  const discount = discountAmount(price, percent);
  return { price, percent, discount, pay: price - discount };
}

export interface EarningRule {
  readonly label: string;
  /** Short amount shown on the right, e.g. "+50 pont". */
  readonly amount: string;
  readonly detail?: string;
}

function points(n: number): string {
  return `${n} pont`;
}

/** The earning rules as the server configures them; nothing is typed in the template. */
export function earningRules(rules: LoyaltyEarningRules): readonly EarningRule[] {
  return [
    { label: 'Regisztráció', amount: `+${points(rules.registrationPoints)}` },
    {
      label: 'Profil kitöltése',
      amount: `+${points(rules.profileCompletionPoints)}`,
      detail: 'telefonszám és születési dátum megadásakor, egyszer',
    },
    {
      label: 'Jegyvásárlás',
      amount: `+${points(rules.ticketPointsPerTicket)}`,
      detail: 'jegyenként, fix összeg: nem függ a jegy árától, így a szinted kedvezménye sem csökkenti',
    },
    { label: 'Bérletvásárlás', amount: `+${points(rules.seasonPassPoints)}` },
    {
      label: 'Bérlet kölcsönadása',
      amount: `+${points(rules.passLoanPoints)}`,
      detail: 'amikor a kölcsön lezárul',
    },
  ];
}

export interface LedgerRow {
  readonly id: string;
  readonly event: string;
  /** Raw source code, shown in monospace. */
  readonly source: string;
  /** Raw reference, or null on rows that were credited without one. */
  readonly reference: string | null;
  readonly points: number;
  readonly pointsText: string;
  readonly balance: number;
  readonly createdAt: string;
}

export function ledgerRow(tx: LoyaltyTransactionResponse): LedgerRow {
  return {
    id: tx.id,
    event: tx.description?.trim() || TRANSACTION_SOURCE_LABELS[tx.source] || tx.source,
    source: tx.source,
    reference: tx.referenceId ?? null,
    points: tx.points,
    pointsText: `${tx.points > 0 ? '+' : tx.points < 0 ? '−' : ''}${Math.abs(tx.points)}`,
    balance: tx.balanceAfter,
    createdAt: tx.createdAt,
  };
}
