import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { RedisConfig } from '../config';
import { REDIS_CLIENT, RedisKeys } from './redis.constants';

export interface SeatLock {
  matchId: string;
  seatId: string;
  ownerToken: string;
  ttlSeconds: number;
  userId?: string;
}

export interface AcquireSeatLockOptions {
  matchId: string;
  seatId: string;
  /** Optional fixed token (e.g. when refreshing an existing lock). */
  ownerToken?: string;
  /** Override the default TTL for this lock. */
  ttlSeconds?: number;
  /** Authenticated user id, when available — stored in lock metadata. */
  userId?: string;
}

/**
 * Lua script for safe lock release: only deletes the key if the value matches.
 * Prevents a client from releasing another client's lock after their TTL expired.
 */
const RELEASE_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

/**
 * Lua script for safe lock extension: only extends TTL if the value matches.
 */
const EXTEND_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
else
  return 0
end
`;

@Injectable()
export class SeatLockService {
  private readonly logger = new Logger(SeatLockService.name);
  private readonly defaultTtlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    const redisConfig = this.configService.getOrThrow<RedisConfig>('redis');
    this.defaultTtlSeconds = redisConfig.seatLockTtlSeconds;
  }

  /**
   * Atomically acquire a seat lock with the configured TTL (default 300 s).
   * Returns the lock descriptor on success, or `null` if the seat is already locked.
   *
   * Lock value is `<ownerToken>` for backwards compatibility with the
   * pipeline-based status query in {@link SeatsService.findSeatsForMatch}.
   * If a `userId` is provided, we also store an auxiliary record at
   * `seat-lock-owner:{matchId}:{userId}` so the user can retrieve their
   * outstanding locks (used by checkout flow).
   */
  async acquire(options: AcquireSeatLockOptions): Promise<SeatLock | null> {
    const { matchId, seatId, userId } = options;
    const ttlSeconds = options.ttlSeconds ?? this.defaultTtlSeconds;
    const ownerToken = options.ownerToken ?? randomUUID();
    const key = RedisKeys.seatLock(matchId, seatId);

    const result = await this.redis.set(key, ownerToken, 'EX', ttlSeconds, 'NX');

    if (result !== 'OK') {
      this.logger.debug(`Seat ${seatId} for match ${matchId} is already locked.`);
      return null;
    }

    if (userId) {
      // Track which seats this user has locked. The hash field is the seatId,
      // the value is the ownerToken — useful for the cart "release all" flow.
      const ownerKey = RedisKeys.seatLockOwner(matchId, userId);
      await this.redis.hset(ownerKey, seatId, ownerToken);
      await this.redis.expire(ownerKey, ttlSeconds);
    }

    this.logger.debug(`Acquired seat lock ${key} (ttl=${ttlSeconds}s)`);
    return { matchId, seatId, ownerToken, ttlSeconds, userId };
  }

  /**
   * Release a previously held lock. Only succeeds when the supplied
   * ownerToken matches the lock's stored value.
   */
  async release(matchId: string, seatId: string, ownerToken: string): Promise<boolean> {
    const key = RedisKeys.seatLock(matchId, seatId);
    const result = (await this.redis.eval(RELEASE_LOCK_LUA, 1, key, ownerToken)) as number;
    const released = result === 1;
    if (released) {
      this.logger.debug(`Released seat lock ${key}`);
    }
    return released;
  }

  /**
   * Extend the TTL on an existing lock if the caller still owns it.
   */
  async extend(
    matchId: string,
    seatId: string,
    ownerToken: string,
    ttlSeconds?: number,
  ): Promise<boolean> {
    const key = RedisKeys.seatLock(matchId, seatId);
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const result = (await this.redis.eval(
      EXTEND_LOCK_LUA,
      1,
      key,
      ownerToken,
      String(ttl),
    )) as number;
    return result === 1;
  }

  /**
   * Check whether a seat is currently locked.
   */
  async isLocked(matchId: string, seatId: string): Promise<boolean> {
    const exists = await this.redis.exists(RedisKeys.seatLock(matchId, seatId));
    return exists === 1;
  }

  /**
   * Returns the current TTL on a seat lock in seconds, or `-2` if missing,
   * `-1` if it exists with no TTL.
   */
  async getRemainingTtl(matchId: string, seatId: string): Promise<number> {
    return this.redis.ttl(RedisKeys.seatLock(matchId, seatId));
  }
}
