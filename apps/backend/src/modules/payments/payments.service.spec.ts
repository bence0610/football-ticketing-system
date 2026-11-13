import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Stripe from 'stripe';
import { PaymentsService } from './payments.service';
import { STRIPE_CLIENT } from './stripe.provider';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { SeatLockService } from '../../redis/seat-lock.service';
import { EmailService } from '../email/email.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { QrService } from '../qr/qr.service';
import { TicketRendererService } from '../tickets/ticket-renderer.service';
import { LoyaltyTier, Match, Seat, Ticket } from '../../database/entities';
import { SeatAvailability } from '../seats/dto';
import { SeatsService } from '../seats/seats.service';
import { SeasonPassesService } from '../season-passes/season-passes.service';

describe('PaymentsService', () => {
  let service: PaymentsService;

  const mockTicketRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const mockMatchRepo = { findOne: jest.fn() };
  const mockSeatRepo = { find: jest.fn() };
  const mockRedis = { del: jest.fn(), set: jest.fn(), get: jest.fn() };
  const mockSeatsService = { resolveAvailabilityForSeats: jest.fn() };
  const mockStripe = {
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
    refunds: { create: jest.fn() },
  };
  const mockSeatLockService = { release: jest.fn(), extend: jest.fn() };
  const mockUserRepo = { findOne: jest.fn() };
  const mockDataSource = {
    transaction: jest.fn(),
    getRepository: jest.fn().mockReturnValue(mockUserRepo),
  };
  const mockLoyaltyService = { award: jest.fn() };
  const mockQrService = {
    generateJti: jest.fn().mockReturnValue('test-jti'),
    generateForTicket: jest.fn(),
  };
  const mockEmailService = { send: jest.fn() };
  const mockSeasonPassesService = { finalizeSeasonPassFromIntent: jest.fn() };
  const mockTicketRenderer = {
    matchSummary: jest.fn(),
    renderTicketSection: jest.fn(),
    formatSeat: jest.fn(),
    computeTotal: jest.fn(),
  };
  const mockConfigService = {
    getOrThrow: jest.fn().mockImplementation((key: string) => {
      if (key === 'stripe') return { currency: 'HUF', webhookSecret: 'whsec_test' };
      if (key === 'loyalty') return { ticketPointsPerTicket: 10 };
      if (key === 'mail') return { retryDelayMs: 3000, baseUrl: 'http://localhost:4200' };
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: STRIPE_CLIENT, useValue: mockStripe },
        { provide: getRepositoryToken(Match), useValue: mockMatchRepo },
        { provide: getRepositoryToken(Seat), useValue: mockSeatRepo },
        { provide: getRepositoryToken(Ticket), useValue: mockTicketRepo },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: SeatLockService, useValue: mockSeatLockService },
        { provide: SeatsService, useValue: mockSeatsService },
        { provide: DataSource, useValue: mockDataSource },
        { provide: LoyaltyService, useValue: mockLoyaltyService },
        { provide: QrService, useValue: mockQrService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: TicketRendererService, useValue: mockTicketRenderer },
        { provide: SeasonPassesService, useValue: mockSeasonPassesService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(PaymentsService);
    jest.clearAllMocks();
    mockQrService.generateJti.mockReturnValue('test-jti');
    mockDataSource.getRepository.mockReturnValue(mockUserRepo);
    mockUserRepo.findOne.mockResolvedValue(null);
  });

  describe('finalizePaymentIntent', () => {
    const intent = {
      id: 'pi_test',
      metadata: { userId: 'u-1', matchId: 'm-1', seatIds: 's-1', ownerTokens: 'tok-1' },
    } as unknown as Stripe.PaymentIntent;

    const event = {
      id: 'evt_test',
      type: 'payment_intent.succeeded',
      data: { object: intent },
    } as unknown as Stripe.Event;

    beforeEach(() => {
      const ticket = {
        id: 'ticket-1',
        userId: 'u-1',
        stripePaymentIntentId: 'pi_test',
        qrJti: 'test-jti',
      };
      mockTicketRepo.find.mockResolvedValue([]);
      mockTicketRepo.findOne.mockResolvedValue(null); // seat is free — no occupying ticket
      mockRedis.get.mockResolvedValue('tok-1'); // lock still present
      mockStripe.refunds.create.mockResolvedValue({ id: 're_test', amount: 0 });
      mockMatchRepo.findOne.mockResolvedValue({
        id: 'm-1',
        homeTeam: 'KTE',
        awayTeam: 'DVTK',
        basePrice: '3000',
      });
      mockSeatRepo.find.mockResolvedValue([
        { id: 's-1', priceModifier: '1.0', section: 'A', row: '1', number: '1' },
      ]);
      mockDataSource.transaction.mockImplementation(async (fn: (em: unknown) => Promise<unknown>) =>
        fn({ create: () => ticket, save: async () => ticket }),
      );
      mockSeatLockService.release.mockResolvedValue(true);
      mockRedis.del.mockResolvedValue(1);
      mockLoyaltyService.award.mockResolvedValue(undefined);
    });

    it('resolves without waiting for the confirmation email to send', async () => {
      jest.useFakeTimers();
      try {
        // email send never resolves — awaiting it would hang the test forever
        mockEmailService.send.mockReturnValue(new Promise<void>(() => {}));

        await service.handleEvent(event);

        // setImmediate has not fired yet (fake timers hold it), so email
        // dispatch has not started
        expect(mockEmailService.send).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('payment_intent.payment_failed', () => {
    it('restarts each seat lock at the configured hold - no separate retry length', async () => {
      mockSeatLockService.extend.mockResolvedValue(true);
      const event = {
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_3Failed',
            metadata: { matchId: 'm-1', seatIds: 's-1,s-2', ownerTokens: 'tok-1,tok-2' },
          },
        },
      } as never;

      await service.handleEvent(event);

      // exactly (match, seat, token): the TTL argument is left to the lock service's
      // configured default (SEAT_LOCK_TTL_SECONDS), so it can never disagree with the hold
      expect(mockSeatLockService.extend.mock.calls).toEqual([
        ['m-1', 's-1', 'tok-1'],
        ['m-1', 's-2', 'tok-2'],
      ]);
    });
  });

  describe('createPaymentIntent', () => {
    const matchId = 'aaaaaaaa-0000-4000-8000-000000000001';
    const seatId = 'bbbbbbbb-0000-4000-8000-000000000001';
    const userId = 'cccccccc-0000-4000-8000-000000000001';
    const ownerToken = 'dddddddd-0000-4000-8000-000000000001';

    beforeEach(() => {
      mockMatchRepo.findOne.mockResolvedValue({
        id: matchId,
        homeTeam: 'KTE',
        awayTeam: 'DVTK',
        basePrice: '3000',
      });
      mockSeatRepo.find.mockResolvedValue([
        { id: seatId, priceModifier: '1.0', section: 'A', row: '1', number: 1 },
      ]);
    });

    it('should throw ConflictException when a seat is held by a season pass', async () => {
      mockSeatsService.resolveAvailabilityForSeats.mockResolvedValue(
        new Map([[seatId, SeatAvailability.SEASON_PASS]]),
      );

      await expect(
        service.createPaymentIntent(userId, {
          matchId,
          seats: [{ seatId, ownerToken }],
        }),
      ).rejects.toThrow('Ez a hely bérletes hely.');
    });

    it('should throw ConflictException when a seat is inactive', async () => {
      mockSeatsService.resolveAvailabilityForSeats.mockResolvedValue(
        new Map([[seatId, SeatAvailability.DISABLED]]),
      );

      await expect(
        service.createPaymentIntent(userId, {
          matchId,
          seats: [{ seatId, ownerToken }],
        }),
      ).rejects.toThrow('Ez a hely nem foglalható');
    });

    it('should create a payment intent for an available locked seat', async () => {
      mockSeatsService.resolveAvailabilityForSeats.mockResolvedValue(
        new Map([[seatId, SeatAvailability.LOCKED]]),
      );
      mockRedis.get.mockResolvedValue(ownerToken);
      mockStripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_test_123',
        client_secret: 'secret_test_456',
      });

      const result = await service.createPaymentIntent(userId, {
        matchId,
        seats: [{ seatId, ownerToken }],
      });

      expect(result.paymentIntentId).toBe('pi_test_123');
      expect(result.clientSecret).toBe('secret_test_456');
    });
  });

  describe('loyalty tier discount', () => {
    const matchId = 'aaaaaaaa-0000-4000-8000-000000000002';
    const userId = 'cccccccc-0000-4000-8000-000000000002';
    const seatA = 'bbbbbbbb-0000-4000-8000-00000000000a';
    const seatB = 'bbbbbbbb-0000-4000-8000-00000000000b';
    // basePrice 3333: seat A = 3333, seat B = round(3333 * 1.5) = 5000, list sum 8333.
    // KTE Legenda 15 %: round(8333 * 0.15) = 1250 off -> 7083, split as [2833, 4250].
    const match = { id: matchId, homeTeam: 'KTE', awayTeam: 'DVTK', basePrice: '3333' };
    const seats = [
      { id: seatA, priceModifier: '1.0', section: 'A', row: '1', number: 1 },
      { id: seatB, priceModifier: '1.5', section: 'A', row: '1', number: 2 },
    ];

    beforeEach(() => {
      mockMatchRepo.findOne.mockResolvedValue(match);
      mockSeatRepo.find.mockResolvedValue(seats);
    });

    describe('createPaymentIntent', () => {
      beforeEach(() => {
        mockSeatsService.resolveAvailabilityForSeats.mockResolvedValue(
          new Map([
            [seatA, SeatAvailability.LOCKED],
            [seatB, SeatAvailability.LOCKED],
          ]),
        );
        mockRedis.get.mockImplementation(async (key: string) =>
          key.endsWith(seatA) ? 'tok-a' : 'tok-b',
        );
        mockStripe.paymentIntents.create.mockResolvedValue({
          id: 'pi_disc',
          client_secret: 'secret_disc',
        });
      });

      const create = () =>
        service.createPaymentIntent(userId, {
          matchId,
          seats: [
            { seatId: seatA, ownerToken: 'tok-a' },
            { seatId: seatB, ownerToken: 'tok-b' },
          ],
        });

      it('charges the discounted total for the buyer tier and records the percent', async () => {
        mockUserRepo.findOne.mockResolvedValue({ id: userId, loyaltyTier: LoyaltyTier.PLATINUM });

        const result = await create();

        const [params, options] = mockStripe.paymentIntents.create.mock.calls[0];
        expect(params.amount).toBe(7083 * 100);
        expect(params.metadata.discountPercent).toBe('15');
        expect(options.idempotencyKey).toMatch(/_d15$/);
        expect(result.amount).toBe(7083);
        expect(result.discountPercent).toBe(15);
        expect(result.discountAmount).toBe(1250);
        expect(result.subtotal).toBe(8333);
        expect(params.metadata.paidPrices).toBe('2833,4250');
        // line items stay at list price; list sum - discountAmount = amount
        expect(result.lineItems.map((l) => l.price)).toEqual([3333, 5000]);
        expect(result.subtotal - result.discountAmount).toBe(result.amount);
      });

      it('charges list price for a Kek (0 %) user', async () => {
        mockUserRepo.findOne.mockResolvedValue({ id: userId, loyaltyTier: LoyaltyTier.BRONZE });

        const result = await create();

        const [params, options] = mockStripe.paymentIntents.create.mock.calls[0];
        expect(params.amount).toBe(8333 * 100);
        expect(params.metadata.discountPercent).toBe('0');
        expect(options.idempotencyKey).toMatch(/_d0$/);
        expect(result.amount).toBe(8333);
        expect(result.discountAmount).toBe(0);
      });

      it('uses a different idempotency key when the tier changes for the same lock hold', async () => {
        mockUserRepo.findOne.mockResolvedValueOnce({ id: userId, loyaltyTier: LoyaltyTier.BRONZE });
        await create();
        mockUserRepo.findOne.mockResolvedValueOnce({ id: userId, loyaltyTier: LoyaltyTier.GOLD });
        await create();

        const keys = (
          mockStripe.paymentIntents.create.mock.calls as Array<
            [unknown, { idempotencyKey: string }]
          >
        ).map((c) => c[1].idempotencyKey);
        expect(keys[0]).not.toBe(keys[1]);
        expect(keys[0].replace(/_d\d+$/, '')).toBe(keys[1].replace(/_d\d+$/, ''));
      });
    });

    describe('finalize', () => {
      interface CreatedTicket {
        seatId: string;
        pricePaid: string;
      }
      let created: CreatedTicket[];

      const intentWith = (metadata: Record<string, string>): Stripe.PaymentIntent =>
        ({
          id: 'pi_disc',
          amount: 7083 * 100,
          metadata: {
            userId,
            matchId,
            seatIds: `${seatA},${seatB}`,
            ownerTokens: 'tok-a,tok-b',
            ...metadata,
          },
        }) as unknown as Stripe.PaymentIntent;

      const succeed = (intent: Stripe.PaymentIntent): Promise<void> =>
        service.handleEvent({
          id: 'evt_disc',
          type: 'payment_intent.succeeded',
          data: { object: intent },
        } as unknown as Stripe.Event);

      beforeEach(() => {
        jest.useFakeTimers(); // hold the setImmediate email dispatch
        created = [];
        mockTicketRepo.find.mockResolvedValue([]);
        mockTicketRepo.findOne.mockResolvedValue(null);
        mockRedis.get.mockResolvedValue('tok');
        mockRedis.del.mockResolvedValue(1);
        mockSeatLockService.release.mockResolvedValue(true);
        mockLoyaltyService.award.mockResolvedValue(undefined);
        mockStripe.refunds.create.mockResolvedValue({ id: 're_disc' });
        mockDataSource.transaction.mockImplementation(
          async (fn: (em: unknown) => Promise<unknown>) =>
            fn({
              create: (_: unknown, data: CreatedTicket) => data,
              save: async (_: unknown, t: CreatedTicket) => {
                const saved = { ...t, id: `t-${t.seatId}`, userId };
                created.push(saved);
                return saved;
              },
            }),
        );
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('records the discounted price per ticket, summing to the charged amount', async () => {
        await succeed(intentWith({ discountPercent: '15' }));

        expect(created.map((t) => t.pricePaid)).toEqual(['2833.00', '4250.00']);
        expect(created.reduce((a, t) => a + Number(t.pricePaid), 0)).toBe(7083);
        expect(mockStripe.refunds.create).not.toHaveBeenCalled();
      });

      it('refunds what was actually paid for a seat taken after payment', async () => {
        mockTicketRepo.findOne.mockImplementation(async (opts: { where: { seatId: string } }) =>
          opts.where.seatId === seatB ? { id: 'someone-else' } : null,
        );

        await succeed(intentWith({ discountPercent: '15' }));

        expect(created.map((t) => [t.seatId, t.pricePaid])).toEqual([[seatA, '2833.00']]);
        expect(mockStripe.refunds.create).toHaveBeenCalledWith(
          { payment_intent: 'pi_disc', amount: 4250 * 100 },
          { idempotencyKey: 'refund_pi_disc' },
        );
      });

      it('treats a legacy intent without discountPercent as list price', async () => {
        await succeed(intentWith({}));

        expect(created.map((t) => t.pricePaid)).toEqual(['3333.00', '5000.00']);
      });

      it('falls back to list price for an invalid discountPercent', async () => {
        await succeed(intentWith({ discountPercent: 'garbage' }));

        expect(created.map((t) => t.pricePaid)).toEqual(['3333.00', '5000.00']);
      });

      it('records the captured per-seat amounts even if the price changed after payment creation', async () => {
        // Admin raised the match base price to 9999 after the buyer paid 7083.
        mockMatchRepo.findOne.mockResolvedValue({ ...match, basePrice: '9999' });

        await succeed(intentWith({ discountPercent: '15', paidPrices: '2833,4250' }));

        expect(created.map((t) => t.pricePaid)).toEqual(['2833.00', '4250.00']);
      });

      it('refunds the captured amount for a taken seat even if the price changed', async () => {
        mockMatchRepo.findOne.mockResolvedValue({ ...match, basePrice: '9999' });
        mockTicketRepo.findOne.mockImplementation(async (opts: { where: { seatId: string } }) =>
          opts.where.seatId === seatB ? { id: 'someone-else' } : null,
        );

        await succeed(intentWith({ discountPercent: '15', paidPrices: '2833,4250' }));

        expect(mockStripe.refunds.create).toHaveBeenCalledWith(
          { payment_intent: 'pi_disc', amount: 4250 * 100 },
          { idempotencyKey: 'refund_pi_disc' },
        );
      });

      it('ignores captured amounts that do not add up to the charged amount', async () => {
        const intent = intentWith({ discountPercent: '15', paidPrices: '1,1' });
        (intent as { amount: number }).amount = 7083 * 100;

        await succeed(intent);

        // fell back to recomputing from current prices
        expect(created.map((t) => t.pricePaid)).toEqual(['2833.00', '4250.00']);
      });

      it('accepts captured amounts that match the charged amount', async () => {
        const intent = intentWith({ discountPercent: '15', paidPrices: '2833,4250' });
        (intent as { amount: number }).amount = 7083 * 100;

        await succeed(intent);

        expect(created.map((t) => t.pricePaid)).toEqual(['2833.00', '4250.00']);
      });

      it('does not recreate tickets or refund when the intent was already finalized', async () => {
        mockTicketRepo.find.mockResolvedValue([{ id: 't-existing', userId }]);

        await succeed(intentWith({ discountPercent: '15' }));

        expect(mockDataSource.transaction).not.toHaveBeenCalled();
        expect(mockStripe.refunds.create).not.toHaveBeenCalled();
      });
    });
  });
});
