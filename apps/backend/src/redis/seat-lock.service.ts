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

/**
 * Lua script behind {@link SeatLockService.acquireFirstFreeGroup}.
 *
 * Redis runs a script start to finish without serving any other command, so
 * "is this whole group free?" and "take it" cannot be interleaved with another
 * client's. That is the whole race-safety argument of the best-seats finder.
 *
 *   KEYS[1]      the user's lock-owner hash (always passed; used only if ARGV[3] = '1')
 *   KEYS[2..]    the seat lock keys of every candidate group, group after group
 *   ARGV[1]      owner token (the value written to every key)
 *   ARGV[2]      TTL in seconds
 *   ARGV[3]      '1' to record the seats in the owner hash
 *   ARGV[4]      number of candidate groups n
 *   ARGV[5..4+n] size of each group
 *   ARGV[5+n..]  the seat ids, in the same order as KEYS[2..]
 *
 * Takes the FIRST group (the caller lists them best first) in which no seat is
 * locked, locks all of its seats, and returns its 1-based index; 0 if none was free.
 */
const ACQUIRE_FIRST_FREE_GROUP_LUA = `
local n = tonumber(ARGV[4])
local keyAt = 2
local idAt = 5 + n
for c = 1, n do
  local size = tonumber(ARGV[4 + c])
  local free = true
  for j = 0, size - 1 do
    if redis.call('EXISTS', KEYS[keyAt + j]) == 1 then
      free = false
      break
    end
  end
  if free then
    for j = 0, size - 1 do
      redis.call('SET', KEYS[keyAt + j], ARGV[1], 'EX', ARGV[2])
      if ARGV[3] == '1' then
        redis.call('HSET', KEYS[1], ARGV[idAt + j], ARGV[1])
      end
    end
    if ARGV[3] == '1' then
      redis.call('EXPIRE', KEYS[1], ARGV[2])
    end
    return c
  end
  keyAt = keyAt + size
  idAt = idAt + size
end
return 0
`;

export interface GroupLock {
  /** 0-based index into the candidate list that was locked. */
  index: number;
  ownerToken: string;
  ttlSeconds: number;
}

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
   * Atomically locks the first candidate group whose seats are all free, in ONE
   * Redis round trip (a Lua script, so no other client can lock a seat of the
   * group between the check and the lock). Candidates are seat-id lists, best
   * first; every seat of the chosen group gets the same owner token.
   *
   * Returns which candidate was locked, or `null` if every one had a seat taken.
   */
  async acquireFirstFreeGroup(
    matchId: string,
    candidates: ReadonlyArray<readonly string[]>,
    options: { userId?: string; ttlSeconds?: number } = {},
  ): Promise<GroupLock | null> {
    if (candidates.length === 0) {
      return null;
    }
    const ttlSeconds = options.ttlSeconds ?? this.defaultTtlSeconds;
    const ownerToken = randomUUID();
    const userId = options.userId;
    const ownerKey = RedisKeys.seatLockOwner(matchId, userId ?? 'anonymous');
    const keys = candidates.flatMap((group) => group.map((id) => RedisKeys.seatLock(matchId, id)));
    const ids = candidates.flatMap((group) => [...group]);

    const result = (await this.redis.eval(
      ACQUIRE_FIRST_FREE_GROUP_LUA,
      1 + keys.length,
      ownerKey,
      ...keys,
      ownerToken,
      String(ttlSeconds),
      userId ? '1' : '0',
      String(candidates.length),
      ...candidates.map((group) => String(group.length)),
      ...ids,
    )) as number;

    if (result === 0) {
      return null;
    }
    return { index: result - 1, ownerToken, ttlSeconds };
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
