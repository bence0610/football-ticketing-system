import type { SeasonPassPrice } from '../../core/models/season-pass.models';
import {
  availabilityOf,
  mostPopularSectionId,
  panelSector,
  perMatchEquivalent,
  savingsFor,
} from './season-pass.logic';

function price(over: Partial<SeasonPassPrice> = {}): SeasonPassPrice {
  return {
    sectionId: 'A',
    sectionName: 'A szektor',
    price: 30000,
    currency: 'HUF',
    seasonLabel: '2026/2027',
    ...over,
  };
}

describe('availabilityOf', () => {
  it('claims nothing without a free-seat count', () => {
    expect(availabilityOf(price())).toBe('unknown');
  });

  it('sold out at zero', () => {
    expect(availabilityOf(price({ freeSeats: 0, totalSeats: 200 }))).toBe('sold-out');
  });

  it('red at 10% of the sector or less', () => {
    expect(availabilityOf(price({ freeSeats: 20, totalSeats: 200 }))).toBe('nearly-gone');
    expect(availabilityOf(price({ freeSeats: 21, totalSeats: 200 }))).toBe('few');
  });

  it('red at 3 seats or fewer even in a small sector', () => {
    expect(availabilityOf(price({ freeSeats: 3, totalSeats: 24 }))).toBe('nearly-gone');
    expect(availabilityOf(price({ freeSeats: 4, totalSeats: 24 }))).toBe('few');
  });

  it('amber up to 30%, green above', () => {
    expect(availabilityOf(price({ freeSeats: 60, totalSeats: 200 }))).toBe('few');
    expect(availabilityOf(price({ freeSeats: 61, totalSeats: 200 }))).toBe('plenty');
  });
});

describe('mostPopularSectionId', () => {
  it('is the single sector with the most passes sold', () => {
    expect(
      mostPopularSectionId([
        price({ sectionId: 'A', passesSold: 4 }),
        price({ sectionId: 'B', passesSold: 9 }),
      ]),
    ).toBe('B');
  });

  it('is null on a tie, with nothing sold, or without the data', () => {
    expect(
      mostPopularSectionId([
        price({ sectionId: 'A', passesSold: 5 }),
        price({ sectionId: 'B', passesSold: 5 }),
      ]),
    ).toBeNull();
    expect(mostPopularSectionId([price({ passesSold: 0 })])).toBeNull();
    expect(mostPopularSectionId([price()])).toBeNull();
  });

  it('a tie below the leader does not matter', () => {
    expect(
      mostPopularSectionId([
        price({ sectionId: 'A', passesSold: 2 }),
        price({ sectionId: 'B', passesSold: 2 }),
        price({ sectionId: 'C', passesSold: 7 }),
      ]),
    ).toBe('C');
  });
});

describe('perMatchEquivalent', () => {
  it('divides the pass price by the matches it still covers', () => {
    expect(perMatchEquivalent(price({ price: 30000, upcomingHomeMatches: 15 }))).toBe(2000);
  });

  it('is null without a match count', () => {
    expect(perMatchEquivalent(price())).toBeNull();
    expect(perMatchEquivalent(price({ upcomingHomeMatches: 0 }))).toBeNull();
  });
});

describe('savingsFor', () => {
  it('reports the positive difference', () => {
    const s = savingsFor(price({ price: 30000, singleMatchTotal: 45000, upcomingHomeMatches: 10 }));
    expect(s).toEqual({ separate: 45000, pass: 30000, difference: 15000, matches: 10 });
  });

  it('shows no difference when the pass is not cheaper', () => {
    expect(savingsFor(price({ price: 30000, singleMatchTotal: 30000 })).difference).toBeNull();
    expect(savingsFor(price({ price: 30000, singleMatchTotal: 20000 })).difference).toBeNull();
  });

  it('shows no total and no difference when the total is unknown', () => {
    const s = savingsFor(price({ singleMatchTotal: null }));
    expect(s.separate).toBeNull();
    expect(s.difference).toBeNull();
  });
});

describe('panelSector', () => {
  const prices = [
    price({ sectionId: 'VIP', price: 45000 }),
    price({ sectionId: 'C', price: 20000 }),
    price({ sectionId: 'B', price: 25000 }),
  ];

  it('is the selected sector', () => {
    expect(panelSector(prices, 'B')?.sectionId).toBe('B');
  });

  it('falls back to the cheapest', () => {
    expect(panelSector(prices, null)?.sectionId).toBe('C');
  });

  it('is null without prices', () => {
    expect(panelSector([], null)).toBeNull();
  });
});
