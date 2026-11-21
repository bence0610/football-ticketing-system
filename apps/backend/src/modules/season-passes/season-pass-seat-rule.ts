/**
 * THE season-pass seat rule: the one definition of "this seat can still be
 * issued as a season pass for this season". The season seat map, the per-sector
 * and per-tier free counts, the hold check and the purchase pre-check all use
 * these SQL fragments, and finalisation re-checks with them inside its
 * transaction, so the number the page shows is the number the purchase honours.
 *
 * A seat is free for a season pass iff
 *   - the seat is active (`seats.is_active = 1`),
 *   - its sector is not the away section (`sectors.is_away = 0`; VENDÉG is
 *     excluded everywhere), and
 *   - NO `season_passes` row exists for (seat, season), WHATEVER ITS STATUS.
 *
 * The last point is deliberately exactly what the unique index
 * `uq_season_passes_seat_season (seat_id, season_label)` enforces: the index
 * ignores `status`, so a CANCELLED or EXPIRED pass row still blocks the seat
 * for that season (an insert would fail). Offering such a seat would only let
 * a buyer pay and then be refunded. Freeing it needs the row deleted or the
 * index changed, an admin decision outside this flow.
 *
 * - NO ticket exists for the seat for an UPCOMING match of this season. A pass
 *   holder gets a SEASON_PASS ticket per home match, and
 *   `uq_tickets_match_seat (match_id, seat_id)` lets only one ticket exist per
 *   (match, seat) that OCCUPIES it, so a seat already ticketed for a future match
 *   would cost the buyer that match. The check is therefore on the existence of an
 *   OCCUPYING ticket (pending payment, paid, used: ticket-occupancy.ts, the same
 *   statuses the index counts; a cancelled/refunded/expired row leaves the seat free),
 *   for a match that is pass-eligible, not cancelled, kicks off after now and
 *   before the end of the season (the latest `valid_until` of the season's price
 *   rows, last day included). A ticket for a match already played does not
 *   matter: nothing is left to refuse.
 *   The fix is here, where the seat is offered, not in the index.
 *
 * Aliases the fragments rely on: `s` = seats, `c` = sectors (joined with
 * PASS_SEAT_FROM_SQL). Each fragment has exactly one `?`: the season label.
 */
export const PASS_SEAT_FROM_SQL = 'FROM seats s LEFT JOIN sectors c ON c.code = s.section';

/** A season_passes row of any status exists for (seat, season). */
export const SEAT_TAKEN_BY_PASS_SQL =
  'EXISTS (SELECT 1 FROM season_passes sp WHERE sp.seat_id = s.id AND sp.season_label = ?)';

/** An OCCUPYING ticket (pending payment, paid, used) exists for the seat for an upcoming match of the season. One `?`: the season label. */
export const SEAT_TICKETED_UPCOMING_SQL =
  'EXISTS (SELECT 1 FROM tickets t JOIN matches m ON m.id = t.match_id ' +
  "WHERE t.seat_id = s.id AND t.status IN ('pending_payment','paid','used') " +
  "AND m.is_season_pass_eligible = 1 AND m.status <> 'cancelled' " +
  'AND m.kickoff_at > NOW() AND m.kickoff_at < (SELECT DATE_ADD(MAX(spp.valid_until), INTERVAL 1 DAY) ' +
  'FROM season_pass_prices spp WHERE spp.season_label = ?))';

/**
 * The whole rule. A seat without a sector row (c.is_away NULL) is not free either.
 * Two `?` (both the season label): the pass check, then the ticket check.
 */
export const SEAT_FREE_FOR_PASS_SQL = `(s.is_active = 1 AND c.is_away = 0 AND NOT ${SEAT_TAKEN_BY_PASS_SQL} AND NOT ${SEAT_TICKETED_UPCOMING_SQL})`;

/**
 * One seat (or many) with everything the rule decides on. Four `?`: the season
 * label four times (`free` uses two, then `taken`, then `ticketed`); append your own WHERE.
 */
export const PASS_SEAT_SELECT_SQL =
  'SELECT s.id AS id, s.section AS section, s.`row` AS `row`, s.`number` AS `number`, ' +
  's.category AS category, s.is_accessible AS isAccessible, s.is_active AS isActive, ' +
  'c.code AS sectorCode, c.is_away AS isAway, c.price_category AS tier, ' +
  `${SEAT_FREE_FOR_PASS_SQL} AS free, ${SEAT_TAKEN_BY_PASS_SQL} AS taken, ` +
  `${SEAT_TICKETED_UPCOMING_SQL} AS ticketed ` +
  PASS_SEAT_FROM_SQL;

/** A row of PASS_SEAT_SELECT_SQL as the driver returns it (tinyints as numbers or strings). */
export interface PassSeatRow {
  id: string;
  section: string;
  row: string;
  number: number | string;
  category: string;
  isAccessible: number | string | boolean;
  isActive: number | string | boolean;
  sectorCode: string | null;
  isAway: number | string | boolean | null;
  tier: 'vip' | 'upper' | 'lower' | null;
  free: number | string | boolean | null;
  taken: number | string | boolean | null;
  /** A ticket exists for an upcoming match of the season (see SEAT_TICKETED_UPCOMING_SQL). */
  ticketed: number | string | boolean | null;
}

export const truthy = (v: number | string | boolean | null | undefined): boolean =>
  v === true || Number(v) === 1;

/** Status on the season map. `ticketed`: the seat has a ticket for an upcoming match, so it cannot carry a pass. */
export type PassSeatStatus = 'available' | 'season_pass' | 'locked' | 'disabled' | 'ticketed';

/**
 * Why a single seat cannot be held or bought, or null when it can (before the
 * Redis hold is looked at).
 */
export type PassSeatRefusal = 'missing' | 'away' | 'disabled' | 'taken' | 'ticketed';

export function passSeatRefusal(row: PassSeatRow | undefined): PassSeatRefusal | null {
  if (!row || !row.sectorCode) return 'missing';
  if (truthy(row.isAway) || row.tier === null) return 'away';
  if (truthy(row.free)) return null;
  if (!truthy(row.isActive)) return 'disabled';
  if (truthy(row.taken)) return 'taken';
  if (truthy(row.ticketed)) return 'ticketed';
  return 'disabled';
}

/** The map status of a seat: the DB rule first, then the Redis hold overlay. */
export function passSeatStatus(row: PassSeatRow, held: boolean): PassSeatStatus {
  if (truthy(row.free)) return held ? 'locked' : 'available';
  if (!truthy(row.isActive)) return 'disabled';
  if (truthy(row.taken)) return 'season_pass';
  if (truthy(row.ticketed)) return 'ticketed';
  return 'disabled';
}
