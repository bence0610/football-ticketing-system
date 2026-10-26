import { TicketStatus } from '../../database/entities';

/**
 * A seat is OCCUPIED for a given match if a ticket exists for that (match, seat)
 * whose status is one of these values.
 *
 * - PENDING_PAYMENT: the payment is in flight; the seat must not be resold.
 * - PAID: the ticket has been purchased; the seat is sold.
 * - USED: the steward has scanned the ticket and granted entry. Scanning
 *   consumes the right of entry — it does NOT release the seat for resale.
 *   The holder is in the stadium; the seat is still occupied.
 *
 * Statuses NOT in this list (CANCELLED, REFUNDED, EXPIRED) mean the original
 * transaction is void and the seat returns to sale.
 */
export const OCCUPYING_TICKET_STATUSES: readonly TicketStatus[] = [
  TicketStatus.PENDING_PAYMENT,
  TicketStatus.PAID,
  TicketStatus.USED,
] as const;

/**
 * Returns true if a ticket with the given status occupies its seat for the
 * corresponding match. Prefer this helper over inlining the array when the
 * check is on a single ticket; use {@link OCCUPYING_TICKET_STATUSES} with
 * TypeORM `In(...)` for query filters.
 */
export function occupiesSeat(status: TicketStatus): boolean {
  return OCCUPYING_TICKET_STATUSES.includes(status);
}
