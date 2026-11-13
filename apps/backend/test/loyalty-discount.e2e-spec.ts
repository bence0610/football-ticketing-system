import './setup/test-env';

import request from 'supertest';
import { Server } from 'http';
import {
  LoyaltyTier,
  LoyaltyTransaction,
  LoyaltyTransactionSource,
  Match,
  Seat,
  Ticket,
  User,
  UserRole,
} from '../src/database/entities';
import { hash } from 'bcrypt';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { seedMinimalFixture, truncateAll } from './helpers/db.helper';
import {
  buildPaymentIntentSucceededEvent,
  buildStripeWebhookHeader,
  StubbedPaymentIntent,
} from './helpers/stripe-stub';

/**
 * The loyalty tier discount, end to end. Every user in the other suites is
 * Kék (0 %), which hides any discount mistake, so this suite buys as Ezüst,
 * Arany and KTE Legenda and asserts that ONE discounted number is what
 *   - the create-intent response says (what the checkout displays),
 *   - Stripe is asked to charge,
 *   - the tickets record (ticket.pricePaid),
 *   - the admin revenue report counts, and
 *   - the confirmation page's status endpoint reports.
 *
 * Fixture: base price 3333, seat A x1.00 = 3333, seat B x1.50 = 4999.5 -> 5000,
 * list total 8333. The expected figures below are worked out by hand
 * (forints, discount rounded half up on the whole order), NOT computed with the
 * application's own discount code:
 *
 *   Ezuest       5 %: 8333 * 0.05 =  416.65 ->  417 off -> 7916
 *   Arany       10 %: 8333 * 0.10 =  833.30 ->  833 off -> 7500
 *   KTE Legenda 15 %: 8333 * 0.15 = 1249.95 -> 1250 off -> 7083
 */

const PASSWORD = 'FanPass123';
const LIST_TOTAL = 8333;
const POINTS_PER_TICKET = 50; // LOYALTY_TICKET_POINTS_PER_TICKET default, flat per ticket

interface Buyer {
  userId: string;
  accessToken: string;
}

interface TierCase {
  name: string;
  tier: LoyaltyTier;
  points: number;
  percent: number;
  discount: number;
  total: number;
}

const TIER_CASES: TierCase[] = [
  { name: 'Ezüst', tier: LoyaltyTier.SILVER, points: 500, percent: 5, discount: 417, total: 7916 },
  { name: 'Arany', tier: LoyaltyTier.GOLD, points: 1500, percent: 10, discount: 833, total: 7500 },
  {
    name: 'KTE Legenda',
    tier: LoyaltyTier.PLATINUM,
    points: 3000,
    percent: 15,
    discount: 1250,
    total: 7083,
  },
];

describe('Loyalty tier discount (E2E)', () => {
  let ctx: TestContext;
  let server: Server;
  let match: Match;
  let seatA: Seat;
  let seatB: Seat;

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
    ctx.stripeStub.refundCreateMock.mockClear();

    const fixture = await seedMinimalFixture(ctx.dataSource);
    await ctx.dataSource.getRepository(Match).update(fixture.match.id, { basePrice: '3333.00' });
    await ctx.dataSource.getRepository(Seat).update(fixture.seatB.id, { priceModifier: '1.50' });
    match = fixture.match;
    seatA = fixture.seatA;
    seatB = fixture.seatB;
  });

  async function registerBuyer(tier: LoyaltyTier, points: number): Promise<Buyer> {
    const email = `disc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@kte.hu`;
    const response = await request(server)
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, firstName: 'Teszt', lastName: 'Vásárló' });
    expect(response.status).toBe(201);
    const userId = response.body.user.id as string;
    // The tier is server-side state: set it directly, exactly as earned points would.
    await ctx.dataSource
      .getRepository(User)
      .update(userId, { loyaltyTier: tier, loyaltyPoints: points });
    return { userId, accessToken: response.body.accessToken as string };
  }

  async function adminToken(): Promise<string> {
    const repo = ctx.dataSource.getRepository(User);
    const admin = await repo.save(
      repo.create({
        email: 'admin-disc@kte.hu',
        passwordHash: await hash(PASSWORD, 10),
        firstName: 'Admin',
        lastName: 'Teszt',
        role: UserRole.ADMIN,
        loyaltyTier: LoyaltyTier.BRONZE,
        loyaltyPoints: 0,
        emailVerified: true,
        twoFactorEnabled: false,
        isActive: true,
      }),
    );
    const response = await request(server)
      .post('/api/auth/login')
      .send({ email: admin.email, password: PASSWORD });
    expect(response.status).toBe(200);
    return response.body.accessToken as string;
  }

  async function lock(buyer: Buyer, seatId: string): Promise<string> {
    const response = await request(server)
      .post(`/api/matches/${match.id}/seats/${seatId}/lock`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send();
    expect(response.status).toBe(201);
    return response.body.ownerToken as string;
  }

  interface IntentBody {
    paymentIntentId: string;
    amount: number;
    subtotal: number;
    discountPercent: number;
    discountAmount: number;
    lineItems: Array<{ price: number }>;
  }

  async function createIntent(buyer: Buyer): Promise<IntentBody> {
    const tokenA = await lock(buyer, seatA.id);
    const tokenB = await lock(buyer, seatB.id);
    const response = await request(server)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        matchId: match.id,
        seats: [
          { seatId: seatA.id, ownerToken: tokenA },
          { seatId: seatB.id, ownerToken: tokenB },
        ],
      });
    expect(response.status).toBe(201);
    return response.body as IntentBody;
  }

  async function settle(): Promise<void> {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));
  }

  async function deliverWebhook(paymentIntentId: string): Promise<void> {
    const intent = ctx.stripeStub.getStoredIntent(paymentIntentId) as StubbedPaymentIntent;
    const payload = JSON.stringify(buildPaymentIntentSucceededEvent(intent));
    const response = await request(server)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', buildStripeWebhookHeader(payload))
      .set('content-type', 'application/json')
      .send(payload);
    expect(response.status).toBe(200);
    await settle();
  }

  async function confirm(buyer: Buyer, paymentIntentId: string): Promise<void> {
    const response = await request(server)
      .post('/api/payments/confirm')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ paymentIntentId });
    expect(response.status).toBe(201);
    await settle();
  }

  const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

  describe.each(TIER_CASES)('$name ($percent %)', (c) => {
    it('shows, charges, records, reports and confirms the same discounted amount', async () => {
      const buyer = await registerBuyer(c.tier, c.points);
      const admin = await adminToken();

      // 1. The checkout's numbers: the create-intent response is all it renders.
      const intent = await createIntent(buyer);
      expect(intent.discountPercent).toBe(c.percent);
      expect(intent.subtotal).toBe(LIST_TOTAL);
      expect(intent.discountAmount).toBe(c.discount);
      expect(intent.amount).toBe(c.total);
      expect(intent.subtotal - intent.discountAmount).toBe(intent.amount);

      // 2. The amount sent to Stripe, in fillér (HUF is a 2-decimal currency there).
      expect(ctx.stripeStub.paymentIntentsCreateMock).toHaveBeenCalledTimes(1);
      const [stripeParams] = ctx.stripeStub.paymentIntentsCreateMock.mock.calls[0];
      expect(stripeParams.amount).toBe(c.total * 100);

      // Pay and let the frontend-driven confirm create the tickets.
      await confirm(buyer, intent.paymentIntentId);

      // 3. ticket.pricePaid, per ticket and in total.
      const tickets = await ctx.dataSource
        .getRepository(Ticket)
        .find({ where: { stripePaymentIntentId: intent.paymentIntentId } });
      expect(tickets).toHaveLength(2);
      expect(sum(tickets.map((t) => Number(t.pricePaid)))).toBe(c.total);
      expect(tickets.every((t) => Number(t.pricePaid) < LIST_TOTAL)).toBe(true);

      // 4. Admin revenue: today, this month and the per-match figure.
      const revenue = await request(server)
        .get('/api/admin/revenue')
        .set('Authorization', `Bearer ${admin}`);
      expect({
        status: revenue.status,
        body: revenue.status === 200 ? 'ok' : revenue.body,
      }).toEqual({ status: 200, body: 'ok' });
      expect(revenue.body.summary.todayRevenue).toBe(c.total);
      expect(revenue.body.summary.monthRevenue).toBe(c.total);
      expect(revenue.body.summary.todayTicketCount).toBe(2);
      expect(revenue.body.byMatch).toHaveLength(1);
      expect(revenue.body.byMatch[0].revenue).toBe(c.total);
      expect(revenue.body.summary.topMatch.revenue).toBe(c.total);
      expect(sum((revenue.body.daily as Array<{ amount: number }>).map((d) => d.amount))).toBe(
        c.total,
      );

      // 5. The confirmation page: its amount and its seat lines.
      const status = await request(server)
        .get(`/api/payments/${intent.paymentIntentId}/status`)
        .set('Authorization', `Bearer ${buyer.accessToken}`);
      expect(status.status).toBe(200);
      expect(status.body.status).toBe('issued');
      expect(status.body.amountPaid).toBe(c.total);
      expect(sum((status.body.seats as Array<{ price: number }>).map((s) => s.price))).toBe(
        c.total,
      );

      // The discount does not touch loyalty points: flat per ticket.
      expect(status.body.pointsCredited).toBe(2 * POINTS_PER_TICKET);
      const earned = await ctx.dataSource.getRepository(LoyaltyTransaction).find({
        where: { userId: buyer.userId, source: LoyaltyTransactionSource.TICKET_PURCHASE },
      });
      expect(sum(earned.map((t) => t.points))).toBe(2 * POINTS_PER_TICKET);

      expect(ctx.stripeStub.getRefunds()).toHaveLength(0);
    });
  });

  it('records the same discounted amounts when Stripe webhook, not the browser, finalises', async () => {
    const c = TIER_CASES[1];
    const buyer = await registerBuyer(c.tier, c.points);

    const intent = await createIntent(buyer);
    await deliverWebhook(intent.paymentIntentId);

    const tickets = await ctx.dataSource
      .getRepository(Ticket)
      .find({ where: { stripePaymentIntentId: intent.paymentIntentId } });
    expect(sum(tickets.map((t) => Number(t.pricePaid)))).toBe(c.total);

    // The browser confirming afterwards finds the tickets and changes nothing.
    await confirm(buyer, intent.paymentIntentId);
    const again = await ctx.dataSource
      .getRepository(Ticket)
      .find({ where: { stripePaymentIntentId: intent.paymentIntentId } });
    expect(again).toHaveLength(2);
    expect(sum(again.map((t) => Number(t.pricePaid)))).toBe(c.total);
  });

  it('charges list price to a Kék (0 %) buyer and reports no discount', async () => {
    const buyer = await registerBuyer(LoyaltyTier.BRONZE, 0);
    const intent = await createIntent(buyer);

    expect(intent.discountPercent).toBe(0);
    expect(intent.discountAmount).toBe(0);
    expect(intent.amount).toBe(LIST_TOTAL);
    expect(ctx.stripeStub.paymentIntentsCreateMock.mock.calls[0][0].amount).toBe(LIST_TOTAL * 100);

    await confirm(buyer, intent.paymentIntentId);
    const tickets = await ctx.dataSource
      .getRepository(Ticket)
      .find({ where: { stripePaymentIntentId: intent.paymentIntentId } });
    expect(sum(tickets.map((t) => Number(t.pricePaid)))).toBe(LIST_TOTAL);
  });

  it('records what was charged when an admin changes the price after the payment was created', async () => {
    const c = TIER_CASES[2];
    const buyer = await registerBuyer(c.tier, c.points);
    const admin = await adminToken();

    const intent = await createIntent(buyer);
    expect(intent.amount).toBe(c.total);

    // Mid-purchase: the match gets much more expensive, and a seat gets a premium.
    await ctx.dataSource.getRepository(Match).update(match.id, { basePrice: '9999.00' });
    await ctx.dataSource.getRepository(Seat).update(seatA.id, { priceModifier: '2.00' });

    await confirm(buyer, intent.paymentIntentId);

    const tickets = await ctx.dataSource
      .getRepository(Ticket)
      .find({ where: { stripePaymentIntentId: intent.paymentIntentId } });
    expect(tickets).toHaveLength(2);
    // Stripe charged c.total; the tickets, admin revenue and confirmation agree.
    expect(sum(tickets.map((t) => Number(t.pricePaid)))).toBe(c.total);

    const revenue = await request(server)
      .get('/api/admin/revenue')
      .set('Authorization', `Bearer ${admin}`);
    expect(revenue.body.summary.todayRevenue).toBe(c.total);

    const status = await request(server)
      .get(`/api/payments/${intent.paymentIntentId}/status`)
      .set('Authorization', `Bearer ${buyer.accessToken}`);
    expect(status.body.amountPaid).toBe(c.total);
  });

  it('ignores a discount supplied by the client', async () => {
    const buyer = await registerBuyer(LoyaltyTier.BRONZE, 0);
    const tokenA = await lock(buyer, seatA.id);
    const response = await request(server)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        matchId: match.id,
        seats: [{ seatId: seatA.id, ownerToken: tokenA }],
        discountPercent: 15,
        amount: 1,
      });
    // The DTO whitelist rejects unknown fields; either way the server never uses them.
    expect(response.status).toBe(400);
    expect(ctx.stripeStub.paymentIntentsCreateMock).not.toHaveBeenCalled();
  });
});
