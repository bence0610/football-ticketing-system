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
