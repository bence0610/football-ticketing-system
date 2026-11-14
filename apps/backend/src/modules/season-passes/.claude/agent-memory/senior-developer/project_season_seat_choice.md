---
name: season-seat-choice
description: Season-pass buyers choose their seat (2026-11-14): season rule, Redis hold design, single-match ticket conflict codes, open risks
metadata:
  type: project
---

Season passes are bought for a buyer-chosen seat (no auto-assignment; findFreeSeatId removed 2026-11-14).

- Season rule = uq_season_passes_seat_season: ANY season_passes row (any status, incl. cancelled/expired) blocks the seat for the season; match state ignored; VENDÉG excluded. One SQL in season-pass-seat-rule.ts.
- Hold = Redis (SeasonPassHoldService, 15 min, one seat per user per season), NOT a pending_payment row. **Why:** a pending row occupies both unique keys, needs a sweeper, and makes the index lie about "sold".
- A pass seat may carry a SINGLE ticket for some match (sold before the pass); uq_tickets_match_seat ignores status, so that match returns 409 seat_sold_for_match (occupying) / seat_slot_blocked (void row, not deleted).
- Season map status `ticketed` (ticket for an UPCOMING season match) blocks pass purchase (409 seat_ticketed). Frontend: own grid state 'J' glyph, season-only; grid emits `unavailableSeatTapped` in season mode so the page explains why.
- Finalisation refunds instead of reassigning; same-intent dup returns the winner BEFORE classifying the dup (seat index fires for webhook+confirm race).

**How to apply:** if asked to "free" cancelled-pass seats or fix seat_slot_blocked, the real fix is a migration making the unique indexes status-aware (functional index), not code. e2e specs posting /season-passes/purchase without seatId/holdToken need updating.
