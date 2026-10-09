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

describe('PaymentsService', () => {
  let service: PaymentsService;

  const mockTicketRepo = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const mockMatchRepo = { findOne: jest.fn() };
  const mockSeatRepo = { find: jest.fn() };
  const mockRedis = { del: jest.fn(), set: jest.fn() };
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
        {
          provide: STRIPE_CLIENT,
          useValue: {
            paymentIntents: { create: jest.fn() },
            webhooks: { constructEvent: jest.fn() },
          },
        },
        { provide: getRepositoryToken(Match), useValue: mockMatchRepo },
        { provide: getRepositoryToken(Seat), useValue: mockSeatRepo },
        { provide: getRepositoryToken(Ticket), useValue: mockTicketRepo },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: SeatLockService, useValue: mockSeatLockService },
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
});
