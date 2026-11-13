/**
 * The one ordering of seats: by sector position, then row, then seat number.
 *
 * Rows are stored as strings ("1" .. "16"). Compared as strings, "10" sorts
 * before "2", which broke the first-free-seat pick and every seat list as soon
 * as a sector had ten or more rows. Compare rows as numbers; a row that is not
 * a plain number sorts after the numbered ones, alphabetically.
 */
export function compareRows(a: string, b: string): number {
  const na = /^\d+$/.test(a) ? Number(a) : null;
  const nb = /^\d+$/.test(b) ? Number(b) : null;
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return a.localeCompare(b, 'hu');
}

export interface OrderableSeat {
  readonly section: string;
  readonly row: string;
  readonly number: number;
}

/**
 * `position` maps a sector code to its place in the stadium order (upper arc
 * first, then lower, west to east). Sectors without a position sort last, by code.
 */
export function compareSeats(
  position: ReadonlyMap<string, number>,
): (a: OrderableSeat, b: OrderableSeat) => number {
  const rank = (code: string): number => position.get(code) ?? Number.MAX_SAFE_INTEGER;
  return (a, b) =>
    rank(a.section) - rank(b.section) ||
    (a.section === b.section ? 0 : a.section.localeCompare(b.section, 'hu')) ||
    compareRows(a.row, b.row) ||
    a.number - b.number;
}

/** SQL fragment for the same row order: numeric first, the raw value as tie-break. */
export const SQL_ROW_ORDER = 'CAST(s.`row` AS UNSIGNED), s.`row`';
