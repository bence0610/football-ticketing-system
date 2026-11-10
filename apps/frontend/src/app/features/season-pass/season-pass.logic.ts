import type { SeasonPassPrice } from '../../core/models/season-pass.models';

/**
 * How many pass seats are left in a sector, as shown by the coloured dot.
 *
 *  - `sold-out`     no seat left: no purchase is offered.
 *  - `nearly-gone`  red: at most 10% of the sector's seats, but never fewer than 3 (so
 *                   a 24-seat sector turns red at 3, a 200-seat one at 20).
 *  - `few`          amber: at most 30% of the sector's seats.
 *  - `plenty`       green: everything else.
 *
 * `unknown` when the API gave no free-seat count: nothing is claimed then.
 */
export type Availability = 'plenty' | 'few' | 'nearly-gone' | 'sold-out' | 'unknown';

export const NEARLY_GONE_RATIO = 0.1;
export const NEARLY_GONE_MIN_SEATS = 3;
export const FEW_RATIO = 0.3;

export function availabilityOf(price: SeasonPassPrice): Availability {
  const free = price.freeSeats;
  if (free === undefined || free === null) {
    return 'unknown';
  }
  if (free <= 0) {
    return 'sold-out';
  }
  const total = price.totalSeats ?? 0;
  if (total <= 0) {
    // A free count without a total to compare it to: only the absolute floor applies.
    return free <= NEARLY_GONE_MIN_SEATS ? 'nearly-gone' : 'plenty';
  }
  if (free <= Math.max(NEARLY_GONE_MIN_SEATS, total * NEARLY_GONE_RATIO)) {
    return 'nearly-gone';
  }
  if (free <= total * FEW_RATIO) {
    return 'few';
  }
  return 'plenty';
}

export function isSoldOut(price: SeasonPassPrice): boolean {
  return availabilityOf(price) === 'sold-out';
}

/**
 * The sector with the most active passes sold — only when that is a single,
 * non-zero leader. A tie or an empty season has no "most popular" sector.
 */
export function mostPopularSectionId(prices: readonly SeasonPassPrice[]): string | null {
  let best: SeasonPassPrice | null = null;
  let tied = false;
  for (const p of prices) {
    const sold = p.passesSold;
    if (sold === undefined || sold <= 0) {
      continue;
    }
    if (best === null || sold > (best.passesSold ?? 0)) {
      best = p;
      tied = false;
    } else if (sold === best.passesSold) {
      tied = true;
    }
  }
  return best !== null && !tied ? best.sectionId : null;
}

/** Pass price spread over the home matches it still covers; null when there are none. */
export function perMatchEquivalent(price: SeasonPassPrice): number | null {
  const n = price.upcomingHomeMatches;
  if (!n || n <= 0) {
    return null;
  }
  return Math.round(price.price / n);
}

export interface Savings {
  /** Cost of the same seat bought match by match; null when it cannot be derived. */
  separate: number | null;
  pass: number;
  /** Positive only; null when there is no total to compare or the pass is not cheaper. */
  difference: number | null;
  matches: number;
}

/**
 * What the savings panel can honestly say about a sector. With no known
 * match-by-match total the panel shows the pass price alone.
 */
export function savingsFor(price: SeasonPassPrice): Savings {
  const separate = price.singleMatchTotal ?? null;
  const diff = separate === null ? null : separate - price.price;
  return {
    separate,
    pass: price.price,
    difference: diff !== null && diff > 0 ? diff : null,
    matches: price.upcomingHomeMatches ?? 0,
  };
}

/** The sector the panel talks about: the chosen one, else the cheapest. */
export function panelSector(
  prices: readonly SeasonPassPrice[],
  selectedId: string | null,
): SeasonPassPrice | null {
  const selected = prices.find((p) => p.sectionId === selectedId);
  if (selected) {
    return selected;
  }
  return prices.reduce<SeasonPassPrice | null>(
    (cheapest, p) => (cheapest === null || p.price < cheapest.price ? p : cheapest),
    null,
  );
}
