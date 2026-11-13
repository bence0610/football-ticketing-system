import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ACCESSIBLE_PLACEHOLDER,
  AWAY_PRICE_MODIFIER,
  PRICE_MODIFIER,
  TIERS,
  TIER_LABEL,
  priceModifierFor,
  SEASON_PASS_TIER_PRICE,
  STADIUM_LAYOUT,
  sectorSeatCount,
  seasonPassSectors,
  seatCategoryFor,
  totalSeatCount,
} from './stadium-layout';

/**
 * Every figure below is written out by hand from the club's plan and from the
 * approved proposal, NOT computed with the layout's own helpers, so a typo in
 * the layout data cannot also be a typo in its test.
 */
describe('stadium layout', () => {
  const codes = (arc: 'upper' | 'lower'): string[] =>
    STADIUM_LAYOUT.filter((s) => s.arc === arc)
      .sort((a, b) => a.position - b.position)
      .map((s) => s.code);

  it('has the upper arc in plan order, west to east, and no ÁLLÓ / ÜLŐ sections', () => {
    expect(codes('upper')).toEqual(['D/1', 'D/2', 'C/1', 'C/2', 'B/1', 'B/2', 'A/1', 'A/2']);
    expect(STADIUM_LAYOUT.map((s) => s.code)).not.toEqual(
      expect.arrayContaining(['ÁLLÓ', 'ÜLŐ', 'ALLO', 'ULO']),
    );
  });

  it('has the lower arc in plan order, with VIP in the middle at the main building', () => {
    expect(codes('lower')).toEqual(['VENDÉG', 'N', 'M', 'L', 'K', 'J', 'VIP', 'H', 'G', 'F', 'E']);
  });

  it('has 19 sectors, with unique codes and a unique position on each arc', () => {
    expect(STADIUM_LAYOUT.length).toBe(19);
    expect(new Set(STADIUM_LAYOUT.map((s) => s.code)).size).toBe(19);
    expect(new Set(STADIUM_LAYOUT.map((s) => `${s.arc}-${s.position}`)).size).toBe(19);
    expect(codes('upper').length).toBe(8);
    expect(codes('lower').length).toBe(11);
  });

  it('is covered exactly where the club says: the whole upper arc and VIP, nothing else', () => {
    const covered = ['D/1', 'D/2', 'C/1', 'C/2', 'B/1', 'B/2', 'A/1', 'A/2', 'VIP'];
    const open = ['VENDÉG', 'N', 'M', 'L', 'K', 'J', 'H', 'G', 'F', 'E'];
    for (const code of covered) {
      expect(STADIUM_LAYOUT.find((s) => s.code === code)?.isCovered).toBe(true);
    }
    for (const code of open) {
      expect(STADIUM_LAYOUT.find((s) => s.code === code)?.isCovered).toBe(false);
    }
    expect(covered.length + open.length).toBe(19);
  });

  it('marks only VENDÉG as the away section', () => {
    expect(STADIUM_LAYOUT.filter((s) => s.isAway).map((s) => s.code)).toEqual(['VENDÉG']);
  });

  it('has the approved seat counts, 5,468 in all', () => {
    const expected: Record<string, number> = {
      'D/1': 216,
      'D/2': 308,
      'C/1': 384,
      'C/2': 448,
      'B/1': 448,
      'B/2': 384,
      'A/1': 308,
      'A/2': 216,
      VENDÉG: 280,
      N: 192,
      M: 234,
      L: 280,
      K: 280,
      J: 280,
      VIP: 224,
      H: 280,
      G: 280,
      F: 234,
      E: 192,
    };
    for (const s of STADIUM_LAYOUT) {
      expect(sectorSeatCount(s)).toBe(expected[s.code]);
    }
    expect(totalSeatCount()).toBe(5468);
    const upper = STADIUM_LAYOUT.filter((s) => s.arc === 'upper');
    expect(upper.reduce((n, s) => n + sectorSeatCount(s), 0)).toBe(2712);
  });

  it("makes the sectors beside each arc's halfway line larger than the corners", () => {
    const size = (code: string): number =>
      sectorSeatCount(STADIUM_LAYOUT.find((s) => s.code === code)!);
    expect(size('C/2')).toBeGreaterThan(size('D/1'));
    expect(size('B/1')).toBeGreaterThan(size('A/2'));
    expect(size('J')).toBeGreaterThan(size('N'));
    expect(size('H')).toBeGreaterThan(size('E'));
    expect(Math.max(...STADIUM_LAYOUT.map((s) => s.rows))).toBeLessThanOrEqual(16);
  });

  it('assigns the gates from the plan, and the whole western half goes through gate 2', () => {
    const gate = (n: number): string[] =>
      STADIUM_LAYOUT.filter((s) => s.gate === n)
        .map((s) => s.code)
        .sort();
    expect(gate(1)).toEqual(['E', 'F', 'G', 'H', 'VIP']);
    expect(gate(2)).toEqual(['C/1', 'C/2', 'D/1', 'D/2', 'J', 'K', 'L', 'M', 'N']);
    expect(gate(3)).toEqual(['VENDÉG']);
    expect(gate(4)).toEqual(['A/1', 'A/2', 'B/1', 'B/2']);
    const load = (n: number): number =>
      STADIUM_LAYOUT.filter((s) => s.gate === n).reduce((sum, s) => sum + sectorSeatCount(s), 0);
    expect([load(1), load(2), load(3), load(4)]).toEqual([1210, 2622, 280, 1356]);
  });

  it('prices in three tiers: the whole upper arc, the whole lower arc, VIP; the away section has none', () => {
    const tier = (t: string | null): string[] =>
      STADIUM_LAYOUT.filter((s) => s.priceCategory === t)
        .map((s) => s.code)
        .sort();
    expect(tier('vip')).toEqual(['VIP']);
    expect(tier('upper')).toEqual(['A/1', 'A/2', 'B/1', 'B/2', 'C/1', 'C/2', 'D/1', 'D/2']);
    expect(tier('lower')).toEqual(['E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N']);
    expect(tier(null)).toEqual(['VENDÉG']);
    expect(new Set(STADIUM_LAYOUT.map((s) => s.priceCategory))).toEqual(
      new Set(['vip', 'upper', 'lower', null]),
    );
    const seats = (t: string): number =>
      STADIUM_LAYOUT.filter((s) => s.priceCategory === t).reduce(
        (sum, s) => sum + sectorSeatCount(s),
        0,
      );
    expect([seats('vip'), seats('lower'), seats('upper')]).toEqual([224, 2252, 2712]);
  });

  it('prices the upper arc below the lower arc, and VIP above both', () => {
    // Written out, not derived: the covered upper arc is the cheaper side in Kecskemét.
    expect(PRICE_MODIFIER).toEqual({ vip: '2.50', lower: '1.40', upper: '1.00' });
    expect(Number(PRICE_MODIFIER.upper)).toBeLessThan(Number(PRICE_MODIFIER.lower));
    expect(Number(PRICE_MODIFIER.lower)).toBeLessThan(Number(PRICE_MODIFIER.vip));
    expect(priceModifierFor(null)).toBe(AWAY_PRICE_MODIFIER);
  });

  it('keeps only VIP as a seat category of its own', () => {
    expect(seatCategoryFor('vip')).toBe('vip');
    expect(seatCategoryFor('lower')).toBe('standard');
    expect(seatCategoryFor('upper')).toBe('standard');
    expect(seatCategoryFor(null)).toBe('standard');
  });

  it('sells season passes for the 18 sellable sectors in three tiers, never for the away section', () => {
    expect(seasonPassSectors().length).toBe(18);
    expect(seasonPassSectors().map((s) => s.code)).not.toContain('VENDÉG');
    expect(SEASON_PASS_TIER_PRICE).toEqual({ vip: 45000, lower: 30000, upper: 22000 });
    expect(SEASON_PASS_TIER_PRICE.upper).toBeLessThan(SEASON_PASS_TIER_PRICE.lower);
    expect(SEASON_PASS_TIER_PRICE.lower).toBeLessThan(SEASON_PASS_TIER_PRICE.vip);
    expect(TIERS).toEqual(['vip', 'lower', 'upper']);
    expect(TIER_LABEL).toEqual({ vip: 'VIP', lower: 'Alsó ív', upper: 'Felső ív' });
  });

  it('reserves the accessible seats where the plan puts them (placeholder, to be confirmed)', () => {
    expect(ACCESSIBLE_PLACEHOLDER).toEqual(['1']);
    expect(
      STADIUM_LAYOUT.filter((s) => s.accessibleRows?.length)
        .map((s) => s.code)
        .sort(),
    ).toEqual(['A/2', 'E', 'F']);
  });

  describe('the migrations', () => {
    const layoutSource = readFileSync(
      join(__dirname, 'migrations', '1715400000000-StadiumLayout.ts'),
      'utf8',
    );
    const rows = [
      ...layoutSource.matchAll(
        /\(UUID\(\), '([^']+)',\s+'([^']+)',\s+(\d), '(upper|lower)', (\d+),\s+(\d), '(\w+)',\s+(\d)\)/g,
      ),
    ].map(([, code, name, covered, arc, position, gate, , away]) => ({
      code,
      name,
      isCovered: covered === '1',
      arc,
      position: Number(position),
      gate: Number(gate),
      isAway: away === '1',
    }));

    it('writes out exactly the sectors of the layout file, field by field (tier aside)', () => {
      expect(rows.length).toBe(19);
      for (const layout of STADIUM_LAYOUT) {
        expect(rows.find((r) => r.code === layout.code)).toEqual({
          code: layout.code,
          name: layout.name,
          isCovered: layout.isCovered,
          arc: layout.arc,
          position: layout.position,
          gate: layout.gate,
          isAway: layout.isAway,
        });
      }
    });

    it('the three-tier migration derives the tier the layout file states', () => {
      // The SQL sits in template literals, so its backticks are escaped in the file.
      const source = readFileSync(
        join(__dirname, 'migrations', '1715500000000-ThreePriceTiers.ts'),
        'utf8',
      ).replace(/\\`/g, '`');
      // The rule it writes: away -> NULL, VIP -> vip, upper arc -> upper, else lower.
      expect(source).toContain("WHEN `is_away` = 1 THEN NULL");
      expect(source).toContain("WHEN `code` = 'VIP' THEN 'vip'");
      expect(source).toContain("WHEN `arc` = 'upper' THEN 'upper'");
      const derive = (s: { code: string; arc: string; isAway: boolean }): string | null =>
        s.isAway ? null : s.code === 'VIP' ? 'vip' : s.arc === 'upper' ? 'upper' : 'lower';
      for (const layout of STADIUM_LAYOUT) {
        expect(derive(layout)).toBe(layout.priceCategory);
      }
      // The modifiers it writes onto the seats are the layout file's.
      expect(source).toContain(`WHEN 'vip' THEN ${PRICE_MODIFIER.vip}`);
      expect(source).toContain(`WHEN 'lower' THEN ${PRICE_MODIFIER.lower}`);
      expect(source).toContain(`WHEN 'upper' THEN ${PRICE_MODIFIER.upper}`);
    });
  });
});
