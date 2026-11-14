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
  Seat,
  SeatCategory,
  SeasonPass,
  SeasonPassPrice,
  SeasonPassStatus,
  Ticket,
  TicketSource,
  TicketStatus,
} from '../src/database/entities';
import { RedisKeys } from '../src/redis/redis.constants';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { seedSeasonPass, truncateAll } from './helpers/db.helper';
import {
  buildPaymentIntentSucceededEvent,
  buildStripeWebhookHeader,
  StubbedPaymentIntent,
} from './helpers/stripe-stub';

/**
 * Season-pass seat choice, end to end against the real MySQL + Redis:
 * the season map, the Redis hold, the purchase and the finalisation race.
 *
 * Season rule under test: a seat is unavailable for a season pass iff ANY
 * season_passes row exists for (seat, season) - whatever its status. Single-match
 * tickets are irrelevant to it. VENDÉG is never offered.
 */
const PASSWORD = 'FanPass123';
const SEASON = '2026/2027';

type Tier = 'upper' | 'lower' | 'vip';
/** A real sector of each price tier: the rule looks seats up through the `sectors` table. */
const SECTOR_OF_TIER: Record<Tier, string> = { upper: 'D/1', lower: 'K', vip: 'VIP' };

interface Fan {
  userId: string;
  email: string;
  accessToken: string;
}

interface MapSeat {
  id: string;
  row: string;
  number: number;
  status: string;
}

describe('Season-pass seat choice (E2E)', () => {
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
    ctx.stripeStub.paymentIntentsRetrieveMock.mockClear();
    ctx.stripeStub.refundCreateMock.mockClear();
  });

  /* ---------------------------- helpers ---------------------------- */

  async function registerFan(
    suffix: string,
    name: { firstName: string; lastName: string } = { firstName: 'Teszt', lastName: 'Felhasználó' },
  ): Promise<Fan> {
    const email = `${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@kte.hu`;
    const res = await request(server)
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, firstName: name.firstName, lastName: name.lastName });
    expect(res.status).toBe(201);
    return { userId: res.body.user.id, email, accessToken: res.body.accessToken };
  }

  /** A price row for the tier plus `count` active seats (rows 'SP', numbers 1..count) in its real sector. */
  async function seedTier(tier: Tier, count: number): Promise<{ price: SeasonPassPrice; seats: Seat[] }> {
    const seatRepo = ctx.dataSource.getRepository(Seat);
    const seats: Seat[] = [];
    for (let n = 1; n <= count; n++) {
      seats.push(
        await seatRepo.save(
          seatRepo.create({
            section: SECTOR_OF_TIER[tier],
            row: 'SP',
            number: n,
            category: SeatCategory.STANDARD,
            priceModifier: '1.00',
            isAccessible: false,
            isActive: true,
          }),
        ),
      );
    }
    const priceRepo = ctx.dataSource.getRepository(SeasonPassPrice);
    const price = await priceRepo.save(
      priceRepo.create({
        section: tier,
        sectionLabel: { upper: 'Felső ív', lower: 'Alsó ív', vip: 'VIP' }[tier],
        seasonLabel: SEASON,
        price: 30000,
        currency: 'HUF',
        validFrom: new Date('2026-07-01'),
        validUntil: new Date('2027-06-30'),
        isActive: true,
      }),
    );
    return { price, seats };
  }

  const holdSeat = (token: string, seatId: string) =>
    request(server)
      .post(`/api/season-passes/seats/${seatId}/hold`)
      .set('Authorization', `Bearer ${token}`)
      .send();

  const postPurchase = (
    token: string,
    tier: string,
    seatId: string,
    holdToken: string,
    extra: { holderName?: string; holderEmail?: string } = {},
  ) =>
    request(server)
      .post('/api/season-passes/purchase')
      .set('Authorization', `Bearer ${token}`)
      .send({ sectionId: tier, seatId, holdToken, ...extra });

  async function seasonMap(section: string): Promise<SupertestResponse> {
    return request(server).get('/api/season-passes/seats').query({ section });
  }

  async function statusOf(section: string, seatId: string): Promise<string> {
    const res = await seasonMap(section);
    expect(res.status).toBe(200);
    return (res.body.seats as MapSeat[]).find((s) => s.id === seatId)!.status;
  }

  async function freeSeatsOf(tier: Tier, section: string): Promise<number> {
    const res = await request(server).get(`/api/season-passes/tiers/${tier}/sectors`);
    expect(res.status).toBe(200);
    const sector = (res.body.sectors as Array<{ section: string; freeSeats: number }>).find(
      (s) => s.section === section,
    );
    expect(sector).toBeDefined();
    return sector!.freeSeats;
  }

  async function deliverWebhook(intent: StubbedPaymentIntent): Promise<SupertestResponse> {
    const payload = JSON.stringify(buildPaymentIntentSucceededEvent(intent));
    return request(server)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', buildStripeWebhookHeader(payload))
      .set('content-type', 'application/json')
      .send(payload);
  }

  async function settle(): Promise<void> {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));
  }

  /** The whole honest flow: hold, purchase, webhook. Returns the issued pass. */
  async function buyPass(
    fan: Fan,
    tier: Tier,
    seat: Seat,
    extra: { holderName?: string; holderEmail?: string } = {},
  ): Promise<SeasonPass> {
    const hold = await holdSeat(fan.accessToken, seat.id);
    expect(hold.status).toBe(201);
    const buy = await postPurchase(fan.accessToken, tier, seat.id, hold.body.holdToken, extra);
    expect(buy.status).toBe(201);
    const intent = ctx.stripeStub.getStoredIntent(buy.body.paymentIntentId as string)!;
    expect((await deliverWebhook(intent)).status).toBe(200);
    await settle();
    return ctx.dataSource
      .getRepository(SeasonPass)
      .findOneOrFail({ where: { stripePaymentIntentId: intent.id } });
  }

  /** PaymentIntent ids refunded during this test (the mock is cleared in beforeEach). */
  function refundedIntents(): string[] {
    return ctx.stripeStub.refundCreateMock.mock.calls.map(
      (call) => (call[0] as { payment_intent: string }).payment_intent,
    );
  }

  async function holdKeys(): Promise<string[]> {
    return ctx.redis.keys('seasonpass-hold*');
  }

  /* ------------------------------ tests ----------------------------- */

  describe('a seat already held by a pass', () => {
    it('should refuse hold and purchase with 409 seat_taken and show season_pass on the map when a pass sits on the seat', async () => {
      const { seats } = await seedTier('upper', 3);
      const owner = await registerFan('owner');
      const other = await registerFan('other');
      const pass = await buyPass(owner, 'upper', seats[0]);
      expect(pass.seatId).toBe(seats[0].id);
      ctx.stripeStub.paymentIntentsCreateMock.mockClear();

      const hold = await holdSeat(other.accessToken, seats[0].id);
      expect(hold.status).toBe(409);
      expect(hold.body.code).toBe('seat_taken');

      const buy = await postPurchase(other.accessToken, 'upper', seats[0].id, 'forged-token');
      expect(buy.status).toBe(409);
      expect(buy.body.code).toBe('seat_taken');
      expect(ctx.stripeStub.paymentIntentsCreateMock).not.toHaveBeenCalled();

      const map = await seasonMap('D/1');
      expect(map.status).toBe(200);
      const byId = new Map((map.body.seats as MapSeat[]).map((s) => [s.id, s.status]));
      expect(byId.get(seats[0].id)).toBe('season_pass');
      expect(byId.get(seats[1].id)).toBe('available');
      expect(byId.get(seats[2].id)).toBe('available');
      // The map only ever speaks the season vocabulary; never "sold".
      expect([...byId.values()].every((s) => ['available', 'season_pass', 'locked', 'disabled'].includes(s))).toBe(true);

      expect(await holdKeys()).toHaveLength(0);
    });

    it('should keep a cancelled pass row blocking its seat (documented behaviour: the unique index ignores status)', async () => {
      const { seats } = await seedTier('upper', 3);
      const owner = await registerFan('cancelled-owner');
      const other = await registerFan('cancelled-other');
      const pass = await seedSeasonPass(ctx.dataSource, { userId: owner.userId, seatId: seats[0].id });
      await ctx.dataSource
        .getRepository(SeasonPass)
        .update({ id: pass.id }, { status: SeasonPassStatus.CANCELLED });

      expect(await statusOf('D/1', seats[0].id)).toBe('season_pass');
      expect(await freeSeatsOf('upper', 'D/1')).toBe(2);
      const hold = await holdSeat(other.accessToken, seats[0].id);
      expect(hold.status).toBe(409);
      expect(hold.body.code).toBe('seat_taken');
    });
  });

  describe('the Redis hold', () => {
    it('should show locked, refuse a second buyer with seat_held and free the seat again when the holder releases', async () => {
      const { seats } = await seedTier('upper', 2);
      const a = await registerFan('hold-a');
      const b = await registerFan('hold-b');

      const holdA = await holdSeat(a.accessToken, seats[0].id);
      expect(holdA.status).toBe(201);
      expect(await statusOf('D/1', seats[0].id)).toBe('locked');

      const holdB = await holdSeat(b.accessToken, seats[0].id);
      expect(holdB.status).toBe(409);
      expect(holdB.body.code).toBe('seat_held');

      // A wrong token releases nothing; the right one does.
      await request(server)
        .delete(`/api/season-passes/seats/${seats[0].id}/hold`)
        .query({ holdToken: 'wrong' })
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(204);
      expect(await statusOf('D/1', seats[0].id)).toBe('locked');
      await request(server)
        .delete(`/api/season-passes/seats/${seats[0].id}/hold`)
        .query({ holdToken: holdA.body.holdToken })
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(204);
      expect(await statusOf('D/1', seats[0].id)).toBe('available');
      expect((await holdSeat(b.accessToken, seats[0].id)).status).toBe(201);
    });

    it('should refuse the purchase with hold_lost before any charge when the token is not the buyer hold', async () => {
      const { seats } = await seedTier('upper', 2);
      const a = await registerFan('lost-a');
      await holdSeat(a.accessToken, seats[0].id);

      const buy = await postPurchase(a.accessToken, 'upper', seats[0].id, 'not-my-token');
      expect(buy.status).toBe(409);
      expect(buy.body.code).toBe('hold_lost');
      expect(ctx.stripeStub.paymentIntentsCreateMock).not.toHaveBeenCalled();
    });
  });

  describe('concurrent finalisation of the same seat', () => {
    it('should end with exactly one pass row and one Stripe refund when two buyers pay for a seat whose hold lapsed', async () => {
      const { seats } = await seedTier('upper', 3);
      // Not the sector's first seat: proves the pass carries the CHOSEN seat.
      const chosen = seats[2];
      const a = await registerFan('race-a', { firstName: 'Aladár', lastName: 'Egy' });
      const b = await registerFan('race-b', { firstName: 'Béla', lastName: 'Kettő' });

      const holdA = await holdSeat(a.accessToken, chosen.id);
      expect(holdA.status).toBe(201);

      // Make both PaymentIntents come back `succeeded` (so purchase finalises
      // synchronously) and hold A's purchase right after its intent exists, i.e.
      // after the hold check and before finalisation.
      const original = ctx.stripeStub.paymentIntentsCreateMock.getMockImplementation()!;
      let aIntentCreated!: () => void;
      const aStalled = new Promise<void>((r) => (aIntentCreated = r));
      let releaseA!: () => void;
      const gate = new Promise<void>((r) => (releaseA = r));
      ctx.stripeStub.paymentIntentsCreateMock
        .mockImplementationOnce(async (params, options) => {
          const intent = await original(params, options);
          ctx.stripeStub.markSucceeded(intent.id);
          aIntentCreated();
          await gate;
          return intent;
        })
        .mockImplementationOnce(async (params, options) => {
          const intent = await original(params, options);
          ctx.stripeStub.markSucceeded(intent.id);
          releaseA();
          return intent;
        });

      const purchaseA = Promise.resolve(
        postPurchase(a.accessToken, 'upper', chosen.id, holdA.body.holdToken),
      );
      await aStalled;

      // The hold lapses (TTL) while A's payment is in flight; B takes the seat.
      await ctx.redis.del(RedisKeys.seasonPassHold(SEASON, chosen.id));
      const holdB = await holdSeat(b.accessToken, chosen.id);
      expect(holdB.status).toBe(201);
      const purchaseB = Promise.resolve(
        postPurchase(b.accessToken, 'upper', chosen.id, holdB.body.holdToken),
      );

      const [respA, respB] = await Promise.all([purchaseA, purchaseB]);
      await settle();

      const statuses = [respA.status, respB.status].sort();
      expect(statuses).toEqual([201, 409]);
      const winnerResp = respA.status === 201 ? respA : respB;
      const loserResp = respA.status === 201 ? respB : respA;
      expect(loserResp.body.code).toBe('pass_not_issued_refunded');

      // Exactly one pass row, on the chosen seat (not the sector's first seat).
      const passes = await ctx.dataSource.getRepository(SeasonPass).find();
      expect(passes).toHaveLength(1);
      expect(passes[0].seatId).toBe(chosen.id);
      expect(passes[0].seatId).not.toBe(seats[0].id);
      expect(passes[0].status).toBe(SeasonPassStatus.ACTIVE);
      expect(winnerResp.body.seasonPassId).toBe(passes[0].id);

      // Exactly one refund, for the intent that did not get the pass.
      const intentIds = (
        await Promise.all(
          ctx.stripeStub.paymentIntentsCreateMock.mock.results.map(
            (r) => r.value as Promise<{ id: string }>,
          ),
        )
      ).map((i) => i.id);
      expect(new Set(intentIds).size).toBe(2);
      const loserIntent = intentIds.find((id) => id !== passes[0].stripePaymentIntentId);
      expect(ctx.stripeStub.refundCreateMock).toHaveBeenCalledTimes(1);
      expect(refundedIntents()).toEqual([loserIntent]);

      // Loyalty only for the issued pass.
      const loyalty = await ctx.dataSource.getRepository(LoyaltyTransaction).find({
        where: { source: LoyaltyTransactionSource.SEASON_PASS_PURCHASE },
      });
      expect(loyalty).toHaveLength(1);
      expect(loyalty[0].referenceId).toBe(`season_pass:${passes[0].id}`);

      // No orphan holds: seat key and both owner keys are gone.
      expect(await holdKeys()).toHaveLength(0);
      expect(await statusOf('D/1', chosen.id)).toBe('season_pass');
    });

    it('should issue one pass and refund the other payment when two webhooks for the same seat arrive concurrently', async () => {
      const { seats } = await seedTier('upper', 3);
      const chosen = seats[1];
      const a = await registerFan('wh-race-a');
      const b = await registerFan('wh-race-b');

      const holdA = await holdSeat(a.accessToken, chosen.id);
      const buyA = await postPurchase(a.accessToken, 'upper', chosen.id, holdA.body.holdToken);
      expect(buyA.status).toBe(201);
      await ctx.redis.del(RedisKeys.seasonPassHold(SEASON, chosen.id));
      const holdB = await holdSeat(b.accessToken, chosen.id);
      const buyB = await postPurchase(b.accessToken, 'upper', chosen.id, holdB.body.holdToken);
      expect(buyB.status).toBe(201);

      const intentA = ctx.stripeStub.getStoredIntent(buyA.body.paymentIntentId as string)!;
      const intentB = ctx.stripeStub.getStoredIntent(buyB.body.paymentIntentId as string)!;
      const hooks = await Promise.all([deliverWebhook(intentA), deliverWebhook(intentB)]);
      hooks.forEach((h) => expect(h.status).toBe(200));
      await settle();

      const passes = await ctx.dataSource.getRepository(SeasonPass).find();
      expect(passes).toHaveLength(1);
      expect(passes[0].seatId).toBe(chosen.id);
      expect(ctx.stripeStub.refundCreateMock).toHaveBeenCalledTimes(1);
      const loser = passes[0].stripePaymentIntentId === intentA.id ? intentB.id : intentA.id;
      // (mock calls, not getRefunds(): the stub's refund store survives between tests)
      expect(refundedIntents()).toEqual([loser]);
      expect(await holdKeys()).toHaveLength(0);
    });
  });

  describe('tickets and the season rule', () => {
    async function ticketSeat(
      seatId: string,
      userId: string,
      kickoffInDays: number,
      status: TicketStatus,
      tag: string,
    ): Promise<void> {
      const matchRepo = ctx.dataSource.getRepository(Match);
      const match = await matchRepo.save(
        matchRepo.create({
          homeTeam: 'Kecskeméti TE',
          awayTeam: `Ellenfél ${tag}`,
          competition: Competition.NB1,
          venue: 'Széktói Stadion',
          kickoffAt: new Date(Date.now() + kickoffInDays * 86_400_000),
          status: kickoffInDays < 0 ? MatchStatus.FINISHED : MatchStatus.ON_SALE,
          capacity: 3,
          basePrice: '5000.00',
          isSeasonPassEligible: true,
        }),
      );
      const ticketRepo = ctx.dataSource.getRepository(Ticket);
      await ticketRepo.save(
        ticketRepo.create({
          matchId: match.id,
          seatId,
          userId,
          status,
          source: TicketSource.SINGLE,
          pricePaid: '5000.00',
          currency: 'HUF',
          qrCode: `KTE-SEASON-RULE-${tag}`,
          qrJti: `jti-season-rule-${tag}`,
        }),
      );
    }

    it('should not offer, hold or sell a seat that has a ticket for an upcoming match', async () => {
      const { seats } = await seedTier('upper', 3);
      const fan = await registerFan('future-ticket-owner');
      await ticketSeat(seats[1].id, fan.userId, 7, TicketStatus.PAID, 'future');

      expect(await statusOf('D/1', seats[1].id)).toBe('ticketed');
      expect(await statusOf('D/1', seats[0].id)).toBe('available');
      expect(await freeSeatsOf('upper', 'D/1')).toBe(2);

      const buyer = await registerFan('future-pass-buyer');
      const held = await holdSeat(buyer.accessToken, seats[1].id);
      expect(held.status).toBe(409);
      expect(held.body.code).toBe('seat_ticketed');

      // the purchase is refused too, before any charge, even with a valid hold on another seat
      const other = await holdSeat(buyer.accessToken, seats[0].id);
      expect(other.status).toBe(201);
      const res = await postPurchase(buyer.accessToken, 'upper', seats[1].id, other.body.holdToken);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('seat_ticketed');
      expect(await ctx.dataSource.getRepository(SeasonPass).count()).toBe(0);
    });

    it('should keep blocking when the only ticket for the upcoming match is void (the unique slot is still taken)', async () => {
      const { seats } = await seedTier('upper', 2);
      const fan = await registerFan('void-ticket-owner');
      await ticketSeat(seats[0].id, fan.userId, 3, TicketStatus.CANCELLED, 'void');
      expect(await statusOf('D/1', seats[0].id)).toBe('ticketed');
    });

    it('should still offer and sell a seat whose only ticket is for a match already played', async () => {
      const { seats } = await seedTier('upper', 3);
      const fan = await registerFan('past-ticket-owner');
      await ticketSeat(seats[1].id, fan.userId, -7, TicketStatus.USED, 'past');

      expect(await statusOf('D/1', seats[1].id)).toBe('available');
      expect(await freeSeatsOf('upper', 'D/1')).toBe(3);

      const buyer = await registerFan('past-pass-buyer');
      const pass = await buyPass(buyer, 'upper', seats[1]);
      expect(pass.seatId).toBe(seats[1].id);
    });
  });

  describe('counts, tiers and the away section', () => {
    it('should decrement the per-sector freeSeats (sectors and prices endpoints) after a pass is issued', async () => {
      const { seats } = await seedTier('upper', 3);
      const fan = await registerFan('count');

      expect(await freeSeatsOf('upper', 'D/1')).toBe(3);
      await buyPass(fan, 'upper', seats[0]);
      expect(await freeSeatsOf('upper', 'D/1')).toBe(2);

      const prices = await request(server).get('/api/season-passes/prices');
      expect(prices.status).toBe(200);
      const upper = (
        prices.body as Array<{
          sectionId: string;
          freeSeats: number;
          totalSeats: number;
          passesSold: number;
          sectors: Array<{ section: string; freeSeats: number; total: number }>;
        }>
      ).find((p) => p.sectionId === 'upper')!;
      expect(upper).toMatchObject({ freeSeats: 2, totalSeats: 3, passesSold: 1 });
      expect(upper.sectors.find((s) => s.section === 'D/1')).toMatchObject({
        freeSeats: 2,
        total: 3,
      });
    });

    it('should answer 403 for VENDÉG on the map, hold and purchase and leave it out of every tier sector list', async () => {
      await seedTier('upper', 1);
      await seedTier('lower', 1);
      const awaySeat = await ctx.dataSource.getRepository(Seat).save(
        ctx.dataSource.getRepository(Seat).create({
          section: 'VENDÉG',
          row: '1',
          number: 1,
          category: SeatCategory.STANDARD,
          priceModifier: '1.00',
          isAccessible: false,
          isActive: true,
        }),
      );
      const fan = await registerFan('away');

      const map = await seasonMap('VENDÉG');
      expect(map.status).toBe(403);
      expect(map.body.code).toBe('away_section');

      expect((await holdSeat(fan.accessToken, awaySeat.id)).status).toBe(403);
      const buy = await postPurchase(fan.accessToken, 'upper', awaySeat.id, 'forged-token');
      expect(buy.status).toBe(403);
      expect(ctx.stripeStub.paymentIntentsCreateMock).not.toHaveBeenCalled();

      for (const tier of ['upper', 'lower'] as const) {
        const res = await request(server).get(`/api/season-passes/tiers/${tier}/sectors`);
        expect(res.status).toBe(200);
        const codes = (res.body.sectors as Array<{ section: string }>).map((s) => s.section);
        expect(codes).not.toContain('VENDÉG');
      }
    });

    it('should answer 404 tier_not_found for a tier without an active price', async () => {
      const res = await request(server).get('/api/season-passes/tiers/upper/sectors');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('tier_not_found');
    });

    it('should refuse a seat of another tier with 400 seat_tier_mismatch before any charge', async () => {
      const upper = await seedTier('upper', 1);
      await seedTier('lower', 1);
      const fan = await registerFan('mismatch');
      const hold = await holdSeat(fan.accessToken, upper.seats[0].id);
      const buy = await postPurchase(fan.accessToken, 'lower', upper.seats[0].id, hold.body.holdToken);
      expect(buy.status).toBe(400);
      expect(buy.body.code).toBe('seat_tier_mismatch');
      expect(ctx.stripeStub.paymentIntentsCreateMock).not.toHaveBeenCalled();
    });
  });

  describe('buying for someone else', () => {
    it('should keep the buyer as payer and give the holder name and account of the e-mail on the chosen seat', async () => {
      const { seats } = await seedTier('upper', 3);
      const buyer = await registerFan('payer', { firstName: 'Péter', lastName: 'Kovács' });
      const partner = await registerFan('partner', { firstName: 'Anna', lastName: 'Kovácsné' });

      const pass = await buyPass(buyer, 'upper', seats[2], { holderEmail: partner.email });
      expect(pass.userId).toBe(buyer.userId);
      expect(pass.holderUserId).toBe(partner.userId);
      expect(pass.holderName).toBe('Kovácsné Anna');
      expect(pass.seatId).toBe(seats[2].id);

      const theirs = await request(server)
        .get('/api/season-passes/me')
        .set('Authorization', `Bearer ${partner.accessToken}`);
      expect(theirs.status).toBe(200);
      expect(theirs.body).toHaveLength(1);
      expect(theirs.body[0]).toMatchObject({
        holderName: 'Kovácsné Anna',
        isHolder: true,
        isBuyer: false,
        buyerName: 'Kovács Péter',
      });
    });

    it('should store a name-only holder without an account and let the buyer buy another seat for themself', async () => {
      const { seats } = await seedTier('upper', 3);
      const buyer = await registerFan('payer2', { firstName: 'Péter', lastName: 'Kovács' });

      const child = await buyPass(buyer, 'upper', seats[1], { holderName: 'Kovács Bence' });
      expect(child.holderName).toBe('Kovács Bence');
      expect(child.holderUserId).toBeNull();
      expect(child.userId).toBe(buyer.userId);
      expect(child.seatId).toBe(seats[1].id);

      const own = await buyPass(buyer, 'upper', seats[0]);
      expect(own.holderUserId).toBe(buyer.userId);
      expect(own.holderName).toBe('Kovács Péter');
      expect(own.seatId).toBe(seats[0].id);
    });
  });
});
