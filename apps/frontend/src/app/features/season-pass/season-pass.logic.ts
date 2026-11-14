import { HttpErrorResponse } from '@angular/common/http';
import type {
  SeasonPassPrice,
  SeasonPassSector,
  SeasonSeatHold,
} from '../../core/models/season-pass.models';
import type { SeatAvailability } from '../../shared/models/seat.model';

// ---------------------------------------------------------------------------------------
// Choosing the seat
// ---------------------------------------------------------------------------------------

/** "N szabad bérletes hely", or "elfogyott" when none is left. */
export function sectorFreeText(sector: SeasonPassSector): string {
  return sector.freeSeats > 0 ? `${sector.freeSeats} szabad bérletes hely` : 'elfogyott';
}

export function sectorSoldOut(sector: SeasonPassSector): boolean {
  return sector.freeSeats <= 0;
}

/** The 409 codes of the seat hold and the purchase that the page words itself. */
export type SeasonSeatConflict =
  | 'seat_taken'
  | 'seat_ticketed'
  | 'seat_held'
  | 'seat_disabled'
  | 'hold_lost'
  | 'pass_not_issued_refunded'
  | 'section_sold_out';

const CONFLICT_MESSAGE: Readonly<Record<SeasonSeatConflict, string>> = {
  seat_taken: 'Erre a helyre közben már valaki bérletet vett. Válassz másik helyet.',
  seat_ticketed:
    'Erre a helyre már van jegy egy közelgő mérkőzésre, ezért nem váltható rá bérlet (a bérletes belépő arra a meccsre nem állítható ki). Válassz másik helyet.',
  seat_held:
    'Ezt a helyet épp egy másik vásárló fizeti ki. Válassz másik helyet, vagy nézz vissza pár perc múlva.',
  seat_disabled: 'Ez a hely nem használható. Válassz másik helyet.',
  hold_lost: 'A helyfoglalásod megszűnt, mielőtt fizettél volna. Válaszd ki újra a helyet.',
  pass_not_issued_refunded:
    'A bérletet nem tudtuk kiállítani, mert a hely közben elkelt. A kifizetett összeget visszatérítjük.',
  section_sold_out: 'Ebben az árkategóriában elfogyott a bérletes hely.',
};

/** The machine-readable `code` of a 409, when it is one this page knows. */
export function seasonSeatConflict(error: unknown): SeasonSeatConflict | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) {
    return null;
  }
  const body: unknown = error.error;
  const code = body && typeof body === 'object' && 'code' in body ? (body as { code: unknown }).code : null;
  return typeof code === 'string' && code in CONFLICT_MESSAGE ? (code as SeasonSeatConflict) : null;
}

export function seasonSeatConflictMessage(code: SeasonSeatConflict): string {
  return CONFLICT_MESSAGE[code];
}

/**
 * Why a tapped seat of the season board cannot be chosen, in plain words; null for a seat
 * that can be (free). Any status the season board does not know is "not for sale".
 */
export function unavailableSeatReason(status: SeatAvailability): string | null {
  switch (status) {
    case 'available':
      return null;
    case 'season_pass':
      return 'Erre a helyre már szól bérlet ebben a szezonban.';
    case 'ticketed':
      return 'Erre a helyre már van jegy egy közelgő mérkőzésre, ezért nem váltható bérletre.';
    case 'locked':
      return 'Másik vásárló épp fizet erre a helyre.';
    default:
      return 'Ez a hely nem értékesíthető.';
  }
}

/** A clock difference above this between the server's `expiresAt` and `now + ttl` is the visitor's clock being off. */
const CLOCK_SKEW_TOLERANCE_MS = 5000;

/**
 * When the hold ends, on the visitor's clock. The server's `expiresAt` is used as is,
 * unless it disagrees with `ttlSeconds` by more than a few seconds: then the device's
 * clock is off, and counting `ttlSeconds` from now is the truth the visitor can see.
 */
export function holdDeadlineMs(hold: SeasonSeatHold, nowMs: number): number {
  const fromTtl = hold.ttlSeconds > 0 ? nowMs + hold.ttlSeconds * 1000 : null;
  const parsed = Date.parse(hold.expiresAt);
  if (Number.isNaN(parsed)) {
    return fromTtl ?? nowMs;
  }
  if (fromTtl !== null && Math.abs(parsed - fromTtl) > CLOCK_SKEW_TOLERANCE_MS) {
    return fromTtl;
  }
  return parsed;
}

/** "9:05" for the hold countdown. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

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
 * The option (price tier) with the most active passes sold — only when that is a
 * single, non-zero leader. A tie or an empty season has no "most popular" option.
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

/** The option the panel talks about: the chosen one, else the cheapest. */
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
