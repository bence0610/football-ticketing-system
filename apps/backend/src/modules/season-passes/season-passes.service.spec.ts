import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SeasonPassesService } from './season-passes.service';
import { STRIPE_CLIENT } from '../payments/stripe.provider';
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

describe('SeasonPassesService – previewLoan', () => {
  let service: SeasonPassesService;

  const mockPassLoanRepo = { findOne: jest.fn() };

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
        { provide: getRepositoryToken(SeasonPass), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(SeasonPassPrice), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Match), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
        { provide: DataSource, useValue: { transaction: jest.fn(), getRepository: jest.fn() } },
        {
          provide: STRIPE_CLIENT,
          useValue: { paymentIntents: { create: jest.fn() }, refunds: { create: jest.fn() } },
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

  it('throws 409 seat_already_used when the loan was REVOKED', async () => {
    mockPassLoanRepo.findOne.mockResolvedValue(makeLoan(PassLoanStatus.REVOKED));
    await expect(service.previewLoan('tok-abc')).rejects.toMatchObject({
      status: 409,
      response: { code: 'seat_already_used' },
    });
  });
});
