import { createReducer, on } from '@ngrx/store';
import { MatchListItem } from '../../shared/models/match.model';
import { MatchesActions } from './matches.actions';

export interface MatchesState {
  readonly matches: readonly MatchListItem[];
  readonly upcoming: readonly MatchListItem[];
  readonly selectedMatchId: string | null;
  /** The selected match fetched by id: covers one that is not in `matches` (already played). */
  readonly selectedMatchDetail: MatchListItem | null;
  readonly loading: boolean;
  readonly upcomingLoading: boolean;
  readonly error: string | null;
}

export const initialMatchesState: MatchesState = {
  matches: [],
  upcoming: [],
  selectedMatchId: null,
  selectedMatchDetail: null,
  loading: false,
  upcomingLoading: false,
  error: null,
};

export const matchesReducer = createReducer(
  initialMatchesState,
  on(MatchesActions.loadMatches, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(MatchesActions.loadMatchesSuccess, (state, { matches }) => ({
    ...state,
    matches,
    loading: false,
  })),
  on(MatchesActions.loadMatchesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(MatchesActions.loadUpcoming, (state) => ({
    ...state,
    upcomingLoading: true,
  })),
  on(MatchesActions.loadUpcomingSuccess, (state, { matches }) => ({
    ...state,
    upcoming: matches,
    upcomingLoading: false,
  })),
  on(MatchesActions.loadUpcomingFailure, (state, { error }) => ({
    ...state,
    upcomingLoading: false,
    error,
  })),
  on(MatchesActions.selectMatch, (state, { matchId }) => ({
    ...state,
    selectedMatchId: matchId,
    // A stale fetched match must not outlive the selection it was fetched for.
    selectedMatchDetail: state.selectedMatchDetail?.id === matchId ? state.selectedMatchDetail : null,
  })),
  on(MatchesActions.loadSelectedMatchSuccess, (state, { match }) => ({
    ...state,
    // Ignore an answer for a match that is no longer the selected one.
    selectedMatchDetail: match && match.id === state.selectedMatchId ? match : state.selectedMatchDetail,
  })),
);
