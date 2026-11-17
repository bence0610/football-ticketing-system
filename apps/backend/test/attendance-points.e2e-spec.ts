import './setup/test-env';

import { randomUUID } from 'crypto';
import {
  Competition,
  LoyaltyTier,
  LoyaltyTransaction,
  LoyaltyTransactionSource,
  Match,
  MatchStatus,
  Seat,
  SeatCategory,
  Ticket,
  TicketSource,
  TicketStatus,
  User,
  UserRole,
} from '../src/database/entities';
import { TicketsService } from '../src/modules/tickets/tickets.service';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { seedSeasonPass, truncateAll } from './helpers/db.helper';

/**
 * Loyalty measures attendance, not spending, against the real database: the first time a person
 * enters a match they earn the attendance points, once per person per match. The "once" is the
 * ledger's unique (source, reference) key, the reference being the match and the person.
 */
describe('Attendance points (E2E)', () => {
  let ctx: TestContext;
  let tickets: TicketsService;

  beforeAll(async () => {
    ctx = await createTestApp();
    tickets = ctx.app.get(TicketsService);
  });

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  beforeEach(async () => {
    await truncateAll(ctx.dataSource);
    await ctx.redis.flushdb();
  });

  async function fan(name: string): Promise<User> {
    const repo = ctx.dataSource.getRepository(User);
    return repo.save(
      repo.create({
        email: `${name}-${randomUUID().slice(0, 8)}@kte.hu`,
        passwordHash: 'x',
        firstName: name,
        lastName: 'Teszt',
        role: UserRole.FAN,
        loyaltyTier: LoyaltyTier.BRONZE,
        loyaltyPoints: 0,
        emailVerified: true,
        twoFactorEnabled: false,
        isActive: true,
      }),
    );
  }

  async function match(daysFromNow = -1): Promise<Match> {
    const repo = ctx.dataSource.getRepository(Match);
    return repo.save(
      repo.create({
        homeTeam: 'Kecskeméti TE',
        awayTeam: 'Teszt FC',
        competition: Competition.NB2,
        venue: 'Széktói Stadion',
        kickoffAt: new Date(Date.now() + daysFromNow * 86_400_000),
        status: MatchStatus.ON_SALE,
        capacity: 20,
        basePrice: '3000.00',
        isSeasonPassEligible: true,
      }),
    );
  }

  let seatNo = 0;
  async function seat(): Promise<Seat> {
    const repo = ctx.dataSource.getRepository(Seat);
    seatNo += 1;
    return repo.save(
      repo.create({
        section: 'D/1',
        row: '1',
        number: seatNo,
        category: SeatCategory.STANDARD,
        priceModifier: '1.00',
        isAccessible: false,
        isActive: true,
      }),
    );
  }

  async function ticket(
    m: Match,
    owner: User,
    source = TicketSource.SINGLE,
    seasonPassId?: string,
    seatId?: string,
  ): Promise<Ticket> {
    const repo = ctx.dataSource.getRepository(Ticket);
    return repo.save(
      repo.create({
        matchId: m.id,
        seatId: seatId ?? (await seat()).id,
        userId: owner.id,
        seasonPassId,
        status: TicketStatus.PAID,
        source,
        pricePaid: source === TicketSource.SINGLE ? '3000.00' : '0.00',
        currency: 'HUF',
        qrCode: `KTE-${randomUUID()}`,
        qrJti: randomUUID(),
      }),
    );
  }

  const ledger = (userId: string): Promise<LoyaltyTransaction[]> =>
    ctx.dataSource.getRepository(LoyaltyTransaction).find({
      where: { userId, source: LoyaltyTransactionSource.ATTENDANCE },
    });
  const points = async (userId: string): Promise<number> =>
    (await ctx.dataSource.getRepository(User).findOneByOrFail({ id: userId })).loyaltyPoints;

  it('three of a user’s tickets scanned for one match earn the points once', async () => {
    const anna = await fan('anna');
    const m = await match();
    const t = [await ticket(m, anna), await ticket(m, anna), await ticket(m, anna)];
    for (const x of t) expect((await tickets.scanTicket(x.id, {})).result).toBe('ok');

    const rows = await ledger(anna.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].points).toBe(50);
    expect(rows[0].referenceId).toBe(`match:${m.id}:${anna.id}`);
    expect(await points(anna.id)).toBe(50);
  });

  it('a pass entry and a ticket of the same user on the same match earn once', async () => {
    const anna = await fan('anna');
    const m = await match();
    const passSeat = await seat();
    const pass = await seedSeasonPass(ctx.dataSource, { userId: anna.id, seatId: passSeat.id });
    const entry = await ticket(m, anna, TicketSource.SEASON_PASS, pass.id, passSeat.id);
    const single = await ticket(m, anna);
    await tickets.scanTicket(entry.id, {});
    await tickets.scanTicket(single.id, {});

    expect(await ledger(anna.id)).toHaveLength(1);
    expect(await points(anna.id)).toBe(50);
  });

  it('a bought but unscanned ticket earns nothing', async () => {
    const anna = await fan('anna');
    const m = await match();
    await ticket(m, anna);
    await ticket(m, anna);
    expect(await ledger(anna.id)).toHaveLength(0);
    expect(await points(anna.id)).toBe(0);
  });

  it('a borrower earns the points; the lender earns none at the gate', async () => {
    const lender = await fan('lender');
    const borrower = await fan('borrower');
    const m = await match();
    const passSeat = await seat();
    const pass = await seedSeasonPass(ctx.dataSource, { userId: lender.id, seatId: passSeat.id });
    const loan = await ticket(m, borrower, TicketSource.LOAN, pass.id, passSeat.id);
    expect((await tickets.scanTicket(loan.id, {})).result).toBe('ok');

    expect(await ledger(borrower.id)).toHaveLength(1);
    expect(await points(borrower.id)).toBe(50);
    expect(await ledger(lender.id)).toHaveLength(0);
    expect(await points(lender.id)).toBe(0);
  });

  it('each match earns separately', async () => {
    const anna = await fan('anna');
    const first = await match(-2);
    const second = await match(-1);
    await tickets.scanTicket((await ticket(first, anna)).id, {});
    await tickets.scanTicket((await ticket(second, anna)).id, {});
    expect(await ledger(anna.id)).toHaveLength(2);
    expect(await points(anna.id)).toBe(100);
  });
});
