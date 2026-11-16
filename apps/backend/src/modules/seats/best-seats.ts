import { compareRows } from './seat-order';

/**
 * Pure logic of the "best free seats" finder: what an adjacent run is, how a run
 * is scored, and how a party is split when no single run is long enough. No I/O
 * here; the service loads the data and the lock service does the locking.
 *
 * WHAT "ADJACENT" MEANS
 *   Same row, consecutive seat numbers, all free, and no aisle between them.
 *   Seat 14 and seat 15 are numerically adjacent but not side by side when the
 *   aisle sits between them.
 *
 * WHAT "BEST" MEANS (the rule the finder implements)
 *   Every candidate run gets a cost in "seats", lower is better:
 *
 *     cost = lateral + ROW_COST * rowIndex
 *
 *   - lateral:  how far the run's centre is from the pitch's halfway line, in
 *               seat widths. Within a sector the halfway line is a point on the
 *               row (or, for a sector away from the middle, its edge nearest the
 *               middle: the best seat there is the one closest to it). The
 *               halfway line of an arc is the point where half of the arc's
 *               total width (sum of its sectors' seats per row) lies each side.
 *   - rowIndex: 0 for the front row (row 1, nearest the pitch), 1 for row 2 ...
 *               Each row back costs ROW_COST (1) seat of sideways distance.
 *
 *   Ties go to the front row, then to the lower seat number, so the answer is
 *   deterministic.
 *
 *   ASSUMPTION (not surveyed): seat numbers rise in the same direction as the
 *   sectors do on their arc (west to east), and row 1 is the front. The layout
 *   is a reconstruction (see database/stadium-layout.ts); so is the aisle rule
 *   below. When the club's figures replace them only the inputs change.
 */

/** One seat of the sector with what the finder needs to know about it. */
export interface GridSeat {
  readonly id: string;
  readonly row: string;
  readonly number: number;
  /** Free to sell right now: not sold, not held, not a pass, not disabled, not away. */
  readonly free: boolean;
}

/** An unbroken stretch of free seats side by side in one row. */
export interface Run {
  readonly row: string;
  readonly seats: readonly GridSeat[];
}

export interface Window {
  readonly row: string;
  readonly seats: readonly GridSeat[];
  readonly cost: number;
}

/** A row further from the pitch costs as much as this many seats of sideways distance. */
export const ROW_COST = 1;

/** Rows wider than this have an aisle in the middle (placeholder: not surveyed). */
export const MAX_BLOCK_WIDTH = 14;

/**
 * The seat numbers after which an aisle sits, for a row `rowWidth` seats wide.
 * One aisle in the middle of any row wider than MAX_BLOCK_WIDTH, none otherwise.
 * The seat grid draws its gaps from the same list, so what the visitor sees is
 * what the finder respects.
 */
export function aislesAfter(rowWidth: number): number[] {
  return rowWidth > MAX_BLOCK_WIDTH ? [Math.ceil(rowWidth / 2)] : [];
}

/** Groups the sector's seats by row, rows in numeric order, seats by number. */
export function groupRows(seats: readonly GridSeat[]): Array<{ row: string; seats: GridSeat[] }> {
  const byRow = new Map<string, GridSeat[]>();
  for (const seat of seats) {
    const list = byRow.get(seat.row);
    if (list) list.push(seat);
    else byRow.set(seat.row, [seat]);
  }
  return [...byRow.entries()]
    .sort(([a], [b]) => compareRows(a, b))
    .map(([row, list]) => ({ row, seats: list.sort((a, b) => a.number - b.number) }));
}

/** Width of the sector in seats per row: its highest seat number. */
export function sectorWidth(seats: readonly GridSeat[]): number {
  let max = 0;
  for (const s of seats) if (s.number > max) max = s.number;
  return max;
}

/** Every maximal run of side-by-side free seats in the sector. */
export function findRuns(seats: readonly GridSeat[], width = sectorWidth(seats)): Run[] {
  const aisles = new Set(aislesAfter(width));
  const runs: Run[] = [];
  for (const { row, seats: rowSeats } of groupRows(seats)) {
    let current: GridSeat[] = [];
    const flush = (): void => {
      if (current.length > 0) runs.push({ row, seats: current });
      current = [];
    };
    for (const seat of rowSeats) {
      const previous = current[current.length - 1];
      const breaks =
        previous !== undefined &&
        (seat.number !== previous.number + 1 || aisles.has(previous.number));
      if (breaks) flush();
      if (seat.free) current.push(seat);
      else flush();
    }
    flush();
  }
  return runs;
}

/** The longest free run in the sector, in seats (0 when nothing is free). */
export function longestRun(seats: readonly GridSeat[], width?: number): number {
  return findRuns(seats, width).reduce((max, run) => Math.max(max, run.seats.length), 0);
}

/**
 * Where the arc's halfway line falls within a sector, in seat widths from the
 * sector's start (0 = the first seat's outer edge, width = the last seat's). `arcWidths` lists the sectors of the arc in order, each with
 * its width; `index` is this sector's place in it. Clamped to the sector: for
 * a sector away from the middle that is its edge nearest the middle.
 */
export function halfwayWithin(arcWidths: readonly number[], index: number): number {
  const total = arcWidths.reduce((a, b) => a + b, 0);
  const before = arcWidths.slice(0, index).reduce((a, b) => a + b, 0);
  const width = arcWidths[index];
  return Math.min(Math.max(total / 2 - before, 0), width);
}

/** Cost of one run-sized window (see the rule above). Lower is better. */
export function windowCost(seats: readonly GridSeat[], rowIndex: number, ideal: number): number {
  const first = seats[0].number;
  const last = seats[seats.length - 1].number;
  const centre = (first + last) / 2 - 0.5; // seat n occupies [n-1, n]
  return Math.abs(centre - ideal) + ROW_COST * rowIndex;
}

const byCost = (a: Window, b: Window): number =>
  a.cost - b.cost || compareRows(a.row, b.row) || a.seats[0].number - b.seats[0].number;

/**
 * Every window of exactly `count` seats inside the runs, best first. A run
 * longer than `count` yields several overlapping windows; the finder is free to
 * take any of them, so the best placement inside a long run wins.
 */
export function rankWindows(
  runs: readonly Run[],
  count: number,
  rowIndexOf: (row: string) => number,
  ideal: number,
): Window[] {
  const windows: Window[] = [];
  for (const run of runs) {
    for (let start = 0; start + count <= run.seats.length; start++) {
      const seats = run.seats.slice(start, start + count);
      windows.push({ row: run.row, seats, cost: windowCost(seats, rowIndexOf(run.row), ideal) });
    }
  }
  return windows.sort(byCost);
}

/** Two windows, from two different runs, that together seat the party. */
export interface SplitProposal {
  readonly windows: readonly Window[];
  readonly cost: number;
}

/**
 * The next best thing when no single run holds the party: two runs. Prefers the
 * most even split (4 people: 2+2 before 3+1), then the lowest total cost. The
 * two windows always come from different runs: if one run could hold both it
 * could hold the party, and the caller only asks for a split when it cannot.
 * Returns null when no two runs can seat the party.
 */
export function bestSplit(
  runs: readonly Run[],
  count: number,
  rowIndexOf: (row: string) => number,
  ideal: number,
): SplitProposal | null {
  for (let small = Math.floor(count / 2); small >= 1; small--) {
    const large = count - small;
    // Best window of each size per run; the cheapest pair from two distinct runs wins.
    const bestLarge = runs.map((r) => rankWindows([r], large, rowIndexOf, ideal)[0] ?? null);
    const bestSmall =
      small === large
        ? bestLarge
        : runs.map((r) => rankWindows([r], small, rowIndexOf, ideal)[0] ?? null);
    let best: SplitProposal | null = null;
    for (let i = 0; i < runs.length; i++) {
      const a = bestLarge[i];
      if (!a) continue;
      for (let j = 0; j < runs.length; j++) {
        const b = bestSmall[j];
        if (i === j || !b) continue;
        const cost = a.cost + b.cost;
        if (!best || cost < best.cost) best = { windows: [a, b], cost };
      }
    }
    if (best) return best;
  }
  return null;
}
