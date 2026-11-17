import { LoyaltyTier } from '../../database/entities';
import loyaltyConfig from '../../config/loyalty.config';
import {
  seasonEndYear,
  tierAfterAward,
  tierAtSeasonEnd,
  tierKeptUntil,
  StoredTier,
} from './loyalty-tier-keeping';

const D = (iso: string): Date => new Date(iso);

describe('seasons', () => {
  it('a season runs 1 July to 30 June', () => {
    expect(seasonEndYear(D('2026-07-01T00:00:00Z'))).toBe(2027);
    expect(seasonEndYear(D('2027-06-30T12:00:00Z'))).toBe(2027);
    expect(seasonEndYear(D('2026-11-20T12:00:00Z'))).toBe(2027);
    expect(seasonEndYear(D('2027-01-05T12:00:00Z'))).toBe(2027);
  });

  it('a tier reached in a season is kept until the end of the NEXT season', () => {
    expect(tierKeptUntil(D('2026-11-20T12:00:00Z')).toISOString().slice(0, 10)).toBe('2028-06-30');
    expect(tierKeptUntil(D('2027-06-29T12:00:00Z')).toISOString().slice(0, 10)).toBe('2028-06-30');
    expect(tierKeptUntil(D('2027-07-02T12:00:00Z')).toISOString().slice(0, 10)).toBe('2029-06-30');
  });
});

describe('the carryover keeps 70% by default', () => {
  it('LOYALTY_CARRYOVER_PERCENT defaults to 70', () => {
    const saved = process.env.LOYALTY_CARRYOVER_PERCENT;
    delete process.env.LOYALTY_CARRYOVER_PERCENT;
    try {
      expect(loyaltyConfig().carryoverPercent).toBe(70);
    } finally {
      if (saved !== undefined) process.env.LOYALTY_CARRYOVER_PERCENT = saved;
    }
  });
});

describe('tierAfterAward: an award raises the tier, never lowers it', () => {
  const now = D('2026-11-20T12:00:00Z');
  const bronze: StoredTier = { tier: LoyaltyTier.BRONZE, reachedAt: null };

  it('stamps the moment a higher tier is reached', () => {
    expect(tierAfterAward(bronze, 520, now)).toEqual({
      tier: LoyaltyTier.SILVER,
      reachedAt: now,
      upgraded: true,
    });
  });

  it('leaves the tier and its stamp alone when the points do not reach a higher one', () => {
    const silver: StoredTier = { tier: LoyaltyTier.SILVER, reachedAt: D('2026-08-01T00:00:00Z') };
    expect(tierAfterAward(silver, 900, now)).toEqual({ ...silver, upgraded: false });
  });

  it('does not lower a kept tier when the points are below it', () => {
    const legenda: StoredTier = {
      tier: LoyaltyTier.PLATINUM,
      reachedAt: D('2026-11-01T00:00:00Z'),
    };
    expect(tierAfterAward(legenda, 2165, now).tier).toBe(LoyaltyTier.PLATINUM);
  });
});

describe('tierAtSeasonEnd: the 30 June decision', () => {
  const at = D('2027-06-30T01:00:00Z');
  const legenda = (reachedAt: Date | null): StoredTier => ({
    tier: LoyaltyTier.PLATINUM,
    reachedAt,
  });
  const keep = (points: number): number => points - Math.floor((points * 30) / 100);

  it('a Legenda fan whose points fall to 2,165 after the carryover stays Legenda', () => {
    expect(keep(3092)).toBe(2165); // 70% of 3,092, the 30% rounded down
    const out = tierAtSeasonEnd({
      ...legenda(D('2026-11-20T12:00:00Z')),
      pointsBefore: 3092,
      pointsAfter: 2165,
      year: 2027,
      at,
    });
    expect(out.tier).toBe(LoyaltyTier.PLATINUM);
    expect(out.reachedAt).not.toBeNull();
  });

  it('a tier reached this season is kept even if the balance before did not reach it (stamped, not re-earned)', () => {
    const out = tierAtSeasonEnd({
      ...legenda(D('2027-03-01T00:00:00Z')),
      pointsBefore: 2400, // did not reach the 2,500 of Legenda this season
      pointsAfter: 1680,
      year: 2027,
      at,
    });
    expect(out.tier).toBe(LoyaltyTier.PLATINUM);
    expect(out.reachedAt).toEqual(D('2027-03-01T00:00:00Z'));
  });

  it('it lasts through the NEXT season: the conversion after that drops it to what the points give', () => {
    // Reached in 2026/27, kept at the 2027 conversion, not earned again in 2027/28.
    const kept = tierAtSeasonEnd({
      ...legenda(D('2026-11-20T12:00:00Z')),
      pointsBefore: 3092,
      pointsAfter: 2165,
      year: 2027,
      at,
    });
    const at2 = D('2028-06-30T01:00:00Z');
    const out = tierAtSeasonEnd({
      ...kept,
      pointsBefore: 2165 + 135, // a quiet season: 2,300, still under 2,500
      pointsAfter: keep(2300),
      year: 2028,
      at: at2,
    });
    expect(keep(2300)).toBe(1610);
    expect(out).toEqual({ tier: LoyaltyTier.GOLD, reachedAt: null });
  });

  it('a tier earned again in the later season is kept for another year', () => {
    const out = tierAtSeasonEnd({
      ...legenda(D('2026-11-20T12:00:00Z')),
      pointsBefore: 3300, // back over 2,500 during 2027/28
      pointsAfter: keep(3300),
      year: 2028,
      at: D('2028-06-30T01:00:00Z'),
    });
    expect(out.tier).toBe(LoyaltyTier.PLATINUM);
    expect(seasonEndYear(out.reachedAt as Date)).toBe(2028);
  });

  it('nothing changes when the points after the conversion still reach the tier', () => {
    const silver: StoredTier = { tier: LoyaltyTier.SILVER, reachedAt: D('2026-09-01T00:00:00Z') };
    expect(
      tierAtSeasonEnd({ ...silver, pointsBefore: 1000, pointsAfter: 700, year: 2027, at }),
    ).toEqual(silver);
  });

  it('a tier held by points alone (no stamp) that the points no longer reach falls', () => {
    const out = tierAtSeasonEnd({
      tier: LoyaltyTier.GOLD,
      reachedAt: null,
      pointsBefore: 900, // did not support Arany (1,000) before either
      pointsAfter: 630,
      year: 2027,
      at,
    });
    expect(out).toEqual({ tier: LoyaltyTier.SILVER, reachedAt: null });
  });
});

/**
 * Loyalty measures attendance: 50 points the first time a person enters a match, once per match.
 * Per season, a pass is worth 500 on top; the first season also has the registration and the
 * profile (150). At 30 June 30% of the balance expires.
 */
describe('simulation: how long it takes to reach a tier by attending', () => {
  const config = { registration: 100, profile: 50, pass: 500, perMatch: 50 };
  const carryoverPercent = 70;

  function simulate(opts: { pass: boolean; matchesPerSeason: number; seasons: number }) {
    let points = 0;
    let state: StoredTier = { tier: LoyaltyTier.BRONZE, reachedAt: null };
    const reached: Array<{ season: number; tier: LoyaltyTier }> = [];
    const peaks: number[] = [];
    const earn = (amount: number, season: number, when: Date): void => {
      points += amount;
      const after = tierAfterAward(state, points, when);
      if (after.upgraded) reached.push({ season, tier: after.tier });
      state = { tier: after.tier, reachedAt: after.reachedAt };
    };
    for (let season = 1; season <= opts.seasons; season += 1) {
      const startYear = 2025 + season; // season 1 = 2026/27
      if (season === 1) {
        earn(config.registration + config.profile, season, D(`${startYear}-07-05T10:00:00Z`));
      }
      if (opts.pass) earn(config.pass, season, D(`${startYear}-07-10T10:00:00Z`));
      for (let m = 0; m < opts.matchesPerSeason; m += 1) {
        // the matches are spread over the season, August to May; each earns once
        const when = new Date(Date.UTC(startYear, 7 + Math.floor(m * 0.6), 10 + (m % 18)));
        earn(config.perMatch, season, when);
      }
      const before = points;
      peaks.push(before);
      const expiring = Math.floor((before * (100 - carryoverPercent)) / 100);
      points -= expiring;
      state = tierAtSeasonEnd({
        ...state,
        pointsBefore: before,
        pointsAfter: points,
        year: startYear + 1,
        at: D(`${startYear + 1}-06-30T01:00:00Z`),
      });
    }
    return { reached, state, points, peaks };
  }

  describe('a pass holder with one extra cup ticket who attends 13 of 15 home matches', () => {
    // 13 league matches and the cup tie: 14 entries a season, 500 for the pass.
    const run = (seasons: number) => simulate({ pass: true, matchesPerSeason: 14, seasons });
    const seasonOf = (seasons: number, tier: LoyaltyTier) =>
      run(seasons).reached.find((r) => r.tier === tier)?.season;

    it('reaches Ezüst in the first season, Arany in the first season, KTE Legenda in the third', () => {
      expect(seasonOf(4, LoyaltyTier.SILVER)).toBe(1); // at the pass purchase: 150 + 500
      expect(seasonOf(4, LoyaltyTier.GOLD)).toBe(1); // 1,000 points at the 7th match
      expect(seasonOf(4, LoyaltyTier.PLATINUM)).toBe(3); // 2,502 points at the 10th match
    });

    it('balances before the conversions: 1,350, 2,145, 2,702, 3,092', () => {
      expect(run(4).peaks).toEqual([1350, 2145, 2702, 3092]);
    });

    it('is not Legenda in the first two seasons', () => {
      const { reached } = run(2);
      expect(reached.map((r) => r.tier)).toEqual([LoyaltyTier.SILVER, LoyaltyTier.GOLD]);
    });

    it('keeps the tier it reached through the next season', () => {
      expect(run(5).state.tier).toBe(LoyaltyTier.PLATINUM);
    });
  });

  describe('a fan without a pass who attends all 15 home matches with tickets', () => {
    const run = (seasons: number) => simulate({ pass: false, matchesPerSeason: 15, seasons });

    it('reaches Ezüst in the first season (3rd match) and Arany in the second (8th match)', () => {
      const { reached } = run(30);
      expect(reached.find((r) => r.tier === LoyaltyTier.SILVER)?.season).toBe(1);
      expect(reached.find((r) => r.tier === LoyaltyTier.GOLD)?.season).toBe(2);
    });

    it('settles at Arany: the yearly peak creeps towards 2,500 and gets there only in season 20', () => {
      // 750 a season against 30% lost each year converges on exactly 2,500 (the rounding of the
      // conversion decides the last point): for twenty years the fan is Arany.
      const { reached, peaks } = run(19);
      expect(reached.some((r) => r.tier === LoyaltyTier.PLATINUM)).toBe(false);
      expect(Math.max(...peaks)).toBeLessThan(2500);
      expect(peaks[peaks.length - 1]).toBeGreaterThan(2400);
      expect(run(20).reached.find((r) => r.tier === LoyaltyTier.PLATINUM)?.season).toBe(20);
    });
  });

  it('with the old 50% carryover, and points for buying, the same pass fan never got there', () => {
    // 550 per season (pass + ticket) with half lost every year: the balance peaks near 1,100.
    let points = 150;
    let peak = 0;
    for (let season = 1; season <= 20; season += 1) {
      points += 550;
      peak = Math.max(peak, points);
      points -= Math.floor(points / 2);
    }
    expect(peak).toBeLessThan(1200);
    expect(peak).toBeGreaterThan(1000);
  });
});
