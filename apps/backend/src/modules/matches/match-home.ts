import type { Match } from '../../database/entities';

/**
 * The single definition of "is this our home match": the configured club is
 * the home side. Shared by the match list and the chatbot snapshot so the two
 * can never disagree.
 */
export function isHomeMatch(match: Pick<Match, 'homeTeam'>, homeTeamName: string): boolean {
  return match.homeTeam === homeTeamName;
}
