/**
 * Subjects name the sender and the match, so the inbox line alone is enough to judge the mail
 * ("Szabó Bence átadja a helyét — KTE–Újpest, nov. 9.").
 */

const HOME_CLUB = 'Kecskeméti TE';

export interface SubjectMatch {
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
}

/** "Kecskeméti TE" -> "KTE"; "Újpest FC" -> "Újpest" (trailing club-form abbreviation dropped). */
export function shortTeamName(team: string): string {
  if (team.trim() === HOME_CLUB) {
    return 'KTE';
  }
  return team.trim().replace(/\s+(FC|TC|SE|SC|FK|FC\.)$/i, '');
}

/** "KTE–Újpest, nov. 9." (stadium timezone). */
export function matchSubjectLabel(match: SubjectMatch): string {
  const date = new Intl.DateTimeFormat('hu-HU', {
    month: 'short',
    day: 'numeric',
    timeZone: 'Europe/Budapest',
  }).format(match.kickoffAt);
  return `${shortTeamName(match.homeTeam)}–${shortTeamName(match.awayTeam)}, ${date}`;
}

/** Joins the lead (who/what) and the match with an em dash. */
export function matchSubject(lead: string, match: SubjectMatch): string {
  return `${lead} — ${matchSubjectLabel(match)}`;
}
