import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SeasonPassesService } from './season-passes.service';
import { STRIPE_CLIENT } from '../payments/stripe.provider';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { SeasonPassHoldService } from '../../redis/season-pass-hold.service';
import { EmailService } from '../email/email.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { QrService } from '../qr/qr.service';
import { TicketRendererService } from '../tickets/ticket-renderer.service';
import {
  Match,
  MatchStatus,
  PassLoan,
  SeasonPass,
  SeasonPassPrice,
  User,
} from '../../database/entities';

const DAY = 24 * 60 * 60 * 1000;

function priceRow(section: string, price: number): SeasonPassPrice {
  return {
    id: `price-${section}`,
    section,
    sectionLabel: `${section} szektor`,
    seasonLabel: '2026/2027',
    price,
    currency: 'HUF',
    isActive: true,
    validFrom: new Date('2026-07-01T00:00:00.000Z'),
    validUntil: new Date('2027-06-30T00:00:00.000Z'),
  } as unknown as SeasonPassPrice;
}

function match(id: string, homeTeam: string, offsetDays: number, basePrice: string): Match {
  return {
    id,
    homeTeam,
    awayTeam: id,
    kickoffAt: new Date(Date.now() + offsetDays * DAY),
    basePrice,
    status: MatchStatus.ON_SALE,
    isSeasonPassEligible: true,
  } as unknown as Match;
}

describe('SeasonPassesService – price list and season overview', () => {
  let service: SeasonPassesService;
  const priceRepo = { find: jest.fn(), findOne: jest.fn() };
  const matchRepo = { find: jest.fn() };
  const dataSource = { query: jest.fn(), transaction: jest.fn(), getRepository: jest.fn() };
  const holds = { heldSeatIds: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SeasonPassesService,
        { provide: getRepositoryToken(PassLoan), useValue: {} },
        { provide: getRepositoryToken(SeasonPass), useValue: {} },
        { provide: getRepositoryToken(SeasonPassPrice), useValue: priceRepo },
        { provide: getRepositoryToken(Match), useValue: matchRepo },
        { provide: getRepositoryToken(User), useValue: {} },
        { provide: DataSource, useValue: dataSource },
        { provide: STRIPE_CLIENT, useValue: {} },
        { provide: REDIS_CLIENT, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: SeasonPassHoldService, useValue: holds },
        { provide: LoyaltyService, useValue: {} },
        { provide: QrService, useValue: {} },
        { provide: TicketRendererService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) =>
              ({
                stripe: { currency: 'HUF' },
                loyalty: { seasonPassPoints: 640 },
                mail: {},
                cron: {},
                app: { homeTeamName: 'KTE FC' },
              })[key],
          },
        },
      ],
    }).compile();
    service = module.get(SeasonPassesService);
  });

  /** Sector rows as the `sectors` table holds them (the columns loadSectorFacts reads). */
  const SECTORS = [
    {
      code: 'D/1',
      name: 'D/1 szektor',
      covered: 1,
      arc: 'upper',
      position: 1,
      gate: 2,
      priceCategory: 'upper',
      isAway: 0,
    },
    {
      code: 'A/2',
      name: 'A/2 szektor',
      covered: 1,
      arc: 'upper',
      position: 8,
      gate: 4,
      priceCategory: 'upper',
      isAway: 0,
    },
    {
      code: 'VENDÉG',
      name: 'Vendég szektor',
      covered: 0,
      arc: 'lower',
      position: 1,
      gate: 3,
      priceCategory: null,
      isAway: 1,
    },
    {
      code: 'K',
      name: 'K szektor',
      covered: 0,
      arc: 'lower',
      position: 5,
      gate: 2,
      priceCategory: 'lower',
      isAway: 0,
    },
    {
      code: 'F',
      name: 'F szektor',
      covered: 0,
      arc: 'lower',
      position: 10,
      gate: 1,
      priceCategory: 'lower',
      isAway: 0,
    },
    {
      code: 'VIP',
      name: 'VIP',
      covered: 1,
      arc: 'lower',
      position: 7,
      gate: 1,
      priceCategory: 'vip',
      isAway: 0,
    },
  ];

  function stubTiers(opts: {
    stats?: Array<{ section: string; total: number; free: number; minMod: string; maxMod: string }>;
    sold?: Array<{ section: string; sold: number }>;
    sectors?: typeof SECTORS;
  }): void {
    dataSource.query.mockImplementation((sql: string) => {
      if (sql.includes('GROUP BY s.section') && sql.includes('MIN(s.price_modifier)')) {
        return Promise.resolve(opts.stats ?? []);
      }
      if (sql.includes('FROM season_passes sp')) return Promise.resolve(opts.sold ?? []);
      if (sql.includes('FROM sectors')) return Promise.resolve(opts.sectors ?? SECTORS);
      return Promise.reject(new Error(`unexpected SQL: ${sql}`));
    });
  }

  const tierPrice = (tier: string, price: number): SeasonPassPrice => ({
    ...priceRow(tier, price),
    sectionLabel: { vip: 'VIP', lower: 'Alsó ív', upper: 'Felső ív' }[tier] as string,
  });

  it('lists three options, dearest first, however many sectors there are', async () => {
    priceRepo.find.mockResolvedValue([
      tierPrice('upper', 22000),
      tierPrice('vip', 45000),
      tierPrice('lower', 30000),
    ]);
    matchRepo.find.mockResolvedValue([]);
    stubTiers({});

    const list = await service.listPrices();

    expect(list.map((p) => [p.sectionId, p.sectionName, p.price])).toEqual([
      ['vip', 'VIP', 45000],
      ['lower', 'Alsó ív', 30000],
      ['upper', 'Felső ív', 22000],
    ]);
    expect(list.map((p) => p.priceCategory)).toEqual(['vip', 'lower', 'upper']);
  });

  it('adds up the seats of every sector of a tier, and never counts the away section', async () => {
    priceRepo.find.mockResolvedValue([tierPrice('lower', 30000)]);
    matchRepo.find.mockResolvedValue([]);
    stubTiers({
      stats: [
        { section: 'K', total: 280, free: 100, minMod: '1.40', maxMod: '1.40' },
        { section: 'F', total: 234, free: 34, minMod: '1.40', maxMod: '1.40' },
        { section: 'VENDÉG', total: 280, free: 280, minMod: '1.00', maxMod: '1.00' },
        { section: 'D/1', total: 216, free: 216, minMod: '1.00', maxMod: '1.00' },
      ],
      sold: [
        { section: 'K', sold: 3 },
        { section: 'F', sold: 4 },
        { section: 'D/1', sold: 9 },
      ],
    });

    const [lower] = await service.listPrices();

    expect(lower.totalSeats).toBe(514);
    expect(lower.freeSeats).toBe(134);
    expect(lower.passesSold).toBe(7);
  });

  it('sums the single-match price of the upcoming home fixtures at the tier modifier', async () => {
    priceRepo.find.mockResolvedValue([tierPrice('lower', 30000)]);
    matchRepo.find.mockResolvedValue([
      match('played', 'KTE FC', -10, '3000.00'), // already played: not counted
      match('m1', 'KTE FC', 5, '3000.00'),
      match('m2', 'KTE FC', 12, '4000.00'),
      match('away', 'Újpest FC', 8, '9000.00'), // not ours: not counted
    ]);
    stubTiers({
      stats: [
        { section: 'K', total: 280, free: 100, minMod: '1.40', maxMod: '1.40' },
        { section: 'F', total: 234, free: 34, minMod: '1.40', maxMod: '1.40' },
      ],
    });

    const [lower] = await service.listPrices();

    expect(lower.upcomingHomeMatches).toBe(2);
    // round(3000*1.4) + round(4000*1.4)
    expect(lower.singleMatchTotal).toBe(4200 + 5600);
  });

  it('refuses to invent a total when the seats of a tier have different price modifiers', async () => {
    priceRepo.find.mockResolvedValue([tierPrice('lower', 30000)]);
    matchRepo.find.mockResolvedValue([match('m1', 'KTE FC', 5, '3000.00')]);
    stubTiers({
      stats: [
        { section: 'K', total: 280, free: 100, minMod: '1.40', maxMod: '1.40' },
        { section: 'F', total: 234, free: 34, minMod: '1.00', maxMod: '1.00' },
      ],
    });
    expect((await service.listPrices())[0].singleMatchTotal).toBeNull();

    stubTiers({
      stats: [{ section: 'K', total: 280, free: 100, minMod: '1.00', maxMod: '1.40' }],
    });
    expect((await service.listPrices())[0].singleMatchTotal).toBeNull();
  });

  it('has no single-match total when no home match is left', async () => {
    priceRepo.find.mockResolvedValue([tierPrice('upper', 22000)]);
    matchRepo.find.mockResolvedValue([match('played', 'KTE FC', -3, '3000.00')]);
    stubTiers({
      stats: [{ section: 'D/1', total: 216, free: 40, minMod: '1.00', maxMod: '1.00' }],
    });

    const [upper] = await service.listPrices();

    expect(upper.upcomingHomeMatches).toBe(0);
    expect(upper.singleMatchTotal).toBeNull();
  });

  it('reports a tier without any seat as sold out', async () => {
    priceRepo.find.mockResolvedValue([tierPrice('upper', 22000)]);
    matchRepo.find.mockResolvedValue([]);
    stubTiers({ stats: [] });

    const [upper] = await service.listPrices();

    expect(upper.freeSeats).toBe(0);
    expect(upper.totalSeats).toBe(0);
  });

  it('has no price for the away section: a row keyed by a sector code is ignored', async () => {
    priceRepo.find.mockResolvedValue([
      priceRow('VENDÉG', 25000), // never created, but must not be listed if it were
      priceRow('K', 25000), // an old per-sector row left behind
      tierPrice('vip', 45000),
    ]);
    matchRepo.find.mockResolvedValue([]);
    stubTiers({});

    const list = await service.listPrices();

    expect(list.map((p) => p.sectionId)).toEqual(['vip']);
  });

  it('carries coverage, arc and gate of the tier only where all its sectors agree', async () => {
    priceRepo.find.mockResolvedValue([
      tierPrice('upper', 22000),
      tierPrice('lower', 30000),
      tierPrice('vip', 45000),
    ]);
    matchRepo.find.mockResolvedValue([]);
    stubTiers({});

    const list = await service.listPrices();
    const by = Object.fromEntries(list.map((p) => [p.sectionId, p]));

    // the whole upper arc is covered, but D/1 and A/2 use different gates
    expect(by.upper).toMatchObject({ isCovered: true, arc: 'upper', gate: null, position: null });
    // lower: open to the weather and two gates; the away section and VIP are not in it
    expect(by.lower).toMatchObject({ isCovered: false, arc: 'lower', gate: null });
    expect(by.vip).toMatchObject({ isCovered: true, arc: 'lower', gate: 1 });
  });

  it('carries the number of active passes sold in the tier', async () => {
    priceRepo.find.mockResolvedValue([tierPrice('vip', 45000)]);
    matchRepo.find.mockResolvedValue([]);
    stubTiers({
      stats: [{ section: 'VIP', total: 224, free: 217, minMod: '2.50', maxMod: '2.50' }],
      sold: [{ section: 'VIP', sold: 7 }],
    });

    const [vip] = await service.listPrices();

    expect(vip.passesSold).toBe(7);
    expect(vip.freeSeats).toBe(217);
  });

  describe('season seat rule (map, counts)', () => {
    /** A seat row as PASS_SEAT_SELECT_SQL returns it. */
    const seatRow = (
      id: string,
      row: string,
      number: number,
      opts: { free?: 0 | 1; taken?: 0 | 1; ticketed?: 0 | 1; isActive?: 0 | 1 } = {},
    ) => ({
      id,
      section: 'D/1',
      row,
      number,
      category: 'standard',
      isAccessible: 0,
      isActive: opts.isActive ?? 1,
      sectorCode: 'D/1',
      isAway: 0,
      tier: 'upper',
      free: opts.free ?? 1,
      taken: opts.taken ?? 0,
      ticketed: opts.ticketed ?? 0,
    });

    function stubMap(rows: ReturnType<typeof seatRow>[]): void {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('WHERE s.section = ?')) return Promise.resolve(rows);
        if (sql.includes('FROM sectors')) return Promise.resolve(SECTORS);
        return Promise.reject(new Error(`unexpected SQL: ${sql}`));
      });
    }

    it('the free count excludes seats ticketed for an UPCOMING match of the season, and only those', async () => {
      priceRepo.find.mockResolvedValue([tierPrice('upper', 22000)]);
      matchRepo.find.mockResolvedValue([]);
      stubTiers({
        stats: [{ section: 'D/1', total: 216, free: 216, minMod: '1.00', maxMod: '1.00' }],
      });

      const [upper] = await service.listPrices();

      const statsSql = (dataSource.query.mock.calls as Array<[string]>)
        .map(([sql]) => sql)
        .find((sql) => sql.includes('MIN(s.price_modifier)'))!;
      // a ticket (any status) for a pass-eligible, uncancelled match that kicks off after now
      // and before the season's end blocks; a match already played does not
      expect(statsSql).toMatch(/FROM tickets t JOIN matches m/);
      expect(statsSql).toContain('m.kickoff_at > NOW()');
      expect(statsSql).toContain('m.kickoff_at < (SELECT DATE_ADD(MAX(spp.valid_until)');
      expect(statsSql).not.toMatch(/t\.status/);
      // any season_passes row of the season blocks, whatever its status: no status filter
      expect(statsSql).toContain('sp.season_label = ?');
      expect(statsSql).not.toMatch(/sp\.status/);
      expect(statsSql).toContain('c.is_away = 0');
      expect(upper.freeSeats).toBe(216);
    });

    it('each tier carries its sectors in stadium order, away excluded, with name/arc/position/gate/covered/total/freeSeats', async () => {
      priceRepo.find.mockResolvedValue([tierPrice('lower', 30000)]);
      matchRepo.find.mockResolvedValue([]);
      stubTiers({
        stats: [
          { section: 'F', total: 234, free: 34, minMod: '1.40', maxMod: '1.40' },
          { section: 'K', total: 280, free: 100, minMod: '1.40', maxMod: '1.40' },
          { section: 'VENDÉG', total: 280, free: 0, minMod: '1.00', maxMod: '1.00' },
        ],
      });

      const [lower] = await service.listPrices();

      expect(lower.sectors).toEqual([
        { section: 'K', name: 'K szektor', arc: 'lower', position: 5, gate: 2, covered: false, total: 280, freeSeats: 100 },
        { section: 'F', name: 'F szektor', arc: 'lower', position: 10, gate: 1, covered: false, total: 234, freeSeats: 34 },
      ]);
    });

    it('GET tiers/:tier/sectors returns the same list with the tier price', async () => {
      priceRepo.findOne.mockResolvedValue(tierPrice('upper', 22000));
      stubTiers({
        stats: [
          { section: 'A/2', total: 200, free: 5, minMod: '1.00', maxMod: '1.00' },
          { section: 'D/1', total: 216, free: 40, minMod: '1.00', maxMod: '1.00' },
        ],
      });

      const res = await service.listTierSectors('upper');

      expect(res).toMatchObject({ tier: 'upper', seasonLabel: '2026/2027', price: 22000 });
      expect(res.sectors.map((s) => [s.section, s.freeSeats])).toEqual([
        ['D/1', 40],
        ['A/2', 5],
      ]);
      await expect(service.listTierSectors('VENDÉG')).rejects.toMatchObject({ status: 404 });
    });

    it('the map shows the tier price on every seat and maps the rule to available / season_pass / locked / disabled', async () => {
      priceRepo.findOne.mockResolvedValue(tierPrice('upper', 22000));
      stubMap([
        seatRow('s2', '1', 2), // free (a ticket for a match already played does not matter)
        seatRow('s6', '1', 6, { free: 0, ticketed: 1 }), // a ticket for an upcoming match
        seatRow('s1', '1', 1, { free: 0, taken: 1 }), // a pass row (any status) for the season
        seatRow('s3', '1', 3), // held by another buyer
        seatRow('s4', '1', 4, { free: 0, isActive: 0 }),
        seatRow('s10', '10', 1),
        seatRow('s5', '2', 1),
      ]);
      holds.heldSeatIds.mockResolvedValue(new Set(['s3']));

      const map = await service.getSeasonSeatMap('D/1');

      expect(map).toMatchObject({
        section: 'D/1',
        name: 'D/1 szektor',
        arc: 'upper',
        gate: 2,
        covered: true,
        tier: 'upper',
        price: 22000,
        seasonLabel: '2026/2027',
        aisles: [],
      });
      expect(map.seats.map((s) => [s.id, s.status])).toEqual([
        ['s1', 'season_pass'],
        ['s2', 'available'],
        ['s3', 'locked'],
        ['s4', 'disabled'],
        ['s6', 'ticketed'],
        ['s5', 'available'], // row 2 before row 10: numeric row order
        ['s10', 'available'],
      ]);
      expect(new Set(map.seats.map((s) => s.price))).toEqual(new Set([22000]));
      expect(map.seats.map((s) => s.status)).not.toContain('sold');
      // only seat 2 is free and unheld in row 1; rows 2 and 10 have one each
      expect(map.longestRun).toBe(1);
      // only seats the rule calls free are looked up in Redis
      expect(holds.heldSeatIds).toHaveBeenCalledWith('2026/2027', ['s2', 's3', 's10', 's5']); // never a ticketed seat
      const mapSql = (dataSource.query.mock.calls as Array<[string]>)
        .map(([sql]) => sql)
        .find((sql) => sql.includes('WHERE s.section = ?'))!;
      expect(mapSql).toContain('AS ticketed');
    });

    it('the away section is refused with 403, an unknown sector with 404', async () => {
      stubMap([]);
      await expect(service.getSeasonSeatMap('VENDÉG')).rejects.toMatchObject({
        status: 403,
        response: { code: 'away_section' },
      });
      await expect(service.getSeasonSeatMap('NOPE')).rejects.toMatchObject({
        status: 404,
        response: { code: 'sector_not_found' },
      });
    });
  });

  it('overview lists only our home matches and reports the configured loyalty reward', async () => {
    priceRepo.find.mockResolvedValue([tierPrice('lower', 30000)]);
    matchRepo.find.mockResolvedValue([
      match('m1', 'KTE FC', 5, '3000.00'),
      match('away', 'Újpest FC', 8, '3000.00'),
    ]);

    const overview = await service.getSeasonOverview();

    expect(overview.loyaltyPoints).toBe(640);
    expect(overview.homeMatches.map((m) => m.id)).toEqual(['m1']);
  });
});
