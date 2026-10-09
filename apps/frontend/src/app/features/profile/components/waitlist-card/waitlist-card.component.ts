import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom, interval } from 'rxjs';
import { WaitlistEntry } from '../../../../shared/models/waitlist.model';
import { WaitlistApiService } from '../../../../shared/services/waitlist.api.service';

const STATUS_LABEL: Readonly<Record<WaitlistEntry['status'], string>> = {
  active: 'Várólistán',
  notified: 'Felszabadult egy hely!',
  converted: 'Megerősítve',
  expired: 'Lejárt',
  cancelled: 'Visszamondva',
};

@Component({
  selector: 'kte-waitlist-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <mat-card appearance="outlined" class="kte-waitlist-card" [class.kte-waitlist-card--notified]="entry.status === 'notified'">
      <mat-card-header>
        <mat-card-title>
          {{ entry.match?.homeTeam }} – {{ entry.match?.awayTeam }}
        </mat-card-title>
        <mat-card-subtitle>
          {{ entry.match?.kickoffAt | date: "yyyy. MMM d. HH:mm" : '' : 'hu-HU' }}
          @if (entry.match?.venue) {
            · {{ entry.match?.venue }}
          }
        </mat-card-subtitle>
      </mat-card-header>

      <mat-card-content>
        <div class="kte-waitlist-card__status">
          <mat-chip [color]="entry.status === 'notified' ? 'accent' : 'primary'" highlighted>
            <mat-icon inline>{{ entry.status === 'notified' ? 'event_available' : 'queue' }}</mat-icon>
            {{ statusLabel }}
          </mat-chip>
          @if (entry.status === 'active') {
            <span class="kte-waitlist-card__position">
              {{ entry.position }}. pozíció · {{ entry.peopleAhead }} ember vár előtted
            </span>
          }
        </div>

        @if (entry.status === 'notified') {
          <div class="kte-waitlist-card__notified">
            <p>
              Felszabadult egy hely - <strong>{{ countdownLabel() }}</strong> alatt
              tudod megerősíteni a vásárlást.
            </p>
            @if (totalSeconds() > 0 && initialSeconds() > 0) {
              <mat-progress-bar
                mode="determinate"
                [value]="progressPercent()"
                color="warn"
              />
            }
            <div class="kte-waitlist-card__notified-actions">
              <button
                mat-flat-button
                color="primary"
                type="button"
                [disabled]="confirming()"
                (click)="confirm()"
              >
                @if (confirming()) {
                  <mat-spinner diameter="18" />
                  Megerősítés…
                } @else {
                  <mat-icon>check_circle</mat-icon>
                  Megerősítés és vásárlás
                }
              </button>
            </div>
          </div>
        }
      </mat-card-content>

      <mat-card-actions align="end">
        <button mat-stroked-button color="warn" type="button" [disabled]="leaving()" (click)="leave()">
          @if (leaving()) {
            <mat-spinner diameter="18" />
          } @else {
            <mat-icon>cancel</mat-icon>
          }
          Lemondás
        </button>
      </mat-card-actions>
    </mat-card>
  `,
  styles: [
    `
      .kte-waitlist-card {
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-2);
      }
      .kte-waitlist-card--notified {
        border: 2px solid #C94B1E;
        box-shadow: 0 4px 18px rgba(201, 75, 30, 0.18);
      }
      .kte-waitlist-card__status {
        display: flex;
        align-items: center;
        gap: var(--kte-spacing-3);
        flex-wrap: wrap;
        margin-bottom: var(--kte-spacing-2);
      }
      .kte-waitlist-card__position {
        color: rgba(0, 0, 0, 0.6);
        font-size: 14px;
      }
      .kte-waitlist-card__notified {
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-2);
        padding-top: var(--kte-spacing-2);
      }
      .kte-waitlist-card__notified p {
        margin: 0;
      }
      .kte-waitlist-card__notified-actions {
        display: flex;
        justify-content: flex-end;
      }
    `,
  ],
})
export class WaitlistCardComponent implements OnInit {
  @Input({ required: true }) entry!: WaitlistEntry;
  @Output() readonly changed = new EventEmitter<void>();

  private readonly api = inject(WaitlistApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly leaving = signal(false);
  protected readonly confirming = signal(false);
  protected readonly nowMs = signal(Date.now());

  protected readonly totalSeconds = computed(() => {
    if (!this.entry.claimExpiresAt) {
      return 0;
    }
    const expiry = new Date(this.entry.claimExpiresAt).getTime();
    return Math.max(0, Math.floor((expiry - this.nowMs()) / 1000));
  });

  protected readonly initialSeconds = computed(() => {
    if (!this.entry.claimExpiresAt || !this.entry.notifiedAt) {
      return 0;
    }
    return Math.max(
      0,
      Math.floor(
        (new Date(this.entry.claimExpiresAt).getTime() -
          new Date(this.entry.notifiedAt).getTime()) /
          1000,
      ),
    );
  });

  protected readonly progressPercent = computed(() => {
    const initial = this.initialSeconds();
    const total = this.totalSeconds();
    if (initial === 0) {
      return 0;
    }
    return Math.round((total / initial) * 100);
  });

  ngOnInit(): void {
    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.nowMs.set(Date.now()));
  }

  protected get statusLabel(): string {
    return STATUS_LABEL[this.entry.status] ?? this.entry.status;
  }

  protected countdownLabel(): string {
    const seconds = this.totalSeconds();
    if (seconds <= 0) {
      return 'lejárt';
    }
    const mm = Math.floor(seconds / 60);
    const ss = seconds % 60;
    return `${mm}:${String(ss).padStart(2, '0')}`;
  }

  protected async leave(): Promise<void> {
    this.leaving.set(true);
    try {
      await firstValueFrom(this.api.leave(this.entry.matchId));
      this.snackBar.open('Lekerültél a várólistáról.', 'Bezárás', { duration: 4000 });
      this.changed.emit();
    } catch {
      this.snackBar.open('A lemondás sikertelen.', 'Bezárás', { duration: 5000 });
    } finally {
      this.leaving.set(false);
    }
  }

  protected async confirm(): Promise<void> {
    if (this.totalSeconds() <= 0) {
      this.snackBar.open(
        'A foglalási lehetőség lejárt. Várj az új értesítésre.',
        'Bezárás',
        { duration: 5000 },
      );
      this.changed.emit();
      return;
    }
    this.confirming.set(true);
    try {
      await firstValueFrom(this.api.claim(this.entry.matchId));
      this.snackBar.open(
        'Megerősítve. Most kiválaszthatod a helyedet a stadiontérképen.',
        'Stadiontérkép',
        { duration: 6000 },
      );
      void this.router.navigate(['/stadium'], {
        queryParams: { matchId: this.entry.matchId },
      });
      this.changed.emit();
    } catch (error) {
      const message =
        (error as { error?: { message?: string } })?.error?.message ??
        'A megerősítés sikertelen.';
      this.snackBar.open(message, 'Bezárás', { duration: 6000 });
      this.changed.emit();
    } finally {
      this.confirming.set(false);
    }
  }
}
