# Backend E2E tests

End-to-end integration tests for the KTE Jegyportál NestJS backend. The
suite boots the real `AppModule` against a throwaway MySQL 8 container and
a throwaway Redis 7 container managed by Docker Compose. Only Stripe's HTTP
calls are stubbed — the real signature verifier runs for every webhook
request.

## What the suite covers

`apps/backend/test/purchase-entry.e2e-spec.ts` walks the full purchase
flow:

1. Fan registration + login
2. Match listing and seat-map lookup
3. Seat locking in Redis
4. Stripe PaymentIntent creation (stubbed — no network call)
5. `payment_intent.succeeded` webhook delivery (real Stripe signature)
6. Ticket creation, seat-lock release, loyalty-point award
7. Fan fetches QR code
8. Gate operator scans QR (first scan OK, second scan rejected)

The same spec includes authorization and race-condition tests:

- A fan cannot scan tickets.
- Fan B cannot fetch Fan A's QR.
- Two concurrent seat-lock requests resolve to exactly one `201` and one `409`.
- A duplicate webhook delivery produces exactly one ticket row and one
  loyalty transaction.

## Prerequisites

**Docker Desktop** is the only prerequisite. No local MySQL or Redis
installation is required. The Compose file starts isolated containers on
non-default ports (MySQL → 3307, Redis → 6380) so they never conflict with
a locally running database or cache.

## Running the full suite (recommended)

From the **repo root**:

```bash
npm run test:e2e
```

This single command:
1. Starts the containers and waits until both are healthy (`--wait`).
2. Runs the backend E2E suite (`--runInBand`).
3. Tears the containers down and removes volumes — even when tests fail.

The exit code reflects whether the tests passed, so CI and local scripts
can rely on it.

## Step-by-step (for debugging)

```bash
# 1. Start containers
npm run test:e2e:up

# 2. Run only the tests (repeat as needed while debugging)
npm run test:e2e:run

# 3. Tear everything down
npm run test:e2e:down
```

## Isolation guarantees

| Layer | Isolation |
|-------|-----------|
| **MySQL** | Dedicated container, database `kte_jegyportal_test`, host port 3307. Migrations run once in `globalSetup`; rows are deleted between tests via `truncateAll()`. |
| **Redis** | Dedicated container, host port 6380, DB index 1, key prefix `kte-e2e:`. Flushed in `globalSetup` and between every test. |
| **Stripe** | No network calls. `STRIPE_CLIENT` is overridden with an in-memory stub. The real `Stripe.webhooks.constructEvent` verifier still runs for every webhook request. |
| **SMTP** | Points at `localhost:25` — nodemailer never dials outbound. |

## CI

The GitHub Actions `backend-e2e` job (`.github/workflows/ci.yml`) spins up
MySQL 8 and Redis 7 as service containers (on the default ports 3306/6379).
The CI step overrides `DB_PORT`, `DB_PASSWORD`, and `REDIS_PORT` so the
suite hits those containers instead of the docker-compose defaults.
