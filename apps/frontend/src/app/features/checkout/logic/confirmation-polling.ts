import { InjectionToken } from '@angular/core';

/**
 * How the confirmation page waits for the ticket to be issued. The payment is
 * already with Stripe at this point; the page only watches for the webhook's
 * result, so none of this ever triggers another payment.
 */
export interface ConfirmationPolling {
  /** Poll this often at first. */
  readonly intervalMs: number;
  /** After this long, poll less often. */
  readonly relaxAfterMs: number;
  readonly relaxedIntervalMs: number;
  /** Ask the server once to finalise (idempotent, verified with Stripe) if still waiting after this long. */
  readonly nudgeAfterMs: number;
  /** After this long, show the way to support (the page keeps checking). */
  readonly slowAfterMs: number;
  /** Stop polling after this long. */
  readonly giveUpAfterMs: number;
  /**
   * Once the tickets exist, keep checking this long for the confirmation email
   * to be marked as sent. It goes out just after the tickets are issued; until
   * it is marked, the page says nothing about an email.
   */
  readonly emailGraceMs: number;
}

export const DEFAULT_CONFIRMATION_POLLING: ConfirmationPolling = {
  intervalMs: 3_000,
  relaxAfterMs: 2 * 60_000,
  relaxedIntervalMs: 10_000,
  nudgeAfterMs: 8_000,
  slowAfterMs: 45_000,
  giveUpAfterMs: 15 * 60_000,
  emailGraceMs: 30_000,
};

export const CONFIRMATION_POLLING = new InjectionToken<ConfirmationPolling>('CONFIRMATION_POLLING', {
  providedIn: 'root',
  factory: () => DEFAULT_CONFIRMATION_POLLING,
});

export function nextDelayMs(policy: ConfirmationPolling, elapsedMs: number): number {
  return elapsedMs >= policy.relaxAfterMs ? policy.relaxedIntervalMs : policy.intervalMs;
}

export function isSlow(policy: ConfirmationPolling, elapsedMs: number): boolean {
  return elapsedMs >= policy.slowAfterMs;
}

export function shouldGiveUp(policy: ConfirmationPolling, elapsedMs: number): boolean {
  return elapsedMs >= policy.giveUpAfterMs;
}

/** The payment id comes from our own redirect or from Stripe's return_url (`payment_intent`). */
export function paymentIntentIdFrom(query: { get(name: string): string | null }, historyState: unknown): string | null {
  const fromQuery = query.get('payment_intent');
  if (fromQuery && /^pi_[A-Za-z0-9]+$/.test(fromQuery)) {
    return fromQuery;
  }
  if (historyState && typeof historyState === 'object' && 'paymentIntentId' in historyState) {
    const id = (historyState as { paymentIntentId: unknown }).paymentIntentId;
    if (typeof id === 'string' && /^pi_[A-Za-z0-9]+$/.test(id)) {
      return id;
    }
  }
  return null;
}
