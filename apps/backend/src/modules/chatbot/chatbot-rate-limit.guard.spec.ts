import { ExecutionContext, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatbotRateLimitGuard } from './chatbot-rate-limit.guard';

function ctx(req: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('ChatbotRateLimitGuard', () => {
  let redis: { pipeline: jest.Mock; zrem: jest.Mock };
  let execResult: unknown;
  let keys: string[];
  let guard: ChatbotRateLimitGuard;

  beforeEach(() => {
    keys = [];
    execResult = null;
    redis = {
      zrem: jest.fn(async () => 1),
      pipeline: jest.fn(() => {
        const p = {
          zremrangebyscore: (k: string) => (keys.push(k), p),
          zadd: () => p,
          zcard: () => p,
          expire: () => p,
          exec: async () => {
            if (execResult instanceof Error) throw execResult;
            return execResult;
          },
        };
        return p;
      }),
    };
    const config = {
      getOrThrow: () => ({ rateLimitAuth: 5, rateLimitAnon: 2 }),
    } as unknown as ConfigService;
    guard = new ChatbotRateLimitGuard(redis as never, config);
  });

  // zremrangebyscore, zadd, zcard, expire — the guard reads the zcard slot.
  const counted = (n: number) => [
    [null, 0],
    [null, 1],
    [null, n],
    [null, 1],
  ];
  const anon = { headers: {}, ip: '1.2.3.4' };
  const authed = { headers: {}, ip: '1.2.3.4', user: { id: 'u1' } };

  it('allows a request within the limit', async () => {
    execResult = counted(2);
    await expect(guard.canActivate(ctx(anon))).resolves.toBe(true);
  });

  it('rejects with 429 and the Hungarian message over the limit, and rolls the entry back', async () => {
    execResult = counted(3);
    const err = await guard.canActivate(ctx(anon)).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(JSON.stringify(err.getResponse())).toContain('Túl sok kérés');
    expect(redis.zrem).toHaveBeenCalledTimes(1);
  });

  it('uses the higher limit and a per-user key for authenticated callers', async () => {
    execResult = counted(5);
    await expect(guard.canActivate(ctx(authed))).resolves.toBe(true);
    expect(keys[0]).toContain('chatbot:auth');
    expect(keys[0]).toContain('u1');
    execResult = counted(6);
    await expect(guard.canActivate(ctx(authed))).rejects.toBeInstanceOf(HttpException);
  });

  it('keys anonymous callers by IP', async () => {
    execResult = counted(1);
    await guard.canActivate(ctx(anon));
    expect(keys[0]).toContain('chatbot:anon');
    expect(keys[0]).toContain('1.2.3.4');
  });

  it('fails open when Redis throws', async () => {
    execResult = new Error('ECONNREFUSED');
    await expect(guard.canActivate(ctx(anon))).resolves.toBe(true);
  });

  it('fails open when the pipeline returns null', async () => {
    execResult = null;
    await expect(guard.canActivate(ctx(anon))).resolves.toBe(true);
  });
});
