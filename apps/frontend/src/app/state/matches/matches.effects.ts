import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';
import { MatchesApiService } from '../../shared/services/matches.api.service';
import { MatchesActions } from './matches.actions';
import { extractApiErrorMessage } from '../../shared/utils/api-error';

@Injectable()
export class MatchesEffects {
  private readonly actions$ = inject(Actions);
  private readonly api = inject(MatchesApiService);

  loadMatches$ = createEffect(() =>
    this.actions$.pipe(
      ofType(MatchesActions.loadMatches),
      switchMap(() =>
        this.api.list({ limit: 50 }).pipe(
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
