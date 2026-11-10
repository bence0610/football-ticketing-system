import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SeasonPassesService } from './season-passes.service';
import { STRIPE_CLIENT } from '../payments/stripe.provider';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { EmailService } from '../email/email.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { QrService } from '../qr/qr.service';
import { TicketRendererService } from '../tickets/ticket-renderer.service';
import {
  Match,
  PassLoan,
  PassLoanStatus,
  SeasonPass,
  SeasonPassPrice,
  User,
} from '../../database/entities';

describe('SeasonPassesService – previewLoan and match QR', () => {
  let service: SeasonPassesService;

  const mockPassLoanRepo = { findOne: jest.fn() };
  const mockSeasonPassRepo = { findOne: jest.fn() };
  const mockMatchRepo = { findOne: jest.fn() };

  const FUTURE = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const PAST = new Date(Date.now() - 1 * 60 * 60 * 1000);

  const STUB_MATCH = {
    homeTeam: 'KTE FC',
    awayTeam: 'Újpest FC',
    kickoffAt: new Date('2026-11-09T19:00:00Z'),
    venue: 'Széktói Stadion',
  };
  const STUB_SEAT = { section: 'B', row: '3', number: 12 };
  const STUB_LENDER = { firstName: 'Test', lastName: 'Owner' };

  function makeLoan(status: PassLoanStatus, expiresAt: Date = FUTURE): PassLoan {
    return {
      id: 'loan-1',
      invitationToken: 'tok-abc',
      status,
      expiresAt,
      borrowerEmail: 'b@test.hu',
      lenderUserId: 'lender-1',
      matchId: 'match-1',
      seasonPassId: 'pass-1',
      match: STUB_MATCH,
      seasonPass: { seat: STUB_SEAT },
      lender: STUB_LENDER,
    } as unknown as PassLoan;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SeasonPassesService,
        { provide: getRepositoryToken(PassLoan), useValue: mockPassLoanRepo },
        { provide: getRepositoryToken(SeasonPass), useValue: mockSeasonPassRepo },
        { provide: getRepositoryToken(SeasonPassPrice), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Match), useValue: mockMatchRepo },
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
        { provide: DataSource, useValue: { transaction: jest.fn(), getRepository: jest.fn() } },
        {
          provide: STRIPE_CLIENT,
          useValue: { paymentIntents: { create: jest.fn() }, refunds: { create: jest.fn() } },
        },
        {
          provide: REDIS_CLIENT,
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
        { provide: EmailService, useValue: { send: jest.fn() } },
        {
          provide: LoyaltyService,
          useValue: {
            award: jest.fn(),
            getConfig: jest.fn().mockReturnValue({ passLoanPoints: 25 }),
          },
        },
        {
          provide: QrService,
          useValue: { generateJti: jest.fn(), generateForTicket: jest.fn(), revoke: jest.fn() },
        },
        {
          provide: TicketRendererService,
          useValue: { matchSummary: jest.fn(), formatSeat: jest.fn(), formatKickoff: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockImplementation((key: string) => {
              const cfg: Record<string, unknown> = {
                stripe: { currency: 'HUF' },
                loyalty: { seasonPassPoints: 500 },
                mail: { retryDelayMs: 0, baseUrl: 'http://localhost:4200' },
                cron: { loanInvitationTtlHours: 72 },
                app: { homeTeamName: 'KTE FC' },
              };
              if (key in cfg) return cfg[key];
              throw new Error(`Unexpected config key: ${key}`);
            }),
          },
        },
      ],
    }).compile();

    service = module.get(SeasonPassesService);
    jest.clearAllMocks();
  });

  it('returns preview data for a valid pending loan', async () => {
    mockPassLoanRepo.findOne.mockResolvedValue(makeLoan(PassLoanStatus.PENDING));
    const result = await service.previewLoan('tok-abc');
    expect(result.matchTitle).toBe('KTE FC - Újpest FC');
    expect(result.matchVenue).toBe('Széktói Stadion');
    expect(result.seatSection).toBe('B');
    expect(result.seatRow).toBe('3');
    expect(result.seatNumber).toBe(12);
    expect(result.lenderName).toBe('Test Owner');
    expect(result.expiresAt).toBe(FUTURE.toISOString());
  });

  it('throws NotFoundException for an unknown token', async () => {
    mockPassLoanRepo.findOne.mockResolvedValue(null);
    await expect(service.previewLoan('bad-token')).rejects.toThrow(NotFoundException);
  });

  it('throws 400 loan_expired when the loan has EXPIRED status', async () => {
    mockPassLoanRepo.findOne.mockResolvedValue(makeLoan(PassLoanStatus.EXPIRED));
    await expect(service.previewLoan('tok-abc')).rejects.toMatchObject({
      status: 400,
      response: { code: 'loan_expired' },
    });
  });

  it('throws 400 loan_expired when expiresAt is in the past (PENDING loan)', async () => {
    mockPassLoanRepo.findOne.mockResolvedValue(makeLoan(PassLoanStatus.PENDING, PAST));
    await expect(service.previewLoan('tok-abc')).rejects.toMatchObject({
      status: 400,
      response: { code: 'loan_expired' },
    });
  });

  it('does NOT mutate loan.status when the invitation has only timed out', async () => {
    const loan = makeLoan(PassLoanStatus.PENDING, PAST);
    mockPassLoanRepo.findOne.mockResolvedValue(loan);
    await expect(service.previewLoan('tok-abc')).rejects.toBeTruthy();
    expect(loan.status).toBe(PassLoanStatus.PENDING); // must remain PENDING
  });

  it('throws 400 loan_revoked when the loan was CANCELLED', async () => {
    mockPassLoanRepo.findOne.mockResolvedValue(makeLoan(PassLoanStatus.CANCELLED));
    await expect(service.previewLoan('tok-abc')).rejects.toMatchObject({
      status: 400,
      response: { code: 'loan_revoked' },
    });
  });

  it('throws 409 seat_already_used when the owner had already entered (OWNER_ENTERED)', async () => {
    mockPassLoanRepo.findOne.mockResolvedValue(makeLoan(PassLoanStatus.OWNER_ENTERED));
    await expect(service.previewLoan('tok-abc')).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'seat_already_used',
        message: expect.stringContaining('már belépett'),
      },
    });
  });

  it('a genuine REVOKED loan says it was withdrawn, never that the owner entered', async () => {
    mockPassLoanRepo.findOne.mockResolvedValue(makeLoan(PassLoanStatus.REVOKED));
    await expect(service.previewLoan('tok-abc')).rejects.toMatchObject({
      status: 400,
      response: { code: 'loan_revoked', message: 'A meghívót visszavonták.' },
    });
  });

  it.each([
    [PassLoanStatus.CANCELLED, 'loan_revoked', 'A meghívót visszavonták.'],
    [PassLoanStatus.EXPIRED, 'loan_expired', 'A meghívó lejárt.'],
    [PassLoanStatus.ACCEPTED, 'loan_already_accepted', 'A meghívót már elfogadták.'],
  ])(
    'status %s has its own code and message instead of echoing the raw state',
    async (status, code, message) => {
      mockPassLoanRepo.findOne.mockResolvedValue(makeLoan(status));
      await expect(service.previewLoan('tok-abc')).rejects.toMatchObject({
        response: { code, message },
      });
    },
  );

  describe('getMatchQr validity window (server-side guard)', () => {
    const pass = {
      id: 'pass-1',
      userId: 'u1',
      holderUserId: 'u1',
      status: 'active',
      seatId: 'seat-1',
      validFrom: new Date('2026-08-01T00:00:00Z'),
      // As the DATE column delivers it: UTC midnight of the last day.
      validUntil: new Date('2027-06-30T00:00:00Z'),
      holderName: 'Holder',
    };

    beforeEach(() => mockSeasonPassRepo.findOne.mockResolvedValue(pass));

    it.each([
      ['before validFrom', '2026-07-31T18:00:00Z'],
      ['the last instant before the first day (23:59 local)', '2026-07-31T21:59:59Z'],
      ['the first instant after the last day (00:00 local)', '2027-06-30T22:00:00Z'],
      ['after validUntil', '2027-07-01T18:00:00Z'],
    ])(
      'rejects a match %s with 400 match_outside_validity and issues no QR',
      async (_label, kickoff) => {
        mockMatchRepo.findOne.mockResolvedValue({ id: 'm1', kickoffAt: new Date(kickoff) });
        await expect(service.getMatchQr('pass-1', 'm1', 'u1')).rejects.toMatchObject({
          status: 400,
          response: { code: 'match_outside_validity' },
        });
      },
    );

    it.each([
      ['first day just after local midnight', '2026-07-31T22:00:00Z'],
      ['first day', '2026-08-01T12:00:00Z'],
      ['final day at UTC midnight', '2027-06-30T00:00:00Z'],
      ['final day, late evening (23:30 local)', '2027-06-30T21:30:00Z'],
    ])('lets a match on the %s through the validity check', async (_label, kickoff) => {
      mockMatchRepo.findOne.mockResolvedValue({ id: 'm1', kickoffAt: new Date(kickoff) });
      jest
        .spyOn(service as never, 'materializeSeasonPassTicket')
        .mockRejectedValue(new Error('reached ticket materialisation') as never);
      // Past the guard = the sentinel error, not match_outside_validity.
      await expect(service.getMatchQr('pass-1', 'm1', 'u1')).rejects.toThrow(
        'reached ticket materialisation',
      );
    });

    it('does not even reach the QR step for an outside match (nothing is materialised)', async () => {
      mockMatchRepo.findOne.mockResolvedValue({
        id: 'm1',
        kickoffAt: new Date('2028-01-01T18:00:00Z'),
      });
      const spy = jest.spyOn(service as never, 'materializeSeasonPassTicket');
      await expect(service.getMatchQr('pass-1', 'm1', 'u1')).rejects.toBeTruthy();
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
