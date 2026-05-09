import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription, firstValueFrom, interval } from 'rxjs';
import { MatchOccupancy } from '../../../shared/models/admin.model';
import { MatchListItem } from '../../../shared/models/match.model';
import { AdminApiService } from '../../../shared/services/admin.api.service';
import { MatchesApiService } from '../../../shared/services/matches.api.service';
import { HeatmapLegendComponent } from './components/heatmap-legend.component';
import { MatchPickerComponent } from './components/match-picker.component';
import { StadiumHeatmapComponent } from './components/stadium-heatmap.component';

const REFRESH_MS = 60_000;

@Component({
  selector: 'kte-admin-heatmap-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatchPickerComponent,
    StadiumHeatmapComponent,
    HeatmapLegendComponent,
  ],
  template: `
    <section class="kte-heatmap-page">
      <header class="kte-heatmap-page__header">
        <kte-heatmap-match-picker
          [matches]="matches()"
          [selectedMatchId]="selectedMatchId()"
          (matchChanged)="onMatchChanged($event)"
        />

        @if (occupancy(); as data) {
          <div class="kte-heatmap-page__summary">
            <div>
              <span class="kte-heatmap-page__label">Foglaltság</span>
              <strong>{{ data.occupancyPercent }}%</strong>
            </div>
            <div>
              <span class="kte-heatmap-page__label">Eladott / Foglalt / Szabad</span>
              <strong>{{ data.totalSold }} / {{ data.totalLocked }} / {{ data.totalAvailable }}</strong>
            </div>
            <div class="kte-heatmap-page__refresh">
              <mat-icon>schedule</mat-icon>
              <span>Frissítve: {{ data.generatedAt | date: 'HH:mm:ss' }}</span>
            </div>
          </div>
        }
      </header>

      @if (loading()) {
        <div class="kte-heatmap-page__loader" role="status" aria-live="polite">
          <mat-spinner diameter="36" />
          <span>Foglaltság betöltése…</span>
        </div>
      } @else {
        @if (error(); as err) {
          <div class="kte-heatmap-page__error" role="alert">
            <mat-icon>error</mat-icon>
            {{ err }}
          </div>
        } @else {
          @if (occupancy(); as data) {
            <kte-stadium-heatmap [sectors]="data.sectors" />
            <kte-heatmap-legend />
          } @else {
            <p class="kte-heatmap-page__empty">Válassz mérkőzést a foglaltsági kép megjelenítéséhez.</p>
          }
        }
      }
    </section>
  `,
  styles: [
    `
      .kte-heatmap-page {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px;
      }
      .kte-heatmap-page__header {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .kte-heatmap-page__summary {
        display: flex;
        gap: 24px;
        flex-wrap: wrap;
        background: #FFFFFF;
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
      }
      .kte-heatmap-page__summary > div {
        display: flex;
        flex-direction: column;
      }
      .kte-heatmap-page__label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(0, 0, 0, 0.55);
      }
      .kte-heatmap-page__summary strong {
        font-size: 18px;
        color: #C94B1E;
      }
      .kte-heatmap-page__refresh {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: rgba(0, 0, 0, 0.5);
        font-size: 13px;
      }
      .kte-heatmap-page__loader {
        display: flex;
        align-items: center;
        gap: 12px;
        justify-content: center;
        padding: 64px 0;
        color: rgba(0, 0, 0, 0.6);
      }
      .kte-heatmap-page__error {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 16px;
        background: rgba(244, 67, 54, 0.08);
        color: #b71c1c;
        border-radius: 8px;
      }
      .kte-heatmap-page__empty {
        padding: 64px;
        text-align: center;
        color: rgba(0, 0, 0, 0.55);
      }
    `,
  ],
})
export class SeatHeatmapPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(AdminApiService);
  private readonly matchesApi = inject(MatchesApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly occupancy = signal<MatchOccupancy | null>(null);
  protected readonly matches = signal<readonly MatchListItem[]>([]);
  protected readonly selectedMatchId = signal<string | null>(null);

  private refreshSub: Subscription | null = null;

  async ngOnInit(): Promise<void> {
    await this.loadMatches();
  }

  ngOnDestroy(): void {
    this.refreshSub?.unsubscribe();
  }

  protected onMatchChanged(matchId: string): void {
    this.selectedMatchId.set(matchId);
    void this.loadOccupancy();
  }

  private async loadMatches(): Promise<void> {
    try {
      const matches = await firstValueFrom(this.matchesApi.list({ limit: 50 }));
      this.matches.set(matches);
      if (matches.length > 0 && !this.selectedMatchId()) {
        this.selectedMatchId.set(matches[0].id);
        await this.loadOccupancy();
      }
    } catch (error) {
      this.error.set(this.normalizeError(error));
    }
  }

  private async loadOccupancy(): Promise<void> {
    const matchId = this.selectedMatchId();
    if (!matchId) {
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await firstValueFrom(this.api.occupancy(matchId));
      this.occupancy.set(data);
      this.startAutoRefresh();
    } catch (error) {
      this.error.set(this.normalizeError(error));
    } finally {
      this.loading.set(false);
    }
  }

  private startAutoRefresh(): void {
    this.refreshSub?.unsubscribe();
    this.refreshSub = interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const matchId = this.selectedMatchId();
        if (!matchId) {
          return;
        }
        this.api.occupancy(matchId).subscribe({
          next: (data) => this.occupancy.set(data),
          error: () => undefined, // keep last known state on transient errors
        });
      });
  }

  private normalizeError(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
      const err = error as { error?: { message?: string }; message?: string };
      if (err.error?.message) {
        return err.error.message;
      }
      if (err.message) {
        return err.message;
      }
    }
    return 'A foglaltsági adatok betöltése sikertelen.';
  }
}
