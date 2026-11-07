---
name: KTE Iteration 4 Test Strategy
description: Risk map, regression analysis, and E2E coverage plan for Iteration 4 (E-ticket, Loyalty Dashboard, Season Pass Loan)
type: project
---

Iteration 4 covers EPIC E7 (E-ticket Generation & Email), EPIC E8 (Loyalty Points System), and EPIC E9 (Season Pass Loan). KTE-051 (Loan Initiation UI) is blocked.

**Why:** This iteration introduces QR codes, email delivery (Nodemailer), a new Loyalty Dashboard page (/loyalty), tier-based checkout discounts, and backend-only season pass loan logic. The ProfilePage is extended with QR image display, breaking one existing test assertion.

**How to apply:** When implementing Iteration 4 tests, extend existing fixtures and POMs — do not write inline locators. Update the broken existing test before adding new ones.

## Breaking regression identified

The existing `profile.spec.ts` Test 6 assertion `await expect(card).toContainText(TICKET_ACTIVE.qrCode)` (matching the string 'QR-TEST-0001') will break after KTE-041 changes QR display from text to `<img data-testid="ticket-qr">`. This line must be replaced with:
  `await expect(card.locator('img[data-testid="ticket-qr"]')).toBeVisible();`

## New spec files planned
- `apps/frontend/e2e/profile-tickets.spec.ts` — KTE-041 QR display, download button, used/expired badges, QR fetch error state
- `apps/frontend/e2e/loyalty.spec.ts` — KTE-045 full loyalty dashboard: tier badge, points, progress bar, transaction table, tier upgrade toast, route guard
- Additions to `apps/frontend/e2e/checkout.spec.ts` — KTE-046 discount row display for Arany/Kek tier users

## New fixtures needed in api-mocks.ts
- `QR_CODE_BASE64_PNG` — stub base64 PNG for mocking GET /tickets/:id/qr
- `TICKET_ACTIVE_WITH_QR` — extends TICKET_ACTIVE with qrCodeUrl field
- `TICKET_USED` and `TICKET_EXPIRED` — for status badge tests
- `LOYALTY_RESPONSE_EZUST` — 750 points, Ezüst tier, 2 transactions
- `LOYALTY_RESPONSE_LEGENDA` — 5200 points, KTE Legenda, no next tier, null nextTierPoints
- `LOYALTY_RESPONSE_NO_TRANSACTIONS` — empty transactions array
- `LOYALTY_TIERS_RESPONSE` — all 4 tier definitions

## New POM planned
- `apps/frontend/e2e/pages/loyalty.page.ts` — tierBadge, totalPoints, progressBar, progressLabel, tierBenefitsList, transactionTable, transactionRows, emptyTransactions, tierUpgradeToast

## ProfilePage POM additions needed
- `qrCodeImages: Locator` — img[data-testid="ticket-qr"]
- `downloadTicketButtons: Locator` — button[data-testid="download-ticket"]
- `ticketStatusBadge(card): Locator` — card.locator('[data-testid="ticket-status-badge"]')

## Key tier boundary values (for unit tests)
Kék: 0–499, Ezüst: 500–1499, Arany: 1500–2999, KTE Legenda: 3000+ (source of truth: apps/backend/src/modules/loyalty/loyalty.constants.ts)
Discounts: Kék 0%, Ezüst 5%, Arany 10%, KTE Legenda 15%

## Idempotency decisions to clarify before implementing
- `tierUpgradeFlag` in GET /loyalty/me: is it consumable (once) or always returned after tier change?
- Loan points reversal on cancel: only if loan was 'active' (points already awarded)? Or always?
- Negative loyalty points: floor at 0 or allow negatives? Must be documented in LoyaltyService.

## Tier naming conflict risk
Current AUTH_USER fixture uses loyaltyTier: 'bronze'. If KTE-043 uses Hungarian tier keys (kek/ezust/arany/kte_legenda), all auth and profile fixtures need updating. Check the DTO before writing tests.

## Download button test pattern (KTE-041)
Use `page.waitForEvent('download')` with `Promise.all` to avoid race. Never use filesystem access or sleep.

## Season pass auth risk (KTE-049)
Horizontal privilege escalation: POST /season-passes/:id/loans must verify the authenticated user owns the pass. This must be covered by a Supertest test with a different userId token.
