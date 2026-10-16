import { ChangeDetectionStrategy, Component, computed, inject, Input, signal } from '@angular/core';
import { DatePipe, NgIf } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { timer } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatchListItem } from '../../../../shared/models/match.model';
import { Pad2Pipe, TimeUntilPipe } from '../../../../shared/pipes/time-until.pipe';

@Component({
  selector: 'kte-match-countdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIf, DatePipe, MatCardModule, MatIconModule, TimeUntilPipe, Pad2Pipe],
  template: `
    <mat-card class="kte-countdown" *ngIf="match; else placeholder">
      <header class="kte-countdown__header">
        <span class="kte-countdown__label">Következő mérkőzés</span>
        <h2 class="kte-countdown__matchup">
          <span class="kte-countdown__home">{{ match.homeTeam }}</span>
          <span class="kte-countdown__vs">vs</span>
          <span class="kte-countdown__away">{{ match.awayTeam }}</span>
        </h2>
        <p class="kte-countdown__meta">
          <mat-icon inline>calendar_today</mat-icon>
          {{ match.kickoffAt | date: "yyyy. MMMM d., EEEE 'kezdés' HH:mm":'':'hu-HU' }}
        </p>
        <p class="kte-countdown__meta">
          <mat-icon inline>place</mat-icon>
          {{ match.venue }}
        </p>
      </header>

      <ng-container *ngIf="match.kickoffAt | timeUntil: now() as parts">
        <div class="kte-countdown__grid" *ngIf="!parts.isPast; else liveBlock">
          <div class="kte-countdown__cell">
            <span class="kte-countdown__value">{{ parts.days | pad2 }}</span>
            <span class="kte-countdown__unit">nap</span>
          </div>
          <div class="kte-countdown__cell">
            <span class="kte-countdown__value">{{ parts.hours | pad2 }}</span>
            <span class="kte-countdown__unit">óra</span>
          </div>
          <div class="kte-countdown__cell">
            <span class="kte-countdown__value">{{ parts.minutes | pad2 }}</span>
            <span class="kte-countdown__unit">perc</span>
          </div>
          <div class="kte-countdown__cell">
            <span class="kte-countdown__value">{{ parts.seconds | pad2 }}</span>
            <span class="kte-countdown__unit">mp</span>
          </div>
        </div>
        <ng-template #liveBlock>
          <div class="kte-countdown__live">
            <mat-icon>radio_button_checked</mat-icon>
            <span>A mérkőzés folyamatban van vagy lejátszott.</span>
          </div>
        </ng-template>
      </ng-container>
    </mat-card>

    <ng-template #placeholder>
      <mat-card class="kte-countdown kte-countdown--empty">
        <p>Jelenleg nincs meghirdetett közelgő mérkőzés.</p>
      </mat-card>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-countdown {
        /* Gradient stop uses a one-off tint of --kte-page; left as a literal
           since no token exists for an intermediate surface shade. */
        background: linear-gradient(135deg, var(--kte-surface) 0%, #F5F7FB 100%);
        border-radius: var(--kte-radius-lg);
        padding: 32px;
        box-shadow: var(--kte-shadow-md);
        border-left: 6px solid var(--kte-brand-mid);
      }

      .kte-countdown__header {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 24px;
      }

      .kte-countdown__label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: var(--kte-brand-deep);
        font-weight: 700;
      }

      .kte-countdown__matchup {
        margin: 0;
        font-family: var(--kte-font-display);
        font-size: 32px;
        font-weight: 700;
        letter-spacing: -0.01em;
        color: var(--kte-ink);
        display: flex;
        align-items: baseline;
        gap: 12px;
        flex-wrap: wrap;
      }

      .kte-countdown__home {
        color: var(--kte-brand-deep);
      }

      .kte-countdown__vs {
        font-size: 18px;
        font-weight: 600;
        color: var(--kte-muted);
      }

      .kte-countdown__meta {
        margin: 0;
        font-size: 14px;
        color: var(--kte-muted);
        display: flex;
        align-items: center;
        gap: 8px;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--kte-brand-deep);
        }
      }

      .kte-countdown__grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
      }

      .kte-countdown__cell {
        display: flex;
        flex-direction: column;
        align-items: center;
        background: var(--kte-brand-deep);
        color: var(--kte-surface);
        border-radius: var(--kte-radius);
        padding: 16px 12px;
        box-shadow: var(--kte-shadow-sm);
      }

      .kte-countdown__value {
        font-family: var(--kte-font-display);
        font-size: 36px;
        font-weight: 700;
        line-height: 1;
        color: var(--kte-brand-tint);
        font-variant-numeric: tabular-nums;
      }

      .kte-countdown__unit {
        margin-top: 4px;
        font-size: 11px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        opacity: 0.8;
      }

      .kte-countdown__live {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px;
        border-radius: var(--kte-radius);
        background: var(--kte-brand-tint);
        color: var(--kte-brand-deep);
        font-weight: 600;
      }

      .kte-countdown--empty {
        padding: 32px;
        color: var(--kte-muted);
      }
    `,
  ],
})
export class MatchCountdownComponent {
  @Input() match: MatchListItem | null = null;

  protected readonly now = signal<number>(Date.now());
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    timer(0, 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));
  }

  protected readonly hasMatch = computed(() => this.match !== null);
}
