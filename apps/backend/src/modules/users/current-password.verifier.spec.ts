import { HttpException } from '@nestjs/common';
import { hash } from 'bcrypt';
import Redis from 'ioredis';
import { SlidingWindowLimiter } from '../../common/rate-limit/sliding-window.limiter';
import { User } from '../../database/entities';
import {
  CurrentPasswordVerifier,
  EMAIL_CHANGE_BUDGET,
  PASSWORD_CHANGE_BUDGET,
} from './current-password.verifier';

const PASSWORD = 'Jelszo123';

async function codeOf(p: Promise<unknown>): Promise<[number, string | undefined]> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    const err = e as HttpException;
    return [err.getStatus(), (err.getResponse() as { code?: string }).code];
  }
  throw new Error('expected a rejection');
}

describe('CurrentPasswordVerifier', () => {
  let user: User;
  const users = { findOne: jest.fn(async () => user) };

  beforeAll(async () => {
    user = { id: 'u1', isActive: true, passwordHash: await hash(PASSWORD, 4) } as User;
  });

  it('wrong password: 400 current_password_incorrect - never 401 (the frontend reads 401 as signed out)', async () => {
    const v = new CurrentPasswordVerifier(users as never, { hit: async () => true } as never);
    expect(await codeOf(v.verify('u1', 'Rossz1234', PASSWORD_CHANGE_BUDGET))).toEqual([
      400,
      'current_password_incorrect',
    ]);
  });

  it('right password: returns the account', async () => {
    const v = new CurrentPasswordVerifier(users as never, { hit: async () => true } as never);
    await expect(v.verify('u1', PASSWORD, PASSWORD_CHANGE_BUDGET)).resolves.toBe(user);
  });

  it('fails closed: limiter unavailable -> 429 rate_limited, the password is not even compared', async () => {
    const v = new CurrentPasswordVerifier(users as never, { hit: async () => false } as never);
    expect(await codeOf(v.verify('u1', PASSWORD, PASSWORD_CHANGE_BUDGET))).toEqual([
      429,
      'rate_limited',
    ]);
  });

  it('budgets: password change 10/hour, e-mail change 5/hour, separate scopes', () => {
    expect(PASSWORD_CHANGE_BUDGET).toEqual({
      scope: 'pwchange:user',
      limit: 10,
      windowSeconds: 3600,
    });
    expect(EMAIL_CHANGE_BUDGET).toEqual({
      scope: 'emailchange:user',
      limit: 5,
      windowSeconds: 3600,
    });
  });

  describe('with the real limiter on Redis (localhost:6379)', () => {
    const prefix = `kte-unit-${process.pid}-${Date.now()}:`;
    let redis: Redis;
    let available = true;

    beforeAll(async () => {
      redis = new Redis({
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
        keyPrefix: prefix,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      try {
        await redis.connect();
      } catch {
        available = false;
      }
    });

    afterAll(async () => {
      if (available) {
        const keys = await redis.keys(`${prefix}*`);
        if (keys.length > 0) {
          await redis.del(...keys.map((k) => k.slice(prefix.length)));
        }
      }
      redis.disconnect();
    });

    it('the 11th password-change attempt within the hour is refused, wrong or right; another account is unaffected', async () => {
      if (!available) {
        console.warn('Redis not reachable on localhost:6379 - skipping the real-limiter check');
        return;
      }
      const limiter = new SlidingWindowLimiter(redis);
      const v = new CurrentPasswordVerifier(users as never, limiter);
      for (let i = 0; i < 10; i += 1) {
        expect((await codeOf(v.verify('u1', 'Rossz1234', PASSWORD_CHANGE_BUDGET)))[1]).toBe(
          'current_password_incorrect',
        );
      }
      expect(await codeOf(v.verify('u1', PASSWORD, PASSWORD_CHANGE_BUDGET))).toEqual([
        429,
        'rate_limited',
      ]);
      // The e-mail change budget is its own counter.
      await expect(v.verify('u1', PASSWORD, EMAIL_CHANGE_BUDGET)).resolves.toBe(user);

      const other = { ...user, id: 'u2' } as User;
      const v2 = new CurrentPasswordVerifier({ findOne: async () => other } as never, limiter);
      await expect(v2.verify('u2', PASSWORD, PASSWORD_CHANGE_BUDGET)).resolves.toBe(other);
    });
  });
});
