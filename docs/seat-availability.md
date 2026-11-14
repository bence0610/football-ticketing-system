# Seat availability rules

## States

| State | Value | Description |
|-------|-------|-------------|
| `AVAILABLE` | `available` | The seat can be selected and locked by any user. |
| `LOCKED` | `locked` | The seat is temporarily reserved in Redis (default TTL: 300 s). Another user's lock in progress. |
| `SOLD` | `sold` | A ticket with status `PAID` or `PENDING_PAYMENT` exists for this seat at this match. The seat cannot be purchased again until the ticket is cancelled, refunded, or expired. |
| `SEASON_PASS` | `season_pass` | An ACTIVE season pass occupies this seat. The seat is permanently reserved for the pass holder for every match in the season. |
| `DISABLED` | `disabled` | The seat's `isActive` flag is `false` in the database. It is hidden from purchase and cannot be locked. |

## Priority order

The rule is encoded in `SeatsService.computeSeatAvailability` (called by both the seat-map query and the per-seat check used at lock time and payment time):

```
1. isActive === false  → DISABLED
2. active ticket exists (PAID | PENDING_PAYMENT) for matchId + seatId → SOLD
3. ACTIVE season pass holds this seatId → SEASON_PASS
4. Redis lock key present for matchId + seatId → LOCKED
5. (none of the above) → AVAILABLE
```

## Allowed transitions

Only a seat in **`AVAILABLE`** state may be locked. The lock endpoint (`POST /matches/:matchId/seats/:seatId/lock`) checks the current DB state before touching Redis and refuses with HTTP 409 if the seat is `DISABLED`, `SOLD`, or `SEASON_PASS`.

A payment intent (`POST /payments/intent`) additionally re-checks the DB state at payment time to guard against races that occurred between the initial lock and the checkout confirmation. If the seat transitioned to `SOLD` or `SEASON_PASS` in that window, the intent creation is rejected with HTTP 409.

```
AVAILABLE  →(lock)→   LOCKED
LOCKED     →(pay)→    SOLD          (ticket created, Redis lock released)
LOCKED     →(ttl)→    AVAILABLE     (lock expired without payment)
SOLD       →(cancel)→ AVAILABLE     (ticket cancelled / refunded / expired)
```

`DISABLED` and `SEASON_PASS` are administrative states that can only be changed via back-office operations outside the ticket purchase flow.

## Best free seats (`POST /matches/:matchId/seats/best`)

Body: `{ section, count (1..6), allowSplit? }`. One server operation: it ranks the placements and locks one.

**Adjacent** = same row, consecutive seat numbers, all `AVAILABLE`, and no aisle between them (`aislesAfter(rowWidth)` in `best-seats.ts`: one aisle in the middle of any row wider than 14 seats; a placeholder until the club's plan is surveyed). The `VENDÉG` sector is refused (403) and its seats are never `AVAILABLE`.

**Best** = lowest `cost = |run centre − halfway line| (in seats) + 1 × rowIndex`. The halfway line is the point where half the arc's total width (sum of seats-per-row of its sectors) lies each side, clamped to the sector (so in a sector away from the middle the best seats are the ones nearest it). Row 1 is the front. Ties: front row, then lowest seat number. Assumes seat numbers rise in the direction of the sector order (west to east); not surveyed.

**Race safety.** The service only *ranks* placements from a snapshot; it never decides a seat is free. `SeatLockService.acquireFirstFreeGroup` hands Redis the top 48 placements and a Lua script takes the first whose seats are all unlocked and locks them in the same atomic step (every seat gets the same owner token). If all 48 were taken since the snapshot it re-reads and retries (5 attempts), then answers 409 `contended`. Tested with real concurrent requests: `src/modules/seats/best-seats.race.spec.ts`.

**No run long enough** → 409 with a `code`: `no_adjacent_run` (body has `longestRun` and `alternative`: the best two-run split, even splits first, or `null`), `not_enough_seats` (`freeSeats` < `count`). Nothing is locked by a refusal. Sending the same request with `allowSplit: true` locks the split, atomically, as a single candidate.

The seat map's sector summary carries `longestRun` (same adjacency rule) and `aisles` for the grid.

## Season passes: the buyer chooses the seat

### The season rule

A seat can be issued as a season pass for a season **iff**

1. `seats.is_active = 1`,
2. its sector is not the away section (`sectors.is_away = 0`; `VENDÉG` is excluded everywhere: map 403, hold 403, purchase 403, never counted), and
3. **no `season_passes` row exists for (seat, season), whatever its status.**

Point 3 is exactly what the unique index `uq_season_passes_seat_season (seat_id, season_label)` enforces. The index ignores `status`, so a **cancelled or expired pass row still blocks the seat** for that season: offering it would only let a buyer pay and be refunded. Freeing such a seat needs the row removed (an admin decision), not a status change.

**Match-level state is irrelevant**: a seat sold as a single-match ticket for one match is still offered for the season and counts in `freeSeats`.

One SQL definition (`src/modules/season-passes/season-pass-seat-rule.ts`: `SEAT_FREE_FOR_PASS_SQL`, `PASS_SEAT_SELECT_SQL`) is used by the season map, the per-sector / per-tier counts, the hold check, the purchase pre-check and the re-check inside the finalisation transaction.

Map statuses (`GET /season-passes/seats?section=D/1`): `available`, `season_pass` (a pass row exists), `locked` (another buyer's hold, mid-payment; also the caller's own hold: the map is public and anonymous), `disabled`. Never `sold` or anything per match. `price` is the tier's season price on every seat; `aisles` / `longestRun` use the same `best-seats.ts` rule as the match map (free = `available`).

### Holds (Redis)

| Key | Value | TTL |
|-----|-------|-----|
| `seasonpass-hold:{season}:{seatId}` | hold token only (no user id, so the holder cannot be read from a seat) | `SEASON_PASS_HOLD_TTL_SECONDS`, default 900 s |
| `seasonpass-hold-owner:{season}:{userId}` | `{seatId}\|{holdToken}` | same |

- `POST /season-passes/seats/:seatId/hold` (JWT): checks the rule (404 unknown seat, 403 away, 409 `seat_taken` / `seat_disabled`), then one Lua script: if the seat key is free it is set, the user's previous seat hold for the season is deleted (only if its token still matches), and the owner key now points at the new seat. 409 `seat_held` if another buyer has it. Re-holding your own seat returns the same token and restarts the TTL. 15 minutes, longer than the 5-minute match lock, because a 3DS challenge can take minutes.
- `DELETE /season-passes/seats/:seatId/hold?holdToken=` (JWT): Lua compare-and-delete, always 204.
- One user holds at most ONE seat per season (so buying for several family members is sequential: hold, buy, hold the next).
- Redis down: hold / purchase answer 503 `hold_unavailable`; the map falls back to "nothing held".

### Purchase and finalisation

`POST /season-passes/purchase` takes `sectionId` (the tier), `seatId` and `holdToken`. Before a PaymentIntent is created: the seat must pass the rule (409 `seat_taken`), lie in the tier (400 `seat_tier_mismatch`), the holder must not have a pass yet, and the hold must belong to this user with this token (409 `hold_lost`). The intent carries `metadata.seatId`; the attempt / idempotency key includes the seat. Once the intent exists the hold's TTL is restarted.

Finalisation (synchronous confirm or webhook) issues **exactly** `metadata.seatId`, never another seat. It does not require the hold to still exist (the money is taken); inside the transaction the rule is re-checked and the unique index is the final guard. Seat taken / inactive / away / missing / moved to another tier, or holder already has a pass → full refund (`refund_seasonpass_{intentId}`), no pass. A duplicate caused by the same intent finalising twice (webhook + confirm) returns the existing pass and does not refund. The hold is released once there is an outcome.

### Why a Redis hold, not a `pending_payment` pass row

A pending row would occupy both unique keys, (seat, season) and (holder, season), for a payment that may never happen; abandoned payments would need a sweeper job; and while it lived the unique index would claim the seat was sold. A TTL key cleans itself up like the match locks, and the DB constraint stays the final guard.

### Single-match tickets on a pass seat

Because match state is ignored, a pass seat can already carry a `SINGLE` ticket for some match (sold before the pass). `uq_tickets_match_seat (match_id, seat_id)` ignores ticket status, so for **that one match**:

- occupying ticket (`pending_payment` / `paid` / `used`): the single-ticket buyer keeps the match; the pass holder's QR, a loan of that match, and loan acceptance answer 409 `seat_sold_for_match`;
- void ticket (`cancelled` / `refunded` / `expired`): the dead row still holds the slot; 409 `seat_slot_blocked`, logged as an error for staff. The row is not deleted (it records a payment/refund).

Every other match of the season works normally. From the moment the pass exists the match map shows the seat as `season_pass`, so no new single tickets are sold on it.
