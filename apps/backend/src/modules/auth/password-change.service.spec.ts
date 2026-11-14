import { BadRequestException, HttpException } from '@nestjs/common';
import { compare, hash } from 'bcrypt';
import { IsNull } from 'typeorm';
import { PasswordResetToken, User } from '../../database/entities';
import {
  CurrentPasswordVerifier,
  PASSWORD_CHANGE_BUDGET,
} from '../users/current-password.verifier';
import { AuthResponseDto } from './dto';
import { PasswordChangeService } from './password-change.service';

const OLD = 'RegiJelszo1';
const NEW = 'UjJelszo2';

async function setup(opts: { casAffected?: number } = {}) {
  const user = {
    id: 'u1',
    email: 'fan@kte.hu',
    firstName: 'Béla',
    isActive: true,
    passwordHash: await hash(OLD, 4),
  } as User;
  const oldHash = user.passwordHash;
  const calls: string[] = [];

  const userUpdate = jest.fn(async () => ({ affected: opts.casAffected ?? 1 }));
  const resetUpdate = jest.fn(async () => ({ affected: 2 }));
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === User) return { update: userUpdate };
      if (entity === PasswordResetToken) return { update: resetUpdate };
      throw new Error('unexpected entity');
    },
  };
  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => cb(manager)),
  };
  const config = { getOrThrow: () => ({ bcryptRounds: 4 }) };
  const verifier = {
    verify: jest.fn(async (_id: string, password: string) => {
      const real = new CurrentPasswordVerifier(
        { findOne: async () => user } as never,
        { hit: async () => true } as never,
      );
      return real.verify('u1', password, PASSWORD_CHANGE_BUDGET);
    }),
  };
  const session: AuthResponseDto = {
    accessToken: 'new-access',
    refreshToken: 'new-refresh',
    expiresIn: 900,
    user: {} as AuthResponseDto['user'],
  };
  const authService = {
    issueSession: jest.fn(async () => {
      calls.push('issueSession');
      return session;
    }),
  };
  const passwordReset = { notifyPasswordChanged: jest.fn(async () => undefined) };
  const refreshStore = {
    revokeAll: jest.fn(async () => {
      calls.push('revokeAll');
    }),
  };
  const service = new PasswordChangeService(
    dataSource as never,
    config as never,
    verifier as unknown as CurrentPasswordVerifier,
    authService as never,
    passwordReset as never,
    refreshStore as never,
  );
  return {
    service,
    user,
    oldHash,
    calls,
    userUpdate,
    resetUpdate,
    verifier,
    authService,
    passwordReset,
    refreshStore,
    session,
  };
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('PasswordChangeService.changePassword', () => {
  it('wrong current password: 400 current_password_incorrect, nothing written, sessions untouched', async () => {
    const h = await setup();
    const p = h.service.changePassword('u1', 'Rossz1234', NEW);
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await p.catch((e: HttpException) => {
      expect(e.getStatus()).toBe(400);
      expect((e.getResponse() as { code: string }).code).toBe('current_password_incorrect');
    });
    expect(h.userUpdate).not.toHaveBeenCalled();
    expect(h.refreshStore.revokeAll).not.toHaveBeenCalled();
    expect(h.passwordReset.notifyPasswordChanged).not.toHaveBeenCalled();
  });

  it('uses the per-account pwchange budget', async () => {
    const h = await setup();
    await h.service.changePassword('u1', OLD, NEW);
    expect(h.verifier.verify).toHaveBeenCalledWith('u1', OLD, PASSWORD_CHANGE_BUDGET);
  });

  it('new password equal to the current one: 400 password_unchanged', async () => {
    const h = await setup();
    await h.service.changePassword('u1', OLD, OLD).then(
      () => {
        throw new Error('expected a rejection');
      },
      (e: HttpException) => {
        expect(e.getStatus()).toBe(400);
        expect((e.getResponse() as { code: string }).code).toBe('password_unchanged');
      },
    );
    expect(h.userUpdate).not.toHaveBeenCalled();
  });

  it('swaps the hash compare-and-swap style, voids reset links, revokes every refresh token, THEN issues a new session', async () => {
    const h = await setup();
    const result = await h.service.changePassword('u1', OLD, NEW, { ip: '84.2.51.77' });

    expect(h.userUpdate).toHaveBeenCalledTimes(1);
    const [where, patch] = h.userUpdate.mock.calls[0] as unknown as [
      { id: string; passwordHash: string },
      { passwordHash: string },
    ];
    expect(where).toEqual({ id: 'u1', passwordHash: h.oldHash });
    expect(await compare(NEW, patch.passwordHash)).toBe(true);
    expect(JSON.stringify(h.userUpdate.mock.calls)).not.toContain(NEW);

    expect(h.resetUpdate).toHaveBeenCalledWith(
      { userId: 'u1', usedAt: IsNull() },
      {
        usedAt: expect.any(Date),
      },
    );

    expect(h.refreshStore.revokeAll).toHaveBeenCalledWith('u1');
    // The order is the point: the caller's new refresh token must survive revokeAll.
    expect(h.calls).toEqual(['revokeAll', 'issueSession']);
    expect(result).toBe(h.session);
    const issuedFor = h.authService.issueSession.mock.calls[0] as unknown as [User];
    expect(issuedFor[0].id).toBe('u1');
  });

  it('sends the password-changed notice (settings wording) with the client info', async () => {
    const h = await setup();
    const client = { ip: '84.2.51.77', userAgent: 'UA' };
    await h.service.changePassword('u1', OLD, NEW, client);
    await flush();
    expect(h.passwordReset.notifyPasswordChanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', email: 'fan@kte.hu' }),
      expect.any(Date),
      client,
      'settings',
    );
  });

  it('a failing notice mail does not fail the change', async () => {
    const h = await setup();
    h.passwordReset.notifyPasswordChanged.mockRejectedValueOnce(new Error('smtp down'));
    await expect(h.service.changePassword('u1', OLD, NEW)).resolves.toBe(h.session);
    await flush();
  });

  it('a concurrent change (CAS affects 0 rows): 409 password_changed_concurrently, no session work', async () => {
    const h = await setup({ casAffected: 0 });
    await h.service.changePassword('u1', OLD, NEW).then(
      () => {
        throw new Error('expected a rejection');
      },
      (e: HttpException) => {
        expect(e.getStatus()).toBe(409);
        expect((e.getResponse() as { code: string }).code).toBe('password_changed_concurrently');
      },
    );
    expect(h.refreshStore.revokeAll).not.toHaveBeenCalled();
    expect(h.authService.issueSession).not.toHaveBeenCalled();
  });
});
