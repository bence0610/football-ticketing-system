import { MatchListItem } from '../../../shared/models/match.model';

/**
 * A match counts as "Kevés hely" when at most this share of its capacity is
 * still free. The API has no such threshold — this is the home page's own
 * rule, applied to the real `availableSeats / capacity` of each match.
 */
export const LOW_AVAILABILITY_RATIO = 0.2;

export type AvailabilityKind = 'available' | 'low' | 'sold_out' | 'soon' | 'closed';

export interface Availability {
  readonly kind: AvailabilityKind;
  readonly label: string;
  /** Status-chip modifier from the global stylesheet. */
  readonly chipClass: 'paid' | 'pending' | 'expired' | 'used';
}

export function availabilityOf(
  match: Pick<MatchListItem, 'status' | 'availableSeats' | 'capacity'>,
): Availability {
  if (match.status === 'sold_out' || (match.status === 'on_sale' && match.availableSeats <= 0)) {
    return { kind: 'sold_out', label: 'Telt ház', chipClass: 'expired' };
  }
  if (match.status === 'scheduled') {
    return { kind: 'soon', label: 'Hamarosan', chipClass: 'used' };
  }
  if (match.status !== 'on_sale') {
    return { kind: 'closed', label: 'Nem elérhető', chipClass: 'used' };
  }
  const ratio = match.capacity > 0 ? match.availableSeats / match.capacity : 1;
  if (ratio <= LOW_AVAILABILITY_RATIO) {
    return { kind: 'low', label: 'Kevés hely', chipClass: 'pending' };
  }
  return { kind: 'available', label: 'Kapható', chipClass: 'paid' };
}

const SHOWN_STATUSES: readonly MatchListItem['status'][] = ['on_sale', 'scheduled', 'sold_out'];

/** Upcoming home matches, soonest first. Sold-out ones stay (they get a waitlist card). */
export function upcomingHomeMatches(
  matches: readonly MatchListItem[],
  nowMs: number,
): readonly MatchListItem[] {
  return matches
    .filter(
      (m) =>
        m.isHome && SHOWN_STATUSES.includes(m.status) && new Date(m.kickoffAt).getTime() > nowMs,
    )
    .slice()
    .sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime());
}
