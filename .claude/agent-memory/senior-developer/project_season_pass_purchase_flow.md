---
name: season-pass-purchase-flow
description: Season pass purchase added in 2026-06 — endpoints, entity, seat-map status, key invariants. See [[project-two-payment-flows]] for the parallel ticket flow.
metadata:
  type: project
---

Season pass purchasing went live in iteration 6 (2026-06-25). The implementation lives in `apps/backend/src/modules/season-passes/` and `apps/frontend/src/app/features/season-pass/`.

**Key design choices:**

1. **`SeasonPassPrice` catalogue table** (`season_pass_prices`) — one row per `(section, seasonLabel)`. Active season label is hard-coded as `'2026/2027'` in `SeasonPassesService` (`ACTIVE_SEASON_LABEL` constant) and seeded with VIP=45000, A=30000, B=25000, C=20000.

**Why:** A catalogue table (vs config) lets admins later edit prices without redeploying.
**How to apply:** If the active season changes, update `ACTIVE_SEASON_LABEL` and add a new seed block; do not delete old rows (kept for historical reporting).

2. **Purchase endpoint** is `POST /api/season-passes/purchase` (in `SeasonPassesController`), NOT routed through `PaymentsModule`. The service injects the same `STRIPE_CLIENT` provider via `stripeProvider` re-imported from `PaymentsModule`.

**Why:** Season pass purchase has a totally different shape (one row → one SeasonPass + loyalty) than the multi-seat checkout flow in `PaymentsService`. Reusing the same Stripe singleton keeps webhook/idempotency semantics identical.
**How to apply:** When fixing bugs in season-pass payments, edit `SeasonPassesService.purchase` — do NOT touch `PaymentsService.handlePaymentSuccess` (that's the ticket path).

3. **Frontend uses a two-step pattern**: first `/purchase` (no paymentMethodId) returns a `clientSecret`, then `stripe.confirmPayment()` runs client-side, then `/purchase` is called again with the same `sectionId` — Stripe's idempotency key (`seasonpass_{userId}_{section}_{season}`) prevents double-charge and `persistSeasonPassFromIntent` is idempotent on `stripePaymentIntentId`.

**Why:** Lets us use the same Payment Element UX as ticket checkout, AND keeps SCA/3DS flows working, AND persists the SeasonPass row server-side even if no webhook fires.
**How to apply:** Do not add a `paymentMethodId` from the frontend in the first call — that triggers server-side `confirm: true` which conflicts with the Payment Element flow.

4. **Seat map "season-pass-taken" indicator**: `SeatAvailability.SEASON_PASS = 'season_pass'` is a new enum value. `SeatsService.findSeatsForMatch` reads ACTIVE `SeasonPass` rows with non-null `seatId` and marks those seats with status `season_pass`. The frontend `seat-grid.component.ts` renders class `kte-seat--season_pass` (purple, hatched).

**Why:** Season pass holders own the seat for the whole season — those seats must never be clickable for single-ticket buyers.
**How to apply:** Match-day operations that need to free a season-pass seat (e.g. for an away game where the holder is loaning out) go through `PassLoan`, not via toggling the SeasonPass status.

5. **Loyalty award** uses `LoyaltyTransactionSource.SEASON_PASS_PURCHASE` with `referenceId: 'season_pass:<id>'` and config value `loyalty.seasonPassPoints` (default 500). The `(source, referenceId)` unique constraint guarantees one award per pass even if the purchase endpoint retries.
