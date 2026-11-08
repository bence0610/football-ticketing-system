import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { MatchesActions, selectAllMatches, selectMatchesError, selectMatchesLoading } from '../../state/matches';
import { AuthService } from '../../core/auth/auth.service';
import { LoyaltyService } from '../../core/services/loyalty.service';
import { MatchPrices, MatchPricesService } from './logic/match-prices.service';
import { upcomingHomeMatches } from './logic/match-availability';
import { HomeHeroComponent } from './components/home-hero/home-hero.component';
import { LoyaltyStripComponent } from './components/loyalty-strip/loyalty-strip.component';
import { UpcomingMatchesComponent } from './components/upcoming-matches/upcoming-matches.component';
import { SeasonPassBandComponent } from './components/season-pass-band/season-pass-band.component';

const NO_PRICES: MatchPrices = { sectors: [], lowest: null };

@Component({
  selector: 'kte-home-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HomeHeroComponent, LoyaltyStripComponent, UpcomingMatchesComponent, SeasonPassBandComponent],
  template: `
    <kte-home-hero
      [match]="nextMatch()"
      [sectors]="heroPrices().sectors"
      [pricesLoading]="heroPricesLoading()"
      [loading]="loading() && !nextMatch()"
      [error]="nextMatch() ? null : error()"
      (retry)="reload()"
    ></kte-home-hero>

    @if (isAuthenticated()) {
      <kte-loyalty-strip [snapshot]="loyalty()"></kte-loyalty-strip>
    }

    <kte-upcoming-matches
      [matches]="matches()"
      [lowestPrices]="lowestPrices()"
      [loading]="loading()"
      [error]="error()"
    ></kte-upcoming-matches>

    <kte-season-pass-band></kte-season-pass-band>
  `,
})
export class HomePageComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly auth = inject(AuthService);
  private readonly loyaltyApi = inject(LoyaltyService);
  private readonly prices = inject(MatchPricesService);

  protected readonly isAuthenticated = this.auth.isAuthenticated;
  protected readonly loading = toSignal(this.store.select(selectMatchesLoading), { initialValue: false });
  protected readonly error = toSignal(this.store.select(selectMatchesError), { initialValue: null });
  private readonly all = toSignal(this.store.select(selectAllMatches), { initialValue: [] });

  /** Upcoming home matches (sold-out ones included), soonest first. */
  protected readonly matches = computed(() => upcomingHomeMatches(this.all(), Date.now()));
  protected readonly nextMatch = computed(() => this.matches()[0] ?? null);

  /** Prices of every card's match (sector summary), keyed by match id. */
  private readonly priceMap = toSignal(
    toObservable(this.matches).pipe(
      switchMap((list) =>
        list.length === 0
          ? of({} as Record<string, MatchPrices>)
          : combineLatest(
              list.map((m) => this.prices.forMatch(m.id).pipe(map((p) => [m.id, p] as const))),
            ).pipe(map((pairs) => Object.fromEntries(pairs))),
      ),
      startWith({} as Record<string, MatchPrices>),
    ),
    { initialValue: {} as Record<string, MatchPrices> },
  );

  protected readonly lowestPrices = computed(() =>
    Object.fromEntries(Object.entries(this.priceMap()).map(([id, p]) => [id, p.lowest])),
  );
  protected readonly heroPrices = computed(() => {
    const id = this.nextMatch()?.id;
    return (id ? this.priceMap()[id] : undefined) ?? NO_PRICES;
  });
  protected readonly heroPricesLoading = computed(() => {
    const id = this.nextMatch()?.id;
    return !!id && !this.priceMap()[id];
  });

  /** Signed-in users only: GET /loyalty/me. */
  protected readonly loyalty = toSignal(
    toObservable(this.isAuthenticated).pipe(
      switchMap((signedIn) =>
        signedIn ? this.loyaltyApi.getSnapshot().pipe(catchError(() => of(null))) : of(null),
      ),
    ),
    { initialValue: null },
  );

  ngOnInit(): void {
    this.reload();
  }

  protected reload(): void {
    this.store.dispatch(MatchesActions.loadMatches());
  }
}
