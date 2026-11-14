import { createHash } from 'crypto';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/**
 * The caller's address. Only `req.ip`, which Express derives from the socket and,
 * if TRUST_PROXY says so, from the trusted proxies' X-Forwarded-For hops. The raw
 * header is caller-controlled and is never read here: using its first entry let
 * anyone pick their own rate-limit identity.
 */
export function extractClientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Identity a conversation is bound to. Logged-in callers: their user id.
 * Anonymous callers: a hash of the client IP (the id itself is an unguessable
 * server-issued UUID, so the IP is a second factor, not the only secret).
 * Known limit: an anonymous visitor whose IP changes cannot continue their
 * conversation and has to start a new one.
 */
export function resolveChatbotOwner(req: Request, user: AuthenticatedUser | undefined): string {
  if (user?.id) {
    return `user:${user.id}`;
  }
  const digest = createHash('sha256').update(extractClientIp(req)).digest('hex').slice(0, 32);
  return `anon:${digest}`;
}
