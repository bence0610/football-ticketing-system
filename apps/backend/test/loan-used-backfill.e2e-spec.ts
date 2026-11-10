import './setup/test-env';

import { randomUUID } from 'crypto';
import request from 'supertest';
import {
  Competition,
  Match,
  MatchStatus,
  PassLoan,
  PassLoanStatus,
  Ticket,
  TicketSource,
  TicketStatus,
} from '../src/database/entities';
import { LoanUsedBackfill1715200000000 } from '../src/database/migrations/1715200000000-LoanUsedBackfill';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { seedMinimalFixture, seedSeasonPass, truncateAll } from './helpers/db.helper';

/**
 * The one-off backfill: a loan that still reads ACCEPTED although its borrowed
 * ticket was already scanned becomes USED, so the sweeper cannot mark it
 * COMPLETED ("they did not come") for someone who did.
 */
describe('LoanUsedBackfill migration', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });
  beforeEach(async () => {
    await truncateAll(ctx.dataSource);
    await ctx.redis.flushdb();
  });

  async function register(tag: string): Promise<string> {
    const res = await request(ctx.httpServer)
      .post('/api/auth/register')
      .send({
        email: `${tag}-${Date.now()}@kte.hu`,
        password: 'FanPass123',
        firstName: 'Teszt',
        lastName: 'Felhasználó',
      });
    expect(res.status).toBe(201);
    return res.body.user.id as string;
  }

  async function extraMatch(i: number): Promise<Match> {
    const repo = ctx.dataSource.getRepository(Match);
    return repo.save(
      repo.create({
        homeTeam: 'Kecskeméti TE',
        awayTeam: `Ellenfél ${i}`,
        competition: Competition.NB1,
        venue: 'Széktói Stadion',
        kickoffAt: new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000),
        status: MatchStatus.ON_SALE,
        capacity: 2,
        basePrice: '5000.00',
        isSeasonPassEligible: true,
      }),
    );
  }

  async function runUp(): Promise<void> {
    const qr = ctx.dataSource.createQueryRunner();
    try {
      await new LoanUsedBackfill1715200000000().up(qr);
    } finally {
      await qr.release();
    }
  }

  it('touches only accepted loans whose borrowed ticket is used, and is idempotent', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const owner = await register('bf-owner');
    const borrower = await register('bf-borrower');
    const pass = await seedSeasonPass(ctx.dataSource, { userId: owner, seatId: seatA.id });
    const matches = [match, await extraMatch(1), await extraMatch(2), await extraMatch(3)];

    const loans = ctx.dataSource.getRepository(PassLoan);
    const tickets = ctx.dataSource.getRepository(Ticket);
    const cases: Array<{
      status: PassLoanStatus;
      ticket: TicketStatus | null;
      expected: PassLoanStatus;
    }> = [
      // accepted + scanned entry            -> USED (the bug)
      { status: PassLoanStatus.ACCEPTED, ticket: TicketStatus.USED, expected: PassLoanStatus.USED },
      // accepted + entry never scanned      -> unchanged
      {
        status: PassLoanStatus.ACCEPTED,
        ticket: TicketStatus.PAID,
        expected: PassLoanStatus.ACCEPTED,
      },
      // accepted, no borrowed ticket at all -> unchanged
      { status: PassLoanStatus.ACCEPTED, ticket: null, expected: PassLoanStatus.ACCEPTED },
      // not accepted, even with a used ticket -> unchanged
      {
        status: PassLoanStatus.COMPLETED,
        ticket: TicketStatus.USED,
        expected: PassLoanStatus.COMPLETED,
      },
    ];

    const ids: string[] = [];
    for (const [i, c] of cases.entries()) {
      const m = matches[i];
      const saved = await loans.save(
        loans.create({
          seasonPassId: pass.id,
          lenderUserId: owner,
          borrowerUserId: borrower,
          matchId: m.id,
          borrowerEmail: 'b@kte.hu',
          status: c.status,
          invitationToken: randomUUID().replace(/-/g, ''),
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      );
      ids.push(saved.id);
      if (c.ticket) {
        await tickets.save(
          tickets.create({
            matchId: m.id,
            seatId: seatA.id,
            userId: borrower,
            seasonPassId: pass.id,
            status: c.ticket,
            source: TicketSource.LOAN,
            pricePaid: '0.00',
            currency: 'HUF',
            qrCode: `KTE-LOAN-${randomUUID()}`,
            qrJti: randomUUID(),
          }),
        );
      }
    }

    const statuses = async (): Promise<PassLoanStatus[]> =>
      Promise.all(ids.map(async (id) => (await loans.findOneByOrFail({ id })).status));

    await runUp();
    expect(await statuses()).toEqual(cases.map((c) => c.expected));

    // A second run finds nothing left to do.
    await runUp();
    expect(await statuses()).toEqual(cases.map((c) => c.expected));
  });
});
