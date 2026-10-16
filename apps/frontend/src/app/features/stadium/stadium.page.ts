import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { AsyncPipe, NgIf } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { combineLatest, distinctUntilChanged, filter, map } from 'rxjs';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { MatBottomSheet, MatBottomSheetModule, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatSidenavModule } from '@angular/material/sidenav';
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
  selectActiveLock,
  selectLockExpiresAtMs,
  selectLocking,
  selectSeats,
  selectSeatsError,
  selectSeatsForSelectedSector,
  selectSeatsLoading,
  selectSectorSummary,
  selectSelectedSeat,
  selectSelectedSection,
} from '../../state/seats';
import { LockSeatResponse, SeatStatus } from '../../shared/models/seat.model';
import { CartFacade } from '../../core/cart/cart.facade';
import { MatchListItem } from '../../shared/models/match.model';
import { MatchSelectorComponent } from './components/match-selector/match-selector.component';
import { StadiumMapComponent } from './components/stadium-map/stadium-map.component';
import { SeatGridComponent } from './components/seat-grid/seat-grid.component';
import { SeatDetailPanelComponent } from './components/seat-detail-panel/seat-detail-panel.component';
import { SectorSummaryComponent } from './components/sector-summary/sector-summary.component';
import { AccessibilityToggleComponent } from './components/accessibility-toggle/accessibility-toggle.component';
import { ColorLegendComponent } from './components/color-legend/color-legend.component';
import {
  SeatDetailBottomSheetComponent,
  SeatDetailBottomSheetData,
} from './components/seat-detail-bottom-sheet/seat-detail-bottom-sheet.component';
import { WaitlistJoinButtonComponent } from './components/waitlist-join-button/waitlist-join-button.component';

@Component({
  selector: 'kte-stadium-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncPipe,
    NgIf,
    MatSidenavModule,
    MatBottomSheetModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatchSelectorComponent,
    StadiumMapComponent,
    SeatGridComponent,
    SeatDetailPanelComponent,
    SectorSummaryComponent,
    AccessibilityToggleComponent,
    ColorLegendComponent,
    WaitlistJoinButtonComponent,
  ],
  template: `
    <div class="kte-stadium">
      <header class="kte-stadium__header">
        <div>
          <h1>Stadion ülésrend</h1>
          <p>Széktói Stadion · Foglalj le helyeket valós idejű ülésrenden.</p>
        </div>
        <kte-match-selector
          [matches]="(matches$ | async) ?? []"
          [matchId]="(matchId$ | async) ?? null"
          (matchIdChange)="onMatchSelected($event)"
        ></kte-match-selector>
      </header>

      <ng-container *ngIf="(matchId$ | async); else noMatch">
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
          <span *ngIf="(seatsLoading$ | async)" class="kte-stadium__loading">
            <mat-progress-spinner diameter="20" mode="indeterminate"></mat-progress-spinner>
            Ülésrend betöltése…
          </span>
        </div>

        <mat-sidenav-container class="kte-stadium__container" autosize>
          <mat-sidenav
            #sidenav
            mode="side"
            position="end"
            [opened]="!isMobile() && (selectedSeat$ | async) !== null"
            [disableClose]="true"
            class="kte-stadium__sidenav"
          >
            <kte-seat-detail-panel
              [seat]="(selectedSeat$ | async) ?? null"
              [activeLock]="(activeLock$ | async) ?? null"
              [lockExpiresAtMs]="(lockExpiresAtMs$ | async) ?? null"
              [locking]="(locking$ | async) ?? false"
              (lock)="onLockSeat($event)"
              (release)="onReleaseLock()"
              (closed)="onClosePanel()"
            ></kte-seat-detail-panel>
          </mat-sidenav>

          <mat-sidenav-content class="kte-stadium__content">
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

            <kte-seat-grid
              [seats]="(seatsForSector$ | async) ?? []"
              [section]="(selectedSection$ | async) ?? null"
              [selectedSeat]="(selectedSeat$ | async) ?? null"
              (seatSelected)="onSeatSelected($event)"
            ></kte-seat-grid>
          </mat-sidenav-content>
        </mat-sidenav-container>
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

      .kte-stadium__container {
        background: transparent;
        min-height: 600px;
      }

      .kte-stadium__sidenav {
        width: 360px;
        max-width: 90vw;
        background: transparent;
        border: none;
        padding: 16px;
      }

      .kte-stadium__content {
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-6);
        padding-right: var(--kte-spacing-4);
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

        .kte-stadium__sidenav {
          display: none;
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
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cart = inject(CartFacade);

  protected readonly matches$ = this.store.select(selectAllMatches);
  protected readonly matchId$ = this.store.select(selectSelectedMatchId);
  protected readonly selectedMatch$ = this.store.select(selectSelectedMatch);
  protected readonly seats$ = this.store.select(selectSeats);
  protected readonly summaries$ = this.store.select(selectSectorSummary);
  protected readonly seatsLoading$ = this.store.select(selectSeatsLoading);
  protected readonly seatsError$ = this.store.select(selectSeatsError);
  protected readonly selectedSection$ = this.store.select(selectSelectedSection);
  protected readonly selectedSeat$ = this.store.select(selectSelectedSeat);
  protected readonly accessibleOnly$ = this.store.select(selectAccessibleOnly);
  protected readonly activeLock$ = this.store.select(selectActiveLock);
  protected readonly lockExpiresAtMs$ = this.store.select(selectLockExpiresAtMs);
  protected readonly locking$ = this.store.select(selectLocking);
  protected readonly seatsForSector$ = this.store.select(selectSeatsForSelectedSector);

  protected readonly isMobile = signal<boolean>(false);

  private currentMatchId: string | null = null;
  private currentMatch: MatchListItem | null = null;
  private currentLock: LockSeatResponse | null = null;
  private mobileSheetRef: MatBottomSheetRef<SeatDetailBottomSheetComponent> | null = null;
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

    this.activeLock$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((lock) => {
        this.currentLock = lock;
      });

    this.selectedMatch$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((match) => {
        this.currentMatch = match ?? null;
      });

    // Mobile / desktop detection — drives bottom-sheet vs side-nav.
    this.breakpointObserver
      .observe([Breakpoints.Handset, '(max-width: 768px)'])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        this.isMobile.set(state.matches);
      });

    // Mobile bottom-sheet for the selected seat.
    combineLatest([
      this.selectedSeat$,
      this.activeLock$,
      this.lockExpiresAtMs$,
      this.locking$,
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([seat, activeLock, lockExpiresAtMs, locking]) => {
        if (this.isMobile() && seat) {
          this.openMobileSheet(seat, activeLock, lockExpiresAtMs, locking ?? false);
        } else if (!seat && this.mobileSheetRef) {
          this.mobileSheetRef.dismiss();
          this.mobileSheetRef = null;
        }
      });

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
    this.store.dispatch(SeatsActions.setSelectedSector({ section }));
  }

  protected onSeatSelected(seat: SeatStatus): void {
    this.store.dispatch(SeatsActions.setSelectedSeat({ seat }));
  }

  protected onAccessibilityToggle(): void {
    this.store.dispatch(SeatsActions.toggleAccessibilityFilter());
  }

  protected async onLockSeat(seat: SeatStatus): Promise<void> {
    if (!this.currentMatchId || !this.currentMatch) {
      return;
    }
    if (this.cart.isFull()) {
      this.snackBar.open(
        'Egy kosárba legfeljebb 6 jegy vehető fel.',
        'Bezárás',
        { duration: 4000 },
      );
      return;
    }
    if (this.cart.has(seat.id)) {
      this.snackBar.open('Ez a szék már a kosaradban van.', 'Bezárás', { duration: 3000 });
      return;
    }
    try {
      const item = await this.cart.add(seat, {
        matchId: this.currentMatch.id,
        homeTeam: this.currentMatch.homeTeam,
        awayTeam: this.currentMatch.awayTeam,
        kickoffAt: this.currentMatch.kickoffAt,
      });
      // Reflect the new lock in the seats slice so the UI repaints the seat as locked.
      this.store.dispatch(
        SeatsActions.lockSeatSuccess({
          lock: {
            matchId: item.matchId,
            seatId: item.seatId,
            ownerToken: item.ownerToken,
            ttlSeconds: Math.max(
              0,
              Math.round((item.lockExpiresAtMs - Date.now()) / 1000),
            ),
            expiresAt: new Date(item.lockExpiresAtMs).toISOString(),
          },
        }),
      );
      this.snackBar.open('A szék hozzáadva a kosárhoz.', 'Kosár', {
        duration: 4000,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'A szék zárolása sikertelen.';
      this.snackBar.open(message, 'Bezárás', { duration: 5000 });
    }
  }

  protected async onReleaseLock(): Promise<void> {
    if (!this.currentLock) {
      return;
    }
    const seatId = this.currentLock.seatId;
    if (this.cart.has(seatId)) {
      await this.cart.remove(seatId);
      this.store.dispatch(SeatsActions.unlockSeatSuccess({ seatId }));
      return;
    }
    this.store.dispatch(
      SeatsActions.unlockSeat({
        matchId: this.currentLock.matchId,
        seatId,
        ownerToken: this.currentLock.ownerToken,
      }),
    );
  }

  protected onClosePanel(): void {
    this.store.dispatch(SeatsActions.setSelectedSeat({ seat: null }));
  }

  private openMobileSheet(
    seat: SeatStatus,
    activeLock: LockSeatResponse | null,
    lockExpiresAtMs: number | null,
    locking: boolean,
  ): void {
    // If the sheet is already open for the same seat, leave it as-is.
    // The seat-detail-panel ticks its own countdown via timer(0,1000),
    // so we only need to re-create on seat changes.
    if (this.mobileSheetRef && this.mobileSheetRef.instance.seat?.id === seat.id) {
      return;
    }
    if (this.mobileSheetRef) {
      this.mobileSheetRef.dismiss();
      this.mobileSheetRef = null;
    }

    const data: SeatDetailBottomSheetData = { seat, activeLock, lockExpiresAtMs, locking };
    this.mobileSheetRef = this.bottomSheet.open(SeatDetailBottomSheetComponent, {
      data,
      panelClass: 'kte-bottom-sheet',
    });

    const instance = this.mobileSheetRef.instance;
    instance.lock.subscribe((s: SeatStatus) => this.onLockSeat(s));
    instance.release.subscribe(() => this.onReleaseLock());
    instance.closed.subscribe(() => {
      this.mobileSheetRef?.dismiss();
      this.onClosePanel();
    });
    this.mobileSheetRef.afterDismissed().subscribe(() => {
      this.mobileSheetRef = null;
    });
  }
}
