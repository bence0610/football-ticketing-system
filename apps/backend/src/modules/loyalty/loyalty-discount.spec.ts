import {
  allocateDiscount,
  allocateLimitedDiscount,
  normalizeDiscountPercent,
} from './loyalty-discount';

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

describe('allocateDiscount', () => {
  it('leaves prices untouched at 0%', () => {
    expect(allocateDiscount([3000, 4500], 0)).toEqual({
      discounts: [3000, 4500],
      total: 7500,
      discountTotal: 0,
    });
  });

  it('discounts a single line by the rounded percent', () => {
    // 3333 * 5% = 166.65 -> 167
    expect(allocateDiscount([3333], 5)).toEqual({
      discounts: [3166],
      total: 3166,
      discountTotal: 167,
    });
  });

  it('rounds the discount on the subtotal exactly like the frontend cart', () => {
    const prices = [3500, 3500, 4999];
    const percent = 15;
    const result = allocateDiscount(prices, percent);
    expect(result.discountTotal).toBe(Math.round((sum(prices) * percent) / 100));
    expect(result.total).toBe(sum(prices) - result.discountTotal);
    expect(sum(result.discounts)).toBe(result.total);
  });

  it('hands out leftover forints by largest remainder, deterministically', () => {
    // sum 3, 10% -> round(0.3) = 0; use a case with real leftovers instead:
    // [1001, 1001, 1001] at 5% -> round(150.15) = 150, shares 50 each, no leftover
    expect(allocateDiscount([1001, 1001, 1001], 5).discounts).toEqual([951, 951, 951]);
    // [1000, 1000, 1001] at 10% -> round(300.1) = 300; shares 99.97, 99.97, 100.07
    // floors 99, 99, 100 = 298, two leftovers to the two .97 remainders (first lines)
    expect(allocateDiscount([1000, 1000, 1001], 10).discounts).toEqual([900, 900, 901]);
    // equal remainders: earlier line wins
    expect(allocateDiscount([5, 5], 10).discounts).toEqual([4, 5]);
  });

  it('is proportional: a bigger line gets a bigger cut', () => {
    const { discounts } = allocateDiscount([2000, 6000], 10);
    expect(discounts).toEqual([1800, 5400]);
  });

  it('never goes below zero, also at 100%', () => {
    expect(allocateDiscount([3000, 1], 100)).toEqual({
      discounts: [0, 0],
      total: 0,
      discountTotal: 3001,
    });
    expect(allocateDiscount([0, 3000], 15).discounts).toEqual([0, 2550]);
  });

  it('clamps out-of-range percents', () => {
    expect(allocateDiscount([1000], -5).discountTotal).toBe(0);
    expect(allocateDiscount([1000], 150).total).toBe(0);
    expect(allocateDiscount([1000], Number.NaN).total).toBe(1000);
  });

  it('handles an empty order', () => {
    expect(allocateDiscount([], 10)).toEqual({ discounts: [], total: 0, discountTotal: 0 });
  });

  it('always sums the lines to subtotal - discount (randomised)', () => {
    let seed = 42;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let run = 0; run < 500; run += 1) {
      const n = 1 + Math.floor(rand() * 8);
      const prices = Array.from({ length: n }, () => Math.floor(rand() * 20000));
      const percent = [0, 5, 10, 15, 33, 99, 100][Math.floor(rand() * 7)];
      const r = allocateDiscount(prices, percent);
      expect(r.discountTotal).toBe(Math.round((sum(prices) * percent) / 100));
      expect(sum(r.discounts)).toBe(sum(prices) - r.discountTotal);
      expect(r.total).toBe(sum(r.discounts));
      r.discounts.forEach((d, i) => {
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(prices[i]);
      });
    }
  });
});

describe('normalizeDiscountPercent', () => {
  it('parses metadata strings and falls back to 0', () => {
    expect(normalizeDiscountPercent('10')).toBe(10);
    expect(normalizeDiscountPercent(5)).toBe(5);
    expect(normalizeDiscountPercent(undefined)).toBe(0);
    expect(normalizeDiscountPercent('')).toBe(0);
    expect(normalizeDiscountPercent('abc')).toBe(0);
    expect(normalizeDiscountPercent('250')).toBe(100);
    expect(normalizeDiscountPercent('-3')).toBe(0);
  });
});

describe('allocateLimitedDiscount: the discount reaches only the first N tickets', () => {
  it('gives 4 tickets at 15% a discount on the first 2 only', () => {
    const r = allocateLimitedDiscount([3333, 3333, 3333, 3333], 15, 2);
    expect(r.discounted).toEqual([true, true, false, false]);
    expect(r.discountTotal).toBe(1000); // round(6,666 x 0.15)
    expect(r.discounts.slice(2)).toEqual([3333, 3333]);
    expect(r.discounts[0] + r.discounts[1]).toBe(6666 - 1000);
    expect(r.total).toBe(4 * 3333 - 1000);
    expect(r.discounts.reduce((a, b) => a + b, 0)).toBe(r.total);
  });

  it('is exactly the whole-order discount when the places cover every ticket', () => {
    const prices = [3333, 4999];
    expect(allocateLimitedDiscount(prices, 10, 2)).toMatchObject({
      discounts: allocateDiscount(prices, 10).discounts,
      total: allocateDiscount(prices, 10).total,
      discounted: [true, true],
    });
    expect(allocateLimitedDiscount(prices, 10, 5).discounted).toEqual([true, true]);
  });

  it('gives no discount when no place is left, or the percent is 0', () => {
    expect(allocateLimitedDiscount([3000, 3000], 15, 0)).toMatchObject({
      discounts: [3000, 3000],
      total: 6000,
      discountTotal: 0,
      discounted: [false, false],
    });
    expect(allocateLimitedDiscount([3000, 3000], 0, 2).discounted).toEqual([false, false]);
  });

  it('treats a negative or invalid place count as none', () => {
    expect(allocateLimitedDiscount([3000], 15, -3).discountTotal).toBe(0);
    expect(allocateLimitedDiscount([3000], 15, Number.NaN).discountTotal).toBe(0);
  });
});
