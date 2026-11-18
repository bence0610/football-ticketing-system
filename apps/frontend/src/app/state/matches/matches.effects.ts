import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';
import { MatchesApiService, upcomingMatchesParams } from '../../shared/services/matches.api.service';
import { MatchesActions } from './matches.actions';
import { extractApiErrorMessage } from '../../shared/utils/api-error';

@Injectable()
export class MatchesEffects {
  private readonly actions$ = inject(Actions);
  private readonly api = inject(MatchesApiService);

  loadMatches$ = createEffect(() =>
    this.actions$.pipe(
      ofType(MatchesActions.loadMatches),
      // Upcoming only: the list is capped and counted from the oldest match, so an unbounded
      // request fills up with past matches and hides every upcoming one. Whoever needs a past
      // match asks for it on its own (see loadSelectedMatch$, the season pass card).
      switchMap(() =>
        this.api.list(upcomingMatchesParams()).pipe(
          map((matches) => MatchesActions.loadMatchesSuccess({ matches })),
          catchError((error: unknown) =>
            of(
              MatchesActions.loadMatchesFailure({
                error: this.toMessage(error, 'Nem sikerült betölteni a meccseket.'),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  /**
   * A deep link (?matchId=…) can point at a match that is no longer in the upcoming list (it
   * has kicked off, say). The page still has to say so, so that one match is fetched by id.
   */
  loadSelectedMatch$ = createEffect(() =>
    this.actions$.pipe(
      ofType(MatchesActions.selectMatch),
      switchMap(({ matchId }) =>
        matchId
          ? this.api.detail(matchId, { silent: true }).pipe(
              map((match) => MatchesActions.loadSelectedMatchSuccess({ match })),
              catchError(() => of(MatchesActions.loadSelectedMatchSuccess({ match: null }))),
            )
          : of(MatchesActions.loadSelectedMatchSuccess({ match: null })),
      ),
    ),
  );

  loadUpcoming$ = createEffect(() =>
    this.actions$.pipe(
      ofType(MatchesActions.loadUpcoming),
      switchMap(() =>
        this.api.upcoming().pipe(
          map((matches) => MatchesActions.loadUpcomingSuccess({ matches })),
          catchError((error: unknown) =>
            of(
              MatchesActions.loadUpcomingFailure({
                error: this.toMessage(error, 'Nem sikerült betölteni a közelgő meccset.'),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  private toMessage(error: unknown, fallback: string): string {
    return extractApiErrorMessage(error, fallback);
  }
}
