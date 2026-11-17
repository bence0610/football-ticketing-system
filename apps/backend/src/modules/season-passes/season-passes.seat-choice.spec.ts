import type Stripe from 'stripe';
import { SeasonPassesService } from './season-passes.service';
import {
  SeasonPass,
  SeasonPassPrice,
  Ticket,
  TicketSource,
  TicketStatus,
} from '../../database/entities';
import type { PurchaseSeasonPassDto } from './dto/purchase-season-pass.dto';

/**
 * The buyer chooses the seat. Unit level (no MySQL): the DB is a stub that
 * answers the shared season-pass seat-rule query, so these tests pin down what
 * the service DOES with the rule's answer: refuse before charging, issue
 * exactly the chosen seat, refund instead of reassigning.
 */

const SEAT = '11111111-1111-4111-8111-111111111111';
const OTHER_SEAT = '22222222-2222-4222-8222-222222222222';

const SECTORS = [
  {
    code: 'D/1',
    name: 'D/1 szektor',
    covered: 1,
    arc: 'upper',
    position: 1,
    gate: 2,
    priceCategory: 'upper',
    isAway: 0,
  },
  {
    code: 'VENDÉG',
    name: 'Vendég szektor',
    covered: 0,
    arc: 'lower',
    position: 1,
    gate: 3,
    priceCategory: null,
    isAway: 1,
  },
  {
    code: 'K',
    name: 'K szektor',
    covered: 0,
    arc: 'lower',
    position: 5,
    gate: 2,
    priceCategory: 'lower',
    isAway: 0,
  },
];

type SeatRowOpts = { free?: 0 | 1; taken?: 0 | 1; isActive?: 0 | 1; section?: string };

function seatRow(id: string, o: SeatRowOpts = {}): Record<string, unknown> {
  const section = o.section ?? 'D/1';
  const sector = SECTORS.find((s) => s.code === section)!;
  return {
    id,
    section,
    row: '3',
    number: 5,
    category: 'standard',
    isAccessible: 0,
    isActive: o.isActive ?? 1,
    sectorCode: section,
    isAway: sector.isAway,
    tier: sector.priceCategory,
    free: o.free ?? (sector.isAway ? 0 : 1),
    taken: o.taken ?? 0,
  };
}

const PRICE_ROW = {
  id: 'price-upper',
  section: 'upper',
  sectionLabel: 'Felső ív',
  seasonLabel: '2026/2027',
  price: 22000,
  currency: 'HUF',
  isActive: true,
  validFrom: new Date('2026-07-01T00:00:00Z'),
  validUntil: new Date('2027-06-30T00:00:00Z'),
} as unknown as SeasonPassPrice;

const BUYER = { id: 'u1', email: 'buyer@x.hu', firstName: 'Anna', lastName: 'Kovács' };

function dupError(index: string): Error {
  return Object.assign(new Error(`ER_DUP_ENTRY: Duplicate entry 'x' for key '${index}'`), {
    code: 'ER_DUP_ENTRY',
  });
}

interface Harness {
  service: SeasonPassesService;
  seats: Map<string, Record<string, unknown>>;
  stripeCreate: jest.Mock;
  refund: jest.Mock;
  save: jest.Mock;
  passFindOne: jest.Mock;
  award: jest.Mock;
  holds: {
    hold: jest.Mock;
    verifyAndExtend: jest.Mock;
    release: jest.Mock;
    releaseForOwner: jest.Mock;
    heldSeatIds: jest.Mock;
  };
  redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  singleTicket: { value: Partial<Ticket> | null };
}

function harness(): Harness {
  const seats = new Map<string, Record<string, unknown>>([[SEAT, seatRow(SEAT)]]);
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM sectors') && !sql.includes('FROM seats')) return SECTORS;
    if (sql.includes('WHERE s.id = ?')) {
      const row = seats.get(String(params[params.length - 1]));
      return row ? [row] : [];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  const save = jest.fn(async (x: SeasonPass) => ({ ...x }));
  const passFindOne = jest.fn(async () => null);
  const singleTicket: { value: Partial<Ticket> | null } = { value: null };
  const ticketRepo = {
    findOne: jest.fn(async ({ where }: { where: { source?: TicketSource } }) =>
      where.source === TicketSource.SINGLE ? singleTicket.value : null,
    ),
    create: (x: unknown) => x,
    save: jest.fn(async (x: unknown) => ({ id: 't-new', ...(x as object) })),
  };
  const manager = {
    query,
    getRepository: (entity: unknown) => {
      if (entity === SeasonPass) return { create: (x: unknown) => x, save };
      if (entity === Ticket) return ticketRepo;
      return { findOne: async () => null };
    },
  };
  const dataSource = {
    query,
    manager,
    transaction: async (cb: (m: unknown) => unknown) => cb(manager),
    getRepository: () => ticketRepo,
  };
  const stripeCreate = jest.fn();
  const refund = jest.fn(async () => ({ id: 're_1' }));
  const award = jest.fn(async () => undefined);
  const holds = {
    hold: jest.fn(),
    verifyAndExtend: jest.fn(async () => true),
    release: jest.fn(async () => true),
    releaseForOwner: jest.fn(async () => undefined),
    heldSeatIds: jest.fn(async () => new Set<string>()),
  };
  const redis = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
  };
  const config = {
    getOrThrow: (key: string) =>
      ({
        mail: {},
        cron: {},
        loyalty: { seasonPassPoints: 500 },
        stripe: { currency: 'huf' },
        app: { homeTeamName: 'KTE FC' },
      })[key],
  };
  const service = new SeasonPassesService(
    { findOne: passFindOne } as never,
    { findOne: async () => null } as never,
    {
      findOne: async () => ({
        id: 'm1',
        kickoffAt: new Date(Date.now() + 86400000),
        isSeasonPassEligible: true,
        status: 'on_sale',
      }),
    } as never,
    {
      findOne: async ({ where }: { where: { id?: string } }) => (where.id === 'u1' ? BUYER : null),
    } as never,
    {
      findOne: async ({ where }: { where: { section?: string; id?: string } }) =>
        where.section === 'upper' || where.id === 'price-upper' ? PRICE_ROW : null,
    } as never,
    dataSource as never,
    { paymentIntents: { create: stripeCreate }, refunds: { create: refund } } as never,
    redis as never,
    config as never,
    { send: jest.fn() } as never,
    {
      generateJti: () => 'jti',
      generateForTicket: jest.fn(async () => ({ dataUrl: 'd', token: 't' })),
    } as never,
    { award } as never,
    { formatSeat: () => 'x' } as never,
    holds as never,
  );
  return {
    service,
    seats,
    stripeCreate,
    refund,
    save,
    passFindOne,
    award,
    holds,
    redis,
    singleTicket,
  };
}

const dto = (over: Partial<PurchaseSeasonPassDto> = {}): PurchaseSeasonPassDto => ({
  sectionId: 'upper',
  seatId: SEAT,
  holdToken: 'tok-1',
  paymentMethodId: 'pm_card_visa',
  ...over,
});

function intent(
  over: Partial<Stripe.PaymentIntent> = {},
  meta: Record<string, string> = {},
): Stripe.PaymentIntent {
  return {
    id: 'pi_1',
    status: 'succeeded',
    amount: 2_200_000,
    client_secret: 'cs',
    metadata: {
      kind: 'season_pass',
      userId: 'u1',
      priceRowId: 'price-upper',
      holderName: 'Kovács Anna',
      holderUserId: 'u1',
      seatId: SEAT,
      ...meta,
    },
    ...over,
  } as unknown as Stripe.PaymentIntent;
}

describe('Season pass: the buyer chooses the seat', () => {
  describe('hold', () => {
    it('holds a free seat and returns the token, ttl and expiry (no holder identity)', async () => {
      const h = harness();
      h.holds.hold.mockResolvedValue({
        kind: 'held',
        holdToken: 'tok-9',
        ttlSeconds: 900,
        renewed: false,
      });
      const res = await h.service.holdSeat('u1', SEAT);
      expect(res).toEqual({
        seatId: SEAT,
        holdToken: 'tok-9',
        ttlSeconds: 900,
        expiresAt: expect.any(String),
      });
      expect(h.holds.hold).toHaveBeenCalledWith('2026/2027', SEAT, 'u1');
    });

    it('a seat with a pass row cannot be held: 409 seat_taken, Redis untouched', async () => {
      const h = harness();
      h.seats.set(SEAT, seatRow(SEAT, { free: 0, taken: 1 }));
      await expect(h.service.holdSeat('u1', SEAT)).rejects.toMatchObject({
        status: 409,
        response: { code: 'seat_taken' },
      });
      expect(h.holds.hold).not.toHaveBeenCalled();
    });

    it('someone else holding it: 409 seat_held', async () => {
      const h = harness();
      h.holds.hold.mockResolvedValue({ kind: 'held_by_other' });
      await expect(h.service.holdSeat('u1', SEAT)).rejects.toMatchObject({
        status: 409,
        response: { code: 'seat_held' },
      });
    });

    it('VENDÉG seat: 403; unknown seat: 404; inactive seat: 409 seat_disabled', async () => {
      const h = harness();
      h.seats.set(OTHER_SEAT, seatRow(OTHER_SEAT, { section: 'VENDÉG' }));
      await expect(h.service.holdSeat('u1', OTHER_SEAT)).rejects.toMatchObject({ status: 403 });
      await expect(
        h.service.holdSeat('u1', '33333333-3333-4333-8333-333333333333'),
      ).rejects.toMatchObject({ status: 404, response: { code: 'seat_not_found' } });
      h.seats.set(SEAT, seatRow(SEAT, { free: 0, isActive: 0 }));
      await expect(h.service.holdSeat('u1', SEAT)).rejects.toMatchObject({
        status: 409,
        response: { code: 'seat_disabled' },
      });
      expect(h.holds.hold).not.toHaveBeenCalled();
    });

    it('Redis down: 503 hold_unavailable rather than an unguarded seat', async () => {
      const h = harness();
      h.holds.hold.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(h.service.holdSeat('u1', SEAT)).rejects.toMatchObject({
        status: 503,
        response: { code: 'hold_unavailable' },
      });
    });
  });

  describe('purchase (before any money moves)', () => {
    it('refuses a seat that already has a pass row: 409 seat_taken, Stripe never called', async () => {
      const h = harness();
      h.seats.set(SEAT, seatRow(SEAT, { free: 0, taken: 1 }));
      await expect(h.service.purchase('u1', dto())).rejects.toMatchObject({
        status: 409,
        response: { code: 'seat_taken' },
      });
      expect(h.stripeCreate).not.toHaveBeenCalled();
    });

    it('refuses a lost hold: 409 hold_lost with a Hungarian message, Stripe never called', async () => {
      const h = harness();
      h.holds.verifyAndExtend.mockResolvedValue(false);
      await expect(h.service.purchase('u1', dto())).rejects.toMatchObject({
        status: 409,
        response: { code: 'hold_lost', message: expect.stringContaining('helyfoglalásod') },
      });
      expect(h.holds.verifyAndExtend).toHaveBeenCalledWith('2026/2027', SEAT, 'u1', 'tok-1');
      expect(h.stripeCreate).not.toHaveBeenCalled();
    });

    it('refuses a seat outside the purchased tier: 400 seat_tier_mismatch', async () => {
      const h = harness();
      h.seats.set(SEAT, seatRow(SEAT, { section: 'K' }));
      await expect(h.service.purchase('u1', dto())).rejects.toMatchObject({
        status: 400,
        response: { code: 'seat_tier_mismatch' },
      });
      expect(h.stripeCreate).not.toHaveBeenCalled();
    });

    it('a seat with only a single-match ticket is purchasable (the rule ignores match state)', async () => {
      const h = harness();
      // The stub DB says the rule finds it free; and a SINGLE ticket exists for some match.
      h.singleTicket.value = { id: 't-single', status: TicketStatus.PAID };
      h.stripeCreate.mockResolvedValue(intent());
      const res = await h.service.purchase('u1', dto());
      expect(res.succeeded).toBe(true);
      expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ seatId: SEAT }));
    });

    it('puts seatId in the metadata, keys the attempt by seat, extends the hold, issues THAT seat, releases the hold', async () => {
      const h = harness();
      h.stripeCreate.mockResolvedValue(intent());
      await h.service.purchase('u1', dto());

      const [params] = h.stripeCreate.mock.calls[0] as [Stripe.PaymentIntentCreateParams];
      expect(params.metadata).toMatchObject({ seatId: SEAT, section: 'upper' });
      const attemptKey = String((h.redis.get.mock.calls[0] as unknown[])[0]);
      expect(attemptKey.endsWith(`:${SEAT}`)).toBe(true);
      // once before charging, once after the intent exists
      expect(h.holds.verifyAndExtend).toHaveBeenCalledTimes(2);
      expect(h.save).toHaveBeenCalledWith(
        expect.objectContaining({
          seatId: SEAT,
          stripePaymentIntentId: 'pi_1',
          pricePaid: '22000.00',
        }),
      );
      expect(h.award).toHaveBeenCalledTimes(1);
      expect(h.holds.releaseForOwner).toHaveBeenCalledWith('2026/2027', SEAT, 'u1');
    });

    it('a different seat is a different attempt (different idempotency record)', async () => {
      const h = harness();
      h.seats.set(OTHER_SEAT, seatRow(OTHER_SEAT));
      h.stripeCreate.mockResolvedValue(intent({ status: 'requires_action' } as never));
      await h.service.purchase('u1', dto());
      await h.service.purchase('u1', dto({ seatId: OTHER_SEAT }));
      const keys = (h.redis.get.mock.calls as unknown[][]).map((c) => String(c[0]));
      expect(new Set(keys).size).toBe(2);
    });
  });

  describe('finalisation (payment already taken)', () => {
    it('seat lost to another pass (unique index fires): refund, no pass, no loyalty, no other seat tried', async () => {
      const h = harness();
      h.save.mockRejectedValueOnce(dupError('uq_season_passes_seat_season'));
      await h.service.finalizeSeasonPassFromIntent(intent());
      expect(h.save).toHaveBeenCalledTimes(1);
      expect(h.refund).toHaveBeenCalledWith(
        { payment_intent: 'pi_1' },
        { idempotencyKey: 'refund_seasonpass_pi_1' },
      );
      expect(h.award).not.toHaveBeenCalled();
      expect(h.holds.releaseForOwner).toHaveBeenCalledWith('2026/2027', SEAT, 'u1');
    });

    it('purchase() surfaces that refund as 409 pass_not_issued_refunded', async () => {
      const h = harness();
      h.stripeCreate.mockResolvedValue(intent());
      h.save.mockRejectedValueOnce(dupError('uq_season_passes_seat_season'));
      await expect(h.service.purchase('u1', dto())).rejects.toMatchObject({
        status: 409,
        response: { code: 'pass_not_issued_refunded' },
      });
      expect(h.refund).toHaveBeenCalledTimes(1);
    });

    it('seat taken by the time of finalisation (rule re-check in the transaction): refund without inserting', async () => {
      const h = harness();
      h.seats.set(SEAT, seatRow(SEAT, { free: 0, taken: 1 }));
      await h.service.finalizeSeasonPassFromIntent(intent());
      expect(h.save).not.toHaveBeenCalled();
      expect(h.refund).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['inactive', seatRow(SEAT, { free: 0, isActive: 0 })],
      ['away', seatRow(SEAT, { section: 'VENDÉG' })],
      ['now in another tier', seatRow(SEAT, { section: 'K' })],
    ])('seat %s at finalisation: refund, no pass', async (_label, row) => {
      const h = harness();
      h.seats.set(SEAT, row);
      await h.service.finalizeSeasonPassFromIntent(intent());
      expect(h.save).not.toHaveBeenCalled();
      expect(h.refund).toHaveBeenCalledTimes(1);
    });

    it('missing seat: refund', async () => {
      const h = harness();
      h.seats.clear();
      await h.service.finalizeSeasonPassFromIntent(intent());
      expect(h.refund).toHaveBeenCalledTimes(1);
      expect(h.save).not.toHaveBeenCalled();
    });

    it('an intent without seatId metadata is refunded, never given an automatic seat', async () => {
      const h = harness();
      await h.service.finalizeSeasonPassFromIntent(intent({}, { seatId: '' }));
      expect(h.save).not.toHaveBeenCalled();
      expect(h.refund).toHaveBeenCalledTimes(1);
    });

    it('does not need the hold any more: finalises even when Redis knows nothing of it', async () => {
      const h = harness();
      h.holds.verifyAndExtend.mockResolvedValue(false);
      await h.service.finalizeSeasonPassFromIntent(intent());
      expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ seatId: SEAT }));
      expect(h.refund).not.toHaveBeenCalled();
    });

    it('holder already has a pass (holder index): refund', async () => {
      const h = harness();
      h.save.mockRejectedValueOnce(dupError('uq_season_passes_holder_season'));
      await h.service.finalizeSeasonPassFromIntent(intent());
      expect(h.refund).toHaveBeenCalledTimes(1);
    });

    it('webhook + confirm race for the SAME intent: the loser returns the winner, no refund', async () => {
      const h = harness();
      h.passFindOne
        .mockResolvedValueOnce(null) // idempotency check: not there yet
        .mockResolvedValueOnce({ id: 'pass-winner', userId: 'u1', seatId: SEAT }); // after the dup
      h.save.mockRejectedValueOnce(dupError('uq_season_passes_seat_season'));
      await h.service.finalizeSeasonPassFromIntent(intent());
      expect(h.refund).not.toHaveBeenCalled();
      expect(h.award).toHaveBeenCalledTimes(1);
    });

    it('idempotent per PaymentIntent: an existing pass is returned, nothing inserted', async () => {
      const h = harness();
      h.passFindOne.mockResolvedValue({ id: 'pass-1', userId: 'u1', seatId: SEAT });
      await h.service.finalizeSeasonPassFromIntent(intent());
      expect(h.save).not.toHaveBeenCalled();
      expect(h.refund).not.toHaveBeenCalled();
    });
  });

  describe('a pass seat that already carries a single-match ticket for one match', () => {
    const pass = {
      id: 'pass-1',
      userId: 'u1',
      holderUserId: 'u1',
      status: 'active',
      seatId: SEAT,
      validFrom: new Date('2020-01-01T00:00:00Z'),
      validUntil: new Date('2099-12-31T00:00:00Z'),
      holderName: 'Kovács Anna',
    };

    it('the match QR is refused with 409 seat_sold_for_match (not a raw 500)', async () => {
      const h = harness();
      h.passFindOne.mockResolvedValue(pass);
      h.singleTicket.value = { id: 't-single', status: TicketStatus.PAID };
      await expect(h.service.getMatchQr('pass-1', 'm1', 'u1')).rejects.toMatchObject({
        status: 409,
        response: { code: 'seat_sold_for_match' },
      });
    });

    it('a void single ticket still blocks the slot: 409 seat_slot_blocked, the row is not deleted', async () => {
      const h = harness();
      h.passFindOne.mockResolvedValue(pass);
      h.singleTicket.value = { id: 't-single', status: TicketStatus.REFUNDED };
      await expect(h.service.getMatchQr('pass-1', 'm1', 'u1')).rejects.toMatchObject({
        status: 409,
        response: { code: 'seat_slot_blocked' },
      });
    });

    it('with no single ticket the SEASON_PASS ticket is materialised as before', async () => {
      const h = harness();
      h.passFindOne.mockResolvedValue(pass);
      const qr = await h.service.getMatchQr('pass-1', 'm1', 'u1');
      expect(qr.ticketId).toBe('t-new');
    });
  });
});
