import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import localeHu from '@angular/common/locales/hu';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store, provideStore } from '@ngrx/store';
import { BehaviorSubject } from 'rxjs';
import { CartFacade } from '../../core/cart/cart.facade';
import { MatchListItem } from '../../shared/models/match.model';
import { SectorSummary } from '../../shared/models/seat.model';
import {
  MATCHES_FEATURE_KEY,
  MatchesActions,
  matchesReducer,
} from '../../state/matches';
import { SEATS_FEATURE_KEY, SeatsActions, seatsReducer } from '../../state/seats';
import { MatchSelectorComponent } from './components/match-selector/match-selector.component';
import { StadiumPageComponent } from './stadium.page';

registerLocaleData(localeHu);

const DAY = 24 * 60 * 60 * 1000;

const match = (id: string, offsetMs: number): MatchListItem => ({
  id,
  homeTeam: 'Kecskeméti TE',
  awayTeam: `Ellenfél ${id}`,
  competition: 'NB2',
  venue: 'Széktói Stadion',
  kickoffAt: new Date(Date.now() + offsetMs).toISOString(),
  status: 'on_sale',
  basePrice: 2800,
  capacity: 5468,
  availableSeats: 1000,
  isHome: true,
  isSeasonPassEligible: true,
});

const sector = (section: string, arc: 'upper' | 'lower', position: number): SectorSummary => ({
  section,
  name: `${section} szektor`,
  arc,
  position,
  gate: 2,
  priceCategory: arc === 'upper' ? 'upper' : 'lower',
  isAway: false,
  covered: arc === 'upper',
  total: 100,
  available: 80,
  locked: 5,
  sold: 15,
  occupancyRatio: 0.2,
  minPrice: 2800,
  maxPrice: 2800,
  longestRun: 6,
  aisles: [],
});

// 'off' is cancelled with its kickoff still ahead: only its status keeps it out of the picker.
const MATCHES: MatchListItem[] = [
  match('past', -DAY),
  match('live', -60_000),
  match('next', 3 * DAY),
  { ...match('off', 4 * DAY), status: 'cancelled' },
  match('later', 9 * DAY),
];

describe('StadiumPageComponent', () => {
  let params$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  function render(matchId: string | null = null): { el: HTMLElement; fixture: ComponentFixture<StadiumPageComponent> } {
    params$ = new BehaviorSubject(convertToParamMap(matchId ? { matchId } : {}));
    TestBed.configureTestingModule({
      imports: [StadiumPageComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideStore({ [MATCHES_FEATURE_KEY]: matchesReducer, [SEATS_FEATURE_KEY]: seatsReducer }),
        { provide: ActivatedRoute, useValue: { queryParamMap: params$ } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        {
          provide: CartFacade,
          useValue: {
            items: signal([]),
            isFull: () => false,
            has: () => false,
            add: () => Promise.reject(new Error('no')),
          },
        },
      ],
    });
    const store = TestBed.inject(Store);
    const fixture = TestBed.createComponent(StadiumPageComponent);
    store.dispatch(MatchesActions.loadMatchesSuccess({ matches: MATCHES }));
    store.dispatch(
      SeatsActions.loadSeatsSuccess({
        response: {
          matchId: matchId ?? 'next',
          seats: [],
          sectorSummary: [sector('D/1', 'upper', 1), sector('K', 'lower', 5)],
        },
      }),
    );
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, fixture };
  }

  it('offers only the matches that have not kicked off and are not cancelled', () => {
    const { fixture } = render();
    const selector = fixture.debugElement.query(By.directive(MatchSelectorComponent))
      .componentInstance as MatchSelectorComponent;
    expect(selector.matches.map((m) => m.id)).toEqual(['next', 'later']);
  });

  it('puts the map before the sector list, and the list before the seat grid', () => {
    const { el } = render('next');
    const order = Array.from(
      el.querySelectorAll('kte-stadium-map, kte-sector-summary, kte-seat-grid'),
    ).map((n) => n.tagName.toLowerCase());
    expect(order).toEqual(['kte-stadium-map', 'kte-sector-summary', 'kte-seat-grid']);
  });

  it('shows the compact list as one dropdown, not 19 cards', () => {
    const { el } = render('next');
    expect(el.querySelectorAll('kte-sector-summary select').length).toBe(1);
    expect(el.querySelector('kte-sector-summary mat-card')).toBeNull();
  });

  it('puts the sticky summary beside the grid, and the finder above the grid once a sector is open', () => {
    const { el, fixture } = render('next');
    const board = el.querySelector('.kte-stadium__board')!;
    expect(board.querySelector('kte-seat-grid')).not.toBeNull();
    expect(board.querySelector('kte-seat-summary')).not.toBeNull();
    expect(el.querySelector('kte-best-seats-panel')).toBeNull(); // no sector yet

    TestBed.inject(Store).dispatch(SeatsActions.setSelectedSector({ section: 'K' }));
    fixture.detectChanges();
    const kids = Array.from(el.querySelectorAll('.kte-stadium__main > *')).map((n) => n.tagName.toLowerCase());
    expect(kids).toEqual(['kte-best-seats-panel', 'kte-seat-grid']);
    expect((el.querySelector('[data-testid="finder-longest-run"]')?.textContent ?? '')).toContain('6 hely');
  });

  it('offers no finder in the away section', () => {
    const { el, fixture } = render('next');
    TestBed.inject(Store).dispatch(
      SeatsActions.loadSeatsSuccess({
        response: {
          matchId: 'next',
          seats: [],
          sectorSummary: [{ ...sector('VENDÉG', 'lower', 1), isAway: true, longestRun: 0 }],
        },
      }),
    );
    TestBed.inject(Store).dispatch(SeatsActions.setSelectedSector({ section: 'VENDÉG' }));
    fixture.detectChanges();
    expect(el.querySelector('kte-best-seats-panel')).toBeNull();
  });

  it('opens the seat map of a match that has not started', () => {
    const { el } = render('next');
    expect(el.querySelector('[data-testid="match-started"]')).toBeNull();
    expect(el.querySelector('kte-stadium-map')).not.toBeNull();
  });

  it('refuses a deep link to a match that has kicked off: no map, no seats, a notice', () => {
    const { el } = render('live');
    expect(el.querySelector('[data-testid="match-started"]')).not.toBeNull();
    expect(el.querySelector('kte-stadium-map')).toBeNull();
    expect(el.querySelector('kte-sector-summary')).toBeNull();
    expect(el.querySelector('kte-seat-grid')).toBeNull();
    expect((el.textContent ?? '').replace(/\s+/g, ' ')).toContain('már nem vásárolható jegy');
  });

  it('refuses a deep link to a cancelled match: no map, no seats, its own notice', () => {
    const { el } = render('off');
    expect(el.querySelector('[data-testid="match-cancelled"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="match-started"]')).toBeNull();
    expect(el.querySelector('kte-stadium-map')).toBeNull();
    expect(el.querySelector('kte-seat-grid')).toBeNull();
    expect((el.textContent ?? '').replace(/\s+/g, ' ')).toContain('Ez a mérkőzés elmarad');
  });
});
