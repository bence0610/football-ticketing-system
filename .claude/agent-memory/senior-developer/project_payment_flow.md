---
name: payment-flow
description: Single Stripe payment flow for ticket purchases. Lives in PaymentsModule; one intent endpoint, one webhook, one finalization path.
metadata:
  type: project
---

The backend has ONE Stripe PaymentIntent flow for ticket purchases, all inside `apps/backend/src/modules/payments/`.

- Intent creation: `POST /api/payments/create-intent` → `PaymentsService.createPaymentIntent`.
- Frontend-driven fallback: `POST /api/payments/confirm` → `PaymentsService.confirmPaymentAndCreateTicket` (idempotent; safe to call alongside the webhook).
- Stripe webhook: `POST /api/webhooks/stripe` → `StripeWebhookController` → `PaymentsService.handleEvent` → `handlePaymentSuccess` → `finalizePaymentIntent`.
- Tickets are NOT pre-created. They are inserted with status `PAID` only after Stripe confirms, by `finalizePaymentIntent`.
- PaymentIntent metadata: `userId`, `matchId`, `seatIds` (csv), `ownerTokens` (csv).

The raw-body middleware for `/api/webhooks/stripe` is registered in `main.ts` so signature verification works.

**Why:** The previous architecture had a duplicate dead `CheckoutModule` (dead `/api/checkout/payment-intents` + legacy `StripeWebhookController` wired to a now-removed `TicketsService.finalizePaidPaymentIntent`). Both were deleted on 2026-10-09 — the frontend never called them, and the legacy webhook could only ever log "No tickets found".

**How to apply:**
- For any post-payment behavior (ticket creation, loyalty awards, seat-lock release), edit `PaymentsService.finalizePaymentIntent`.
- For missing-ticket reports in dev, first check that `stripe listen --forward-to localhost:3000/api/webhooks/stripe` is running and `STRIPE_WEBHOOK_SECRET` matches the listener's `whsec_...`. If the webhook is down, `/api/payments/confirm` is the frontend's safety net — it also calls `finalizePaymentIntent`.
- `Ticket.qrJti` is NOT NULL — the finalizer calls `qrService.generateJti()` for every row; don't remove that or inserts silently roll back the whole transaction.
