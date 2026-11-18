import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { ReplaySubject } from 'rxjs';
import { MatchListItem } from '../../shared/models/match.model';
import { MatchesActions } from './matches.actions';
import { MatchesEffects } from './matches.effects';
import { initialMatchesState, matchesReducer } from './matches.reducer';
import { selectSelectedMatch } from './matches.selectors';

const match = (id: string): MatchListItem => ({ id, kickoffAt: '2026-01-01T10:00:00Z' }) as MatchListItem;

describe('MatchesEffects', () => {
  let actions$: ReplaySubject<Action>;
  let effects: MatchesEffects;
  let http: HttpTestingController;

  beforeEach(() => {
    actions$ = new ReplaySubject<Action>(1);
    TestBed.configureTestingModule({
      providers: [
        MatchesEffects,
        provideMockActions(() => actions$),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    effects = TestBed.inject(MatchesEffects);
    http = TestBed.inject(HttpTestingController);
  });

  it('asks only for matches from now on, at the largest page size', () => {
    const before = Date.now();
    const emitted: Action[] = [];
    effects.loadMatches$.subscribe((a) => emitted.push(a));
    actions$.next(MatchesActions.loadMatches());

    const req = http.expectOne((r) => r.url === '/matches');
    const from = Date.parse(req.request.params.get('from') ?? '');
    // Without `from` the 50-row default is filled by past matches and the upcoming ones vanish.
    expect(from).toBeGreaterThanOrEqual(before);
    expect(from).toBeLessThanOrEqual(Date.now());
    expect(req.request.params.get('limit')).toBe('100');

    req.flush([match('next')]);
    expect(emitted).toEqual([MatchesActions.loadMatchesSuccess({ matches: [match('next')] })]);
  });

  it('fetches a deep-linked match by id, so a played one is still found', () => {
    const emitted: Action[] = [];
    effects.loadSelectedMatch$.subscribe((a) => emitted.push(a));
    actions$.next(MatchesActions.selectMatch({ matchId: 'old' }));

    http.expectOne('/matches/old').flush(match('old'));
    expect(emitted).toEqual([MatchesActions.loadSelectedMatchSuccess({ match: match('old') })]);
  });

  it('does not fail the page when the deep-linked match does not exist', () => {
    const emitted: Action[] = [];
    effects.loadSelectedMatch$.subscribe((a) => emitted.push(a));
    actions$.next(MatchesActions.selectMatch({ matchId: 'gone' }));

    http.expectOne('/matches/gone').flush({}, { status: 404, statusText: 'Not Found' });
    expect(emitted).toEqual([MatchesActions.loadSelectedMatchSuccess({ match: null })]);
  });
});

describe('selected match (list first, fetched match as fallback)', () => {
  const stateWith = (matches: MatchListItem[], detail: MatchListItem | null, id: string | null) => {
    let state = matchesReducer(initialMatchesState, MatchesActions.loadMatchesSuccess({ matches }));
    state = matchesReducer(state, MatchesActions.selectMatch({ matchId: id }));
    return matchesReducer(state, MatchesActions.loadSelectedMatchSuccess({ match: detail }));
  };
  const select = (state: ReturnType<typeof stateWith>) =>
    selectSelectedMatch.projector(state.matches, state.selectedMatchId, state.selectedMatchDetail);

  it('finds a match that is not in the upcoming list through the fetched one', () => {
    expect(select(stateWith([match('next')], match('old'), 'old'))?.id).toBe('old');
  });

  it('prefers the list entry', () => {
    expect(select(stateWith([match('next')], null, 'next'))?.id).toBe('next');
  });

  it('drops a fetched match when another one is selected', () => {
    const state = stateWith([], match('old'), 'old');
    const next = matchesReducer(state, MatchesActions.selectMatch({ matchId: 'other' }));
    expect(next.selectedMatchDetail).toBeNull();
  });
});
