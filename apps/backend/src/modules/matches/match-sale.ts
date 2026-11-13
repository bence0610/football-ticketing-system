import { ConflictException } from '@nestjs/common';
import type { Match } from '../../database/entities';

/**
 * The single definition of "this match can no longer be bought": its kickoff
 * has passed. Kickoff, not kickoff plus the match length: a ticket for a game
 * that is already under way is worth nothing, and gate entry is a separate
 * matter (it is not governed by this). Used by the seat lock and the payment
 * intent so the two can never disagree.
 */
export function hasKickedOff(match: Pick<Match, 'kickoffAt'>, now: Date = new Date()): boolean {
  // Written so that a missing or unparseable kickoff counts as started: fail closed.
  return !(new Date(match.kickoffAt).getTime() > now.getTime());
}

/** Throws 409 `match_started` when the match has kicked off. */
export function assertMatchNotStarted(match: Pick<Match, 'kickoffAt'>, now: Date = new Date()): void {
  if (hasKickedOff(match, now)) {
    throw new ConflictException({
      statusCode: 409,
      message: 'Erre a mérkőzésre már nem vásárolható jegy: a mérkőzés elkezdődött.',
      code: 'match_started',
    });
  }
}
