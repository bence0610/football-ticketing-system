import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { RedisConfig } from '../config';
import { REDIS_CLIENT, RedisKeys } from './redis.constants';

/**
 * Season-pass seat holds: the seat a buyer has chosen stays theirs while they
 * pay (default 15 minutes, longer than the 5-minute match lock because a 3DS
 * challenge can take minutes).
 *
 * WHY A REDIS HOLD AND NOT A `pending_payment` season_passes ROW
 *   A pending row would occupy BOTH unique keys of the table, (seat, season)
 *   and (holder, season), for a payment that may never happen; it would need a
 *   sweeper job to delete abandoned payments; and while it lived, the
 *   `uq_season_passes_seat_season` index would claim the seat was sold when it
 *   was not. A TTL key cleans itself up exactly like the match seat locks, and
 *   the DB constraint stays the final guard at finalisation: the hold only
 *   keeps two honest buyers from paying for the same seat, it never decides
 *   who gets it.
 *
 * KEYS (see RedisKeys)
 *   seasonpass-hold:{season}:{seatId}         = holdToken        (EX ttl)
 *   seasonpass-hold-owner:{season}:{userId}   = seatId|holdToken (EX ttl)
 *   The seat key holds only the token, so nothing about the holder can be read
 *   from a seat; the owner key is what makes "one seat per user per season".
 */

/**
 * Atomic hold.
 *   KEYS[1] target seat key, KEYS[2] owner key, KEYS[3] the user's previous seat key
 *   (the target key again when the user had none)
 *   ARGV[1] new token, ARGV[2] ttl, ARGV[3] target seat id,
 *   ARGV[4] the owner value the caller read before ('' = none)
 * Returns {1, token} taken, {2, token} re-held own seat (TTL extended),
 * {0, ''} someone else holds it, {-1, ''} the owner key changed since the caller
 * read it (a concurrent hold by the same user): the caller retries.
 */
const HOLD_LUA = `
local own = redis.call('GET', KEYS[2])
if (own or '') ~= ARGV[4] then
  return {-1, ''}
end
local cur = redis.call('GET', KEYS[1])
if cur then
  if own and own == ARGV[3] .. '|' .. cur then
    redis.call('EXPIRE', KEYS[1], ARGV[2])
    redis.call('EXPIRE', KEYS[2], ARGV[2])
    return {2, cur}
  end
  return {0, ''}
end
if own then
  local sep = string.find(own, '|', 1, true)
  if sep then
    local prevToken = string.sub(own, sep + 1)
    if redis.call('GET', KEYS[3]) == prevToken then
      redis.call('DEL', KEYS[3])
    end
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('SET', KEYS[2], ARGV[3] .. '|' .. ARGV[1], 'EX', ARGV[2])
return {1, ARGV[1]}
`;

/**
 * Verify the hold belongs to this user and token, and restart its TTL.
 *   KEYS[1] seat key, KEYS[2] owner key; ARGV[1] token, ARGV[2] seat id, ARGV[3] ttl
 */
const VERIFY_EXTEND_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] and redis.call('GET', KEYS[2]) == ARGV[2] .. '|' .. ARGV[1] then
  redis.call('EXPIRE', KEYS[1], ARGV[3])
  redis.call('EXPIRE', KEYS[2], ARGV[3])
  return 1
end
return 0
`;

/**
 * Compare-and-delete with the token.
 *   KEYS[1] seat key, KEYS[2] owner key; ARGV[1] token, ARGV[2] seat id
 */
const RELEASE_LUA = `
local released = 0
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  released = 1
end
if redis.call('GET', KEYS[2]) == ARGV[2] .. '|' .. ARGV[1] then
  redis.call('DEL', KEYS[2])
end
return released
`;

/**
 * Release whatever hold the user has on this seat, by the owner record (used at
 * finalisation, where the token is not at hand and need not be).
 *   KEYS[1] seat key, KEYS[2] owner key; ARGV[1] seat id
 */
const RELEASE_FOR_OWNER_LUA = `
local own = redis.call('GET', KEYS[2])
if not own then
  return 0
end
local prefix = ARGV[1] .. '|'
if string.sub(own, 1, string.len(prefix)) ~= prefix then
  return 0
end
local token = string.sub(own, string.len(prefix) + 1)
redis.call('DEL', KEYS[2])
if redis.call('GET', KEYS[1]) == token then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

export type SeasonPassHoldResult =
  | { readonly kind: 'held'; readonly holdToken: string; readonly ttlSeconds: number; readonly renewed: boolean }
  | { readonly kind: 'held_by_other' };

const MAX_HOLD_ATTEMPTS = 5;

@Injectable()
export class SeasonPassHoldService {
  private readonly logger = new Logger(SeasonPassHoldService.name);
  readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService,
  ) {
    const ttl = configService.get<RedisConfig>('redis')?.seasonPassHoldTtlSeconds;
    this.ttlSeconds = typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? ttl : 900;
  }

  /**
   * Holds the seat for the user: atomically, so of two concurrent requests for
   * one seat exactly one wins. The user's previous hold for the season (another
   * seat) is released in the same step. Re-holding one's own seat is idempotent:
   * same token, TTL restarted. Throws if Redis is unreachable.
   */
  async hold(seasonLabel: string, seatId: string, userId: string): Promise<SeasonPassHoldResult> {
    const seatKey = RedisKeys.seasonPassHold(seasonLabel, seatId);
    const ownerKey = RedisKeys.seasonPassHoldOwner(seasonLabel, userId);
    for (let attempt = 0; attempt < MAX_HOLD_ATTEMPTS; attempt++) {
      const own = (await this.redis.get(ownerKey)) ?? '';
      const previousSeat = own.includes('|') ? own.slice(0, own.indexOf('|')) : '';
      const previousKey = previousSeat
        ? RedisKeys.seasonPassHold(seasonLabel, previousSeat)
        : seatKey;
      const token = randomUUID();
      const [code, value] = (await this.redis.eval(
        HOLD_LUA,
        3,
        seatKey,
        ownerKey,
        previousKey,
        token,
        String(this.ttlSeconds),
        seatId,
        own,
      )) as [number, string];
      if (code === 1 || code === 2) {
        this.logger.log(
          `[season-pass-hold] ${code === 2 ? 'renewed' : 'held'} seat=${seatId} season=${seasonLabel} user=${userId}`,
        );
        return { kind: 'held', holdToken: value, ttlSeconds: this.ttlSeconds, renewed: code === 2 };
      }
      if (code === 0) {
        return { kind: 'held_by_other' };
      }
      // -1: the same user changed their hold concurrently; read again.
    }
    // The user's own concurrent requests kept moving the hold: treat as contention.
    return { kind: 'held_by_other' };
  }

  /** True when the hold exists with this token for this user; restarts the TTL. */
  async verifyAndExtend(
    seasonLabel: string,
    seatId: string,
    userId: string,
    holdToken: string,
  ): Promise<boolean> {
    const result = (await this.redis.eval(
      VERIFY_EXTEND_LUA,
      2,
      RedisKeys.seasonPassHold(seasonLabel, seatId),
      RedisKeys.seasonPassHoldOwner(seasonLabel, userId),
      holdToken,
      seatId,
      String(this.ttlSeconds),
    )) as number;
    return result === 1;
  }

  /** Compare-and-delete. Idempotent: a wrong or expired token is a no-op. */
  async release(
    seasonLabel: string,
    seatId: string,
    userId: string,
    holdToken: string,
  ): Promise<boolean> {
    const result = (await this.redis.eval(
      RELEASE_LUA,
      2,
      RedisKeys.seasonPassHold(seasonLabel, seatId),
      RedisKeys.seasonPassHoldOwner(seasonLabel, userId),
      holdToken,
      seatId,
    )) as number;
    return result === 1;
  }

  /**
   * After the payment has concluded (pass issued or refunded): drop the user's
   * hold on this seat, if it still is theirs. Never throws: a hold left behind
   * expires by itself.
   */
  async releaseForOwner(seasonLabel: string, seatId: string, userId: string): Promise<void> {
    try {
      await this.redis.eval(
        RELEASE_FOR_OWNER_LUA,
        2,
        RedisKeys.seasonPassHold(seasonLabel, seatId),
        RedisKeys.seasonPassHoldOwner(seasonLabel, userId),
        seatId,
      );
    } catch (error) {
      this.logger.warn(
        `[season-pass-hold] release after payment failed seat=${seatId} user=${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Which of these seats are held by anyone right now (one MGET). Falls back to
   * "none held" if Redis is unavailable: the map then over-offers, and the hold
   * endpoint (which does need Redis) is the one that refuses.
   */
  async heldSeatIds(seasonLabel: string, seatIds: readonly string[]): Promise<Set<string>> {
    if (seatIds.length === 0) return new Set();
    try {
      const values = await this.redis.mget(
        ...seatIds.map((id) => RedisKeys.seasonPassHold(seasonLabel, id)),
      );
      const held = new Set<string>();
      values.forEach((v, i) => {
        if (v !== null && v !== undefined) held.add(seatIds[i]);
      });
      return held;
    } catch (error) {
      this.logger.warn(
        `[season-pass-hold] MGET failed; treating every seat as not held. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return new Set();
    }
  }
}
