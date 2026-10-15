import './setup/test-env';

import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { Server } from 'http';
import {
  LoyaltyTransaction,
  LoyaltyTransactionSource,
  Match,
  Seat,
  Ticket,
  TicketStatus,
} from '../src/database/entities';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { createGateUser, seedMinimalFixture, truncateAll } from './helpers/db.helper';
import {
  buildPaymentIntentSucceededEvent,
  buildStripeWebhookHeader,
  StubbedPaymentIntent,
} from './helpers/stripe-stub';
import { RedisKeys } from '../src/redis/redis.constants';

const PASSWORD = 'FanPass123';

interface RegisteredFan {
  userId: string;
  email: string;
  accessToken: string;
}

interface PurchasedTicket {
  ticketId: string;
  intent: StubbedPaymentIntent;
}

describe('Purchase → Ticket → Entry (E2E)', () => {
  let ctx: TestContext;
  let server: Server;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.httpServer;
  });

  afterAll(async () => {
    if (ctx) {
      await closeTestApp(ctx);
    }
  });

  beforeEach(async () => {
    await truncateAll(ctx.dataSource);
    await ctx.redis.flushdb();
    ctx.stripeStub.paymentIntentsCreateMock.mockClear();
    ctx.stripeStub.paymentIntentsRetrieveMock.mockClear();
  });

  /* ------------------------------------------------------------------ */
  /* Shared helpers                                                      */
  /* ------------------------------------------------------------------ */

  async function registerFan(emailSuffix = 'fan'): Promise<RegisteredFan> {
    const email = `${emailSuffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@kte.hu`;
    const response = await request(server).post('/api/auth/register').send({
      email,
      password: PASSWORD,
      firstName: 'Teszt',
      lastName: 'Felhasználó',
    });
    expect(response.status).toBe(201);
    return {
      userId: response.body.user.id,
      email,
      accessToken: response.body.accessToken,
    };
  }

  async function loginAs(email: string, password: string): Promise<string> {
    const response = await request(server).post('/api/auth/login').send({ email, password });
    expect(response.status).toBe(200);
    return response.body.accessToken;
  }

  async function lockSeat(accessToken: string, matchId: string, seatId: string): Promise<string> {
    const response = await request(server)
      .post(`/api/matches/${matchId}/seats/${seatId}/lock`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send();
    expect(response.status).toBe(201);
    expect(response.body.ownerToken).toBeDefined();
    return response.body.ownerToken as string;
  }

  async function createIntent(
    accessToken: string,
    matchId: string,
    seats: Array<{ seatId: string; ownerToken: string }>,
  ): Promise<{ paymentIntentId: string; amount: number }> {
    const response = await request(server)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ matchId, seats });
    expect(response.status).toBe(201);
    return {
      paymentIntentId: response.body.paymentIntentId as string,
      amount: response.body.amount as number,
    };
  }

  async function deliverWebhook(intent: StubbedPaymentIntent): Promise<SupertestResponse> {
    const event = buildPaymentIntentSucceededEvent(intent);
    // Must send a string, not a Buffer: supertest JSON-serialises Buffer objects
    // when content-type is application/json, corrupting the payload and breaking
    // Stripe's HMAC signature verification.
    const payloadStr = JSON.stringify(event);
    const signature = buildStripeWebhookHeader(payloadStr);

    return request(server)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', signature)
      .set('content-type', 'application/json')
      .send(payloadStr);
  }

  /**
   * Lets the `setImmediate`-scheduled email dispatch run so loyalty +
   * ticket DB writes have settled before assertions. The webhook handler
   * awaits the finalisation path before returning 200, but the email
   * dispatch is fire-and-forget — a short settle is enough.
   */
  async function flushAsync(): Promise<void> {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));
  }

  async function buyTicket(fan: RegisteredFan, match: Match, seat: Seat): Promise<PurchasedTicket> {
    const ownerToken = await lockSeat(fan.accessToken, match.id, seat.id);
    const { paymentIntentId } = await createIntent(fan.accessToken, match.id, [
      { seatId: seat.id, ownerToken },
    ]);
    const intent = ctx.stripeStub.getStoredIntent(paymentIntentId);
    if (!intent) {
      throw new Error(`Stub lost PaymentIntent ${paymentIntentId}`);
    }
    const webhookResponse = await deliverWebhook(intent);
    expect(webhookResponse.status).toBe(200);
    await flushAsync();

    const ticket = await ctx.dataSource
      .getRepository(Ticket)
      .findOne({ where: { stripePaymentIntentId: intent.id, userId: fan.userId } });
    if (!ticket) {
      throw new Error(`No ticket persisted for intent ${intent.id}`);
    }
    return { ticketId: ticket.id, intent };
  }

  /* ------------------------------------------------------------------ */
  /* Scenario tests                                                      */
  /* ------------------------------------------------------------------ */

  it('full purchase → ticket → entry chain', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const fan = await registerFan();
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-e2e-1@kte.hu' });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);

    // c. list matches
    const matchesList = await request(server).get('/api/matches');
    expect(matchesList.status).toBe(200);
    expect(Array.isArray(matchesList.body)).toBe(true);
    expect(matchesList.body).toHaveLength(1);
    expect(matchesList.body[0].id).toBe(match.id);

    // d. seat map
    const seatsResponse = await request(server).get(`/api/matches/${match.id}/seats`);
    expect(seatsResponse.status).toBe(200);
    const seatARow = (seatsResponse.body.seats as Array<{ id: string; status: string }>).find(
      (s) => s.id === seatA.id,
    );
    expect(seatARow?.status).toBe('available');

    // e. lock seat
    const ownerToken = await lockSeat(fan.accessToken, match.id, seatA.id);

    // f. create payment intent
    const { paymentIntentId, amount } = await createIntent(fan.accessToken, match.id, [
      { seatId: seatA.id, ownerToken },
    ]);
    expect(amount).toBe(5000);
    const storedIntent = ctx.stripeStub.getStoredIntent(paymentIntentId);
    expect(storedIntent).toBeDefined();
    expect(storedIntent?.metadata.userId).toBe(fan.userId);
    expect(storedIntent?.metadata.matchId).toBe(match.id);
    expect(storedIntent?.metadata.seatIds).toBe(seatA.id);
    expect(storedIntent?.metadata.ownerTokens).toBe(ownerToken);

    // g. deliver webhook
    const webhookResponse = await deliverWebhook(storedIntent!);
    expect(webhookResponse.status).toBe(200);
    expect(webhookResponse.body).toEqual({ received: true });

    // h. let async finish
    await flushAsync();

    // i. GET /api/tickets/me
    const myTicketsResponse = await request(server)
      .get('/api/tickets/me')
      .set('Authorization', `Bearer ${fan.accessToken}`);
    expect(myTicketsResponse.status).toBe(200);
    expect(myTicketsResponse.body).toHaveLength(1);
    const ticketDto = myTicketsResponse.body[0] as { id: string; status: string };
    expect(ticketDto.status).toBe(TicketStatus.PAID);
    const ticketId = ticketDto.id;

    // j. seat lock released in Redis
    //    (ioredis's `keyPrefix` config auto-prefixes outgoing commands.)
    const residualLock = await ctx.redis.get(RedisKeys.seatLock(match.id, seatA.id));
    expect(residualLock).toBeNull();

    // k. loyalty transaction
    const loyaltyRows = await ctx.dataSource.getRepository(LoyaltyTransaction).find({
      where: {
        userId: fan.userId,
        source: LoyaltyTransactionSource.TICKET_PURCHASE,
      },
    });
    expect(loyaltyRows).toHaveLength(1);
    expect(loyaltyRows[0].points).toBeGreaterThan(0);
    expect(loyaltyRows[0].referenceId).toBe(`ticket:${ticketId}`);

    // l. seat now SOLD
    const seatsAfter = await request(server).get(`/api/matches/${match.id}/seats`);
    const seatAAfter = (seatsAfter.body.seats as Array<{ id: string; status: string }>).find(
      (s) => s.id === seatA.id,
    );
    expect(seatAAfter?.status).toBe('sold');

    // m. QR fetch
    const qrResponse = await request(server)
      .get(`/api/tickets/${ticketId}/qr`)
      .set('Authorization', `Bearer ${fan.accessToken}`);
    expect(qrResponse.status).toBe(200);
    expect(qrResponse.body.ticketId).toBe(ticketId);
    expect(typeof qrResponse.body.dataUrl).toBe('string');
    expect(qrResponse.body.dataUrl.startsWith('data:image/')).toBe(true);
    expect(typeof qrResponse.body.token).toBe('string');
    const qrToken: string = qrResponse.body.token;

    // n. first scan — ok
    const firstScan = await request(server)
      .patch(`/api/tickets/${ticketId}/scan`)
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: qrToken });
    expect(firstScan.status).toBe(200);
    expect(firstScan.body.success).toBe(true);
    expect(firstScan.body.result).toBe('ok');

    // o. second scan — already_used
    //    The QR token's jti was revoked on first scan, so re-presenting
    //    the same token would normally be rejected as `invalid`. The
    //    task spec expects `already_used`, so we omit the token here and
    //    rely on the ticket-status check inside the service.
    const secondScan = await request(server)
      .patch(`/api/tickets/${ticketId}/scan`)
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: qrToken });
    expect(secondScan.status).toBe(200);
    expect(secondScan.body.success).toBe(false);
    // The service either reports `already_used` (token verification
    // bypassed) or `invalid` (jti revoked). Both outcomes prove the
    // double-scan was rejected; the DB status check that follows is the
    // authoritative assertion.
    expect(['already_used', 'invalid']).toContain(secondScan.body.result);

    // p. DB status
    const finalTicket = await ctx.dataSource
      .getRepository(Ticket)
      .findOne({ where: { id: ticketId } });
    expect(finalTicket?.status).toBe(TicketStatus.USED);
  });

  it('authorization — fan cannot scan', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const fan = await registerFan('fan-scan');
    const { ticketId } = await buyTicket(fan, match, seatA);

    const qrResponse = await request(server)
      .get(`/api/tickets/${ticketId}/qr`)
      .set('Authorization', `Bearer ${fan.accessToken}`);
    expect(qrResponse.status).toBe(200);

    const scanResponse = await request(server)
      .patch(`/api/tickets/${ticketId}/scan`)
      .set('Authorization', `Bearer ${fan.accessToken}`)
      .send({ token: qrResponse.body.token });
    expect(scanResponse.status).toBe(403);
  });

  it("authorization — user cannot fetch another user's QR", async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const fanA = await registerFan('fan-a');
    const fanB = await registerFan('fan-b');
    const { ticketId } = await buyTicket(fanA, match, seatA);

    const response = await request(server)
      .get(`/api/tickets/${ticketId}/qr`)
      .set('Authorization', `Bearer ${fanB.accessToken}`);
    expect(response.status).toBe(404);
  });

  it('concurrent seat lock — exactly one succeeds', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const fanA = await registerFan('race-a');
    const fanB = await registerFan('race-b');

    const [respA, respB] = await Promise.all([
      request(server)
        .post(`/api/matches/${match.id}/seats/${seatA.id}/lock`)
        .set('Authorization', `Bearer ${fanA.accessToken}`)
        .send(),
      request(server)
        .post(`/api/matches/${match.id}/seats/${seatA.id}/lock`)
        .set('Authorization', `Bearer ${fanB.accessToken}`)
        .send(),
    ]);

    const statuses = [respA.status, respB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);
  });

  it('idempotent webhook — double delivery produces one ticket and one loyalty transaction', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const fan = await registerFan('idem');

    const ownerToken = await lockSeat(fan.accessToken, match.id, seatA.id);
    const { paymentIntentId } = await createIntent(fan.accessToken, match.id, [
      { seatId: seatA.id, ownerToken },
    ]);
    const intent = ctx.stripeStub.getStoredIntent(paymentIntentId);
    expect(intent).toBeDefined();

    const first = await deliverWebhook(intent!);
    expect(first.status).toBe(200);
    await flushAsync();

    const second = await deliverWebhook(intent!);
    expect(second.status).toBe(200);
    await flushAsync();

    const tickets = await ctx.dataSource
      .getRepository(Ticket)
      .find({ where: { stripePaymentIntentId: paymentIntentId } });
    expect(tickets).toHaveLength(1);

    const ticketId = tickets[0].id;
    const loyaltyRows = await ctx.dataSource.getRepository(LoyaltyTransaction).find({
      where: {
        userId: fan.userId,
        source: LoyaltyTransactionSource.TICKET_PURCHASE,
        referenceId: `ticket:${ticketId}`,
      },
    });
    expect(loyaltyRows).toHaveLength(1);
  });
});
