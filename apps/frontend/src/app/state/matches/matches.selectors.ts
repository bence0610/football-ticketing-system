import { createFeatureSelector, createSelector } from '@ngrx/store';
import { MATCHES_FEATURE_KEY } from './matches.feature';
import { MatchesState } from './matches.reducer';

const selectMatchesFeature = createFeatureSelector<MatchesState>(MATCHES_FEATURE_KEY);

export const selectAllMatches = createSelector(selectMatchesFeature, (state) => state.matches);

export const selectUpcomingMatches = createSelector(
  selectMatchesFeature,
  (state) => state.upcoming,
);

export const selectNextMatch = createSelector(selectUpcomingMatches, (upcoming) => {
  return upcoming.length > 0 ? upcoming[0] : null;
});

export const selectMatchesLoading = createSelector(
  selectMatchesFeature,
  (state) => state.loading,
);

export const selectUpcomingLoading = createSelector(
  selectMatchesFeature,
  (state) => state.upcomingLoading,
);

export const selectMatchesError = createSelector(
  selectMatchesFeature,
  (state) => state.error,
);

export const selectSelectedMatchId = createSelector(
  selectMatchesFeature,
  (state) => state.selectedMatchId,
);

export const selectSelectedMatchDetail = createSelector(
  selectMatchesFeature,
  (state) => state.selectedMatchDetail,
);

/** From the (upcoming) list when it is there, else the match fetched by id. */
export const selectSelectedMatch = createSelector(
  selectAllMatches,
  selectSelectedMatchId,
  selectSelectedMatchDetail,
  (matches, id, detail) =>
    id ? (matches.find((m) => m.id === id) ?? (detail?.id === id ? detail : null)) : null,
);
