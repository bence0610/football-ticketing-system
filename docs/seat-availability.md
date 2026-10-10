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
