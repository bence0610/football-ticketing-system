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
  chatbotConversationOwner: (conversationId: string): string =>
    `chatbot:conv-owner:${conversationId}`,
  chatbotContext: (): string => 'chatbot:context:upcoming-matches',
  // Payments — confirmation email idempotency lock
  emailConfirmLock: (paymentIntentId: string, userId: string): string =>
    `email:confirm-lock:${paymentIntentId}:${userId}`,
  // Season-pass purchase — per-attempt idempotency record (TTL 300 s)
  // `holderKey` identifies who the pass is for, so buying for several holders
  // in one section yields separate attempts (and separate PaymentIntents).
  // `seatId` is part of it too: a different chosen seat is a different purchase.
  seasonPassAttempt: (
    userId: string,
    section: string,
    seasonLabel: string,
    holderKey: string,
    seatId: string,
  ): string => `seasonpass-attempt:${userId}:${section}:${seasonLabel}:${holderKey}:${seatId}`,
  // Season-pass seat hold while the buyer pays (value = the hold token only,
  // never the user id, so the holder cannot be read back from the seat).
  seasonPassHold: (seasonLabel: string, seatId: string): string =>
    `seasonpass-hold:${seasonLabel}:${seatId}`,
  // The one seat a user holds for a season: value `${seatId}|${holdToken}`.
  seasonPassHoldOwner: (seasonLabel: string, userId: string): string =>
    `seasonpass-hold-owner:${seasonLabel}:${userId}`,
} as const;
