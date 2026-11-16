/**
 * Seeded random numbers for the demo data. The same seed always gives the same
 * accounts, seats and purchases, so two runs of the script produce the same history
 * (only the dates move, because they are relative to the day the script runs).
 */

/** Every id the demo script creates starts with this, so its rows can be found again. */
export const DEMO_ID_PREFIX = 'de300000';

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** 32-bit string hash (FNV-1a), used to derive independent streams from one seed. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** An independent stream: changing how one part of the data is drawn leaves the others alone. */
  fork(label: string): Rng {
    return new Rng(hashString(label) ^ this.state);
  }

  /** mulberry32: uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Whole number in [min, max], both included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  between(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Index drawn with probability proportional to `weights[i]` (all zero: uniform). */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w > 0 ? w : 0;
    if (total <= 0) return Math.floor(this.next() * weights.length);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i += 1) {
      const w = weights[i] > 0 ? weights[i] : 0;
      if (r < w) return i;
      r -= w;
    }
    return weights.length - 1;
  }

  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    return items[this.weightedIndex(items.map(weight))];
  }

  /** Normal distribution (Box-Muller). */
  normal(mean: number, sd: number): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Exponential with the given mean. */
  exponential(mean: number): number {
    return -Math.log(Math.max(this.next(), 1e-12)) * mean;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  private hex(length: number): string {
    let out = '';
    for (let i = 0; i < length; i += 1) out += Math.floor(this.next() * 16).toString(16);
    return out;
  }

  /** A version-4 shaped UUID that starts with {@link DEMO_ID_PREFIX}. */
  uuid(): string {
    const variant = '89ab'[Math.floor(this.next() * 4)];
    return `${DEMO_ID_PREFIX}-${this.hex(4)}-4${this.hex(3)}-${variant}${this.hex(3)}-${this.hex(12)}`;
  }

  /** URL-safe token, the same alphabet nanoid uses (invitation tokens, QR token ids). */
  token(length: number): string {
    let out = '';
    for (let i = 0; i < length; i += 1) {
      out += TOKEN_ALPHABET[Math.floor(this.next() * TOKEN_ALPHABET.length)];
    }
    return out;
  }
}
