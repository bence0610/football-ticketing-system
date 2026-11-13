-- Clears everything that references the OLD stadium layout, so that the
-- StadiumLayout migration's guard (no tickets, season passes or loans) lets it run.
--
-- Run it on the DEV database only, once, before `npm run migration:run`:
--   mysql -u root -p kte_jegyportal < apps/backend/scripts/clear-transactional-data.sql
--
-- All of it is one transaction: either everything below happens or nothing does.
-- Needs MySQL 8 (a window function rebuilds the loyalty running balance).
--
-- SURVIVES: users (accounts, passwords, roles), matches, password-reset tokens,
--           waitlist entries (only their stale preferred sector is cleared),
--           loyalty points earned for registering / completing the profile / by admin.
-- DELETED:  pass_loans, tickets, season_passes, and the loyalty ledger rows that
--           were earned by them (ticket_purchase, season_pass_purchase, pass_loan).
-- The migration itself then replaces sectors, seats and season_pass_prices.

START TRANSACTION;

-- 0. Remember whose loyalty balance is about to be wrong. Only these users are
--    recomputed below, so an account whose points were never in the ledger (for
--    example the seeded admin, who has a tier but no ledger rows) is left alone.
CREATE TEMPORARY TABLE tmp_affected_users AS
  SELECT DISTINCT user_id
  FROM loyalty_transactions
  WHERE source IN ('ticket_purchase', 'season_pass_purchase', 'pass_loan');

-- 1. Children before parents, so no foreign key blocks a delete:
--      pass_loans    -> season_passes (CASCADE) and matches/users (RESTRICT)
--      tickets       -> season_passes (SET NULL) and seats/matches/users (RESTRICT)
--      season_passes -> users (RESTRICT), seats (SET NULL)
DELETE FROM pass_loans;
DELETE FROM tickets;
DELETE FROM season_passes;

-- 2. The points those purchases earned. reference_id is plain text ('ticket:<id>',
--    'season_pass:<id>', 'loan:<id>'), not a foreign key, so nothing cascades:
--    these rows would otherwise point at tickets and passes that no longer exist.
DELETE FROM loyalty_transactions
WHERE source IN ('ticket_purchase', 'season_pass_purchase', 'pass_loan');

-- 3. Every surviving row stores the balance after it. Rebuild that running total in
--    the order the rows were written (never below zero, as the application does).
UPDATE loyalty_transactions t
JOIN (
  SELECT id, SUM(points) OVER (PARTITION BY user_id ORDER BY created_at, id) AS running
  FROM loyalty_transactions
) r ON r.id = t.id
SET t.balance_after = GREATEST(r.running, 0);

-- 4. The user's own balance and tier are stored columns too: without this they
--    keep the points the deleted purchases earned. Tier thresholds are the
--    application's: Ezüst 500, Arany 1500, KTE Legenda 3000, otherwise Kék.
UPDATE users u
JOIN tmp_affected_users a ON a.user_id = u.id
LEFT JOIN (
  SELECT user_id, SUM(points) AS total FROM loyalty_transactions GROUP BY user_id
) s ON s.user_id = u.id
SET u.loyalty_points = GREATEST(COALESCE(s.total, 0), 0);

UPDATE users u
JOIN tmp_affected_users a ON a.user_id = u.id
SET u.loyalty_tier = CASE
  WHEN u.loyalty_points >= 3000 THEN 'platinum'
  WHEN u.loyalty_points >= 1500 THEN 'gold'
  WHEN u.loyalty_points >= 500 THEN 'silver'
  ELSE 'bronze'
END;

-- 5. Waitlist entries stay (they belong to a user and a match), but a preferred
--    sector 'A' or 'VIP' means nothing in the new stadium. (The migration clears this too.)
UPDATE waitlist SET preferred_section = NULL;

DROP TEMPORARY TABLE tmp_affected_users;

COMMIT;
