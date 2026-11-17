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

/**
 * "This match has been called off." Mirrors the server's `match_cancelled` refusal; the
 * server is the real guard, this only keeps a cancelled match from being offered.
 */
export function isCancelled(match: Partial<Pick<MatchListItem, 'status'>>): boolean {
  return match.status === 'cancelled';
}

/**
 * "This is an away match": the club does not host it, so no ticket is sold for it. Mirrors the
 * server's `match_away` refusal. Only an explicit `isHome: false` counts (the API always sends it).
 */
export function isAway(match: Partial<Pick<MatchListItem, 'isHome'>>): boolean {
  return match.isHome === false;
}

/** The matches a visitor may still buy for (home, not started, not cancelled), in the order given. */
export function purchasableMatches<
  T extends Pick<MatchListItem, 'kickoffAt'> & Partial<Pick<MatchListItem, 'status' | 'isHome'>>,
>(matches: readonly T[], now: number = Date.now()): readonly T[] {
  return matches.filter((m) => !isAway(m) && !isCancelled(m) && !hasKickedOff(m, now));
}
