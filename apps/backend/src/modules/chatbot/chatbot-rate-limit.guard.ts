import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import Redis from 'ioredis';
import { ChatbotConfig } from '../../config';
import { REDIS_CLIENT, RedisKeys } from '../../redis/redis.constants';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

const WINDOW_SECONDS = 3600;

/**
 * Sliding-hour rate limit using Redis sorted sets. Anonymous callers are
 * keyed by IP, authenticated callers by user id. Limits come from the
 * `chatbot` config namespace ({@link ChatbotConfig}).
 *
 * On Redis failures the guard fails open (logs a warning and allows the
 * request) so a chat outage isn't escalated by the limiter itself.
 */
@Injectable()
export class ChatbotRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(ChatbotRateLimitGuard.name);
  private readonly limitAuth: number;
  private readonly limitAnon: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService,
  ) {
    const config = configService.getOrThrow<ChatbotConfig>('chatbot');
    this.limitAuth = config.rateLimitAuth;
    this.limitAnon = config.rateLimitAnon;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();

    const isAuthenticated = !!request.user?.id;
    const identifier = request.user?.id ?? this.extractClientIp(request);
    const limit = isAuthenticated ? this.limitAuth : this.limitAnon;
    const scope = isAuthenticated ? 'chatbot:auth' : 'chatbot:anon';
    const key = RedisKeys.rateLimit(scope, identifier);
    const now = Date.now();
    const windowStart = now - WINDOW_SECONDS * 1000;
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

    try {
      const pipeline = this.redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now, member);
      pipeline.zcard(key);
      pipeline.expire(key, WINDOW_SECONDS);
      const results = await pipeline.exec();
      if (!results) {
        return true;
      }
      const cardEntry = results[2];
      const count = Number(cardEntry?.[1] ?? 0);
      if (count > limit) {
        // Roll back this request from the set so the next one isn't penalized further.
        await this.redis.zrem(key, member).catch(() => undefined);
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Túl sok kérés a chatbothoz, próbáld újra később.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.warn(`Rate limit Redis failure (fail-open): ${(error as Error).message}`);
      return true;
    }
  }

  private extractClientIp(req: Request): string {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0].trim();
    }
    return req.ip ?? 'unknown';
  }
}
