import { PriceCategory, SectorSummary, StadiumArc } from '../../../../shared/models/seat.model';

/**
 * Layout of the stadium map, computed from the sector summary the server
 * sends. No sector code appears here: which sectors exist, which arc they are on,
 * their order and their relative size all come from the data, so a corrected
 * plan needs no change to the map.
 *
 * The stadium is two curved stands around the pitch: the upper arc above it
 * (west to east, left to right) and the lower, main-building arc below it. Each
 * stand is a ring of elliptical segments; a sector's width is proportional to
 * its seat count, so the large sectors beside the halfway line look large.
 */

export const VIEW_WIDTH = 1000;
export const VIEW_HEIGHT = 600;

const CX = 500;
const CY = 300;
/** Ellipse radii of the inner and outer edge of a stand. */
const INNER = { rx: 330, ry: 120 };
const OUTER = { rx: 420, ry: 190 };
/** Each stand covers this many degrees of its half-ellipse, leaving the ends open for the gates. */
const SPAN = { from: 12, to: 168 };
/** Gap between neighbouring sectors, in degrees. */
const GAP = 0.8;

export const PITCH = { x: 270, y: 215, width: 460, height: 170 };

export interface SectorShape {
  readonly section: string;
  readonly path: string;
  readonly labelX: number;
  readonly labelY: number;
  /** Angular width in degrees: tells the template whether a label fits. */
  readonly angle: number;
  readonly arc: StadiumArc;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

function point(edge: { rx: number; ry: number }, deg: number): { x: number; y: number } {
  return { x: CX + edge.rx * Math.cos(rad(deg)), y: CY + edge.ry * Math.sin(rad(deg)) };
}

const fmt = (n: number): string => n.toFixed(1);

/**
 * One annular segment between two angles. `upper` stands run over the top
 * (angles 180..360, clockwise on screen); lower stands run along the bottom
 * (angles 180..0), so west is on the left in both.
 */
function segment(arc: StadiumArc, from: number, to: number): string {
  const o1 = point(OUTER, from);
  const o2 = point(OUTER, to);
  const i1 = point(INNER, from);
  const i2 = point(INNER, to);
  // Going west to east: over the top is clockwise (sweep 1); along the bottom is counter-clockwise.
  const sweep = arc === 'upper' ? 1 : 0;
  return (
    `M${fmt(o1.x)},${fmt(o1.y)} ` +
    `A${OUTER.rx},${OUTER.ry} 0 0 ${sweep} ${fmt(o2.x)},${fmt(o2.y)} ` +
    `L${fmt(i2.x)},${fmt(i2.y)} ` +
    `A${INNER.rx},${INNER.ry} 0 0 ${1 - sweep} ${fmt(i1.x)},${fmt(i1.y)} Z`
  );
}

/** Sectors of one arc in west-to-east order. Sectors without arc data are not drawn. */
export function sectorsOnArc(
  summaries: readonly SectorSummary[],
  arc: StadiumArc,
): readonly SectorSummary[] {
  return summaries
    .filter((s) => s.arc === arc && s.position !== null)
    .sort((a, b) => (a.position as number) - (b.position as number));
}

export function sectorShapes(summaries: readonly SectorSummary[]): readonly SectorShape[] {
  const shapes: SectorShape[] = [];
  for (const arc of ['upper', 'lower'] as const) {
    const sectors = sectorsOnArc(summaries, arc);
    const seats = sectors.reduce((sum, s) => sum + Math.max(s.total, 1), 0);
    if (seats === 0) continue;
    const available = SPAN.to - SPAN.from - GAP * (sectors.length - 1);
    let cursor = 0; // degrees travelled west to east, from the west end of the stand
    for (const sector of sectors) {
      const width = (Math.max(sector.total, 1) / seats) * available;
      const west = SPAN.from + cursor;
      const east = west + width;
      cursor += width + GAP;
      // Map "distance from the west end" to the screen angle of each stand.
      const [a1, a2] = arc === 'upper' ? [180 + west, 180 + east] : [180 - west, 180 - east];
      const mid = (a1 + a2) / 2;
      const label = point({ rx: (INNER.rx + OUTER.rx) / 2, ry: (INNER.ry + OUTER.ry) / 2 }, mid);
      shapes.push({
        section: sector.section,
        path: segment(arc, a1, a2),
        labelX: label.x,
        labelY: label.y,
        angle: width,
        arc,
      });
    }
  }
  return shapes;
}

/** A gate marker on the outline, in map coordinates. */
export interface GateMarker {
  readonly gate: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Where the four gates are drawn, from the plan: gate 1 at the east end,
 * gates 2 and 3 at the west end (3 on the lower side, serving the away
 * section), gate 4 at the north-east.
 */
export function gateMarkers(): readonly GateMarker[] {
  const out = { rx: OUTER.rx + 30, ry: OUTER.ry + 26 };
  const at = (gate: number, deg: number): GateMarker => ({ gate, ...point(out, deg) });
  return [at(1, 2), at(2, 194), at(3, 166), at(4, 322)];
}

// ---- price tier styling ---------------------------------------------------------

export interface TierStyle {
  /** A CSS colour: built from the design tokens, so the map follows the theme. */
  readonly fill: string;
  readonly text: string;
}

/**
 * Colour is the price tier, in three steps of the brand purple from deep to light:
 * the map reads as a price map at a glance. Seat state (sold out, nearly full) is
 * shown by the outline, never by the fill, so the two never compete.
 */
export const TIER_STYLE: Readonly<Record<PriceCategory, TierStyle>> = {
  vip: { fill: 'color-mix(in srgb, var(--brand-deep) 65%, var(--ink))', text: '#ffffff' },
  lower: { fill: 'var(--brand-deep)', text: '#ffffff' },
  upper: { fill: 'var(--brand-mid)', text: '#ffffff' },
};

/** Tier order on the legend, dearest first. */
export const TIER_ORDER: readonly PriceCategory[] = ['vip', 'lower', 'upper'];

/** Lowest ticket price of each tier among the sectors that can be bought; null = none on sale. */
export function tierFromPrices(
  summaries: readonly SectorSummary[],
): Readonly<Record<PriceCategory, number | null>> {
  const out: Record<PriceCategory, number | null> = {
    vip: null,
    lower: null,
    upper: null,
  };
  for (const s of summaries) {
    if (s.isAway || s.priceCategory === null) continue;
    const current = out[s.priceCategory];
    out[s.priceCategory] = current === null ? s.minPrice : Math.min(current, s.minPrice);
  }
  return out;
}

/** The outline that says how full a sector is: colour only for the two states that matter. */
export function occupancyOutline(summary: SectorSummary): 'full' | 'busy' | 'none' {
  if (summary.isAway || summary.total === 0) return 'none';
  if (summary.available === 0) return 'full';
  if (summary.occupancyRatio >= 0.6) return 'busy';
  return 'none';
}
