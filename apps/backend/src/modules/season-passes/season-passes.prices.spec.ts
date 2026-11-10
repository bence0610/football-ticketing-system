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

  it('sums the single-match price of the upcoming home fixtures per sector', async () => {
    priceRepo.find.mockResolvedValue([priceRow('A', 30000)]);
    matchRepo.find.mockResolvedValue([
      match('played', 'KTE FC', -10, '3000.00'), // already played: not counted
      match('m1', 'KTE FC', 5, '3000.00'),
      match('m2', 'KTE FC', 12, '4000.00'),
      match('away', 'Újpest FC', 8, '9000.00'), // not ours: not counted
    ]);
    stubSql({ stats: [{ section: 'A', total: 100, free: 40, minMod: '1.50', maxMod: '1.50' }] });

    const [a] = await service.listPrices();

    expect(a.upcomingHomeMatches).toBe(2);
    // round(3000*1.5) + round(4000*1.5)
    expect(a.singleMatchTotal).toBe(4500 + 6000);
    expect(a.freeSeats).toBe(40);
    expect(a.totalSeats).toBe(100);
  });

  it('refuses to invent a total when the sector has mixed price modifiers', async () => {
    priceRepo.find.mockResolvedValue([priceRow('A', 30000)]);
    matchRepo.find.mockResolvedValue([match('m1', 'KTE FC', 5, '3000.00')]);
    stubSql({ stats: [{ section: 'A', total: 100, free: 40, minMod: '1.00', maxMod: '1.50' }] });

    const [a] = await service.listPrices();

    expect(a.singleMatchTotal).toBeNull();
  });

  it('has no single-match total when no home match is left', async () => {
    priceRepo.find.mockResolvedValue([priceRow('A', 30000)]);
    matchRepo.find.mockResolvedValue([match('played', 'KTE FC', -3, '3000.00')]);
    stubSql({ stats: [{ section: 'A', total: 100, free: 40, minMod: '1.00', maxMod: '1.00' }] });

    const [a] = await service.listPrices();

    expect(a.upcomingHomeMatches).toBe(0);
    expect(a.singleMatchTotal).toBeNull();
  });

  it('reports a sector without any seat as sold out, and unknown coverage as null', async () => {
    priceRepo.find.mockResolvedValue([priceRow('X', 10000)]);
    matchRepo.find.mockResolvedValue([]);
    stubSql({ stats: [] });

    const [x] = await service.listPrices();

    expect(x.freeSeats).toBe(0);
    expect(x.totalSeats).toBe(0);
    expect(x.isCovered).toBeNull();
  });

  it('carries coverage and the number of active passes sold', async () => {
    priceRepo.find.mockResolvedValue([priceRow('B', 25000)]);
    matchRepo.find.mockResolvedValue([]);
    stubSql({
      stats: [{ section: 'B', total: 200, free: 150, minMod: '1.00', maxMod: '1.00' }],
      sold: [{ section: 'B', sold: 7 }],
      sectors: [{ code: 'B', covered: 1 }],
    });

    const [b] = await service.listPrices();

    expect(b.passesSold).toBe(7);
    expect(b.isCovered).toBe(true);
  });

  it('overview lists only our home matches and reports the configured loyalty reward', async () => {
    priceRepo.find.mockResolvedValue([priceRow('A', 30000)]);
    matchRepo.find.mockResolvedValue([
      match('m1', 'KTE FC', 5, '3000.00'),
      match('away', 'Újpest FC', 8, '3000.00'),
    ]);

    const overview = await service.getSeasonOverview();

    expect(overview.loyaltyPoints).toBe(640);
    expect(overview.homeMatches.map((m) => m.id)).toEqual(['m1']);
  });
});
