---
name: Active payment flow has hard webhook dependency for ticket creation
description: PaymentsModule creates Ticket rows ONLY in handlePaymentSuccess; without `stripe listen` forwarding to /api/payments/webhook in dev, no tickets ever exist after a "successful" payment.
type: project
---

The active flow (`PaymentsService.handlePaymentSuccess`) is the **only** code path that inserts Ticket rows for purchases driven by the Angular `CheckoutPageComponent`. The frontend's `confirmPayment()` does NOT call any backend confirm endpoint — after `Stripe.confirmPayment` resolves with `succeeded`, it just navigates to `/checkout/confirmation`.

**Why:** Iteration 3 implemented this flow as webhook-driven on the assumption that local dev would always run `stripe listen --forward-to localhost:3000/api/payments/webhook` with `STRIPE_WEBHOOK_SECRET` set to the listener's secret. When that's not running, the test card flow appears to succeed end-to-end on the UI but no ticket is ever persisted, so the profile is empty and the bug looks like a "tickets disappearing" issue.

**How to apply:**
- First diagnostic question on any "ticket missing after payment" report: are the `[PaymentsController] Received Stripe event` log lines present? If silent, the webhook is not being delivered — the bug is environmental, not in the persistence code.
- A second possible misconfiguration: Stripe forwarding to `/api/webhooks/stripe` (the legacy `StripeWebhookController` from `CheckoutModule`) instead of `/api/payments/webhook`. Symptom: log line `No tickets found for paymentIntent=...` from `TicketsService.finalizePaidPaymentIntent`. The legacy webhook expects pre-created PENDING tickets that the active flow never writes.
- Recommended hardening (not yet implemented as of 2026-05-10): expose `POST /payments/confirm` that re-runs the idempotent `handlePaymentSuccess` from the frontend right after `Stripe.confirmPayment` succeeds. The existence-check at the top of `handlePaymentSuccess` (line ~192 in payments.service.ts) makes this safe to run alongside the real webhook.
