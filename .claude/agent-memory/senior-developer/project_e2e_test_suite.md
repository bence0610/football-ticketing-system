---
name: project-e2e-test-suite
description: Backend E2E test suite architecture — boots real AppModule, real MySQL (kte_jegyportal_test), real Redis DB 1, stubs only Stripe network calls.
metadata:
  type: project
---

Backend E2E suite lives under `apps/backend/test/`.

**Why:** The project needed real integration coverage of purchase → ticket → entry chain that unit tests with mocks cannot provide (loyalty idempotency, Redis seat-lock release, Stripe webhook signature verification, raw-body wiring).

**How to apply:**
- Use `kte_jegyportal_test` database and Redis DB `1` + prefix `kte-e2e:` for all E2E work — never share state with dev DB.
- Stripe is overridden by `StripeStub` (test/helpers/stripe-stub.ts); the real `Stripe.webhooks.constructEvent` + `generateTestHeaderString` are reused so signature verification still runs.
- Test env is applied twice: in `globalSetup` for one-time migrations, and at the top of every spec via `import './setup/test-env'` because Jest workers get fresh Node processes.
- Rawbody middleware for `/api/webhooks/stripe` must be replicated in `createTestApp()` — mirrors `apps/backend/src/main.ts`.
- `test/tsconfig.json` extends backend's tsconfig and widens `rootDir` to the backend root so TypeScript can see both `src/` and `test/`.
- `jest-e2e.json` uses `maxWorkers: 1` because MySQL/Redis state is shared.
- CI job is `backend-e2e` in `.github/workflows/ci.yml` with MySQL 8 + Redis 7 service containers.

Local prerequisite: the user running the suite must have CREATE DATABASE privilege on MySQL. The dev `kte_user` account does not — a root-equivalent connection string must be configured.
