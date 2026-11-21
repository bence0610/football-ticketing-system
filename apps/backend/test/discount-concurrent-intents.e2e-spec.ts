import './setup/test-env';

import { randomUUID } from 'crypto';
import request from 'supertest';
import { Server } from 'http';
import { LoyaltyTier, Seat, SeatCategory, User } from '../src/database/entities';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { seedMinimalFixture, truncateAll } from './helpers/db.helper';

/**
 * Suspicion 2 of the audit: two payments opened at the same moment by one buyer for one match.
 * The discount is limited to LOYALTY_DISCOUNT_TICKETS_PER_MATCH tickets per buyer per match, but
 * the places were counted first and reserved only after the payment was created, so two parallel
 * requests could both read "none used yet" and both be discounted: the limit exceeded.
 */
describe('Discount limit under concurrent payments (E2E)', () => {
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
    ctx.stripeStub.paymentIntentsCreateMock.mockClear();
  });

  const LIMIT = 2; // LOYALTY_DISCOUNT_TICKETS_PER_MATCH default

  async function goldBuyer(): Promise<{ userId: string; token: string }> {
    const res = await request(server)
      .post('/api/auth/register')
      .send({
        email: `disc-${randomUUID().slice(0, 8)}@kte.hu`,
        password: 'Teszt1234!',
        firstName: 'Teszt',
        lastName: 'Vásárló',
      });
    expect(res.status).toBe(201);
    const userId = res.body.user.id as string;
    await ctx.dataSource
      .getRepository(User)
      .update(userId, { loyaltyTier: LoyaltyTier.GOLD, loyaltyPoints: 1000 });
    return { userId, token: res.body.accessToken as string };
  }

  async function moreSeats(count: number, firstNumber: number): Promise<Seat[]> {
    const repo = ctx.dataSource.getRepository(Seat);
    const out: Seat[] = [];
    for (let n = firstNumber; n < firstNumber + count; n++) {
      out.push(
        await repo.save(
          repo.create({
            section: 'A',
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
    return out;
  }

  it('never discounts more than the per-match limit, however many payments are opened at once', async () => {
    const { match, seatA, seatB } = await seedMinimalFixture(ctx.dataSource);
    const [seatC, seatD] = await moreSeats(2, 3);
    const buyer = await goldBuyer();

    const lock = async (seatId: string): Promise<string> => {
      const res = await request(server)
        .post(`/api/matches/${match.id}/seats/${seatId}/lock`)
        .set('Authorization', `Bearer ${buyer.token}`);
      expect(res.status).toBe(201);
      return res.body.ownerToken as string;
    };
    // Two different lock holds of two seats each (two tabs, two carts).
    const holdOne = [
      { seatId: seatA.id, ownerToken: await lock(seatA.id) },
      { seatId: seatB.id, ownerToken: await lock(seatB.id) },
    ];
    const holdTwo = [
      { seatId: seatC.id, ownerToken: await lock(seatC.id) },
      { seatId: seatD.id, ownerToken: await lock(seatD.id) },
    ];
    const open = (seats: typeof holdOne) =>
      request(server)
        .post('/api/payments/create-intent')
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({ matchId: match.id, seats });

    const [first, second] = await Promise.all([open(holdOne), open(holdTwo)]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const discounted =
      (first.body.discountedTickets as number) + (second.body.discountedTickets as number);
    expect(discounted).toBeLessThanOrEqual(LIMIT);
    // Everything the limit allows is used, and the rest is charged in full.
    expect(discounted).toBe(LIMIT);
    const lines = [...first.body.lineItems, ...second.body.lineItems] as Array<{
      discounted: boolean;
      price: number;
      paidPrice: number;
    }>;
    expect(lines.filter((l) => l.discounted)).toHaveLength(LIMIT);
    for (const line of lines.filter((l) => !l.discounted)) {
      expect(line.paidPrice).toBe(line.price);
    }
    // What Stripe is asked to charge matches the response: no payment carries a hidden discount.
    const charged = ctx.stripeStub.paymentIntentsCreateMock.mock.calls.map(
      (c) => c[0].amount as number,
    );
    expect(charged.reduce((a, b) => a + b, 0)).toBe(
      ((first.body.amount as number) + (second.body.amount as number)) * 100,
    );
  });

  it('a payment that fails at Stripe gives its reserved discounted places back', async () => {
    const { match, seatA, seatB } = await seedMinimalFixture(ctx.dataSource);
    const buyer = await goldBuyer();
    const tokens: string[] = [];
    for (const seat of [seatA, seatB]) {
      const res = await request(server)
        .post(`/api/matches/${match.id}/seats/${seat.id}/lock`)
        .set('Authorization', `Bearer ${buyer.token}`);
      tokens.push(res.body.ownerToken as string);
    }
    const seats = [
      { seatId: seatA.id, ownerToken: tokens[0] },
      { seatId: seatB.id, ownerToken: tokens[1] },
    ];
    ctx.stripeStub.paymentIntentsCreateMock.mockRejectedValueOnce(new Error('stripe down'));
    const failed = await request(server)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ matchId: match.id, seats });
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await ctx.redis.hlen(`discount-inflight:${match.id}:${buyer.userId}`)).toBe(0);

    // The retry is discounted again: nothing stayed reserved by the payment that never existed.
    const retry = await request(server)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ matchId: match.id, seats });
    expect(retry.status).toBe(201);
    expect(retry.body.discountedTickets).toBe(LIMIT);
  });
});
