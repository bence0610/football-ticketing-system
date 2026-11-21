import { registerAs } from '@nestjs/config';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix: string;
  seatLockTtlSeconds: number;
  /**
   * The longest a seat stays held, counted from its FIRST lock, however often the hold is
   * extended. An extend never pushes the expiry beyond this.
   */
  seatLockMaxHoldSeconds: number;
  /**
   * How long a season-pass buyer's chosen seat stays held while they pay.
   * Longer than the 5-minute match lock: a 3DS challenge can take minutes.
   */
  seasonPassHoldTtlSeconds: number;
}

export default registerAs(
  'redis',
  (): RedisConfig => ({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'kte:',
    seatLockTtlSeconds: parseInt(process.env.SEAT_LOCK_TTL_SECONDS ?? '300', 10),
    seatLockMaxHoldSeconds: parseInt(process.env.SEAT_LOCK_MAX_HOLD_SECONDS ?? '1200', 10),
    seasonPassHoldTtlSeconds: parseInt(process.env.SEASON_PASS_HOLD_TTL_SECONDS ?? '900', 10),
  }),
);
