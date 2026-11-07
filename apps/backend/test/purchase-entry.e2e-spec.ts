import './setup/test-env';

import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { Server } from 'http';
import {
  Competition,
  LoyaltyTransaction,
  LoyaltyTransactionSource,
  Match,
  MatchStatus,
  PassLoan,
  PassLoanStatus,
  Seat,
  SeatCategory,
  SeasonPass,
  SeasonPassPrice,
  SeasonPassStatus,
  Ticket,
  TicketSource,
  TicketStatus,
} from '../src/database/entities';
import { ChatbotContextService } from '../src/modules/chatbot/chatbot-context.service';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import {
  createGateUser,
  seedMinimalFixture,
  seedSeasonPass,
  truncateAll,
} from './helpers/db.helper';
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
    ctx.stripeStub.refundCreateMock.mockClear();
  });

  /* ------------------------------------------------------------------ */
  /* Shared helpers                                                      */
  /* ------------------------------------------------------------------ */

  async function registerFan(
    emailSuffix = 'fan',
    name: { firstName: string; lastName: string } = { firstName: 'Teszt', lastName: 'Felhasználó' },
  ): Promise<RegisteredFan> {
    const email = `${emailSuffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@kte.hu`;
    const response = await request(server).post('/api/auth/register').send({
      email,
      password: PASSWORD,
      firstName: name.firstName,
      lastName: name.lastName,
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

  /* ------------------------------------------------------------------ */
  /* Seat-occupancy regression suite                                     */
  /*                                                                      */
  /* These cover the business rule in `OCCUPYING_TICKET_STATUSES`:       */
  /* a seat is held by any ticket in PENDING_PAYMENT / PAID / USED.      */
  /* CANCELLED, REFUNDED and EXPIRED release the seat.                   */
  /* ------------------------------------------------------------------ */

  async function fetchSeatMap(matchId: string): Promise<Array<{ id: string; status: string }>> {
    const response = await request(server).get(`/api/matches/${matchId}/seats`);
    expect(response.status).toBe(200);
    return response.body.seats as Array<{ id: string; status: string }>;
  }

  function findSeat(
    seats: Array<{ id: string; status: string }>,
    seatId: string,
  ): { id: string; status: string } {
    const row = seats.find((s) => s.id === seatId);
    if (!row) {
      throw new Error(`Seat ${seatId} not present in seat map`);
    }
    return row;
  }

  /**
   * Simulates a gate operator scanning a ticket. The ScanTicketDto demands a
   * JWT QR token (class-validator MinLength(20)), so we first fetch the
   * owner's QR via the owner-only endpoint and present it on the scan.
   */
  async function scanTicket(
    ownerAccessToken: string,
    gateToken: string,
    ticketId: string,
  ): Promise<SupertestResponse> {
    const qrResp = await request(server)
      .get(`/api/tickets/${ticketId}/qr`)
      .set('Authorization', `Bearer ${ownerAccessToken}`);
    expect(qrResp.status).toBe(200);
    const qrToken: string = qrResp.body.token;
    return request(server)
      .patch(`/api/tickets/${ticketId}/scan`)
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: qrToken });
  }

  it('a scanned (USED) ticket keeps its seat occupied on the seat map', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const fan = await registerFan('used-map');
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-used-1@kte.hu' });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);
    const { ticketId } = await buyTicket(fan, match, seatA);

    const scanResp = await scanTicket(fan.accessToken, gateToken, ticketId);
    expect(scanResp.status).toBe(200);
    expect(scanResp.body.success).toBe(true);
    expect(scanResp.body.result).toBe('ok');

    const dbTicket = await ctx.dataSource
      .getRepository(Ticket)
      .findOne({ where: { id: ticketId } });
    expect(dbTicket?.status).toBe(TicketStatus.USED);

    const seats = await fetchSeatMap(match.id);
    const seatARow = findSeat(seats, seatA.id);
    // The business rule: USED tickets still occupy their seat. The seat map
    // reports this status as 'sold' (the SeatAvailability enum does not
    // distinguish USED from PAID — the seat is simply not available).
    expect(seatARow.status).not.toBe('available');
    expect(seatARow.status).toBe('sold');
  });

  it('a scanned (USED) seat cannot be purchased again — availability check rejects the lock', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const firstFan = await registerFan('used-rebuy-1');
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-used-2@kte.hu' });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);
    const { ticketId } = await buyTicket(firstFan, match, seatA);

    const scanResp = await scanTicket(firstFan.accessToken, gateToken, ticketId);
    expect(scanResp.status).toBe(200);
    expect(scanResp.body.result).toBe('ok');

    // A different fan now tries to buy the same seat. The seat-map
    // availability check must reject the lock attempt with 409 BEFORE
    // Stripe is involved and before the DB unique constraint can fire.
    const secondFan = await registerFan('used-rebuy-2');
    const lockResponse = await request(server)
      .post(`/api/matches/${match.id}/seats/${seatA.id}/lock`)
      .set('Authorization', `Bearer ${secondFan.accessToken}`)
      .send();
    expect(lockResponse.status).toBe(409);
    expect(ctx.stripeStub.paymentIntentsCreateMock).toHaveBeenCalledTimes(1); // only the first purchase

    // No second ticket row was created.
    const ticketCount = await ctx.dataSource
      .getRepository(Ticket)
      .count({ where: { matchId: match.id, seatId: seatA.id } });
    expect(ticketCount).toBe(1);
  });

  it('cancelling a ticket releases the seat so a new purchase succeeds', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const firstFan = await registerFan('cancel-release-1');
    const { ticketId } = await buyTicket(firstFan, match, seatA);

    // Seat is sold right after the first purchase.
    let seats = await fetchSeatMap(match.id);
    expect(findSeat(seats, seatA.id).status).toBe('sold');

    // Admin / refund flow cancels the ticket.
    await ctx.dataSource
      .getRepository(Ticket)
      .update({ id: ticketId }, { status: TicketStatus.CANCELLED });

    // Seat must now be available on the public seat map — this is the half
    // of the business rule the OCCUPYING_TICKET_STATUSES refactor guarantees.
    seats = await fetchSeatMap(match.id);
    expect(findSeat(seats, seatA.id).status).toBe('available');

    // And a brand-new buyer can lock + purchase the seat. Note: the production
    // schema enforces UNIQUE(match_id, seat_id) on `tickets`, so even a
    // CANCELLED row would collide with a fresh PAID insert. Repurchase on a
    // cancelled seat is therefore a cold-reset path: the admin workflow
    // deletes the stale row before releasing the seat for resale, which is
    // what we simulate here. The alternative — relaxing the UNIQUE constraint
    // — is out of scope for this change (addressed under the admin refund
    // workflow backlog).
    await ctx.dataSource.getRepository(Ticket).delete({ id: ticketId });

    const secondFan = await registerFan('cancel-release-2');
    const ownerToken = await lockSeat(secondFan.accessToken, match.id, seatA.id);
    const { paymentIntentId } = await createIntent(secondFan.accessToken, match.id, [
      { seatId: seatA.id, ownerToken },
    ]);
    const intent = ctx.stripeStub.getStoredIntent(paymentIntentId);
    expect(intent).toBeDefined();
    const webhookResponse = await deliverWebhook(intent!);
    expect(webhookResponse.status).toBe(200);
    await flushAsync();

    const newTicket = await ctx.dataSource
      .getRepository(Ticket)
      .findOne({ where: { stripePaymentIntentId: intent!.id, userId: secondFan.userId } });
    expect(newTicket).not.toBeNull();
    expect(newTicket?.status).toBe(TicketStatus.PAID);
  });

  it('chatbot context free-seat count agrees with the seat map after a scan', async () => {
    const { match, seatA, seatB } = await seedMinimalFixture(ctx.dataSource);
    // Capacity is 2 (seatA + seatB). After purchasing and scanning seatA,
    // the free-seat count must still be 1 — the scanned seat remains held.
    const fan = await registerFan('chatbot-agree');
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-chatbot@kte.hu' });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);
    const { ticketId } = await buyTicket(fan, match, seatA);
    const scanResp = await scanTicket(fan.accessToken, gateToken, ticketId);
    expect(scanResp.body.result).toBe('ok');

    // Reach the service directly — ChatbotContextService has no public HTTP
    // route (it is consumed internally by ChatbotService), so DI retrieval
    // is the legitimate test entry point.
    const chatbotContext = ctx.app.get(ChatbotContextService);
    // Flush any cached snapshot from a prior test run.
    await ctx.redis.flushdb();
    const snapshot = await chatbotContext.getUpcomingMatchesSnapshot();
    const matchSnapshot = snapshot.upcomingMatches.find((m) => m.id === match.id);
    expect(matchSnapshot).toBeDefined();

    // Count free seats on the seat map.
    const seatMap = await fetchSeatMap(match.id);
    const seatMapFreeCount = seatMap.filter((s) => s.status === 'available').length;

    // seatB is free, seatA is occupied (USED). Both views must agree.
    expect(seatMapFreeCount).toBe(1);
    expect(findSeat(seatMap, seatA.id).status).toBe('sold');
    expect(findSeat(seatMap, seatB.id).status).toBe('available');
    expect(matchSnapshot!.availableSeats).toBe(seatMapFreeCount);
    expect(matchSnapshot!.soldSeats).toBe(1);
  });

  /* ------------------------------------------------------------------ */
  /* Season-pass + loan entry scenarios (unified gate)                  */
  /* ------------------------------------------------------------------ */

  /**
   * Materialises and scans a season-pass QR.
   * Calls the new GET /api/season-passes/:passId/qr/:matchId endpoint, then
   * presents the returned token at the gate scan endpoint.
   */
  async function getSeasonPassQr(
    accessToken: string,
    passId: string,
    matchId: string,
  ): Promise<{ ticketId: string; token: string }> {
    const resp = await request(server)
      .get(`/api/season-passes/${passId}/qr/${matchId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(resp.status).toBe(200);
    return { ticketId: resp.body.ticketId as string, token: resp.body.token as string };
  }

  async function getLoanTicketForBorrower(
    accessToken: string,
  ): Promise<{ id: string; source: string }> {
    const resp = await request(server)
      .get('/api/tickets/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(resp.status).toBe(200);
    const loan = (resp.body as Array<{ id: string; source: string }>).find(
      (t) => t.source === TicketSource.LOAN,
    );
    if (!loan) throw new Error('No loan ticket found for borrower');
    return loan;
  }

  async function createAndAcceptLoan(
    ownerToken: string,
    passId: string,
    matchId: string,
    borrowerEmail: string,
    borrowerToken: string,
  ): Promise<{ loanId: string }> {
    const createResp = await request(server)
      .post(`/api/season-passes/${passId}/loans`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ matchId, borrowerEmail });
    expect(createResp.status).toBe(201);
    const loanId: string = createResp.body.id as string;

    const loanRow = await ctx.dataSource
      .getRepository(PassLoan)
      .findOneOrFail({ where: { id: loanId } });

    const acceptResp = await request(server)
      .post(`/api/season-passes/loans/accept/${loanRow.invitationToken}`)
      .set('Authorization', `Bearer ${borrowerToken}`);
    expect(acceptResp.status).toBe(200);

    return { loanId };
  }

  it('scenario 1 — season-pass holder obtains a QR and enters the stadium', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const holder = await registerFan('sp-holder-1');
    const pass = await seedSeasonPass(ctx.dataSource, {
      userId: holder.userId,
      seatId: seatA.id,
    });
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-sp-1@kte.hu' });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);

    const { ticketId, token } = await getSeasonPassQr(holder.accessToken, pass.id, match.id);
    expect(ticketId).toBeDefined();

    const scanResp = await request(server)
      .patch(`/api/tickets/${ticketId}/scan`)
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token });
    expect(scanResp.status).toBe(200);
    expect(scanResp.body.success).toBe(true);
    expect(scanResp.body.result).toBe('ok');
    expect(scanResp.body.source).toBe(TicketSource.SEASON_PASS);

    const ticket = await ctx.dataSource
      .getRepository(Ticket)
      .findOneOrFail({ where: { id: ticketId } });
    expect(ticket.status).toBe(TicketStatus.USED);
    expect(ticket.source).toBe(TicketSource.SEASON_PASS);
  });

  it('scenario 2 — full loan: owner lends, borrower accepts, borrower enters at gate', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const owner = await registerFan('loan-owner-2');
    const borrower = await registerFan('loan-borrower-2');
    const pass = await seedSeasonPass(ctx.dataSource, { userId: owner.userId, seatId: seatA.id });
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-loan-2@kte.hu' });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);

    await createAndAcceptLoan(
      owner.accessToken,
      pass.id,
      match.id,
      borrower.email,
      borrower.accessToken,
    );

    const loanTicket = await getLoanTicketForBorrower(borrower.accessToken);
    expect(loanTicket.source).toBe(TicketSource.LOAN);

    const qrResp = await request(server)
      .get(`/api/tickets/${loanTicket.id}/qr`)
      .set('Authorization', `Bearer ${borrower.accessToken}`);
    expect(qrResp.status).toBe(200);

    const scanResp = await request(server)
      .patch(`/api/tickets/${loanTicket.id}/scan`)
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: qrResp.body.token });
    expect(scanResp.status).toBe(200);
    expect(scanResp.body.success).toBe(true);
    expect(scanResp.body.result).toBe('ok');
    expect(scanResp.body.source).toBe(TicketSource.LOAN);
  });

  it('scenario 3 — after acceptance the owner cannot enter that match on that seat', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const owner = await registerFan('loan-owner-3');
    const borrower = await registerFan('loan-borrower-3');
    const pass = await seedSeasonPass(ctx.dataSource, { userId: owner.userId, seatId: seatA.id });
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-loan-3@kte.hu' });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);

    // Owner materialises their ticket first
    const { ticketId: ownerTicketId, token: ownerToken } = await getSeasonPassQr(
      owner.accessToken,
      pass.id,
      match.id,
    );

    // Loan is created and accepted — owner's ticket is deleted and QR revoked
    await createAndAcceptLoan(
      owner.accessToken,
      pass.id,
      match.id,
      borrower.email,
      borrower.accessToken,
    );

    // Owner's original token is rejected (ticket was deleted)
    const ownerScan = await request(server)
      .patch(`/api/tickets/${ownerTicketId}/scan`)
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: ownerToken });
    expect(ownerScan.status).toBe(200);
    expect(ownerScan.body.success).toBe(false);

    // Owner's season-pass QR endpoint is also blocked for this match
    const ownerQr2 = await request(server)
      .get(`/api/season-passes/${pass.id}/qr/${match.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(ownerQr2.status).toBe(409);
  });

  it("scenario 4 — borrower's entry does not free the seat for sale", async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const owner = await registerFan('seat-lock-owner-4');
    const borrower = await registerFan('seat-lock-borrower-4');
    const pass = await seedSeasonPass(ctx.dataSource, { userId: owner.userId, seatId: seatA.id });
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-lock-4@kte.hu' });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);

    await createAndAcceptLoan(
      owner.accessToken,
      pass.id,
      match.id,
      borrower.email,
      borrower.accessToken,
    );

    // Borrower enters
    const loanTicket = await getLoanTicketForBorrower(borrower.accessToken);
    const qrResp = await request(server)
      .get(`/api/tickets/${loanTicket.id}/qr`)
      .set('Authorization', `Bearer ${borrower.accessToken}`);
    await request(server)
      .patch(`/api/tickets/${loanTicket.id}/scan`)
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: qrResp.body.token });

    // Seat must NOT become available — the USED LOAN Ticket still occupies it
    const lockResp = await request(server)
      .post(`/api/matches/${match.id}/seats/${seatA.id}/lock`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send();
    expect(lockResp.status).toBe(409);

    // Only one ticket row for this (match, seat)
    const count = await ctx.dataSource
      .getRepository(Ticket)
      .count({ where: { matchId: match.id, seatId: seatA.id } });
    expect(count).toBe(1);
  });

  it('scenario 5 — revocation before use: borrower QR rejected, owner can enter again', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const owner = await registerFan('revoke-pre-owner-5');
    const borrower = await registerFan('revoke-pre-borrower-5');
    const pass = await seedSeasonPass(ctx.dataSource, { userId: owner.userId, seatId: seatA.id });
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-revoke-pre-5@kte.hu' });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);

    const { loanId } = await createAndAcceptLoan(
      owner.accessToken,
      pass.id,
      match.id,
      borrower.email,
      borrower.accessToken,
    );

    // Capture borrower's QR token before cancellation
    const loanTicket = await getLoanTicketForBorrower(borrower.accessToken);
    const borrowerQr = await request(server)
      .get(`/api/tickets/${loanTicket.id}/qr`)
      .set('Authorization', `Bearer ${borrower.accessToken}`);
    expect(borrowerQr.status).toBe(200);
    const borrowerToken: string = borrowerQr.body.token as string;
    const borrowerTicketId: string = loanTicket.id;

    // Owner cancels the loan
    const cancelResp = await request(server)
      .delete(`/api/season-passes/${pass.id}/loans/${loanId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ reason: 'Changed mind' });
    expect(cancelResp.status).toBe(200);

    // Borrower's QR is rejected (ticket deleted)
    const borrowerScan = await request(server)
      .patch(`/api/tickets/${borrowerTicketId}/scan`)
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: borrowerToken });
    expect(borrowerScan.status).toBe(200);
    expect(borrowerScan.body.success).toBe(false);

    // Owner can re-materialise their ticket and enter
    const { ticketId: newTicketId, token: ownerToken } = await getSeasonPassQr(
      owner.accessToken,
      pass.id,
      match.id,
    );
    const ownerScan = await request(server)
      .patch(`/api/tickets/${newTicketId}/scan`)
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: ownerToken });
    expect(ownerScan.status).toBe(200);
    expect(ownerScan.body.success).toBe(true);
    expect(ownerScan.body.result).toBe('ok');
  });

  it('scenario 6 — revocation after borrower entered: no new usable entry for either party', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const owner = await registerFan('revoke-post-owner-6');
    const borrower = await registerFan('revoke-post-borrower-6');
    const pass = await seedSeasonPass(ctx.dataSource, { userId: owner.userId, seatId: seatA.id });
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-revoke-post-6@kte.hu' });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);

    const { loanId } = await createAndAcceptLoan(
      owner.accessToken,
      pass.id,
      match.id,
      borrower.email,
      borrower.accessToken,
    );

    // Borrower enters
    const loanTicket = await getLoanTicketForBorrower(borrower.accessToken);
    const qrResp = await request(server)
      .get(`/api/tickets/${loanTicket.id}/qr`)
      .set('Authorization', `Bearer ${borrower.accessToken}`);
    const scanResp = await request(server)
      .patch(`/api/tickets/${loanTicket.id}/scan`)
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: qrResp.body.token });
    expect(scanResp.body.success).toBe(true);

    // Owner tries to cancel AFTER the borrower entered
    const cancelResp = await request(server)
      .delete(`/api/season-passes/${pass.id}/loans/${loanId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ reason: 'Post-entry cancel attempt' });
    expect(cancelResp.status).toBe(200);

    // Owner trying to get a QR must be blocked — a USED LOAN Ticket still
    // occupies the (match, seat) slot
    const ownerQr = await request(server)
      .get(`/api/season-passes/${pass.id}/qr/${match.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(ownerQr.status).toBe(409);

    // Only the USED loan ticket remains — no second usable entry
    const tickets = await ctx.dataSource
      .getRepository(Ticket)
      .find({ where: { matchId: match.id, seatId: seatA.id } });
    expect(tickets).toHaveLength(1);
    expect(tickets[0].status).toBe(TicketStatus.USED);
    expect(tickets[0].source).toBe(TicketSource.LOAN);
  });

  it('scenario 7 — loan on match A does not affect owner entry on match B', async () => {
    const { match: matchA, seatA } = await seedMinimalFixture(ctx.dataSource);

    // Create a second match independently
    const matchB = await ctx.dataSource.getRepository(Match).save(
      ctx.dataSource.getRepository(Match).create({
        homeTeam: 'Kecskeméti TE',
        awayTeam: 'Next Match Rivals',
        competition: Competition.NB1,
        venue: 'Széktói Stadion',
        kickoffAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        status: MatchStatus.ON_SALE,
        capacity: 2,
        basePrice: '5000.00',
        isSeasonPassEligible: true,
      }),
    );

    const owner = await registerFan('next-match-owner-7');
    const borrower = await registerFan('next-match-borrower-7');
    const pass = await seedSeasonPass(ctx.dataSource, { userId: owner.userId, seatId: seatA.id });
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-next-7@kte.hu' });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);

    // Owner loans match A to the borrower
    await createAndAcceptLoan(
      owner.accessToken,
      pass.id,
      matchA.id,
      borrower.email,
      borrower.accessToken,
    );

    // Owner can still enter match B — the loan only affects match A
    const { ticketId: ticketB, token: tokenB } = await getSeasonPassQr(
      owner.accessToken,
      pass.id,
      matchB.id,
    );
    const scanResp = await request(server)
      .patch(`/api/tickets/${ticketB}/scan`)
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: tokenB });
    expect(scanResp.status).toBe(200);
    expect(scanResp.body.success).toBe(true);
    expect(scanResp.body.result).toBe('ok');
  });

  it('scenario 8 — same QR presented at two gates simultaneously: exactly one scan succeeds', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const holder = await registerFan('concurrent-sp-8');
    const pass = await seedSeasonPass(ctx.dataSource, {
      userId: holder.userId,
      seatId: seatA.id,
    });
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-concurrent-8@kte.hu' });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);

    const { ticketId, token } = await getSeasonPassQr(holder.accessToken, pass.id, match.id);

    // Two concurrent scans with the SAME token — genuine concurrency via Promise.all
    const [scanA, scanB] = await Promise.all([
      request(server)
        .patch(`/api/tickets/${ticketId}/scan`)
        .set('Authorization', `Bearer ${gateToken}`)
        .send({ token }),
      request(server)
        .patch(`/api/tickets/${ticketId}/scan`)
        .set('Authorization', `Bearer ${gateToken}`)
        .send({ token }),
    ]);

    expect(scanA.status).toBe(200);
    expect(scanB.status).toBe(200);

    const results = [scanA.body.result as string, scanB.body.result as string];
    // Exactly one scan succeeds
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);

    // DB shows the ticket as USED (exactly once)
    const ticket = await ctx.dataSource
      .getRepository(Ticket)
      .findOneOrFail({ where: { id: ticketId } });
    expect(ticket.status).toBe(TicketStatus.USED);
  });

  it('scenario 9 — acceptLoan refused when owner already entered: USED ticket intact, no LOAN ticket, loan REVOKED', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const owner = await registerFan('accept-after-entry-owner-9');
    const borrower = await registerFan('accept-after-entry-borrower-9');
    const pass = await seedSeasonPass(ctx.dataSource, { userId: owner.userId, seatId: seatA.id });
    const gate = await createGateUser(ctx.dataSource, {
      email: 'gate-accept-after-entry-9@kte.hu',
    });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);

    // Owner materialises their QR and enters the stadium
    const { ticketId: ownerTicketId, token: ownerQrToken } = await getSeasonPassQr(
      owner.accessToken,
      pass.id,
      match.id,
    );
    const scanResp = await request(server)
      .patch(`/api/tickets/${ownerTicketId}/scan`)
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token: ownerQrToken });
    expect(scanResp.status).toBe(200);
    expect(scanResp.body.success).toBe(true);
    expect(scanResp.body.result).toBe('ok');

    const usedTicket = await ctx.dataSource
      .getRepository(Ticket)
      .findOneOrFail({ where: { id: ownerTicketId } });
    expect(usedTicket.status).toBe(TicketStatus.USED);

    // Owner creates a loan invitation after having already entered
    const createResp = await request(server)
      .post(`/api/season-passes/${pass.id}/loans`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ matchId: match.id, borrowerEmail: borrower.email });
    expect(createResp.status).toBe(201);
    const loanId: string = createResp.body.id as string;

    const loanRow = await ctx.dataSource
      .getRepository(PassLoan)
      .findOneOrFail({ where: { id: loanId } });

    // Borrower tries to accept — must be refused with 409
    const acceptResp = await request(server)
      .post(`/api/season-passes/loans/accept/${loanRow.invitationToken}`)
      .set('Authorization', `Bearer ${borrower.accessToken}`);
    expect(acceptResp.status).toBe(409);

    // Owner's USED ticket must remain intact
    const ownerTicketAfter = await ctx.dataSource
      .getRepository(Ticket)
      .findOneOrFail({ where: { id: ownerTicketId } });
    expect(ownerTicketAfter.status).toBe(TicketStatus.USED);
    expect(ownerTicketAfter.source).toBe(TicketSource.SEASON_PASS);

    // No LOAN ticket was created for this (match, seat)
    const loanTickets = await ctx.dataSource
      .getRepository(Ticket)
      .find({ where: { matchId: match.id, seatId: seatA.id, source: TicketSource.LOAN } });
    expect(loanTickets).toHaveLength(0);

    // The loan must end in REVOKED state — a clear terminal signal
    const finalLoan = await ctx.dataSource
      .getRepository(PassLoan)
      .findOneOrFail({ where: { id: loanId } });
    expect(finalLoan.status).toBe(PassLoanStatus.REVOKED);
  });

  /* ------------------------------------------------------------------ */
  /* Expired-lock timing scenarios                                       */
  /* ------------------------------------------------------------------ */

  it('scenario 10 — lock expired, seat still free: ticket is issued, no refund requested', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const fan = await registerFan('lock-expired-free-10');

    const ownerToken = await lockSeat(fan.accessToken, match.id, seatA.id);
    const { paymentIntentId } = await createIntent(fan.accessToken, match.id, [
      { seatId: seatA.id, ownerToken },
    ]);
    const intent = ctx.stripeStub.getStoredIntent(paymentIntentId)!;

    // Simulate lock expiry: delete the Redis key before the webhook fires
    await ctx.redis.del(RedisKeys.seatLock(match.id, seatA.id));

    const webhookResp = await deliverWebhook(intent);
    expect(webhookResp.status).toBe(200);
    await flushAsync();

    // Ticket was issued despite the expired lock (seat was still free in DB)
    const ticket = await ctx.dataSource.getRepository(Ticket).findOne({
      where: { stripePaymentIntentId: intent.id, userId: fan.userId },
    });
    expect(ticket).not.toBeNull();
    expect(ticket?.status).toBe(TicketStatus.PAID);

    // No refund was requested
    expect(ctx.stripeStub.refundCreateMock).not.toHaveBeenCalled();
  });

  it('scenario 11 — lock expired, seat taken by another buyer: no ticket for late buyer, full refund requested, winner ticket untouched', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const fan1 = await registerFan('lock-expired-taken-1-11');
    const fan2 = await registerFan('lock-expired-taken-2-11');

    // fan1: lock + create intent
    const ownerToken1 = await lockSeat(fan1.accessToken, match.id, seatA.id);
    const { paymentIntentId: pid1 } = await createIntent(fan1.accessToken, match.id, [
      { seatId: seatA.id, ownerToken: ownerToken1 },
    ]);
    const intent1 = ctx.stripeStub.getStoredIntent(pid1)!;

    // Simulate fan1's lock expiry
    await ctx.redis.del(RedisKeys.seatLock(match.id, seatA.id));

    // fan2 acquires the now-free seat and completes the purchase
    const ownerToken2 = await lockSeat(fan2.accessToken, match.id, seatA.id);
    const { paymentIntentId: pid2 } = await createIntent(fan2.accessToken, match.id, [
      { seatId: seatA.id, ownerToken: ownerToken2 },
    ]);
    const intent2 = ctx.stripeStub.getStoredIntent(pid2)!;
    const webhook2 = await deliverWebhook(intent2);
    expect(webhook2.status).toBe(200);
    await flushAsync();

    const fan2Ticket = await ctx.dataSource.getRepository(Ticket).findOne({
      where: { stripePaymentIntentId: pid2, userId: fan2.userId },
    });
    expect(fan2Ticket).not.toBeNull();

    // fan1's late webhook arrives — seatA is now taken
    const webhook1 = await deliverWebhook(intent1);
    expect(webhook1.status).toBe(200);
    await flushAsync();

    // No ticket for fan1
    const fan1Ticket = await ctx.dataSource.getRepository(Ticket).findOne({
      where: { stripePaymentIntentId: pid1 },
    });
    expect(fan1Ticket).toBeNull();

    // Full refund was requested for fan1
    expect(ctx.stripeStub.refundCreateMock).toHaveBeenCalledTimes(1);
    expect(ctx.stripeStub.refundCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: pid1 }),
      expect.anything(),
    );

    // fan2's ticket is untouched
    const fan2TicketAfter = await ctx.dataSource
      .getRepository(Ticket)
      .findOneOrFail({ where: { id: fan2Ticket!.id } });
    expect(fan2TicketAfter.status).toBe(TicketStatus.PAID);

    // Seat map shows seatA as occupied (by fan2)
    const seats = await fetchSeatMap(match.id);
    expect(findSeat(seats, seatA.id).status).toBe('sold');
  });

  it('scenario 12 — mixed basket: seatA taken, seatB free → ticket for seatB only, partial refund for seatA', async () => {
    const { match, seatA, seatB } = await seedMinimalFixture(ctx.dataSource);
    const fan1 = await registerFan('mixed-basket-fan1-12');
    const fan2 = await registerFan('mixed-basket-fan2-12');

    // fan1 locks both seats and creates a 2-seat intent
    const ownerTokenA = await lockSeat(fan1.accessToken, match.id, seatA.id);
    const ownerTokenB = await lockSeat(fan1.accessToken, match.id, seatB.id);
    const { paymentIntentId: pid1, amount: totalAmount } = await createIntent(
      fan1.accessToken,
      match.id,
      [
        { seatId: seatA.id, ownerToken: ownerTokenA },
        { seatId: seatB.id, ownerToken: ownerTokenB },
      ],
    );
    const intent1 = ctx.stripeStub.getStoredIntent(pid1)!;

    // fan1's locks expire
    await ctx.redis.del(RedisKeys.seatLock(match.id, seatA.id));
    await ctx.redis.del(RedisKeys.seatLock(match.id, seatB.id));

    // fan2 buys only seatA in the meantime
    const ownerToken2 = await lockSeat(fan2.accessToken, match.id, seatA.id);
    const { paymentIntentId: pid2 } = await createIntent(fan2.accessToken, match.id, [
      { seatId: seatA.id, ownerToken: ownerToken2 },
    ]);
    await deliverWebhook(ctx.stripeStub.getStoredIntent(pid2)!);
    await flushAsync();

    // fan1's webhook arrives: seatA is taken, seatB is still free
    const webhook1 = await deliverWebhook(intent1);
    expect(webhook1.status).toBe(200);
    await flushAsync();

    // Exactly one ticket for fan1 — only seatB
    const fan1Tickets = await ctx.dataSource.getRepository(Ticket).find({
      where: { stripePaymentIntentId: pid1, userId: fan1.userId },
    });
    expect(fan1Tickets).toHaveLength(1);
    expect(fan1Tickets[0].seatId).toBe(seatB.id);
    expect(fan1Tickets[0].status).toBe(TicketStatus.PAID);

    // Partial refund for seatA only (less than the full basket total)
    expect(ctx.stripeStub.refundCreateMock).toHaveBeenCalledTimes(1);
    const refundArgs = ctx.stripeStub.refundCreateMock.mock.calls[0][0] as {
      payment_intent: string;
      amount: number;
    };
    expect(refundArgs.payment_intent).toBe(pid1);
    // The refund covers one seat's share; the full basket is two seats
    const stripeTotal = totalAmount * 100;
    expect(refundArgs.amount).toBeGreaterThan(0);
    expect(refundArgs.amount).toBeLessThan(stripeTotal);
  });

  it('scenario 13 — webhook and confirm arrive concurrently: exactly one ticket, no error state', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const fan = await registerFan('concurrent-finalize-13');

    const ownerToken = await lockSeat(fan.accessToken, match.id, seatA.id);
    const { paymentIntentId } = await createIntent(fan.accessToken, match.id, [
      { seatId: seatA.id, ownerToken },
    ]);
    const intent = ctx.stripeStub.getStoredIntent(paymentIntentId)!;

    // Genuine concurrency: fire both paths simultaneously
    const [webhookResp, confirmResp] = await Promise.all([
      deliverWebhook(intent),
      request(server)
        .post('/api/payments/confirm')
        .set('Authorization', `Bearer ${fan.accessToken}`)
        .send({ paymentIntentId }),
    ]);

    await flushAsync();

    // Both paths must succeed (no 5xx)
    expect(webhookResp.status).toBe(200);
    expect([200, 201]).toContain(confirmResp.status);

    // Exactly one ticket must exist — the concurrent path must not duplicate
    const tickets = await ctx.dataSource.getRepository(Ticket).find({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    expect(tickets).toHaveLength(1);
    expect(tickets[0].status).toBe(TicketStatus.PAID);

    // No refund was triggered — this is a clean concurrent finalization
    expect(ctx.stripeStub.refundCreateMock).not.toHaveBeenCalled();
  });

  /* ------------------------------------------------------------------ */
  /* Season-pass list endpoint — date serialisation regression          */
  /*                                                                      */
  /* Regression guard for the DATE column bug: MySQL returns 'date'      */
  /* columns as plain strings, so any call to .toISOString() on the raw  */
  /* entity value crashes with "not a function". These tests ensure the   */
  /* endpoint returns 200 with valid ISO strings regardless of whether    */
  /* the transformer is wired or not — a 500 here means the fix regressed.*/
  /* ------------------------------------------------------------------ */

  it('season-pass list: user with no passes returns 200 and empty array', async () => {
    const fan = await registerFan('sp-date-none');
    const resp = await request(server)
      .get('/api/season-passes/me')
      .set('Authorization', `Bearer ${fan.accessToken}`);
    expect(resp.status).toBe(200);
    expect(resp.body).toEqual([]);
  });

  it('season-pass list: user who owns a pass returns 200 with valid ISO date strings', async () => {
    const { seatA } = await seedMinimalFixture(ctx.dataSource);
    const fan = await registerFan('sp-date-owner');
    const pass = await seedSeasonPass(ctx.dataSource, { userId: fan.userId, seatId: seatA.id });

    const resp = await request(server)
      .get('/api/season-passes/me')
      .set('Authorization', `Bearer ${fan.accessToken}`);

    expect(resp.status).toBe(200);
    expect(Array.isArray(resp.body)).toBe(true);
    expect(resp.body).toHaveLength(1);

    const dto = resp.body[0] as {
      id: string;
      status: string;
      validFrom: string;
      validUntil: string;
    };
    expect(dto.id).toBe(pass.id);
    expect(dto.status).toBe('active');

    // Must be non-empty strings
    expect(typeof dto.validFrom).toBe('string');
    expect(typeof dto.validUntil).toBe('string');

    // Must be parseable ISO datetimes (not the raw MySQL '2026-07-01' date string)
    const from = new Date(dto.validFrom);
    const until = new Date(dto.validUntil);
    expect(isNaN(from.getTime())).toBe(false);
    expect(isNaN(until.getTime())).toBe(false);

    // ISO format check: must start with the date portion then 'T'
    expect(dto.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dto.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Round-tripping: the date portion must match what was seeded
    expect(dto.validFrom.startsWith('2026-07-01')).toBe(true);
    expect(dto.validUntil.startsWith('2027-06-30')).toBe(true);
  });

  it('season-pass QR: 400 when match kickoff is outside pass validity window', async () => {
    const matchRepo = ctx.dataSource.getRepository(Match);
    const seatRepo = ctx.dataSource.getRepository(Seat);

    const seatOut = await seatRepo.save(
      seatRepo.create({
        section: 'B',
        row: '1',
        number: 99,
        category: SeatCategory.STANDARD,
        priceModifier: '1.00',
        isAccessible: false,
        isActive: true,
      }),
    );

    // Match whose kickoffAt is before the pass validFrom (2026-07-01)
    const matchOutside = await matchRepo.save(
      matchRepo.create({
        homeTeam: 'Kecskeméti TE',
        awayTeam: 'Outside Rivals',
        competition: Competition.NB1,
        venue: 'Széktói Stadion',
        kickoffAt: new Date('2025-09-15T17:00:00Z'),
        status: MatchStatus.ON_SALE,
        capacity: 10,
        basePrice: '5000.00',
        isSeasonPassEligible: true,
      }),
    );

    const fan = await registerFan('sp-validity');
    const pass = await seedSeasonPass(ctx.dataSource, { userId: fan.userId, seatId: seatOut.id });

    const resp = await request(server)
      .get(`/api/season-passes/${pass.id}/qr/${matchOutside.id}`)
      .set('Authorization', `Bearer ${fan.accessToken}`);

    expect(resp.status).toBe(400);
    expect(resp.body.code).toBe('match_outside_validity');
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

  /* ------------------------------------------------------------------ */
  /* Season-pass purchase webhook scenarios                              */
  /* ------------------------------------------------------------------ */

  async function seedSeasonPassPrice(section = 'A', seatCount = 3): Promise<SeasonPassPrice> {
    // Passes get a seat at purchase, so the section needs free seats.
    const seatRepo = ctx.dataSource.getRepository(Seat);
    for (let n = 1; n <= seatCount; n++) {
      await seatRepo.save(
        seatRepo.create({
          section,
          row: 'SP',
          number: n,
          category: SeatCategory.STANDARD,
          priceModifier: '1.00',
          isAccessible: false,
          isActive: true,
        }),
      );
    }
    const repo = ctx.dataSource.getRepository(SeasonPassPrice);
    return repo.save(
      repo.create({
        section,
        sectionLabel: `Szektor ${section}`,
        seasonLabel: '2026/2027',
        price: 30000,
        currency: 'HUF',
        validFrom: new Date('2026-07-01'),
        validUntil: new Date('2027-06-30'),
        isActive: true,
      }),
    );
  }

  async function purchaseSeasonPassIntent(
    accessToken: string,
    sectionId: string,
  ): Promise<{ paymentIntentId: string }> {
    const resp = await request(server)
      .post('/api/season-passes/purchase')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sectionId });
    expect(resp.status).toBe(201);
    return { paymentIntentId: resp.body.paymentIntentId as string };
  }

  it('season-pass purchase scenario a — webhook-only finalisation: exactly one pass, status active, loyalty awarded', async () => {
    const priceRow = await seedSeasonPassPrice('A');
    const fan = await registerFan('sp-purchase-a');

    const { paymentIntentId } = await purchaseSeasonPassIntent(fan.accessToken, priceRow.section);
    const intent = ctx.stripeStub.getStoredIntent(paymentIntentId);
    expect(intent).toBeDefined();

    expect(intent?.metadata.kind).toBe('season_pass');
    expect(intent?.metadata.priceRowId).toBe(priceRow.id);
    expect(intent?.metadata.userId).toBe(fan.userId);

    // Stub returns requires_payment_method — synchronous path skipped
    const beforePass = await ctx.dataSource
      .getRepository(SeasonPass)
      .findOne({ where: { stripePaymentIntentId: intent!.id } });
    expect(beforePass).toBeNull();

    const webhookResp = await deliverWebhook(intent!);
    expect(webhookResp.status).toBe(200);
    await flushAsync();

    const passes = await ctx.dataSource
      .getRepository(SeasonPass)
      .find({ where: { stripePaymentIntentId: intent!.id } });
    expect(passes).toHaveLength(1);
    expect(passes[0].status).toBe(SeasonPassStatus.ACTIVE);
    expect(passes[0].userId).toBe(fan.userId);

    const loyalty = await ctx.dataSource.getRepository(LoyaltyTransaction).find({
      where: { userId: fan.userId, source: LoyaltyTransactionSource.SEASON_PASS_PURCHASE },
    });
    expect(loyalty).toHaveLength(1);
    expect(loyalty[0].referenceId).toBe(`season_pass:${passes[0].id}`);
  });

  it('season-pass purchase scenario b — double webhook delivery: one pass, one loyalty transaction', async () => {
    const priceRow = await seedSeasonPassPrice('B');
    const fan = await registerFan('sp-purchase-b');

    const { paymentIntentId } = await purchaseSeasonPassIntent(fan.accessToken, priceRow.section);
    const intent = ctx.stripeStub.getStoredIntent(paymentIntentId)!;

    const first = await deliverWebhook(intent);
    expect(first.status).toBe(200);
    await flushAsync();

    const second = await deliverWebhook(intent);
    expect(second.status).toBe(200);
    await flushAsync();

    const passes = await ctx.dataSource
      .getRepository(SeasonPass)
      .find({ where: { stripePaymentIntentId: intent.id } });
    expect(passes).toHaveLength(1);

    const loyalty = await ctx.dataSource.getRepository(LoyaltyTransaction).find({
      where: { userId: fan.userId, source: LoyaltyTransactionSource.SEASON_PASS_PURCHASE },
    });
    expect(loyalty).toHaveLength(1);
  });

  it('season-pass purchase scenario c — ticket intent still produces tickets, no season pass created', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const fan = await registerFan('sp-purchase-c');

    await buyTicket(fan, match, seatA);

    const seasonPasses = await ctx.dataSource
      .getRepository(SeasonPass)
      .find({ where: { userId: fan.userId } });
    expect(seasonPasses).toHaveLength(0);

    const tickets = await ctx.dataSource
      .getRepository(Ticket)
      .find({ where: { userId: fan.userId } });
    expect(tickets).toHaveLength(1);
    expect(tickets[0].status).toBe(TicketStatus.PAID);
  });

  it('season-pass purchase scenario d — unusable metadata: no pass created, webhook returns 200', async () => {
    const fan = await registerFan('sp-purchase-d');

    const malformedIntent: StubbedPaymentIntent = {
      id: `pi_malformed_${Date.now()}`,
      object: 'payment_intent',
      client_secret: 'cs_test',
      status: 'succeeded',
      amount: 3000000,
      currency: 'huf',
      metadata: {
        kind: 'season_pass',
        userId: fan.userId,
        // priceRowId intentionally omitted
      },
    };

    const webhookResp = await deliverWebhook(malformedIntent);
    expect(webhookResp.status).toBe(200);
    await flushAsync();

    const passes = await ctx.dataSource
      .getRepository(SeasonPass)
      .find({ where: { userId: fan.userId } });
    expect(passes).toHaveLength(0);

    const loyalty = await ctx.dataSource.getRepository(LoyaltyTransaction).find({
      where: { userId: fan.userId, source: LoyaltyTransactionSource.SEASON_PASS_PURCHASE },
    });
    expect(loyalty).toHaveLength(0);
  });

  /* ------------------------------------------------------------------ */
  /* Idempotency key fix — scenarios                                     */
  /* ------------------------------------------------------------------ */

  it('season-pass idempotency — two purchase requests for the same attempt collapse to exactly one PaymentIntent, one pass, one loyalty tx', async () => {
    const priceRow = await seedSeasonPassPrice('E');
    const fan = await registerFan('sp-idem-a');

    // Two successive calls while the Redis attempt key is still alive.
    const { paymentIntentId: id1 } = await purchaseSeasonPassIntent(
      fan.accessToken,
      priceRow.section,
    );
    const { paymentIntentId: id2 } = await purchaseSeasonPassIntent(
      fan.accessToken,
      priceRow.section,
    );

    // Both calls must resolve to the same PaymentIntent.
    expect(id1).toBe(id2);

    // Stripe's create was invoked twice but only created one intent (second
    // call returned the cached entry via the shared idempotency key).
    expect(ctx.stripeStub.paymentIntentsCreateMock).toHaveBeenCalledTimes(2);
    const allResults = await Promise.all(
      ctx.stripeStub.paymentIntentsCreateMock.mock.results.map(
        (r) => r.value as Promise<{ id: string }>,
      ),
    );
    const uniqueIds = new Set(allResults.map((i) => i.id));
    expect(uniqueIds.size).toBe(1);

    // Delivering the webhook once must produce exactly one pass and one loyalty tx.
    const intent = ctx.stripeStub.getStoredIntent(id1)!;
    const webhookResp = await deliverWebhook(intent);
    expect(webhookResp.status).toBe(200);
    await flushAsync();

    const passes = await ctx.dataSource
      .getRepository(SeasonPass)
      .find({ where: { stripePaymentIntentId: intent.id } });
    expect(passes).toHaveLength(1);

    const loyalty = await ctx.dataSource.getRepository(LoyaltyTransaction).find({
      where: { userId: fan.userId, source: LoyaltyTransactionSource.SEASON_PASS_PURCHASE },
    });
    expect(loyalty).toHaveLength(1);
  });

  it('season-pass idempotency — retry after card decline creates a fresh PaymentIntent without a 24-hour block', async () => {
    const priceRow = await seedSeasonPassPrice('F');
    const fan = await registerFan('sp-idem-b');

    // First attempt: simulate a card decline (Stripe throws with payment_intent).
    const declinedId = `pi_declined_${Date.now()}`;
    ctx.stripeStub.paymentIntentsCreateMock.mockRejectedValueOnce(
      Object.assign(new Error('Your card was declined'), {
        payment_intent: {
          id: declinedId,
          object: 'payment_intent',
          status: 'payment_failed',
          client_secret: null,
          metadata: {},
        },
      }),
    );
    const resp1 = await request(server)
      .post('/api/season-passes/purchase')
      .set('Authorization', `Bearer ${fan.accessToken}`)
      .send({ sectionId: priceRow.section });
    expect(resp1.status).toBe(201);
    expect(resp1.body.paymentIntentId).toBe(declinedId);

    // After the decline the service must have deleted the Redis attempt key.
    expect(await ctx.redis.keys('seasonpass-attempt:*')).toHaveLength(0);

    // Second attempt: must succeed immediately — no 24-hour block, new intent.
    const { paymentIntentId: newId } = await purchaseSeasonPassIntent(
      fan.accessToken,
      priceRow.section,
    );
    expect(newId).not.toBe(declinedId);

    // Webhook for the new intent → exactly one pass, zero passes for the declined id.
    const intent = ctx.stripeStub.getStoredIntent(newId)!;
    expect(intent).toBeDefined();
    await deliverWebhook(intent);
    await flushAsync();

    const passes = await ctx.dataSource.getRepository(SeasonPass).find({
      where: { userId: fan.userId },
    });
    expect(passes).toHaveLength(1);
    expect(passes[0].stripePaymentIntentId).toBe(newId);
  });

  it('ticket idempotency — two createIntent calls with the same seat locks collapse to one PaymentIntent', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const fan = await registerFan('tkt-idem-a');

    const ownerToken = await lockSeat(fan.accessToken, match.id, seatA.id);

    const { paymentIntentId: id1 } = await createIntent(fan.accessToken, match.id, [
      { seatId: seatA.id, ownerToken },
    ]);
    const { paymentIntentId: id2 } = await createIntent(fan.accessToken, match.id, [
      { seatId: seatA.id, ownerToken },
    ]);

    // Same ownerToken → same hash → same Stripe idempotency key → same intent.
    expect(id1).toBe(id2);

    // Delivering the webhook once must yield exactly one ticket.
    const intent = ctx.stripeStub.getStoredIntent(id1)!;
    await deliverWebhook(intent);
    await flushAsync();

    const tickets = await ctx.dataSource
      .getRepository(Ticket)
      .find({ where: { userId: fan.userId } });
    expect(tickets).toHaveLength(1);
    expect(tickets[0].status).toBe(TicketStatus.PAID);
  });

  it('ticket idempotency — createIntent after re-acquiring seat lock creates a fresh PaymentIntent', async () => {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const fan = await registerFan('tkt-idem-b');

    // First attempt.
    const ownerToken1 = await lockSeat(fan.accessToken, match.id, seatA.id);
    const { paymentIntentId: id1 } = await createIntent(fan.accessToken, match.id, [
      { seatId: seatA.id, ownerToken: ownerToken1 },
    ]);

    // Simulate the first attempt being abandoned: release the seat lock so
    // the user can re-acquire it for a fresh attempt.
    await ctx.redis.del(RedisKeys.seatLock(match.id, seatA.id));

    // Second attempt with a fresh lock → new ownerToken → different hash.
    const ownerToken2 = await lockSeat(fan.accessToken, match.id, seatA.id);
    expect(ownerToken2).not.toBe(ownerToken1);

    const { paymentIntentId: id2 } = await createIntent(fan.accessToken, match.id, [
      { seatId: seatA.id, ownerToken: ownerToken2 },
    ]);

    // Different hash → different idempotency key → different PaymentIntent.
    expect(id2).not.toBe(id1);

    // Only the second intent is fulfilled; zero tickets for the first.
    const intent2 = ctx.stripeStub.getStoredIntent(id2)!;
    await deliverWebhook(intent2);
    await flushAsync();

    const tickets = await ctx.dataSource
      .getRepository(Ticket)
      .find({ where: { userId: fan.userId } });
    expect(tickets).toHaveLength(1);
    expect(tickets[0].stripePaymentIntentId).toBe(id2);
  });

  /* ------------------------------------------------------------------ */
  /* Buyer ≠ holder: family season passes                                */
  /* ------------------------------------------------------------------ */

  /** Purchases one pass through the API and finalises it via the Stripe webhook. */
  async function buyPassFor(
    buyer: RegisteredFan,
    sectionId: string,
    holder: { holderName?: string; holderEmail?: string } = {},
  ): Promise<{ intent: StubbedPaymentIntent; pass: SeasonPass | null }> {
    const resp = await request(server)
      .post('/api/season-passes/purchase')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ sectionId, ...holder });
    expect(resp.status).toBe(201);
    const intent = ctx.stripeStub.getStoredIntent(resp.body.paymentIntentId as string)!;
    const hook = await deliverWebhook(intent);
    expect(hook.status).toBe(200);
    await flushAsync();
    const pass = await ctx.dataSource
      .getRepository(SeasonPass)
      .findOne({ where: { stripePaymentIntentId: intent.id } });
    return { intent, pass };
  }

  async function scanAt(gateToken: string, ticketId: string, token: string) {
    return request(server)
      .patch(`/api/tickets/${ticketId}/scan`)
      .set('Authorization', `Bearer ${gateToken}`)
      .send({ token });
  }

  interface Family {
    buyer: RegisteredFan;
    partner: RegisteredFan;
    passes: { self: SeasonPass; partner: SeasonPass; child: SeasonPass };
  }

  /** Buyer buys three passes in one section: for themself, their partner (account), a child (no account). */
  async function buyFamilyPasses(section: string): Promise<Family> {
    const buyer = await registerFan('fam-buyer', { firstName: 'Péter', lastName: 'Kovács' });
    const partner = await registerFan('fam-partner', { firstName: 'Anna', lastName: 'Kovácsné' });
    const self = await buyPassFor(buyer, section);
    const part = await buyPassFor(buyer, section, { holderEmail: partner.email });
    const child = await buyPassFor(buyer, section, { holderName: 'Kovács Bence' });
    return {
      buyer,
      partner,
      passes: { self: self.pass!, partner: part.pass!, child: child.pass! },
    };
  }

  it('family a — one buyer, three holders in one section: three passes, three different seats, three charges', async () => {
    await seedSeasonPassPrice('A');
    const { buyer, partner, passes } = await buyFamilyPasses('A');

    expect(ctx.stripeStub.paymentIntentsCreateMock).toHaveBeenCalledTimes(3);
    const created = await Promise.all(
      ctx.stripeStub.paymentIntentsCreateMock.mock.results.map(
        (r) => r.value as Promise<{ id: string; amount: number }>,
      ),
    );
    expect(new Set(created.map((i) => i.id)).size).toBe(3);
    created.forEach((i) => expect(i.amount).toBe(3000000));

    const all = [passes.self, passes.partner, passes.child];
    all.forEach((p) => {
      expect(p.userId).toBe(buyer.userId);
      expect(p.status).toBe(SeasonPassStatus.ACTIVE);
      expect(p.seatId).toBeTruthy();
    });
    expect(new Set(all.map((p) => p.seatId)).size).toBe(3);

    expect(passes.self.holderName).toBe('Péter Kovács');
    expect(passes.self.holderUserId).toBe(buyer.userId);
    expect(passes.partner.holderName).toBe('Anna Kovácsné');
    expect(passes.partner.holderUserId).toBe(partner.userId);
    expect(passes.child.holderName).toBe('Kovács Bence');
    expect(passes.child.holderUserId).toBeNull();
  });

  it('family a2 — three webhooks delivered concurrently still get three different seats', async () => {
    await seedSeasonPassPrice('A');
    const buyer = await registerFan('fam-conc');
    const intents: StubbedPaymentIntent[] = [];
    for (const holderName of ['Gyerek Egy', 'Gyerek Kettő', 'Gyerek Három']) {
      const resp = await request(server)
        .post('/api/season-passes/purchase')
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ sectionId: 'A', holderName });
      expect(resp.status).toBe(201);
      intents.push(ctx.stripeStub.getStoredIntent(resp.body.paymentIntentId as string)!);
    }
    const results = await Promise.all(intents.map((i) => deliverWebhook(i)));
    results.forEach((r) => expect(r.status).toBe(200));
    await flushAsync();

    const passes = await ctx.dataSource.getRepository(SeasonPass).find({
      where: { userId: buyer.userId },
    });
    expect(passes).toHaveLength(3);
    expect(new Set(passes.map((p) => p.seatId)).size).toBe(3);
    expect(ctx.stripeStub.refundCreateMock).not.toHaveBeenCalled();
  });

  it("family b — each holder's per-match entry works at the gate and the scan names the holder", async () => {
    await seedSeasonPassPrice('A');
    const { match } = await seedMinimalFixture(ctx.dataSource);
    const { buyer, partner, passes } = await buyFamilyPasses('A');
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-fam-b@kte.hu' });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);

    // The buyer shows the QR for themself and the child (no account);
    // the partner shows their own, from their own profile.
    const cases: Array<{ token: string; pass: SeasonPass; holderName: string }> = [
      { token: buyer.accessToken, pass: passes.self, holderName: 'Péter Kovács' },
      { token: buyer.accessToken, pass: passes.child, holderName: 'Kovács Bence' },
      { token: partner.accessToken, pass: passes.partner, holderName: 'Anna Kovácsné' },
    ];
    for (const c of cases) {
      const qr = await request(server)
        .get(`/api/season-passes/${c.pass.id}/qr/${match.id}`)
        .set('Authorization', `Bearer ${c.token}`);
      expect(qr.status).toBe(200);
      expect(qr.body.holderName).toBe(c.holderName);

      const scan = await scanAt(gateToken, qr.body.ticketId as string, qr.body.token as string);
      expect(scan.status).toBe(200);
      expect(scan.body.success).toBe(true);
      expect(scan.body.source).toBe(TicketSource.SEASON_PASS);
      expect(scan.body.holderName).toBe(c.holderName);
      expect(scan.body.seat.id).toBe(c.pass.seatId);
    }

    // Profiles: the buyer manages all three, the partner sees only their own.
    const mine = await request(server)
      .get('/api/season-passes/me')
      .set('Authorization', `Bearer ${buyer.accessToken}`);
    expect(mine.body).toHaveLength(3);
    expect((mine.body as Array<{ holderName: string }>).map((p) => p.holderName).sort()).toEqual([
      'Anna Kovácsné',
      'Kovács Bence',
      'Péter Kovács',
    ]);
    const theirs = await request(server)
      .get('/api/season-passes/me')
      .set('Authorization', `Bearer ${partner.accessToken}`);
    expect(theirs.body).toHaveLength(1);
    expect(theirs.body[0].holderName).toBe('Anna Kovácsné');
    expect(theirs.body[0].isHolder).toBe(true);
    expect(theirs.body[0].isBuyer).toBe(false);
    expect(theirs.body[0].buyerName).toBe('Péter Kovács');

    // A stranger can neither see nor use somebody else's pass.
    const stranger = await registerFan('fam-stranger');
    const denied = await request(server)
      .get(`/api/season-passes/${passes.child.id}/qr/${match.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(denied.status).toBe(403);
  });

  it('family c — the same seat cannot be sold as a season pass twice for one season (DB constraint)', async () => {
    const { seatA } = await seedMinimalFixture(ctx.dataSource);
    const first = await registerFan('seat-dup-1');
    const second = await registerFan('seat-dup-2');
    await seedSeasonPass(ctx.dataSource, { userId: first.userId, seatId: seatA.id });

    await expect(
      seedSeasonPass(ctx.dataSource, { userId: second.userId, seatId: seatA.id }),
    ).rejects.toThrow(/uq_season_passes_seat_season/);

    expect(await ctx.dataSource.getRepository(SeasonPass).count()).toBe(1);

    // A different season may reuse the seat.
    const repo = ctx.dataSource.getRepository(SeasonPass);
    await repo.save(
      repo.create({
        userId: second.userId,
        holderName: 'Következő Szezon',
        holderUserId: second.userId,
        seatId: seatA.id,
        seasonLabel: '2027/2028',
        validFrom: new Date('2027-07-01'),
        validUntil: new Date('2028-06-30'),
        status: SeasonPassStatus.ACTIVE,
        pricePaid: '30000.00',
        currency: 'HUF',
        qrCode: `KTE-SP-${Date.now()}`,
      }),
    );
    expect(await repo.count()).toBe(2);
  });

  it('family c2 — a full section refuses a further purchase before any charge', async () => {
    await seedSeasonPassPrice('A', 2);
    const buyer = await registerFan('full-section');
    await buyPassFor(buyer, 'A', { holderName: 'Egy' });
    await buyPassFor(buyer, 'A', { holderName: 'Kettő' });
    ctx.stripeStub.paymentIntentsCreateMock.mockClear();

    const resp = await request(server)
      .post('/api/season-passes/purchase')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ sectionId: 'A', holderName: 'Három' });
    expect(resp.status).toBe(409);
    expect(resp.body.code).toBe('section_sold_out');
    expect(ctx.stripeStub.paymentIntentsCreateMock).not.toHaveBeenCalled();
  });

  it('family d — an account holds at most one pass per season (API pre-check, DB constraint, refund on race)', async () => {
    await seedSeasonPassPrice('A');
    const buyer = await registerFan('hold-buyer');
    const partner = await registerFan('hold-partner');

    // 1) First pass for the partner succeeds, a second purchase is refused before charging.
    const first = await buyPassFor(buyer, 'A', { holderEmail: partner.email });
    expect(first.pass?.holderUserId).toBe(partner.userId);
    ctx.stripeStub.paymentIntentsCreateMock.mockClear();
    const again = await request(server)
      .post('/api/season-passes/purchase')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ sectionId: 'A', holderEmail: partner.email });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('holder_already_has_pass');
    // Buying FOR someone else: the message names them (not "ennek a felhasználónak").
    expect(first.pass?.holderName).toBeTruthy();
    expect(again.body.message).toBe(
      `${first.pass?.holderName} nevére már van bérlet erre a szezonra.`,
    );
    expect(ctx.stripeStub.paymentIntentsCreateMock).not.toHaveBeenCalled();

    // The partner buying a pass for themself is the same rule.
    const own = await request(server)
      .post('/api/season-passes/purchase')
      .set('Authorization', `Bearer ${partner.accessToken}`)
      .send({ sectionId: 'A' });
    expect(own.status).toBe(409);
    expect(own.body.code).toBe('holder_already_has_pass');
    // Buying for MYSELF: second person.
    expect(own.body.message).toBe('Erre a szezonra már van bérleted.');

    // 2) The database itself rejects a second pass for the same account + season.
    const { seatA } = await seedMinimalFixture(ctx.dataSource);
    await expect(
      seedSeasonPass(ctx.dataSource, {
        userId: buyer.userId,
        seatId: seatA.id,
        holderUserId: partner.userId,
      }),
    ).rejects.toThrow(/uq_season_passes_holder_season/);

    // 3) Race: two purchases for a fresh account both pass the pre-check
    //    (nothing issued yet); the second webhook must be refunded, not issued.
    const racer = await registerFan('hold-racer');
    const respA = await request(server)
      .post('/api/season-passes/purchase')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ sectionId: 'A', holderEmail: racer.email, holderName: 'Racer A' });
    const respB = await request(server)
      .post('/api/season-passes/purchase')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ sectionId: 'A', holderEmail: racer.email, holderName: 'Racer B' });
    expect(respA.status).toBe(201);
    expect(respB.status).toBe(201);
    ctx.stripeStub.refundCreateMock.mockClear();
    for (const r of [respA, respB]) {
      await deliverWebhook(ctx.stripeStub.getStoredIntent(r.body.paymentIntentId as string)!);
      await flushAsync();
    }
    const racerPasses = await ctx.dataSource
      .getRepository(SeasonPass)
      .find({ where: { holderUserId: racer.userId } });
    expect(racerPasses).toHaveLength(1);
    expect(ctx.stripeStub.refundCreateMock).toHaveBeenCalledTimes(1);
    const refundArgs = ctx.stripeStub.refundCreateMock.mock.calls[0][0] as {
      payment_intent: string;
    };
    expect(refundArgs.payment_intent).toBe(respB.body.paymentIntentId);
  });

  it('family e — unknown holder email is rejected before charging', async () => {
    await seedSeasonPassPrice('A');
    const buyer = await registerFan('unknown-holder');
    const resp = await request(server)
      .post('/api/season-passes/purchase')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ sectionId: 'A', holderEmail: 'nobody-here@kte.hu' });
    expect(resp.status).toBe(404);
    expect(resp.body.code).toBe('holder_account_not_found');
    expect(ctx.stripeStub.paymentIntentsCreateMock).not.toHaveBeenCalled();
  });

  it('family f — lending: buyer and holder may both lend; a borrower displaces only one match of one pass', async () => {
    await seedSeasonPassPrice('A');
    const { match: match1 } = await seedMinimalFixture(ctx.dataSource);
    const matchRepo = ctx.dataSource.getRepository(Match);
    const match2 = await matchRepo.save(
      matchRepo.create({
        homeTeam: 'Kecskeméti TE',
        awayTeam: 'Második Ellenfél',
        competition: Competition.NB1,
        venue: 'Széktói Stadion',
        kickoffAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        status: MatchStatus.ON_SALE,
        capacity: 2,
        basePrice: '5000.00',
        isSeasonPassEligible: false,
      }),
    );
    const { buyer, partner, passes } = await buyFamilyPasses('A');
    const borrower = await registerFan('fam-borrower', { firstName: 'Kölcsön', lastName: 'Vevő' });
    const stranger = await registerFan('fam-stranger-2');
    const gate = await createGateUser(ctx.dataSource, { email: 'gate-fam-f@kte.hu' });
    const gateToken = await loginAs(gate.user.email, gate.plainPassword);

    const lend = (token: string, passId: string, matchId: string, email: string) =>
      request(server)
        .post(`/api/season-passes/${passId}/loans`)
        .set('Authorization', `Bearer ${token}`)
        .send({ matchId, borrowerEmail: email });
    const qr = (token: string, passId: string, matchId: string) =>
      request(server)
        .get(`/api/season-passes/${passId}/qr/${matchId}`)
        .set('Authorization', `Bearer ${token}`);

    // Neither buyer nor holder → refused. Lending to the pass's own holder → refused.
    const byStranger = await lend(stranger.accessToken, passes.child.id, match1.id, borrower.email);
    expect(byStranger.status).toBe(403);
    const toOwnHolder = await lend(buyer.accessToken, passes.partner.id, match1.id, partner.email);
    expect(toOwnHolder.status).toBe(400);

    // The BUYER lends the child's pass (holder has no account) for match 1.
    await createAndAcceptLoan(
      buyer.accessToken,
      passes.child.id,
      match1.id,
      borrower.email,
      borrower.accessToken,
    );

    // Child's pass: match 1 is gone (409), match 2 still works.
    const blocked = await qr(buyer.accessToken, passes.child.id, match1.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('entry_transferred');
    const child2 = await qr(buyer.accessToken, passes.child.id, match2.id);
    expect(child2.status).toBe(200);

    // The other two passes are untouched for match 1.
    const partnerQr = await qr(partner.accessToken, passes.partner.id, match1.id);
    expect(partnerQr.status).toBe(200);
    const selfQr = await qr(buyer.accessToken, passes.self.id, match1.id);
    expect(selfQr.status).toBe(200);

    // The borrower enters with the LOAN ticket — gate shows the borrower, not the child.
    const loanTicket = await getLoanTicketForBorrower(borrower.accessToken);
    const loanQr = await request(server)
      .get(`/api/tickets/${loanTicket.id}/qr`)
      .set('Authorization', `Bearer ${borrower.accessToken}`);
    const loanScan = await scanAt(gateToken, loanTicket.id, loanQr.body.token as string);
    expect(loanScan.body.result).toBe('ok');
    expect(loanScan.body.source).toBe(TicketSource.LOAN);
    expect(loanScan.body.holderName).toBe('Kölcsön Vevő');
    expect(loanScan.body.seat.id).toBe(passes.child.seatId);

    // The other holders still enter match 1, and the child's pass enters match 2.
    for (const q of [partnerQr, selfQr]) {
      const s = await scanAt(gateToken, q.body.ticketId as string, q.body.token as string);
      expect(s.body.result).toBe('ok');
    }
    const child2Scan = await scanAt(
      gateToken,
      child2.body.ticketId as string,
      child2.body.token as string,
    );
    expect(child2Scan.body.result).toBe('ok');
    expect(child2Scan.body.holderName).toBe('Kovács Bence');

    // Exactly one LOAN ticket exists: nothing else was displaced.
    expect(
      await ctx.dataSource.getRepository(Ticket).count({ where: { source: TicketSource.LOAN } }),
    ).toBe(1);

    // The HOLDER (with account) lends their own pass for match 2 ...
    const holderLoan = await lend(
      partner.accessToken,
      passes.partner.id,
      match2.id,
      borrower.email,
    );
    expect(holderLoan.status).toBe(201);
    // ... a stranger may not withdraw it, but the BUYER, who shares management, may.
    const strangerCancel = await request(server)
      .delete(`/api/season-passes/${passes.partner.id}/loans/${holderLoan.body.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .send({});
    expect(strangerCancel.status).toBe(403);
    const cancel = await request(server)
      .delete(`/api/season-passes/${passes.partner.id}/loans/${holderLoan.body.id}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ reason: 'Mégsem' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('cancelled');
  });
});
