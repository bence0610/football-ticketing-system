import './setup/test-env';

import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  Competition,
  LoyaltyTier,
  LoyaltyTransaction,
  LoyaltyTransactionSource,
  LoyaltyTransactionType,
  Match,
  MatchStatus,
  PassLoan,
  PassLoanStatus,
  Seat,
  SeatCategory,
  SeasonPass,
  SeasonPassStatus,
  Ticket,
  TicketSource,
  TicketStatus,
  User,
  UserRole,
  Waitlist,
} from '../src/database/entities';
import { StadiumLayout1715400000000 } from '../src/database/migrations/1715400000000-StadiumLayout';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { truncateAll } from './helpers/db.helper';

/**
 * The dev-database clean-up script (scripts/clear-transactional-data.sql) run
 * against real MySQL with data in every table that the old layout touches: it
 * must unblock the migration's guard, leave nothing dangling, and keep users,
 * matches and login data.
 */
describe('clear-transactional-data.sql (E2E)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  beforeEach(async () => {
    await truncateAll(ctx.dataSource);
  });

  /** Runs the script's statements, in order, on ONE connection (it uses a temporary table). */
  async function runScript(): Promise<void> {
    const sql = readFileSync(
      join(__dirname, '..', 'scripts', 'clear-transactional-data.sql'),
      'utf8',
    );
    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    const qr = ctx.dataSource.createQueryRunner();
    await qr.connect();
    try {
      for (const statement of statements) {
        await qr.query(statement);
      }
    } finally {
      await qr.release();
    }
  }

  async function user(over: Partial<User>): Promise<User> {
    const repo = ctx.dataSource.getRepository(User);
    return repo.save(
      repo.create({
        email: `u-${randomUUID().slice(0, 8)}@kte.hu`,
        passwordHash: 'hash',
        firstName: 'Teszt',
        lastName: 'Elek',
        role: UserRole.FAN,
        loyaltyTier: LoyaltyTier.BRONZE,
        loyaltyPoints: 0,
        emailVerified: true,
        twoFactorEnabled: false,
        isActive: true,
        ...over,
      }),
    );
  }

  async function ledger(
    userId: string,
    source: LoyaltyTransactionSource,
    points: number,
    balanceAfter: number,
    referenceId: string,
    at: string,
  ): Promise<void> {
    const repo = ctx.dataSource.getRepository(LoyaltyTransaction);
    const row = repo.create({
      userId,
      type: LoyaltyTransactionType.EARN,
      source,
      points,
      balanceAfter,
      referenceId,
      description: source,
    });
    const saved = await repo.save(row);
    await ctx.dataSource.query('UPDATE loyalty_transactions SET created_at = ? WHERE id = ?', [
      at,
      saved.id,
    ]);
  }

  /** A fan with a ticket, a season pass, a loan, ledger rows and a waitlist entry, plus an admin with no ledger. */
  async function seedDevData(): Promise<{ fan: User; admin: User; match: Match }> {
    const matchRepo = ctx.dataSource.getRepository(Match);
    const match = await matchRepo.save(
      matchRepo.create({
        homeTeam: 'Kecskeméti TE',
        awayTeam: 'Dev FC',
        competition: Competition.NB1,
        venue: 'Széktói Stadion',
        kickoffAt: new Date(Date.now() + 7 * 86_400_000),
        status: MatchStatus.ON_SALE,
        capacity: 524,
        basePrice: '3500.00',
        isSeasonPassEligible: true,
      }),
    );
    const seatRepo = ctx.dataSource.getRepository(Seat);
    const seats: Seat[] = [];
    for (const [section, n] of [
      ['A', 1],
      ['A', 2],
      ['VIP', 1],
    ] as const) {
      seats.push(
        await seatRepo.save(
          seatRepo.create({
            section,
            row: '1',
            number: n,
            category: SeatCategory.STANDARD,
            priceModifier: '1.00',
            isAccessible: false,
            isActive: true,
          }),
        ),
      );
    }

    // The fan registered (+50), bought a ticket (+50) and a season pass (+500): 600 points, Ezüst.
    const fan = await user({ loyaltyPoints: 600, loyaltyTier: LoyaltyTier.SILVER });
    // The seeded admin: a tier, but no ledger at all.
    const admin = await user({
      email: 'admin-dev@kte.hu',
      role: UserRole.SUPER_ADMIN,
      loyaltyTier: LoyaltyTier.PLATINUM,
      loyaltyPoints: 0,
    });

    const passRepo = ctx.dataSource.getRepository(SeasonPass);
    const pass = await passRepo.save(
      passRepo.create({
        userId: fan.id,
        holderName: 'Teszt Elek',
        holderUserId: fan.id,
        seatId: seats[0].id,
        seasonLabel: '2026/2027',
        validFrom: new Date('2026-07-01'),
        validUntil: new Date('2027-06-30'),
        status: SeasonPassStatus.ACTIVE,
        pricePaid: '25000.00',
        currency: 'HUF',
        qrCode: `KTE-SP-${randomUUID()}`,
        autoRenew: false,
      }),
    );

    const ticketRepo = ctx.dataSource.getRepository(Ticket);
    const ticket = await ticketRepo.save(
      ticketRepo.create({
        matchId: match.id,
        seatId: seats[1].id,
        userId: fan.id,
        status: TicketStatus.PAID,
        source: TicketSource.SINGLE,
        pricePaid: '3500.00',
        currency: 'HUF',
        qrCode: `KTE-${randomUUID()}`,
        qrJti: randomUUID(),
      }),
    );
    // a pass entry that points at the pass (tickets.season_pass_id, SET NULL)
    await ticketRepo.save(
      ticketRepo.create({
        matchId: match.id,
        seatId: seats[0].id,
        userId: fan.id,
        seasonPassId: pass.id,
        status: TicketStatus.PAID,
        source: TicketSource.SEASON_PASS,
        pricePaid: '0.00',
        currency: 'HUF',
        qrCode: `KTE-SP-${randomUUID()}`,
        qrJti: randomUUID(),
      }),
    );

    const loanRepo = ctx.dataSource.getRepository(PassLoan);
    const loan = await loanRepo.save(
      loanRepo.create({
        seasonPassId: pass.id,
        lenderUserId: fan.id,
        borrowerUserId: admin.id,
        matchId: match.id,
        borrowerEmail: 'admin-dev@kte.hu',
        status: PassLoanStatus.PENDING,
        invitationToken: randomUUID().replace(/-/g, ''),
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );

    await ledger(
      fan.id,
      LoyaltyTransactionSource.REGISTRATION,
      50,
      50,
      `registration:${fan.id}`,
      '2026-10-01 10:00:00',
    );
    await ledger(
      fan.id,
      LoyaltyTransactionSource.TICKET_PURCHASE,
      50,
      100,
      `ticket:${ticket.id}`,
      '2026-10-02 10:00:00',
    );
    await ledger(
      fan.id,
      LoyaltyTransactionSource.SEASON_PASS_PURCHASE,
      500,
      600,
      `season_pass:${pass.id}`,
      '2026-10-03 10:00:00',
    );
    await ledger(
      fan.id,
      LoyaltyTransactionSource.PASS_LOAN,
      25,
      625,
      `loan:${loan.id}`,
      '2026-10-04 10:00:00',
    );
    await ctx.dataSource.query('UPDATE users SET loyalty_points = 625 WHERE id = ?', [fan.id]);
    // a profile bonus earned AFTER the purchases: its stored balance must be rebuilt (it was 675)
    await ledger(
      fan.id,
      LoyaltyTransactionSource.PROFILE_COMPLETION,
      50,
      675,
      `profile_completion:${fan.id}`,
      '2026-10-05 10:00:00',
    );
    await ctx.dataSource.query('UPDATE users SET loyalty_points = 675 WHERE id = ?', [fan.id]);

    await ctx.dataSource.getRepository(Waitlist).save(
      ctx.dataSource.getRepository(Waitlist).create({
        userId: fan.id,
        matchId: match.id,
        requestedQuantity: 2,
        preferredSection: 'VIP',
      }),
    );
    await ctx.dataSource
      .query(
        'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (UUID(), ?, ?, NOW() + INTERVAL 1 DAY)',
        [fan.id, randomUUID().replace(/-/g, '')],
      )
      .catch(() => undefined); // table shape is not under test; users keep their tokens either way

    return { fan, admin, match };
  }

  const count = async (table: string): Promise<number> =>
    Number((await ctx.dataSource.query(`SELECT COUNT(*) AS n FROM \`${table}\``))[0].n);

  it('the migration guard refuses the dev data as it stands', async () => {
    await seedDevData();
    const qr = ctx.dataSource.createQueryRunner();
    await qr.connect();
    try {
      await expect(new StadiumLayout1715400000000().up(qr)).rejects.toThrow(/refused/);
    } finally {
      await qr.release();
    }
  });

  it('empties the three tables the guard checks', async () => {
    await seedDevData();
    expect(await count('tickets')).toBe(2);
    expect(await count('season_passes')).toBe(1);
    expect(await count('pass_loans')).toBe(1);

    await runScript();

    expect(await count('tickets')).toBe(0);
    expect(await count('season_passes')).toBe(0);
    expect(await count('pass_loans')).toBe(0);
  });

  it('removes the loyalty rows the purchases earned, and rebuilds the balances that are left', async () => {
    const { fan } = await seedDevData();

    await runScript();

    const rows = await ctx.dataSource
      .getRepository(LoyaltyTransaction)
      .find({ where: { userId: fan.id }, order: { createdAt: 'ASC' } });
    // only registration and the profile bonus survive; nothing references a deleted ticket, pass or loan
    expect(rows.map((r) => r.source)).toEqual([
      LoyaltyTransactionSource.REGISTRATION,
      LoyaltyTransactionSource.PROFILE_COMPLETION,
    ]);
    expect(rows.map((r) => r.balanceAfter)).toEqual([50, 100]);
    expect(rows.some((r) => /^(ticket|season_pass|loan):/.test(r.referenceId ?? ''))).toBe(false);

    const after = await ctx.dataSource.getRepository(User).findOneByOrFail({ id: fan.id });
    expect(after.loyaltyPoints).toBe(100);
    // 675 points was Ezüst; 100 is Kék again
    expect(after.loyaltyTier).toBe(LoyaltyTier.BRONZE);
  });

  it('leaves an account whose points were never in the ledger exactly as it was', async () => {
    const { admin } = await seedDevData();

    await runScript();

    const after = await ctx.dataSource.getRepository(User).findOneByOrFail({ id: admin.id });
    expect(after.loyaltyTier).toBe(LoyaltyTier.PLATINUM);
    expect(after.loyaltyPoints).toBe(0);
  });

  it('keeps users, matches and login data, and keeps waitlist entries but clears their old sector', async () => {
    const { fan, match } = await seedDevData();

    await runScript();

    expect(await count('users')).toBe(2);
    expect(await count('matches')).toBe(1);
    const u = await ctx.dataSource.getRepository(User).findOneByOrFail({ id: fan.id });
    expect(u.email).toBe(fan.email);
    expect(u.passwordHash).toBe('hash');
    expect(u.role).toBe(UserRole.FAN);
    const waitlist = await ctx.dataSource.getRepository(Waitlist).find();
    expect(waitlist.length).toBe(1);
    expect(waitlist[0].matchId).toBe(match.id);
    expect(waitlist[0].preferredSection).toBeNull();
    // seats are the migration's job, not this script's
    expect(await count('seats')).toBe(3);
  });

  it('is safe to run twice, and on an already clean database', async () => {
    await seedDevData();
    await runScript();
    await runScript();
    expect(await count('tickets')).toBe(0);
    expect(await count('users')).toBe(2);
  });
});
