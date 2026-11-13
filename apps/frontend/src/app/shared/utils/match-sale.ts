import type { MatchListItem } from '../models/match.model';

/**
 * "This match can no longer be bought": its kickoff has passed. Kickoff, not
 * kickoff plus the match length (a ticket for a game already under way is worth
 * nothing). Mirrors the server's rule in `match-sale.ts`; the server is the
 * authority, this only keeps the choice from being offered in the first place.
 * A missing or unparseable kickoff counts as started.
 */
export function hasKickedOff(match: Pick<MatchListItem, 'kickoffAt'>, now: number = Date.now()): boolean {
  return !(new Date(match.kickoffAt).getTime() > now);
}

/** The matches a visitor may still buy for, in the order given. */
export function purchasableMatches<T extends Pick<MatchListItem, 'kickoffAt'>>(
  matches: readonly T[],
  now: number = Date.now(),
): readonly T[] {
  return matches.filter((m) => !hasKickedOff(m, now));
}
