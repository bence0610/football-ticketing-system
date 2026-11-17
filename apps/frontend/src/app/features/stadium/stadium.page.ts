import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { AsyncPipe, NgIf } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { combineLatest, distinctUntilChanged, filter, map } from 'rxjs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import {
  MatchesActions,
  selectAllMatches,
  selectSelectedMatch,
  selectSelectedMatchId,
} from '../../state/matches';
import {
  SeatsActions,
  selectAccessibleOnly,
  selectSeats,
  selectSeatsError,
  selectSeatsForSelectedSector,
  selectSeatsLoading,
  selectSectorSummary,
  selectSelectedSection,
} from '../../state/seats';
import { SeatStatus, SectorSummary } from '../../shared/models/seat.model';
import { CartFacade } from '../../core/cart/cart.facade';
import { MatchListItem } from '../../shared/models/match.model';
import { MatchSelectorComponent } from './components/match-selector/match-selector.component';
import { StadiumMapComponent } from './components/stadium-map/stadium-map.component';
import { SeatGridComponent } from './components/seat-grid/seat-grid.component';
import { SectorSummaryComponent } from './components/sector-summary/sector-summary.component';
import { AccessibilityToggleComponent } from './components/accessibility-toggle/accessibility-toggle.component';
import { ColorLegendComponent } from './components/color-legend/color-legend.component';
import { BestSeatsPanelComponent, BestSeatsPlaced } from './components/best-seats-panel/best-seats-panel.component';
import { SeatSummaryComponent } from './components/seat-summary/seat-summary.component';
import { WaitlistJoinButtonComponent } from './components/waitlist-join-button/waitlist-join-button.component';
import { lockErrorMessage } from '../../shared/utils/lock-error';
import { hasKickedOff, isAway, isCancelled, purchasableMatches } from '../../shared/utils/match-sale';

@Component({
  selector: 'kte-stadium-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncPipe,
    NgIf,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatchSelectorComponent,
    StadiumMapComponent,
    SeatGridComponent,
    BestSeatsPanelComponent,
    SeatSummaryComponent,
    SectorSummaryComponent,
    AccessibilityToggleComponent,
    ColorLegendComponent,
    WaitlistJoinButtonComponent,
  ],
  template: `
    <div class="kte-stadium">
      <header class="kte-stadium__header">
        <div>
          <h1>Jegyvásárlás</h1>
          <p>Széktói Stadion · Foglalj le helyeket valós idejű ülésrenden.</p>
        </div>
        <kte-match-selector
          [matches]="(matches$ | async) ?? []"
          [matchId]="(matchId$ | async) ?? null"
          (matchIdChange)="onMatchSelected($event)"
        ></kte-match-selector>
      </header>

      <ng-container *ngIf="(matchId$ | async); else noMatch">
        <div
          *ngIf="startedMatch$ | async as started"
          class="kte-stadium__started"
          role="status"
          data-testid="match-started"
        >
          <mat-icon>schedule</mat-icon>
          <div>
            <strong>Ez a mérkőzés már elkezdődött.</strong>
            <p>
              {{ started.homeTeam }} – {{ started.awayTeam }}: a mérkőzésre már nem vásárolható jegy.
              Válassz egy másik mérkőzést a fenti listából.
            </p>
          </div>
        </div>

        <div
          *ngIf="cancelledMatch$ | async as called"
          class="kte-stadium__started"
          role="status"
          data-testid="match-cancelled"
        >
          <mat-icon>event_busy</mat-icon>
          <div>
            <strong>Ez a mérkőzés elmarad.</strong>
            <p>
              {{ called.homeTeam }} – {{ called.awayTeam }}: a mérkőzésre nem vásárolható jegy.
              Válassz egy másik mérkőzést a fenti listából.
            </p>
          </div>
        </div>

        <div
          *ngIf="awayMatch$ | async as away"
          class="kte-stadium__started"
          role="status"
          data-testid="match-away"
        >
          <mat-icon>directions_bus</mat-icon>
          <div>
            <strong>Ez idegenbeli mérkőzés.</strong>
            <p>
              {{ away.homeTeam }} – {{ away.awayTeam }}: idegenbeli mérkőzésre nem vásárolható jegy.
              Válassz egy hazai mérkőzést a fenti listából.
            </p>
          </div>
        </div>

        <ng-container
          *ngIf="(startedMatch$ | async) === null && (cancelledMatch$ | async) === null && (awayMatch$ | async) === null"
        >
          <ng-container *ngIf="selectedMatch$ | async as activeMatch">
            <div *ngIf="isSoldOut(activeMatch)" class="kte-stadium__sold-out">
              <mat-icon>info</mat-icon>
              <div>
                <strong>Telt ház!</strong>
                <p>Erre a meccsre minden hely elkelt vagy átmenetileg foglalt. Ha mégis szeretnél jönni, iratkozz fel a várólistára - értesítünk, ha valaki visszamondja a jegyét.</p>
              </div>
              <kte-waitlist-join-button [matchId]="activeMatch.id" />
            </div>
          </ng-container>

          <span *ngIf="(seatsLoading$ | async)" class="kte-stadium__loading">
            <mat-progress-spinner diameter="20" mode="indeterminate"></mat-progress-spinner>
            Ülésrend betöltése…
          </span>

          <div class="kte-stadium__content">
            <!-- The map first: it is what people came for. -->
            <div class="kte-stadium__map-wrapper">
              <kte-stadium-map
                [sectorSummary]="(summaries$ | async) ?? []"
                [selectedSection]="(selectedSection$ | async) ?? null"
                (sectorSelected)="onSectorSelected($event)"
              ></kte-stadium-map>
              <div class="kte-stadium__legend">
                <kte-color-legend></kte-color-legend>
              </div>
            </div>

            <!-- The fallback below it: the same choice as a list, for keyboard and screen readers. -->
            <kte-sector-summary
              [summaries]="(summaries$ | async) ?? []"
              [selectedSection]="(selectedSection$ | async) ?? null"
              (sectorSelected)="onSectorSelected($event)"
            ></kte-sector-summary>

            <div class="kte-stadium__toolbar">
              <kte-accessibility-toggle
                [checked]="(accessibleOnly$ | async) ?? false"
                (changed)="onAccessibilityToggle()"
              ></kte-accessibility-toggle>
            </div>

            <ng-container *ngIf="selectedMatch$ | async as activeMatch">
              <div class="kte-stadium__board">
                <div class="kte-stadium__main">
                  <ng-container *ngIf="selectedSector$ | async as sector">
                    <kte-best-seats-panel
                      *ngIf="!sector.isAway"
                      [section]="sector.section"
                      [sectorName]="sector.name"
                      [longestRun]="sector.longestRun"
                      [match]="activeMatch"
                      (placed)="onBestSeatsPlaced($event)"
                    ></kte-best-seats-panel>
                  </ng-container>

                  <kte-seat-grid
                    [seats]="(seatsForSector$ | async) ?? []"
                    [section]="(selectedSection$ | async) ?? null"
                    [sectorName]="(selectedSector$ | async)?.name ?? null"
                    [arc]="(selectedSector$ | async)?.arc ?? null"
                    [gate]="(selectedSector$ | async)?.gate ?? null"
                    [covered]="(selectedSectorCovered$ | async) ?? null"
                    [aisles]="(selectedSector$ | async)?.aisles ?? []"
                    [longestRun]="(selectedSector$ | async)?.longestRun ?? null"
                    [chosenIds]="chosenIds()"
                    [busyIds]="busyIds()"
                    (seatToggled)="onSeatToggled($event)"
                  ></kte-seat-grid>
                </div>

                <kte-seat-summary
                  [items]="chosenItems()"
                  [busy]="busyIds().size > 0"
                  (remove)="onRemoveChosen($event)"
                  (proceed)="onProceed()"
                ></kte-seat-summary>
              </div>
            </ng-container>
          </div>
        </ng-container>
      </ng-container>

      <ng-template #noMatch>
        <div class="kte-stadium__empty">
          <mat-icon>sports_soccer</mat-icon>
          <p>Válassz mérkőzést a fenti listából az ülésrend megnyitásához.</p>
        </div>
      </ng-template>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-stadium {
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-6);
      }

      .kte-stadium__header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: flex-end;
        gap: 16px;
      }

      .kte-stadium__header h1 {
        margin: 0;
        font-family: var(--kte-font-display);
        font-size: 32px;
        font-weight: 700;
        color: var(--kte-brand-deep);
      }

      .kte-stadium__header p {
        margin: 4px 0 0;
        color: var(--kte-muted);
      }

      .kte-stadium__toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
      }

      .kte-stadium__loading {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--kte-muted);
        font-size: 13px;
      }

      .kte-stadium__content {
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-6);
        min-width: 0;
      }

      /* Grid on the left, summary on the right; stacked (summary glued to the bottom edge) on phones. */
      .kte-stadium__board {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--kte-spacing-4);
        align-items: start;
      }
      .kte-stadium__main {
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-4);
        min-width: 0;
      }
      @media (min-width: 900px) {
        .kte-stadium__board {
          grid-template-columns: minmax(0, 1fr) 340px;
        }
      }

      .kte-stadium__map-wrapper {
        position: relative;
      }

      .kte-stadium__legend {
        position: absolute;
        right: 16px;
        bottom: 16px;
        z-index: 5;
      }

      .kte-stadium__started {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 16px;
        padding: 16px 20px;
        background: var(--kte-surface);
        border-left: 4px solid var(--kte-muted);
        border-radius: var(--kte-radius);
      }
      .kte-stadium__started mat-icon {
        color: var(--kte-muted);
        font-size: 28px;
        width: 28px;
        height: 28px;
      }
      .kte-stadium__started p {
        margin: 4px 0 0;
        color: var(--kte-muted);
        font-size: 14px;
      }

      .kte-stadium__sold-out {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 16px;
        padding: 16px 20px;
        background: var(--kte-danger-bg);
        border-left: 4px solid var(--kte-danger);
        border-radius: var(--kte-radius);
      }
      .kte-stadium__sold-out mat-icon {
        color: var(--kte-danger);
        font-size: 28px;
        width: 28px;
        height: 28px;
      }
      .kte-stadium__sold-out p {
        margin: 4px 0 0;
        color: var(--kte-muted);
        font-size: 14px;
      }
      @media (max-width: 768px) {
        .kte-stadium__sold-out {
          grid-template-columns: 1fr;
          text-align: center;
        }
      }

      .kte-stadium__empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 64px 24px;
        background: var(--kte-surface);
        border-radius: var(--kte-radius-lg);
        box-shadow: var(--kte-shadow-sm);
        color: var(--kte-muted);
        text-align: center;

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          color: var(--kte-brand-deep);
        }
      }

      @media (max-width: 768px) {
        .kte-stadium__header {
          flex-direction: column;
          align-items: stretch;
        }

        .kte-stadium__legend {
          position: static;
          margin-top: 12px;
        }
      }
    `,
  ],
})
export class StadiumPageComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cart = inject(CartFacade);

  /**
   * Only the matches still to be played: a match that has kicked off is not
   * offered. The server refuses it too (seat lock and payment intent); this is
   * not the only guard.
   */
  protected readonly matches$ = this.store
    .select(selectAllMatches)
    .pipe(map((matches) => purchasableMatches(matches)));
  protected readonly matchId$ = this.store.select(selectSelectedMatchId);
  protected readonly selectedMatch$ = this.store.select(selectSelectedMatch);
  /** The match a deep link (?matchId=...) points at, when it has already kicked off. */
  protected readonly startedMatch$ = this.selectedMatch$.pipe(
    map((match) =>
      match && !isAway(match) && !isCancelled(match) && hasKickedOff(match) ? match : null,
    ),
  );
  /** The match a deep link points at, when it is an away match: no tickets are sold for it. */
  protected readonly awayMatch$ = this.selectedMatch$.pipe(
    map((match) => (match && isAway(match) ? match : null)),
  );
  /** The match a deep link points at, when it has been called off. */
  protected readonly cancelledMatch$ = this.selectedMatch$.pipe(
    map((match) => (match && !isAway(match) && isCancelled(match) ? match : null)),
  );
  protected readonly seats$ = this.store.select(selectSeats);
  protected readonly summaries$ = this.store.select(selectSectorSummary);
  protected readonly seatsLoading$ = this.store.select(selectSeatsLoading);
  protected readonly seatsError$ = this.store.select(selectSeatsError);
  protected readonly selectedSection$ = this.store.select(selectSelectedSection);
  protected readonly accessibleOnly$ = this.store.select(selectAccessibleOnly);
  protected readonly seatsForSector$ = this.store.select(selectSeatsForSelectedSector);

  /** Coverage of the selected sector, from the seat map's sector summary. */
  protected readonly selectedSectorCovered$ = combineLatest([this.selectedSection$, this.summaries$]).pipe(
    map(([section, sums]) => sums.find((s) => s.section === section)?.covered ?? null),
  );

  /** The selected sector, from the seat map's sector summary. */
  protected readonly selectedSector$ = combineLatest([this.selectedSection$, this.summaries$]).pipe(
    map(([section, sums]) => sums.find((s) => s.section === section) ?? null),
  );

  private readonly matchIdSignal = toSignal(this.matchId$, { initialValue: null });

  /** The visitor's picks for the match on screen: the cart, since picking a seat locks it. */
  protected readonly chosenItems = computed(() =>
    this.cart.items().filter((item) => item.matchId === this.matchIdSignal()),
  );
  protected readonly chosenIds = computed<ReadonlySet<string>>(
    () => new Set(this.chosenItems().map((item) => item.seatId)),
  );
  /** Seats whose lock or release is in flight. */
  protected readonly busyIds = signal<ReadonlySet<string>>(new Set());

  @ViewChild(SeatGridComponent) private grid?: SeatGridComponent;

  private latestSummaries: readonly SectorSummary[] = [];
  private currentMatchId: string | null = null;
  private currentMatch: MatchListItem | null = null;
  private lastSnackbarError: string | null = null;

  ngOnInit(): void {
    this.store.dispatch(MatchesActions.loadMatches());

    // Sync ?matchId=... query param into the store (deep-link friendly).
    this.route.queryParamMap
      .pipe(
        map((params) => params.get('matchId')),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((matchId) => {
        this.store.dispatch(MatchesActions.selectMatch({ matchId }));
        if (matchId) {
          this.store.dispatch(SeatsActions.loadSeatsForMatch({ matchId }));
        }
      });

    this.matchId$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((matchId) => {
        this.currentMatchId = matchId;
      });

    this.selectedMatch$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((match) => {
        this.currentMatch = match ?? null;
      });

    this.summaries$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((s) => (this.latestSummaries = s));

    // Surface lock-flow errors via snackbar.
    this.seatsError$
      .pipe(
        filter((err): err is string => !!err),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((message) => {
        if (message === this.lastSnackbarError) {
          return;
        }
        this.lastSnackbarError = message;
        this.snackBar.open(message, 'Bezárás', { duration: 5000, panelClass: ['kte-snackbar'] });
      });
  }

  protected isSoldOut(match: MatchListItem | null | undefined): boolean {
    if (!match) {
      return false;
    }
    return match.status === 'sold_out' || match.availableSeats <= 0;
  }

  protected onMatchSelected(matchId: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { matchId },
      queryParamsHandling: 'merge',
    });
  }

  protected onSectorSelected(section: string): void {
    // The away section is not for sale through the portal: it cannot be opened.
    if (this.latestSummaries.find((s) => s.section === section)?.isAway) {
      return;
    }
    this.store.dispatch(SeatsActions.setSelectedSector({ section }));
  }

  protected onAccessibilityToggle(): void {
    this.store.dispatch(SeatsActions.toggleAccessibilityFilter());
  }

  /**
   * A tap on a seat picks it (locks it and puts it in the cart) or, on one of the
   * visitor's own seats, puts it back. The summary and the board both follow the cart.
   */
  protected async onSeatToggled(seat: SeatStatus): Promise<void> {
    if (!this.currentMatchId || !this.currentMatch || this.busyIds().has(seat.id)) {
      return;
    }
    if (this.cart.has(seat.id)) {
      await this.onRemoveChosen(seat.id);
      return;
    }
    if (isAway(this.currentMatch) || isCancelled(this.currentMatch) || hasKickedOff(this.currentMatch)) {
      this.snackBar.open('Erre a mérkőzésre már nem vásárolható jegy.', 'Bezárás', { duration: 4000 });
      return;
    }
    if (this.cart.isFull()) {
      this.snackBar.open('Egy kosárba legfeljebb 6 jegy vehető fel.', 'Bezárás', { duration: 4000 });
      return;
    }
    this.markBusy(seat.id, true);
    try {
      const item = await this.cart.add(seat, {
        matchId: this.currentMatch.id,
        homeTeam: this.currentMatch.homeTeam,
        awayTeam: this.currentMatch.awayTeam,
        kickoffAt: this.currentMatch.kickoffAt,
        sectorName: this.latestSummaries.find((s) => s.section === seat.section)?.name,
      });
      // Repaint the seat as held in the seats slice (the board shows it as the visitor's own).
      this.store.dispatch(
        SeatsActions.lockSeatSuccess({
          lock: {
            matchId: item.matchId,
            seatId: item.seatId,
            ownerToken: item.ownerToken,
            ttlSeconds: Math.max(0, Math.round((item.lockExpiresAtMs - Date.now()) / 1000)),
            expiresAt: new Date(item.lockExpiresAtMs).toISOString(),
          },
        }),
      );
    } catch (error) {
      this.snackBar.open(lockErrorMessage(error), 'Bezárás', { duration: 5000 });
      // Someone else was quicker: reload so the seat shows as held rather than free.
      this.store.dispatch(SeatsActions.loadSeatsForMatch({ matchId: this.currentMatchId }));
    } finally {
      this.markBusy(seat.id, false);
    }
  }

  protected async onRemoveChosen(seatId: string): Promise<void> {
    this.markBusy(seatId, true);
    try {
      await this.cart.remove(seatId);
      this.store.dispatch(SeatsActions.unlockSeatSuccess({ seatId }));
    } finally {
      this.markBusy(seatId, false);
    }
  }

  /** The finder has locked seats and put them in the cart: repaint them and show where they are. */
  protected onBestSeatsPlaced(placed: BestSeatsPlaced): void {
    for (const seat of placed.seats) {
      this.store.dispatch(
        SeatsActions.lockSeatSuccess({
          lock: {
            matchId: placed.response.matchId,
            seatId: seat.id,
            ownerToken: placed.response.ownerToken,
            ttlSeconds: placed.response.ttlSeconds,
            expiresAt: placed.response.expiresAt,
          },
        }),
      );
    }
    this.grid?.reveal(placed.seats.map((s) => s.id));
  }

  protected onProceed(): void {
    void this.router.navigate(['/cart']);
  }

  private markBusy(seatId: string, busy: boolean): void {
    const next = new Set(this.busyIds());
    if (busy) next.add(seatId);
    else next.delete(seatId);
    this.busyIds.set(next);
  }
}
