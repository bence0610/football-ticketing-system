/**
 * Loyalty tier discount allocation (pure, no I/O).
 *
 * The discount is computed ONCE on the order subtotal, rounded exactly like
 * the frontend cart (`Math.round(subtotal * percent / 100)`), and then spread
 * over the individual lines so every ticket records what was really paid for
 * it. The spread is deterministic: floor of each line's proportional share,
 * then the leftover forints go one by one to the lines with the largest
 * fractional remainder (ties: earlier line first).
 *
 * Guarantees:
 *  - `discountTotal === Math.round(sum * percent / 100)`
 *  - `sum(discounts) === discountTotal`
 *  - `total === sum - discountTotal` and every discounted line is >= 0
 */
export interface DiscountAllocation {
  /** Discounted price per line, same order as the input. */
  readonly discounts: number[];
  /** Sum of the discounted lines. */
  readonly total: number;
  /** Forints taken off the subtotal. */
  readonly discountTotal: number;
}

/** Clamp an arbitrary value to a whole-number percent in 0..100 (invalid => 0). */
export function normalizeDiscountPercent(value: unknown): number {
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    n = Number(value);
  } else {
    return 0;
  }
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function allocateDiscount(prices: readonly number[], percent: number): DiscountAllocation {
  const lines = prices.map((p) => (Number.isFinite(p) && p > 0 ? Math.round(p) : 0));
  const sum = lines.reduce((acc, p) => acc + p, 0);
  const pct = normalizeDiscountPercent(percent);

  if (pct === 0 || sum === 0) {
    return { discounts: [...lines], total: sum, discountTotal: 0 };
  }

  const discountTotal = Math.round((sum * pct) / 100);

  // Integer arithmetic for the shares: line * discountTotal / sum.
  const cuts = lines.map((p) => Math.floor((p * discountTotal) / sum));
  const remainders = lines.map((p, i) => p * discountTotal - cuts[i] * sum);
  let leftover = discountTotal - cuts.reduce((acc, c) => acc + c, 0);

  const order = lines.map((_, i) => i).sort((a, b) => remainders[b] - remainders[a] || a - b);
  for (const i of order) {
    if (leftover <= 0) break;
    if (cuts[i] < lines[i]) {
      cuts[i] += 1;
      leftover -= 1;
    }
  }

  const discounts = lines.map((p, i) => p - cuts[i]);
  return { discounts, total: sum - discountTotal, discountTotal };
}
