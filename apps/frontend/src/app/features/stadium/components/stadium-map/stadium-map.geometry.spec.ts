import { PriceCategory, SectorSummary } from '../../../../shared/models/seat.model';
import {
  gateMarkers,
  occupancyOutline,
  sectorShapes,
  sectorsOnArc,
  TIER_ORDER,
  tierFromPrices,
} from './stadium-map.geometry';

const sector = (
  section: string,
  arc: 'upper' | 'lower',
  position: number,
  total: number,
  over: Partial<SectorSummary> = {},
): SectorSummary => ({
  section,
  name: `${section} szektor`,
  arc,
  position,
  gate: 2,
  priceCategory: 'lower',
  isAway: false,
  covered: false,
  total,
  available: total,
  locked: 0,
  sold: 0,
  occupancyRatio: 0,
  minPrice: 3500,
  maxPrice: 3500,
  ...over,
});

describe('stadium map geometry', () => {
  const data = [
    // deliberately out of order: the data decides the order, not the array
    sector('B/1', 'upper', 2, 400),
    sector('D/1', 'upper', 1, 200),
    sector('VIP', 'lower', 2, 200),
    sector('VENDÉG', 'lower', 1, 300, { isAway: true }),
  ];

  it('draws every sector that has arc data, one shape each', () => {
    expect(sectorShapes(data).map((s) => s.section).sort()).toEqual(['B/1', 'D/1', 'VENDÉG', 'VIP']);
  });

  it('orders each arc by position, west to east', () => {
    expect(sectorsOnArc(data, 'upper').map((s) => s.section)).toEqual(['D/1', 'B/1']);
    expect(sectorsOnArc(data, 'lower').map((s) => s.section)).toEqual(['VENDÉG', 'VIP']);
  });

  it('makes a sector as wide as its seats say: twice the seats, twice the angle', () => {
    const shapes = sectorShapes(data);
    const angle = (code: string): number => shapes.find((s) => s.section === code)!.angle;
    expect(angle('B/1') / angle('D/1')).toBeCloseTo(2, 5);
    expect(angle('VENDÉG') / angle('VIP')).toBeCloseTo(1.5, 5);
  });

  it('puts the west sector on the left of both stands and the east one on the right', () => {
    const shapes = sectorShapes(data);
    const x = (code: string): number => shapes.find((s) => s.section === code)!.labelX;
    expect(x('D/1')).toBeLessThan(x('B/1'));
    expect(x('VENDÉG')).toBeLessThan(x('VIP'));
  });

  it('keeps the upper stand above the pitch and the lower stand below it', () => {
    const shapes = sectorShapes(data);
    const y = (code: string): number => shapes.find((s) => s.section === code)!.labelY;
    expect(y('B/1')).toBeLessThan(300);
    expect(y('VIP')).toBeGreaterThan(300);
  });

  it('skips a sector with no arc data rather than guessing where it goes', () => {
    const unknown = { ...sector('X', 'upper', 1, 100), arc: null, position: null } as SectorSummary;
    expect(sectorShapes([unknown]).length).toBe(0);
  });

  it('is driven by the data alone: no sector code is needed', () => {
    expect(sectorShapes([sector('ZZ', 'lower', 1, 50)]).map((s) => s.section)).toEqual(['ZZ']);
  });

  it('places the four gates from the plan: 1 east, 2 and 3 west, 4 north-east', () => {
    const g = Object.fromEntries(gateMarkers().map((m) => [m.gate, m]));
    expect(g[1].x).toBeGreaterThan(900);
    expect(g[2].x).toBeLessThan(100);
    expect(g[3].x).toBeLessThan(100);
    expect(g[4].x).toBeGreaterThan(800);
    expect(g[4].y).toBeLessThan(200);
    // gate 3 is on the lower side (the away section), gate 2 on the upper side
    expect(g[3].y).toBeGreaterThan(g[2].y);
  });
});

describe('price tiers on the map', () => {
  it('reports the lowest price per tier from the sectors that can be bought', () => {
    const prices = tierFromPrices([
      sector('A', 'upper', 1, 10, { priceCategory: 'upper', minPrice: 2800 }),
      sector('B', 'upper', 2, 10, { priceCategory: 'upper', minPrice: 2750 }),
      sector('C', 'lower', 3, 10, { priceCategory: 'lower', minPrice: 3900 }),
      sector('V', 'lower', 1, 10, { priceCategory: null, minPrice: 1000, isAway: true }),
    ]);
    expect(prices.upper).toBe(2750);
    expect(prices.lower).toBe(3900);
    // the away section does not set a price, and a tier with nothing on sale has none
    expect(prices.vip).toBeNull();
  });
});

describe('occupancy outline', () => {
  it('marks only a full sector and a busy one; the away section never', () => {
    expect(occupancyOutline(sector('A', 'upper', 1, 10, { available: 0, sold: 10, occupancyRatio: 1 }))).toBe('full');
    expect(occupancyOutline(sector('A', 'upper', 1, 10, { available: 3, occupancyRatio: 0.7 }))).toBe('busy');
    expect(occupancyOutline(sector('A', 'upper', 1, 10, { available: 9, occupancyRatio: 0.1 }))).toBe('none');
    expect(occupancyOutline(sector('V', 'lower', 1, 10, { isAway: true, available: 0 }))).toBe('none');
  });

  it('knows three tiers, dearest first', () => {
    const tiers: PriceCategory[] = ['vip', 'lower', 'upper'];
    expect(TIER_ORDER).toEqual(tiers);
  });
});
