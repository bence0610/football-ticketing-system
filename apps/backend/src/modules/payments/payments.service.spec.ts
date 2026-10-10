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
import { Match, Seat, Ticket } from '../../database/entities';
import { SeatAvailability } from '../seats/dto';
import { SeatsService } from '../seats/seats.service';

describe('PaymentsService', () => {
  let service: PaymentsService;

  const mockTicketRepo = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const mockMatchRepo = { findOne: jest.fn() };
  const mockSeatRepo = { find: jest.fn() };
  const mockRedis = { del: jest.fn(), set: jest.fn(), get: jest.fn() };
  const mockSeatsService = { resolveAvailabilityForSeats: jest.fn() };
  const mockStripe = {
    paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  };
  const mockSeatLockService = { release: jest.fn() };
  const mockDataSource = { transaction: jest.fn() };
  const mockLoyaltyService = { award: jest.fn() };
  const mockQrService = {
    generateJti: jest.fn().mockReturnValue('test-jti'),
    generateForTicket: jest.fn(),
  };
  const mockEmailService = { send: jest.fn() };
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
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(PaymentsService);
    jest.clearAllMocks();
    mockQrService.generateJti.mockReturnValue('test-jti');
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
      mockMatchRepo.findOne.mockResolvedValue({
        id: 'm-1',
        homeTeam: 'KTE',
        awayTeam: 'DVTK',
        basePrice: '3000',
      });
      mockSeatRepo.find.mockResolvedValue([
        { id: 's-1', priceModifier: '1.0', section: 'A', row: '1', number: '1' },
      ]);
      mockDataSource.transaction.mockImplementation(async (fn: (em: any) => Promise<any>) =>
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
});
