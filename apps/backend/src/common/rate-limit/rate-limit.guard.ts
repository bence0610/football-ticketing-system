import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SlidingWindowLimiter } from './sliding-window.limiter';

export interface RateLimitOptions {
  /** Names the counter, so two endpoints do not share a budget. */
  scope: string;
  limit: number;
  windowSeconds: number;
  /**
   * What the budget is per. Default `ip`. `user` keys on the signed-in account (the route must sit
   * behind a JWT guard that runs first) and falls back to the address when there is none.
   */
  by?: 'ip' | 'user';
}

const RATE_LIMIT_KEY = 'kte:rate-limit';

/** Limits a route per client address (or per signed-in user, `by: 'user'`): `@RateLimit({ scope, limit, windowSeconds })`. */
export const RateLimit = (options: RateLimitOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);

/**
 * Enforces {@link RateLimit} per client address. It uses `req.ip` - which
 * follows Express's `trust proxy` setting - and never the raw X-Forwarded-For
 * header, which a caller can set to anything to get a fresh budget.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: SlidingWindowLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    const address = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    const identifier = options.by === 'user' && userId ? `user:${userId}` : address;
    const allowed = await this.limiter.hit(
      options.scope,
      identifier,
      options.limit,
      options.windowSeconds,
    );
    if (!allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Túl sok kérés érkezett erről a címről. Próbáld újra később.',
          code: 'rate_limited',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
