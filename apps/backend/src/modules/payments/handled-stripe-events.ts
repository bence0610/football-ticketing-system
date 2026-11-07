/**
 * Stripe event types the backend acts on in PaymentsService.handleEvent.
 *
 * `scripts/stripe-listen.js` reads this list (one quoted string per line
 * between the markers) and passes it to `stripe listen --events`, so the
 * local forwarder sends exactly these. handled-stripe-events.spec.ts fails if
 * this list and the switch in handleEvent drift apart.
 */
// HANDLED_STRIPE_EVENTS:begin
export const HANDLED_STRIPE_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.dispute.created',
] as const;
// HANDLED_STRIPE_EVENTS:end

export type HandledStripeEvent = (typeof HANDLED_STRIPE_EVENTS)[number];
