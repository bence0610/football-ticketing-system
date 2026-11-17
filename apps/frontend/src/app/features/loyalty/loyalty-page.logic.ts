import {
  LoyaltyEarningRules,
  LoyaltySnapshotResponse,
  LoyaltyTier,
  LoyaltyTransactionResponse,
  TRANSACTION_SOURCE_LABELS,
} from '../../core/models/loyalty.models';
import { discountAmount } from '../cart/logic/cart-logic';

/**
 * "Szintedet ... -ig megtartod": shown while the tier is kept without the points to match it (the
 * season-end conversion took the balance under its threshold). Null when the points hold the tier.
 */
export function tierKeptText(snapshot: LoyaltySnapshotResponse): string | null {
  if (!snapshot.tierKeptUntil) {
    return null;
  }
  const until = new Date(`${snapshot.tierKeptUntil}T00:00:00Z`).toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const short = snapshot.pointsToKeepTier ?? 0;
  return `Szintedet (${snapshot.tier.label}) ${until}-ig megtartod; ha addig további ${short} pontot gyűjtesz, a pontjaid is fedezik.`;
}

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
      label: 'Részvétel',
      amount: `+${points(rules.attendancePoints)}`,
      detail:
        'meccsenként egyszer, jeggyel vagy bérlettel: az első beolvasott belépő után jár, akárhány jegyed van arra a meccsre. Kölcsönkapott belépővel is jár; jegyvásárlásért nem jár pont, a fix összeg nem függ a jegy árától',
    },
    {
      label: 'Bérletvásárlás',
      amount: `+${points(rules.seasonPassPoints)}`,
      detail:
        'a bérlet birtokosának jár, nem a vevőnek; ha a birtokosnak nincs fiókja (gyerek, vendég), senki nem kapja',
    },
    {
      label: 'Bérlet kölcsönadása',
      amount: `+${points(rules.passLoanPoints)}`,
      detail: 'amikor a kölcsön lezárul',
    },
  ];
}

export interface LedgerRow {
  readonly id: string;
  /** The event in plain Hungarian, e.g. "Részvétel". Never the internal source code. */
  readonly event: string;
  /** The match the row belongs to, e.g. "Kecskeméti TE – Diósgyőri VTK, nov. 28.", or null. */
  readonly match: string | null;
  readonly points: number;
  readonly pointsText: string;
  readonly balance: number;
  readonly createdAt: string;
}

/** Sources whose own description says more than the label (a free-text note, the conversion rate). */
const DESCRIBED_SOURCES: ReadonlySet<string> = new Set([
  'admin',
  'promotion',
  'reward_redeem',
  'season_carryover',
]);

/** "Kecskeméti TE – Diósgyőri VTK, nov. 28." (the date in the stadium's time zone). */
export function matchLabel(match: NonNullable<LoyaltyTransactionResponse['match']>): string {
  const date = new Date(match.kickoffAt).toLocaleDateString('hu-HU', {
    month: 'short',
    day: 'numeric',
    timeZone: 'Europe/Budapest',
  });
  return `${match.homeTeam} – ${match.awayTeam}, ${date}`;
}

/**
 * One ledger row as the user sees it: the event in plain words and the match it belongs to. The
 * internal source code and reference are never shown (the reference is a database key).
 */
export function ledgerRow(tx: LoyaltyTransactionResponse): LedgerRow {
  const label = TRANSACTION_SOURCE_LABELS[tx.source] ?? 'Pontmozgás';
  const described = DESCRIBED_SOURCES.has(tx.source) ? tx.description?.trim() : '';
  return {
    id: tx.id,
    event: described || label,
    match: tx.match ? matchLabel(tx.match) : null,
    points: tx.points,
    pointsText: `${tx.points > 0 ? '+' : tx.points < 0 ? '−' : ''}${Math.abs(tx.points)}`,
    balance: tx.balanceAfter,
    createdAt: tx.createdAt,
  };
}
