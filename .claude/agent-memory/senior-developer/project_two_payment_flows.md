---
name: Two parallel payment flows in KTE backend
description: PaymentsModule (active) and CheckoutModule (legacy) both implement Stripe ticket purchase end-to-end. Be careful which one you touch.
type: project
---

The backend has TWO co-existing PaymentIntent flows for ticket purchases. Both are wired in `app.module.ts` and both run.

1. **`PaymentsModule`** (`apps/backend/src/modules/payments/`) — the one the Angular checkout page actually calls.
   - Endpoint: `POST /api/payments/create-intent` (used by `PaymentsApiService.createIntent` on the frontend).
   - Webhook: `POST /api/payments/webhook` → `PaymentsService.handleEvent`.
   - Tickets are NOT pre-created. They are created inside `handlePaymentSuccess` with status `PAID` only after the webhook fires.
   - Metadata on the PaymentIntent: `userId`, `matchId`, `seatIds` (csv), `ownerTokens` (csv).

2. **`CheckoutModule`** (`apps/backend/src/modules/checkout/`) — legacy/alternative flow.
   - Endpoint: `POST /api/checkout/payment-intents` (no frontend caller).
   - Webhook: `POST /api/webhooks/stripe` → `TicketsService.finalizePaidPaymentIntent`.
   - Tickets are pre-created with `PENDING_PAYMENT`; webhook flips them to `PAID`.
   - Loyalty awarding + confirmation email live inside `TicketsService.finalizePaidPaymentIntent`.

**Why:** Both flows were wired up at different iterations and the legacy CheckoutModule was never deleted. The frontend only calls flow #1.

**How to apply:** When fixing post-payment behavior (loyalty, ticket creation, seat status), edit `PaymentsService.handlePaymentSuccess` — that's the path the frontend exercises. Treat anything in `CheckoutService` / `TicketsService.finalizePaidPaymentIntent` as dormant unless someone actively switches the frontend over.

**Gotcha:** `Ticket.qrJti` is NOT NULL. `PaymentsService.handlePaymentSuccess` must populate it via `qrService.generateJti()` or the INSERT silently rolls back the whole transaction (no tickets, no loyalty, no lock release).
