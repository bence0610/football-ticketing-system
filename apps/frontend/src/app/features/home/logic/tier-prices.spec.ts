import { SectorSummary } from '../../../shared/models/seat.model';
import { tierPrices } from './tier-prices';

const sector = (section: string, over: Partial<SectorSummary>): SectorSummary => ({
  section,
  name: `${section} szektor`,
  arc: 'lower',
  position: 1,
  gate: 2,
  priceCategory: 'lower',
  isAway: false,
  covered: false,
  total: 100,
  available: 50,
  locked: 0,
  sold: 50,
  occupancyRatio: 0.5,
  minPrice: 3900,
  maxPrice: 3900,
  ...over,
});

describe('tierPrices', () => {
  const data = [
    sector('K', {}),
    sector('D/1', { arc: 'upper', priceCategory: 'upper', minPrice: 2800, maxPrice: 2800 }),
    sector('VIP', { priceCategory: 'vip', minPrice: 7000, maxPrice: 7000 }),
    sector('J', {}),
    sector('C/2', { arc: 'upper', priceCategory: 'upper', minPrice: 2800, maxPrice: 2800 }),
    sector('VENDÉG', { isAway: true, priceCategory: null, minPrice: 1, maxPrice: 1 }),
  ];

  it('gives three rows for 19 sectors: VIP, lower arc, upper arc, dearest first', () => {
    const rows = tierPrices(data);
    expect(rows.map((r) => r.label)).toEqual(['VIP', 'Alsó ív', 'Felső ív']);
    expect(rows.map((r) => r.minPrice)).toEqual([7000, 3900, 2800]);
  });

  it('never lets the away section into a tier', () => {
    expect(tierPrices(data).some((r) => r.minPrice === 1)).toBeFalse();
  });

  it('leaves out a tier with no sector and is empty for no data', () => {
    expect(tierPrices([data[1]]).map((r) => r.tier)).toEqual(['upper']);
    expect(tierPrices([])).toEqual([]);
  });

  it('spans min to max when a tier is not uniform', () => {
    const rows = tierPrices([sector('K', {}), sector('J', { minPrice: 4100, maxPrice: 4300 })]);
    expect([rows[0].minPrice, rows[0].maxPrice]).toEqual([3900, 4300]);
  });
});
