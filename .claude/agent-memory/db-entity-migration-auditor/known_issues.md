---
name: Known Issues — 2026-05-09 Audit (Post-migration-run)
description: All schema discrepancies resolved; all 4 migrations applied to the database; schema is fully in sync.
type: project
---

## Status: CLEAN — 2026-05-09 PASS (all migrations applied)

### Root Cause of `profile_completed_at` Error
The column was NOT missing from any migration file. `1714400000000-Iteration4Schema.ts` correctly
defines it. The database had only had `InitialSchema1714050000000` applied (1 of 4 migrations).
Running `npm run migration:run` from `apps/backend` applied the 3 pending migrations.

### All Migrations Now Applied (database state as of 2026-05-09)
1. `InitialSchema1714050000000` — baseline schema (was already applied)
2. `Iteration4Schema1714400000000` — profile_completed_at, tickets expansion, loyalty_transactions expansion, pass_loans expansion
3. `FixSchemaDiscrepancies1714500000000` — drops IDX_users_email_unique, adds fk_tickets_scanned_by
4. `Iteration5Schema1714600000000` — waitlist composite indexes

### Previously Resolved Code-Level Issues (still valid)
- W1: IDX_users_email_unique orphaned index — handled in migration 3 above
- W2: IDX_tickets_qr orphaned named index — FIXED in entity
- W3: IDX_season_passes_qr orphaned named index — FIXED in entity
- W4: pass_loans.qr_jti missing unique: true — FIXED in entity (class-level @Index)
- I1/W8: tickets.scanned_by_user_id missing FK — FIXED in migration 3 above
- NEW-1: ticket.entity.ts qr_jti inline unique: true removed
- NEW-2: user.entity.ts email inline unique: true removed

### Remaining Non-SQL Informational
- FixSchemaDiscrepancies JSDoc labels the FK fix as "I1" but original audit called it "W8". Cosmetic only.
