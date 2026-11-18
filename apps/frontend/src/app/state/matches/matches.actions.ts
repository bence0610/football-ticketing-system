import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { MatchListItem } from '../../shared/models/match.model';

export const MatchesActions = createActionGroup({
  source: 'Matches',
  events: {
    'Load Matches': emptyProps(),
    'Load Matches Success': props<{ matches: MatchListItem[] }>(),
    'Load Matches Failure': props<{ error: string }>(),

    'Load Upcoming': emptyProps(),
    'Load Upcoming Success': props<{ matches: MatchListItem[] }>(),
    'Load Upcoming Failure': props<{ error: string }>(),

    'Select Match': props<{ matchId: string | null }>(),
    'Load Selected Match Success': props<{ match: MatchListItem | null }>(),
  },
});
