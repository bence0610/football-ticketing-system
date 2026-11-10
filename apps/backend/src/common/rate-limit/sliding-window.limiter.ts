import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT, RedisKeys } from '../../redis/redis.constants';

/**
 * Sliding-window counter on a Redis sorted set: "at most `limit` hits per
 * `windowSeconds` for this (scope, identifier)".
 *
 * Fails closed: if Redis cannot be reached the hit is refused. It guards
 * actions that send email or touch credentials, where letting everything
 * through during an outage is the worse mistake - and sign-in itself needs the
 * same Redis, so nothing else is lost.
 */
@Injectable()
export class SlidingWindowLimiter {
  private readonly logger = new Logger(SlidingWindowLimiter.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Records one hit and says whether it is within the limit. */
  async hit(
    scope: string,
    identifier: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const key = RedisKeys.rateLimit(scope, identifier);
    const now = Date.now();
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
    try {
      const pipeline = this.redis.pipeline();
      pipeline.zremrangebyscore(key, 0, now - windowSeconds * 1000);
      pipeline.zadd(key, now, member);
      pipeline.zcard(key);
      pipeline.expire(key, windowSeconds);
      const results = await pipeline.exec();
      const count = Number(results?.[2]?.[1] ?? Number.POSITIVE_INFINITY);
      if (count > limit) {
        // A refused hit does not count against the caller's window.
        await this.redis.zrem(key, member).catch(() => undefined);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(`Rate limiter unavailable (refusing): ${(error as Error).message}`);
      return false;
    }
  }
}
