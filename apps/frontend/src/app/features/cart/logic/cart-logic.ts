import { CartItem } from '../../../shared/models/cart.model';
import { SeatCategory } from '../../../shared/models/seat.model';

/** Under this much time left on a hold, its match strip turns amber. */
export const URGENT_BELOW_MS = 60_000;

export interface MatchGroup {
  readonly matchId: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly kickoffAt: string;
  readonly items: readonly CartItem[];
  /** Shortest time left among this match's seats (ms, never negative). */
  readonly remainingMs: number;
  readonly urgent: boolean;
}

/**
 * Groups the cart by match, keeping the order seats were added. Each seat has
 * its own hold; the match's pill shows the shortest one, since that is the
 * first seat that will drop out.
 */
export function groupByMatch(items: readonly CartItem[], nowMs: number): readonly MatchGroup[] {
  const groups = new Map<string, CartItem[]>();
  for (const item of items) {
    const list = groups.get(item.matchId);
    if (list) {
      list.push(item);
    } else {
      groups.set(item.matchId, [item]);
    }
  }
  return [...groups.entries()].map(([matchId, list]) => {
    const remainingMs = Math.max(0, Math.min(...list.map((i) => i.lockExpiresAtMs - nowMs)));
    const first = list[0];
    return {
      matchId,
      homeTeam: first.homeTeam,
      awayTeam: first.awayTeam,
      kickoffAt: first.kickoffAt,
      items: list,
      remainingMs,
      urgent: remainingMs < URGENT_BELOW_MS,
    };
  });
}

/** Shortest remaining hold over the whole cart, or null when it is empty. */
export function shortestHoldMs(items: readonly CartItem[], nowMs: number): number | null {
  if (items.length === 0) {
    return null;
  }
  return Math.max(0, Math.min(...items.map((i) => i.lockExpiresAtMs - nowMs)));
}

/** The 38px chip text: the sector code (A, B, C, VIP). */
export function seatShortLabel(item: Pick<CartItem, 'section'>): string {
  return item.section;
}

/** "A szektor · 1. sor · 5. szék" (the VIP sector has no "szektor" suffix). */
export function seatDescription(item: Pick<CartItem, 'section' | 'row' | 'seatNumber'>): string {
  const sector = item.section === 'VIP' ? 'VIP' : `${item.section} szektor`;
  return `${sector} · ${item.row}. sor · ${item.seatNumber}. szék`;
}

const TICKET_TYPES: Record<SeatCategory, string> = {
  standard: 'Normál jegy',
  premium: 'Prémium jegy',
  vip: 'VIP jegy',
  standing: 'Álló jegy',
};

export function ticketTypeLabel(category: SeatCategory): string {
  return TICKET_TYPES[category] ?? 'Jegy';
}

/** Loyalty discount in whole forints, rounded the way checkout rounds it. */
export function discountAmount(subtotal: number, percent: number): number {
  return Math.round((subtotal * percent) / 100);
}
