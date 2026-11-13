import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SeasonPassesService } from './season-passes.service';
import { STRIPE_CLIENT } from '../payments/stripe.provider';
import { REDIS_CLIENT } from '../../redis/redis.constants';
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
  const priceRepo = { find: jest.fn() };
  const matchRepo = { find: jest.fn() };
  const dataSource = { query: jest.fn(), transaction: jest.fn(), getRepository: jest.fn() };

  /** What the three raw SQL reads return, keyed by a fragment of the statement. */
  function stubSql(opts: {
    stats: Array<{ section: string; total: number; free: number; minMod: string; maxMod: string }>;
    sold?: Array<{ section: string; sold: number }>;
    sectors?: Array<{ code: string; covered: number }>;
  }): void {
    dataSource.query.mockImplementation((sql: string) => {
      if (sql.includes('GROUP BY s.section') && sql.includes('MIN(s.price_modifier)')) {
        return Promise.resolve(opts.stats);
      }
      if (sql.includes('FROM season_passes sp')) return Promise.resolve(opts.sold ?? []);
      if (sql.includes('FROM sectors')) return Promise.resolve(opts.sectors ?? []);
      return Promise.reject(new Error(`unexpected SQL: ${sql}`));
    });
  }

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
