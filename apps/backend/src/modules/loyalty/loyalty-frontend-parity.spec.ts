import { readFileSync } from 'fs';
import { join } from 'path';
import { TIER_DEFINITIONS } from './loyalty.constants';

/**
 * The frontend cannot import loyalty.constants.ts (it drags in TypeORM
 * entities), so it keeps a mirror of the tier labels. This pins that mirror to
 * the backend source of truth, so a rename fails here instead of silently
 * leaving the UI behind. (A second check used to pin the Playwright loyalty
 * mocks' thresholds; those mocks were removed with the loyalty e2e spec.)
 */
const FRONTEND = join(__dirname, '../../../../frontend');
const read = (rel: string): string => readFileSync(join(FRONTEND, rel), 'utf-8');

describe('loyalty tiers: frontend mirror matches loyalty.constants', () => {
  it('frontend TIER_LABELS equal the backend tier labels', () => {
    const src = read('src/app/core/models/loyalty.models.ts');
    const block = /export const TIER_LABELS[^{]*\{([^}]*)\}/.exec(src)?.[1] ?? '';
    const labels = Object.fromEntries(
      [...block.matchAll(/(\w+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]),
    );
    expect(Object.keys(labels)).toHaveLength(TIER_DEFINITIONS.length);
    for (const def of TIER_DEFINITIONS) {
      expect(labels[def.tier]).toBe(def.label);
    }
  });
});
