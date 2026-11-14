import type { Request, Response } from 'express';
import { UsersController } from '../users/users.controller';
import { AuthController } from './auth.controller';
import { AuthResponseDto } from './dto';

const req = {
  ip: '84.2.51.77',
  headers: { 'user-agent': 'Mozilla/5.0 Chrome/120.0' },
} as unknown as Request;
const user = { id: 'u1', email: 'fan@kte.hu', role: 'fan' } as never;

function authController() {
  const session = {
    accessToken: 'a',
    refreshToken: 'r-new',
    expiresIn: 900,
    user: {},
  } as AuthResponseDto;
  const passwordChange = { changePassword: jest.fn(async () => session) };
  const emailChange = {
    confirmChange: jest.fn(async () => ({ message: 'ok', email: 'uj@pelda.hu' })),
  };
  const config = { getOrThrow: () => ({ nodeEnv: 'test' }) };
  const controller = new AuthController(
    {} as never,
    config as never,
    passwordChange as never,
    emailChange as never,
  );
  return { controller, passwordChange, emailChange, session };
}

describe('POST auth/change-password', () => {
  it('returns the new session like login and sets the refresh cookie the same way', async () => {
    const { controller, passwordChange, session } = authController();
    const res = { cookie: jest.fn() } as unknown as Response;
    const out = await controller.changePassword(
      user,
      { currentPassword: 'RegiJelszo1', newPassword: 'UjJelszo2' },
      req,
      res,
    );
    expect(out).toBe(session);
    expect(passwordChange.changePassword).toHaveBeenCalledWith('u1', 'RegiJelszo1', 'UjJelszo2', {
      ip: '84.2.51.77',
      userAgent: 'Mozilla/5.0 Chrome/120.0',
    });
    expect(res.cookie).toHaveBeenCalledWith(
      'kte_refresh_token',
      'r-new',
      expect.objectContaining({ httpOnly: true, path: '/api/auth' }),
    );
  });
});

describe('POST auth/confirm-email-change', () => {
  it('passes the token and the client info, returns { message, email }', async () => {
    const { controller, emailChange } = authController();
    const out = await controller.confirmEmailChange({ token: 't'.repeat(48) }, req);
    expect(out).toEqual({ message: 'ok', email: 'uj@pelda.hu' });
    expect(emailChange.confirmChange).toHaveBeenCalledWith('t'.repeat(48), {
      ip: '84.2.51.77',
      userAgent: 'Mozilla/5.0 Chrome/120.0',
    });
  });
});

describe('POST users/me/email-change', () => {
  it('starts the change for the signed-in user with the client info', async () => {
    const emailChange = {
      requestChange: jest.fn(async () => ({ message: 'm', pendingEmail: 'uj@pelda.hu' })),
    };
    const controller = new UsersController({} as never, emailChange as never);
    const out = await controller.requestEmailChange(
      user,
      { newEmail: 'uj@pelda.hu', currentPassword: 'Jelszo123' },
      req,
    );
    expect(out).toEqual({ message: 'm', pendingEmail: 'uj@pelda.hu' });
    expect(emailChange.requestChange).toHaveBeenCalledWith('u1', 'uj@pelda.hu', 'Jelszo123', {
      ip: '84.2.51.77',
      userAgent: 'Mozilla/5.0 Chrome/120.0',
    });
  });

  it('answers 202 Accepted', () => {
    const status = Reflect.getMetadata(
      '__httpCode__',
      UsersController.prototype.requestEmailChange,
    ) as number;
    expect(status).toBe(202);
  });
});
