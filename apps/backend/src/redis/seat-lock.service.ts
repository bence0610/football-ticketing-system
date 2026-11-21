import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
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
  /**
   * At most this many seats may be held by `userId` for this match at the same time; the lock is
   * refused (409 `seat_limit_reached`) when it would be one more. Needs `userId`.
   */
  maxHeldSeats?: number;
}

/** What an extend did: restarted the hold, found it already at the maximum hold, or lost it. */
export type ExtendOutcome = 'extended' | 'at_limit' | 'lost';

/** The 409 for a user who already holds the most seats they may hold for a match. */
export function seatLimitReached(maxHeldSeats: number): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: 'seat_limit_reached',
    message: `Egy mérkőzésre egyszerre legfeljebb ${maxHeldSeats} hely lehet lefoglalva. Engedj el egyet, vagy fizess a már lefoglaltakért.`,
  });
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
 * Counts the seats the owner hash still really holds (the lock key exists and carries the same
 * token) and drops the entries that no longer do, so a lapsed or released lock never counts.
 * Shared by the scripts below; `ownerKey` is the hash, `lockPrefix` the full lock-key prefix
 * (including the client's key prefix, because keys built inside a script are not prefixed).
 */
const LIVE_HOLDS_LUA = `
local function liveHolds(ownerKey, lockPrefix)
  local live = 0
  local fields = redis.call('HGETALL', ownerKey)
  for i = 1, #fields, 2 do
    if redis.call('GET', lockPrefix .. fields[i]) == fields[i + 1] then
      live = live + 1
    else
      redis.call('HDEL', ownerKey, fields[i])
    end
  end
  return live
end
`;

/**
 * Lua script behind {@link SeatLockService.acquire} for a signed-in user: takes the lock only if
 * the user holds fewer than the allowed number of seats for this match, in one step, so two
 * parallel locks cannot both squeeze under the limit.
 *
 *   KEYS[1] seat lock   KEYS[2] the user's owner hash   KEYS[3] the "first locked" anchor
 *   ARGV: 1 token, 2 ttl s, 3 seatId, 4 max held seats, 5 lock-key prefix, 6 max hold s,
 *         7 now (epoch ms, from the caller: a script that read TIME could not write afterwards on
 *         older Redis servers)
 * Returns 1 locked, 0 seat already locked, -1 the user is at the limit.
 */
const ACQUIRE_LIMITED_LUA = `${LIVE_HOLDS_LUA}
if liveHolds(KEYS[2], ARGV[5]) >= tonumber(ARGV[4]) then
  return -1
end
if not redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX') then
  return 0
end
redis.call('SET', KEYS[3], ARGV[7], 'EX', ARGV[6])
redis.call('HSET', KEYS[2], ARGV[3], ARGV[1])
redis.call('EXPIRE', KEYS[2], ARGV[6])
return 1
`;

/**
 * Lua script for safe lock extension: only extends if the value matches, and never beyond the
 * maximum hold counted from the FIRST lock (the anchor key), so a script that extends again and
 * again cannot keep a seat for ever.
 *
 *   KEYS[1] seat lock   KEYS[2] the "first locked" anchor
 *   ARGV: 1 token, 2 ttl s, 3 max hold s, 4 now (epoch ms, from the caller)
 * Returns 1 extended, 0 already at the maximum (nothing gained), -1 not the owner / lapsed.
 */
const EXTEND_LOCK_LUA = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return -1
end
local nowMs = tonumber(ARGV[4])
local maxMs = tonumber(ARGV[3]) * 1000
local born = tonumber(redis.call('GET', KEYS[2]))
if not born then
  born = nowMs
  redis.call('SET', KEYS[2], born, 'PX', maxMs)
end
local wantMs = tonumber(ARGV[2]) * 1000
local room = born + maxMs - nowMs
if room < wantMs then
  -- The maximum hold caps this extend. If it would add (almost) nothing, the hold is at its
  -- maximum; the second of slack absorbs the clock difference between the caller and Redis.
  if room <= redis.call('PTTL', KEYS[1]) + 1000 then
    return 0
  end
  wantMs = room
end
redis.call('PEXPIRE', KEYS[1], wantMs)
return 1
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
 *   ARGV[5+n]    the full seat-lock key prefix (client key prefix included)
 *   ARGV[6+n]    the full "first locked" key prefix
 *   ARGV[7+n]    the most seats the user may hold for the match (0 = no limit)
 *   ARGV[8+n]    the maximum hold in seconds
 *   ARGV[9+n]    now (epoch ms, from the caller)
 *   ARGV[10+n..] the seat ids, in the same order as KEYS[2..]
 *
 * Takes the FIRST group (the caller lists them best first) in which no seat is
 * locked, locks all of its seats, and returns its 1-based index; 0 if none was free; -1 if the user
 * would end up holding more than the limit allows (nothing is locked then).
 */
const ACQUIRE_FIRST_FREE_GROUP_LUA = `${LIVE_HOLDS_LUA}
local n = tonumber(ARGV[4])
local lockPrefix = ARGV[5 + n]
local bornPrefix = ARGV[6 + n]
local maxHeld = tonumber(ARGV[7 + n])
local maxHold = ARGV[8 + n]
local nowMs = ARGV[9 + n]
local keyAt = 2
local idAt = 10 + n
if ARGV[3] == '1' and maxHeld > 0 then
  if liveHolds(KEYS[1], lockPrefix) + tonumber(ARGV[5]) > maxHeld then
    return -1
  end
end
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
      redis.call('SET', bornPrefix .. ARGV[idAt + j], nowMs, 'EX', maxHold)
      if ARGV[3] == '1' then
        redis.call('HSET', KEYS[1], ARGV[idAt + j], ARGV[1])
      end
    end
    if ARGV[3] == '1' then
      redis.call('EXPIRE', KEYS[1], maxHold)
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
  private readonly maxHoldSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    const redisConfig = this.configService.getOrThrow<RedisConfig>('redis');
    this.defaultTtlSeconds = redisConfig.seatLockTtlSeconds;
    this.maxHoldSeconds = Math.max(
      redisConfig.seatLockMaxHoldSeconds ?? 1200,
      redisConfig.seatLockTtlSeconds,
    );
  }

  /** The client's key prefix: keys built inside a Lua script are not prefixed automatically. */
  private get keyPrefix(): string {
    return this.redis.options?.keyPrefix ?? '';
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
    const { matchId, seatId, userId, maxHeldSeats } = options;
    const ttlSeconds = options.ttlSeconds ?? this.defaultTtlSeconds;
    const ownerToken = options.ownerToken ?? randomUUID();
    const key = RedisKeys.seatLock(matchId, seatId);

    if (userId && maxHeldSeats !== undefined) {
      // One atomic step: count what the user holds, refuse at the limit, else lock.
      const taken = (await this.redis.eval(
        ACQUIRE_LIMITED_LUA,
        3,
        key,
        RedisKeys.seatLockOwner(matchId, userId),
        RedisKeys.seatLockBorn(matchId, seatId),
        ownerToken,
        String(ttlSeconds),
        seatId,
        String(maxHeldSeats),
        `${this.keyPrefix}${RedisKeys.seatLock(matchId, '')}`,
        String(this.maxHoldSeconds),
        String(Date.now()),
      )) as number;
      if (taken === -1) {
        throw seatLimitReached(maxHeldSeats);
      }
      if (taken !== 1) {
        this.logger.debug(`Seat ${seatId} for match ${matchId} is already locked.`);
        return null;
      }
      this.logger.debug(`Acquired seat lock ${key} (ttl=${ttlSeconds}s)`);
      return { matchId, seatId, ownerToken, ttlSeconds, userId };
    }

    const result = await this.redis.set(key, ownerToken, 'EX', ttlSeconds, 'NX');

    if (result !== 'OK') {
      this.logger.debug(`Seat ${seatId} for match ${matchId} is already locked.`);
      return null;
    }
    await this.redis.set(
      RedisKeys.seatLockBorn(matchId, seatId),
      Date.now(),
      'EX',
      this.maxHoldSeconds,
    );

    if (userId) {
      // Track which seats this user has locked. The hash field is the seatId,
      // the value is the ownerToken — useful for the cart "release all" flow.
      const ownerKey = RedisKeys.seatLockOwner(matchId, userId);
      await this.redis.hset(ownerKey, seatId, ownerToken);
      await this.redis.expire(ownerKey, this.maxHoldSeconds);
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
    options: { userId?: string; ttlSeconds?: number; maxHeldSeats?: number } = {},
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
      `${this.keyPrefix}${RedisKeys.seatLock(matchId, '')}`,
      `${this.keyPrefix}${RedisKeys.seatLockBorn(matchId, '')}`,
      String(userId ? (options.maxHeldSeats ?? 0) : 0),
      String(this.maxHoldSeconds),
      String(Date.now()),
      ...ids,
    )) as number;

    if (result === -1) {
      throw seatLimitReached(options.maxHeldSeats ?? 0);
    }
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
   * Restarts the hold of a lock the caller still owns, but never beyond the maximum hold counted
   * from the first lock (SEAT_LOCK_MAX_HOLD_SECONDS): 'extended', 'at_limit' when the hold is
   * already at the maximum (it will lapse on its own, nothing was gained) or 'lost'.
   */
  async extendWithinLimit(
    matchId: string,
    seatId: string,
    ownerToken: string,
    ttlSeconds?: number,
  ): Promise<ExtendOutcome> {
    const result = (await this.redis.eval(
      EXTEND_LOCK_LUA,
      2,
      RedisKeys.seatLock(matchId, seatId),
      RedisKeys.seatLockBorn(matchId, seatId),
      ownerToken,
      String(ttlSeconds ?? this.defaultTtlSeconds),
      String(this.maxHoldSeconds),
      String(Date.now()),
    )) as number;
    return result === 1 ? 'extended' : result === 0 ? 'at_limit' : 'lost';
  }

  /** True while the caller still owns the lock after the attempt (extended or already at the maximum). */
  async extend(
    matchId: string,
    seatId: string,
    ownerToken: string,
    ttlSeconds?: number,
  ): Promise<boolean> {
    return (await this.extendWithinLimit(matchId, seatId, ownerToken, ttlSeconds)) !== 'lost';
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
