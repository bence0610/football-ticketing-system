/**
 * Sanity unit test that does not require a live database/Redis.
 * Verifies that placeholder services compile and respond as expected.
 */
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LoyaltyTransaction, User } from './database/entities';
import { AdminService } from './modules/admin/admin.service';
import { AuthService } from './modules/auth/auth.service';
import { EmailVerificationService } from './modules/auth/email-verification.service';
import { RefreshTokenStore } from './modules/auth/refresh-token.store';

describe('Module placeholders', () => {
  it('AuthService exposes ping with status=ready', async () => {
    const ref = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: EmailVerificationService, useValue: { sendAtRegistration: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: { manager: { transaction: jest.fn() } } },
        { provide: getRepositoryToken(LoyaltyTransaction), useValue: {} },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn(), verifyAsync: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue({
              accessSecret: 'access-secret',
              accessExpiresIn: '15m',
              refreshSecret: 'refresh-secret',
              refreshExpiresIn: '7d',
              bcryptRounds: 12,
            }),
          },
        },
        {
          provide: RefreshTokenStore,
          useValue: { save: jest.fn(), exists: jest.fn(), revoke: jest.fn() },
        },
      ],
    }).compile();
    expect(ref.get(AuthService).ping()).toEqual({ module: 'auth', status: 'ready' });
  });

  it('AdminService exposes ping with status=ready', async () => {
    const ref = await Test.createTestingModule({ providers: [AdminService] }).compile();
    expect(ref.get(AdminService).ping()).toEqual({ module: 'admin', status: 'ready' });
  });
});
