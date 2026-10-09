export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Redis key naming conventions for the project.
 * Always use these helpers; never hard-code keys at call sites.
 */
export const RedisKeys = {
  seatLock: (matchId: string, seatId: string): string => `seat-lock:${matchId}:${seatId}`,
  seatLockOwner: (matchId: string, userId: string): string =>
    `seat-lock-owner:${matchId}:${userId}`,
  refreshToken: (userId: string, jti: string): string => `refresh:${userId}:${jti}`,
  rateLimit: (scope: string, identifier: string): string => `rate:${scope}:${identifier}`,
  // Iteration 5 — Waitlist
  waitlistClaim: (matchId: string, userId: string): string => `waitlist:claim:${matchId}:${userId}`,
  waitlistNotificationLock: (matchId: string): string => `waitlist:notification-lock:${matchId}`,
  // Iteration 5 — Chatbot
  chatbotConversation: (conversationId: string): string => `chatbot:conv:${conversationId}`,
  chatbotContext: (): string => 'chatbot:context:upcoming-matches',
} as const;
