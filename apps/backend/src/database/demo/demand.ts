import type { Rng } from './rng';

/**
 * WHERE THE TICKETS GO (the rule the demo data follows)
 *
 * 1. How many: a match's attendance is the share of sellable seats
 *    `BASE_OCCUPANCY x draw of the visitor x day/month factor x a little noise`. A strong
 *    visitor (Diósgyőri VTK, Videoton, the neighbour from Tiszakécske) draws a fuller
 *    stadium than a small club, and a midweek or winter match a thinner one.
 * 2. Which sectors: each sector gets a weight. It falls with the distance from the halfway
 *    line (the middle of the upper arc; the VIP stand, the middle of the main stand, on the
 *    lower arc), and is lowered for the cheaper-to-skip VIP stand at ordinary matches and
 *    for uncovered sectors in the cold months. Sector occupancy is then `lambda x weight`,
 *    capped just under 100%, with one `lambda` found so the sectors add up to the match's
 *    attendance. So the sectors beside the halfway line reach their cap first while the corners
 *    stay thin, and a bigger crowd fills outwards from the middle.
 * 3. Which seats: buyers come in groups (1-6 seats, side by side in one row), in the middle
 *    rows and the middle of the row more often than at the edges.
 * 4. The away section is never sold: it is not offered through the portal (a ticket there
 *    would be a state the application refuses to create), so it stays empty here.
 */

export interface SeatRef {
  id: string;
  section: string;
  row: number;
  number: number;
  priceModifier: number;
  isAccessible: boolean;
}

export interface SectorRef {
  code: string;
  arc: 'upper' | 'lower';
  position: number;
  isAway: boolean;
  isCovered: boolean;
  priceCategory: 'vip' | 'upper' | 'lower' | null;
}

/** Share of the sellable seats an ordinary NB II visitor fills on an ordinary Saturday. */
export const BASE_OCCUPANCY = 0.4;
/** The biggest upcoming match: about this share of the seats open to singles is ticketed. */
export const FULLEST_SHARE = 0.85;
const SECTOR_CAP = 0.985;

/**
 * How full the dearest stand (VIP, 224 seats) gets for a match still ahead. Its buyers come late
 * and few, and a season pass must stay buyable in it: the pass rule refuses every seat that has
 * a ticket for any upcoming league match, so the stand must keep plenty of free seats.
 */
export const UPCOMING_VIP_CAP = 0.7;

/** How many seats one order holds: weights for 1..6. */
export const GROUP_SIZE_WEIGHTS: readonly number[] = [22, 38, 13, 18, 3, 6];

export class Stadium {
  readonly sectors: SectorRef[];
  readonly seatById = new Map<string, SeatRef>();
  /** sector -> row -> seats of the row, by seat number. */
  readonly grid = new Map<string, Map<number, SeatRef[]>>();
  readonly sectorByCode = new Map<string, SectorRef>();

  constructor(seats: readonly SeatRef[], sectors: readonly SectorRef[]) {
    this.sectors = [...sectors].sort(
      (a, b) => a.arc.localeCompare(b.arc) || a.position - b.position,
    );
    for (const s of this.sectors) this.sectorByCode.set(s.code, s);
    for (const seat of seats) {
      this.seatById.set(seat.id, seat);
      let rows = this.grid.get(seat.section);
      if (!rows) {
        rows = new Map();
        this.grid.set(seat.section, rows);
      }
      const row = rows.get(seat.row) ?? [];
      row.push(seat);
      rows.set(seat.row, row);
    }
    for (const rows of this.grid.values()) {
      for (const row of rows.values()) row.sort((a, b) => a.number - b.number);
    }
  }

  isSellable(code: string): boolean {
    const s = this.sectorByCode.get(code);
    return !!s && !s.isAway && s.priceCategory !== null;
  }

  sellableSeats(): SeatRef[] {
    const out: SeatRef[] = [];
    for (const [code, rows] of this.grid) {
      if (!this.isSellable(code)) continue;
      for (const row of rows.values()) out.push(...row);
    }
    return out;
  }

  sectorSeatCount(code: string): number {
    let n = 0;
    for (const row of this.grid.get(code)?.values() ?? []) n += row.length;
    return n;
  }

  /** The position, along its arc, of the halfway line. */
  centreOf(arc: 'upper' | 'lower'): number {
    const onArc = this.sectors.filter((s) => s.arc === arc);
    const vip = onArc.find((s) => s.priceCategory === 'vip');
    if (vip) return vip.position;
    const positions = onArc.map((s) => s.position);
    return (Math.min(...positions) + Math.max(...positions)) / 2;
  }
}

export interface DemandContext {
  /** The visitor's pull (1 = ordinary). Also decides how much the VIP stand fills. */
  draw: number;
  /** Cold months: uncovered sectors are less popular. */
  cold: boolean;
}

/** Popularity of each sellable sector for a match, before the overall level is fitted. */
export function sectorWeights(stadium: Stadium, ctx: DemandContext): Map<string, number> {
  const weights = new Map<string, number>();
  for (const sector of stadium.sectors) {
    if (!stadium.isSellable(sector.code)) continue;
    const centre = stadium.centreOf(sector.arc);
    const sigma = sector.arc === 'upper' ? 1.25 : 1.6;
    const d = (sector.position - centre) / sigma;
    const centrality = Math.exp(-d * d);
    let w = 0.26 + 0.74 * centrality;
    if (sector.priceCategory === 'lower') w *= 0.92;
    if (sector.priceCategory === 'vip') {
      // The dearest stand fills only when the visitor is worth the money.
      w *= Math.min(1, 0.35 + 0.65 * Math.max(0, ctx.draw - 0.7));
    }
    if (ctx.cold && !sector.isCovered) w *= 0.85;
    weights.set(sector.code, w);
  }
  return weights;
}

/**
 * Splits `total` tickets over the sectors: occupancy = min(cap, lambda x weight), with
 * lambda found by bisection so the sectors add up to `total` (or to everything, if the
 * caps cannot hold that many).
 */
export function sectorTargets(
  freeBySector: ReadonlyMap<string, number>,
  weights: ReadonlyMap<string, number>,
  total: number,
  caps: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
  const sectors = [...freeBySector.keys()].filter((c) => (weights.get(c) ?? 0) > 0);
  const capOf = (c: string): number => Math.min(SECTOR_CAP, caps.get(c) ?? SECTOR_CAP);
  const sold = (lambda: number): number =>
    sectors.reduce(
      (sum, c) =>
        sum +
        Math.min(capOf(c), lambda * (weights.get(c) as number)) * (freeBySector.get(c) as number),
      0,
    );
  let lo = 0;
  let hi = 50;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (sold(mid) < total) lo = mid;
    else hi = mid;
  }
  const lambda = hi;
  const out = new Map<string, number>();
  let assigned = 0;
  for (const c of sectors) {
    const free = freeBySector.get(c) as number;
    const n = Math.min(
      free,
      Math.round(Math.min(capOf(c), lambda * (weights.get(c) as number)) * free),
    );
    out.set(c, n);
    assigned += n;
  }
  // Rounding: settle the difference on the busiest sectors.
  let diff = total - assigned;
  const byWeight = [...sectors].sort(
    (a, b) => (weights.get(b) as number) - (weights.get(a) as number),
  );
  for (let i = 0; diff !== 0 && i < byWeight.length * 4; i += 1) {
    const c = byWeight[i % byWeight.length];
    const free = freeBySector.get(c) as number;
    const have = out.get(c) as number;
    if (diff > 0 && have < free) {
      out.set(c, have + 1);
      diff -= 1;
    } else if (diff < 0 && have > 0) {
      out.set(c, have - 1);
      diff += 1;
    }
  }
  return out;
}

/** Free-seat bookkeeping for one match. */
export class SeatPool {
  /** sector -> row -> free flag per seat of the row (same order as `Stadium.grid`). */
  private readonly free = new Map<string, Map<number, boolean[]>>();
  private readonly freePerSector = new Map<string, number>();

  constructor(
    private readonly stadium: Stadium,
    unavailable: ReadonlySet<string>,
  ) {
    for (const [code, rows] of stadium.grid) {
      if (!stadium.isSellable(code)) continue;
      const flags = new Map<number, boolean[]>();
      let n = 0;
      for (const [rowNo, seats] of rows) {
        const row = seats.map((s) => !unavailable.has(s.id));
        n += row.filter(Boolean).length;
        flags.set(rowNo, row);
      }
      this.free.set(code, flags);
      this.freePerSector.set(code, n);
    }
  }

  freeCounts(): Map<string, number> {
    return new Map(this.freePerSector);
  }

  totalFree(): number {
    let n = 0;
    for (const v of this.freePerSector.values()) n += v;
    return n;
  }

  freeIn(code: string): number {
    return this.freePerSector.get(code) ?? 0;
  }

  /** Takes `k` seats side by side in one row; null when no row of the sector has such a run. */
  takeGroup(code: string, k: number, rng: Rng): SeatRef[] | null {
    const rows = this.free.get(code);
    const seatsOf = this.stadium.grid.get(code);
    if (!rows || !seatsOf) return null;
    const rowCount = seatsOf.size;
    const candidates: Array<{ row: number; start: number; weight: number }> = [];
    for (const [rowNo, flags] of rows) {
      const rowWeight = rowWeightOf(rowNo, rowCount);
      let run = 0;
      for (let i = 0; i < flags.length; i += 1) {
        run = flags[i] ? run + 1 : 0;
        if (run >= k) {
          const start = i - k + 1;
          const middle = start + (k - 1) / 2;
          const half = (flags.length - 1) / 2;
          const edge = half === 0 ? 0 : Math.abs(middle - half) / half;
          candidates.push({ row: rowNo, start, weight: rowWeight * (1 - 0.35 * edge) });
        }
      }
    }
    if (candidates.length === 0) return null;
    const chosen = rng.weighted(candidates, (c) => c.weight);
    const flags = rows.get(chosen.row) as boolean[];
    const seats = (seatsOf.get(chosen.row) as SeatRef[]).slice(chosen.start, chosen.start + k);
    for (let i = 0; i < k; i += 1) flags[chosen.start + i] = false;
    this.freePerSector.set(code, (this.freePerSector.get(code) ?? 0) - k);
    return seats;
  }
}

/** Middle rows are chosen more often than the front and the back. */
export function rowWeightOf(row: number, rowCount: number): number {
  const middle = (rowCount + 1) * 0.5;
  const d = (row - middle) / Math.max(1, rowCount * 0.45);
  return 0.5 + 0.5 * Math.exp(-d * d);
}

export function sampleGroupSize(rng: Rng): number {
  return rng.weightedIndex(GROUP_SIZE_WEIGHTS) + 1;
}

/**
 * Places `total` tickets as orders (groups of seats side by side). Forced sizes are placed
 * first (they belong to named demo accounts and keep their order index).
 */
export function placeOrders(
  pool: SeatPool,
  weights: ReadonlyMap<string, number>,
  total: number,
  rng: Rng,
  forcedSizes: readonly number[] = [],
  caps: ReadonlyMap<string, number> = new Map(),
): { groups: SeatRef[][]; forced: SeatRef[][] } {
  const groups: SeatRef[][] = [];
  const forced: SeatRef[][] = [];
  const free = pool.freeCounts();
  const targets = sectorTargets(free, weights, total, caps);

  const sectorsByWeight = [...targets.keys()].sort(
    (a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0),
  );

  // Forced orders go to the most popular sectors that still have room.
  for (const size of forcedSizes) {
    let got: SeatRef[] | null = null;
    for (const code of sectorsByWeight) {
      if ((targets.get(code) ?? 0) < size) continue;
      got = pool.takeGroup(code, size, rng);
      if (got) {
        targets.set(code, (targets.get(code) as number) - size);
        break;
      }
    }
    if (!got) throw new Error(`No room for a forced order of ${size} seats.`);
    forced.push(got);
  }

  for (const code of sectorsByWeight) {
    let need = targets.get(code) ?? 0;
    let guard = 0;
    while (need > 0 && guard < 20000) {
      guard += 1;
      let k = Math.min(sampleGroupSize(rng), need);
      let got: SeatRef[] | null = null;
      while (k >= 1 && !got) {
        got = pool.takeGroup(code, k, rng);
        if (!got) k -= 1;
      }
      if (!got) break;
      groups.push(got);
      need -= got.length;
    }
  }
  return { groups, forced };
}

/** Share of a match's final sales already made when it is `days` days away. */
export function soldShareAt(days: number): number {
  if (days <= 0) return 1;
  return 0.85 * Math.exp(-days / 4.5) + 0.15 * Math.exp(-days / 21);
}

/** How long before kickoff a purchase was made, in days. */
export function sampleLeadDays(rng: Rng): number {
  return rng.chance(0.85) ? rng.exponential(4.5) : rng.exponential(21);
}
