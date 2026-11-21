import './setup/test-env';

import { randomUUID } from 'crypto';
import request from 'supertest';
import { Server } from 'http';
import {
  PassLoan,
  PassLoanStatus,
  Ticket,
  TicketSource,
  TicketStatus,
  User,
} from '../src/database/entities';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import {
  createGateUser,
  seedMinimalFixture,
  seedSeasonPass,
  truncateAll,
} from './helpers/db.helper';

/**
 * Suspicion 1 of the audit: accepting a loan and scanning the holder's own entry at the same
 * moment. `acceptLoan` read the holder's ticket without a lock and then deleted it, so a scan that
 * committed in between was deleted too (a USED ticket and a fresh LOAN ticket, both admitted).
 *
 * The invariant, whatever the interleaving: an entry that has been ADMITTED is never also handed
 * to the borrower. Either the scan wins (the loan ends OWNER_ENTERED and no LOAN ticket exists) or
 * the acceptance wins (the holder's ticket is gone and the scan is refused).
 */
describe('Loan acceptance racing the holder’s scan (E2E)', () => {
  let ctx: TestContext;
  let server: Server;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.httpServer;
  });
  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });
  beforeEach(async () => {
    await truncateAll(ctx.dataSource);
    await ctx.redis.flushdb();
  });

  async function fan(prefix: string): Promise<{ id: string; email: string; token: string }> {
    const email = `${prefix}-${randomUUID().slice(0, 8)}@kte.hu`;
    const res = await request(server)
      .post('/api/auth/register')
      .send({ email, password: 'Teszt1234!', firstName: 'Teszt', lastName: 'Elek' });
    expect(res.status).toBe(201);
    await ctx.dataSource
      .getRepository(User)
      .update({ id: res.body.user.id }, { emailVerified: true });
    return { id: res.body.user.id, email, token: res.body.accessToken };
  }

  it('never admits the holder AND hands the same entry to the borrower', async () => {
    const ITERATIONS = 16;
    const outcomes = { scanWon: 0, acceptWon: 0 };
    const violations: string[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      // A fresh world per run (the minimal fixture's seat is always A-1-1).
      await truncateAll(ctx.dataSource);
      await ctx.redis.flushdb();
      const gate = await createGateUser(ctx.dataSource, { email: 'gate-race@kte.hu' });
      const gateLogin = await request(server)
        .post('/api/auth/login')
        .send({ email: gate.user.email, password: gate.plainPassword });
      const gateToken = gateLogin.body.accessToken as string;
      const { match, seatA } = await seedMinimalFixture(ctx.dataSource, {
        seasonPassEligible: true,
      });
      const owner = await fan('race-owner');
      const borrower = await fan('race-borrower');
      const pass = await seedSeasonPass(ctx.dataSource, { userId: owner.id, seatId: seatA.id });

      // The holder has opened the QR: the entry ticket exists and a loan is pending.
      const qr = await request(server)
        .get(`/api/season-passes/${pass.id}/qr/${match.id}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(qr.status).toBe(200);
      const created = await request(server)
        .post(`/api/season-passes/${pass.id}/loans`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ matchId: match.id, borrowerEmail: borrower.email });
      expect(created.status).toBe(201);
      const loan = await ctx.dataSource
        .getRepository(PassLoan)
        .findOneOrFail({ where: { id: created.body.id } });

      // Both at once, the scan a few milliseconds apart so every interleaving gets hit.
      const delay = (i % 10) * 3;
      const accept = request(server)
        .post(`/api/season-passes/loans/accept/${loan.invitationToken}`)
        .set('Authorization', `Bearer ${borrower.token}`)
        .then((r) => r);
      const scan = new Promise<request.Response>((resolve) =>
        setTimeout(() => {
          void request(server)
            .patch(`/api/tickets/${qr.body.ticketId}/scan`)
            .set('Authorization', `Bearer ${gateToken}`)
            .send({ token: qr.body.token })
            .then(resolve);
        }, delay),
      );
      const [acceptRes, scanRes] = await Promise.all([accept, scan]);

      const tickets = await ctx.dataSource
        .getRepository(Ticket)
        .find({ where: { matchId: match.id, seatId: seatA.id } });
      const loanTickets = tickets.filter((t) => t.source === TicketSource.LOAN);
      const ownerTickets = tickets.filter((t) => t.source === TicketSource.SEASON_PASS);
      const loanAfter = await ctx.dataSource
        .getRepository(PassLoan)
        .findOneOrFail({ where: { id: loan.id } });
      const admitted = scanRes.status === 200 && scanRes.body.success === true;

      if (admitted && loanTickets.length > 0) {
        violations.push(
          `#${i}: holder admitted (scan ${scanRes.status}) and a LOAN ticket exists (accept ${acceptRes.status}, loan ${loanAfter.status})`,
        );
      }
      if (admitted) {
        outcomes.scanWon++;
        // The scan won: the entry is used, the loan can only have ended as OWNER_ENTERED.
        expect(ownerTickets).toHaveLength(1);
        expect(ownerTickets[0].status).toBe(TicketStatus.USED);
        expect(acceptRes.status).toBe(409);
        expect(loanAfter.status).toBe(PassLoanStatus.OWNER_ENTERED);
      } else {
        outcomes.acceptWon++;
        // The acceptance won: the holder's ticket is gone, exactly one LOAN ticket, scan refused.
        expect(acceptRes.status).toBe(200);
        expect(ownerTickets).toHaveLength(0);
        expect(loanTickets).toHaveLength(1);
        expect(loanTickets[0].status).toBe(TicketStatus.PAID);
        expect(loanAfter.status).toBe(PassLoanStatus.ACCEPTED);
      }
    }

    expect(violations).toEqual([]);
    // Eyeball aid in the log: both outcomes should occur over the staggered runs.
    // eslint-disable-next-line no-console
    console.log(`accept/scan race outcomes over ${ITERATIONS} runs: ${JSON.stringify(outcomes)}`);
  }, 240_000);
});
