import './setup/test-env';

import { randomUUID } from 'crypto';
import request from 'supertest';
import { Server } from 'http';
import { Match, MatchStatus, Ticket, TicketSource, TicketStatus } from '../src/database/entities';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { createGateUser, seedMinimalFixture, truncateAll } from './helpers/db.helper';

/**
 * The scan window against the real application (the e2e environment opens the gate 720 h before
 * kickoff and keeps it open 72 h after, see test-env.ts): a ticket for a match far outside it gets
 * the `not_today` verdict, stays PAID and earns nothing; one inside it is admitted.
 */
describe('Scan window around kickoff (E2E)', () => {
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

  async function scanFor(
    kickoffInDays: number,
  ): Promise<{ status: number; body: Record<string, unknown>; ticket: Ticket }> {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource, {});
    await ctx.dataSource.getRepository(Match).update(
      { id: match.id },
      {
        kickoffAt: new Date(Date.now() + kickoffInDays * 86_400_000),
        status: MatchStatus.ON_SALE,
      },
    );
    const gate = await createGateUser(ctx.dataSource, {
      email: `gate-${randomUUID().slice(0, 6)}@kte.hu`,
    });
    const login = await request(server)
      .post('/api/auth/login')
      .send({ email: gate.user.email, password: gate.plainPassword });
    // As in reality: the fan owns the ticket and fetches its QR; the steward only scans it.
    const fanRes = await request(server)
      .post('/api/auth/register')
      .send({
        email: `fan-${randomUUID().slice(0, 8)}@kte.hu`,
        password: 'Teszt1234!',
        firstName: 'Teszt',
        lastName: 'Elek',
      });
    expect(fanRes.status).toBe(201);
    const repo = ctx.dataSource.getRepository(Ticket);
    const ticket = await repo.save(
      repo.create({
        matchId: match.id,
        seatId: seatA.id,
        userId: fanRes.body.user.id as string,
        status: TicketStatus.PAID,
        source: TicketSource.SINGLE,
        pricePaid: '3000.00',
        currency: 'HUF',
        qrCode: `KTE-${randomUUID()}`,
        qrJti: randomUUID().slice(0, 21),
      }),
    );
    const qr = await request(server)
      .get(`/api/tickets/${ticket.id}/qr`)
      .set('Authorization', `Bearer ${fanRes.body.accessToken as string}`);
    expect(qr.status).toBe(200);
    const res = await request(server)
      .patch(`/api/tickets/${ticket.id}/scan`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ token: qr.body.token });
    return {
      status: res.status,
      body: res.body,
      ticket: await repo.findOneByOrFail({ id: ticket.id }),
    };
  }

  it('refuses a ticket for a match two months away: not_today, still PAID', async () => {
    const { body, ticket } = await scanFor(60);
    expect(body).toMatchObject({ success: false, result: 'not_today', message: 'too_early' });
    expect(body.match).toBeDefined();
    expect(ticket.status).toBe(TicketStatus.PAID);
  });

  it('refuses a ticket for a match played a week ago', async () => {
    const { body, ticket } = await scanFor(-7);
    expect(body).toMatchObject({ success: false, result: 'not_today', message: 'too_late' });
    expect(ticket.status).toBe(TicketStatus.PAID);
  });

  it('admits a ticket for a match that kicks off soon', async () => {
    const { body, ticket } = await scanFor(0.05);
    expect(body).toMatchObject({ success: true, result: 'ok' });
    expect(ticket.status).toBe(TicketStatus.USED);
  });
});
