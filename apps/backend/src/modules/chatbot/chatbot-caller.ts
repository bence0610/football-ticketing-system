import { createHash } from 'crypto';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

export function extractClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
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
