import { MatchListItem } from '../../../shared/models/match.model';

/**
 * The API exposes the competition but no round / matchday, so the card
 * eyebrow shows the competition only.
 */
export function competitionLabel(competition: MatchListItem['competition']): string {
  switch (competition) {
    case 'NB1':
      return 'NB I';
    case 'NB2':
      return 'NB II';
    case 'magyar_kupa':
      return 'Magyar Kupa';
    case 'friendly':
      return 'Felkészülési mérkőzés';
    default:
      return competition;
  }
}
