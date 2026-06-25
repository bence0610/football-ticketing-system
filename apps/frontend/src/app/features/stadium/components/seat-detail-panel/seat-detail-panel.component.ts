import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { timer } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { LockSeatResponse, SeatStatus } from '../../../../shared/models/seat.model';
import { HufCurrencyPipe } from '../../../../shared/pipes/huf-currency.pipe';
import { Pad2Pipe } from '../../../../shared/pipes/time-until.pipe';

@Component({
  selector: 'kte-seat-detail-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgIf,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatChipsModule,
    HufCurrencyPipe,
    Pad2Pipe,
  ],
  template: `
    <aside class="kte-seat-detail" *ngIf="seat; else emptyState">
      <header class="kte-seat-detail__header">
        <span class="kte-seat-detail__chip">{{ seat.section }} szektor</span>
        <h3>{{ seat.row }}. sor / {{ seat.number }}. szék</h3>
        <p class="kte-seat-detail__category">{{ categoryLabel(seat.category) }}</p>
      </header>

      <dl class="kte-seat-detail__list">
        <div>
          <dt>Ár</dt>
          <dd class="kte-seat-detail__price">{{ seat.price | hufCurrency }}</dd>
        </div>
        <div>
          <dt>Akadálymentes</dt>
          <dd>{{ seat.isAccessible ? 'Igen' : 'Nem' }}</dd>
        </div>
        <div>
          <dt>Állapot</dt>
          <dd>{{ statusLabel(seat.status) }}</dd>
        </div>
      </dl>

      <ng-container *ngIf="activeLock && activeLock.seatId === seat.id; else lockCta">
        <div class="kte-seat-detail__lock">
          <header>
            <mat-icon>lock_clock</mat-icon>
            <span>Hely lefoglalva — {{ remaining() | pad2 }}:{{ remainingSeconds() | pad2 }}</span>
          </header>
          <mat-progress-bar
            mode="determinate"
            [value]="remainingPercentage()"
            color="accent"
          ></mat-progress-bar>
          <div class="kte-seat-detail__lock-actions">
            <a mat-flat-button color="primary" routerLink="/cart">
              <mat-icon>shopping_cart</mat-icon>
              Folytatás a kosárba
            </a>
            <button
              mat-stroked-button
              color="warn"
              type="button"
              (click)="release.emit()"
            >
              Foglalás elengedése
            </button>
          </div>
        </div>
      </ng-container>

      <ng-template #lockCta>
        <button
          mat-flat-button
          color="accent"
          class="kte-seat-detail__cta"
          [disabled]="seat.status !== 'available' || locking"
          (click)="lock.emit(seat)"
        >
          <mat-icon>shopping_cart</mat-icon>
          {{ locking ? 'Foglalás...' : 'Kosárba' }}
        </button>
      </ng-template>

      <button
        type="button"
        mat-button
        class="kte-seat-detail__close"
        (click)="closed.emit()"
        aria-label="Bezárás"
      >
        <mat-icon>close</mat-icon>
        Bezárás
      </button>
    </aside>

    <ng-template #emptyState>
      <aside class="kte-seat-detail kte-seat-detail--empty">
        <mat-icon>event_seat</mat-icon>
        <p>Válassz széket az ülésrendből, és itt jelennek meg a részletek.</p>
      </aside>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-seat-detail {
        background: #ffffff;
        border-radius: var(--kte-radius-lg);
        padding: 24px;
        box-shadow: var(--kte-shadow-md);
        display: flex;
        flex-direction: column;
        gap: 18px;
        min-width: 280px;
      }

      .kte-seat-detail__header h3 {
        margin: 4px 0;
        font-family: 'Barlow Condensed', 'Inter', sans-serif;
        font-size: 28px;
        font-weight: 700;
        color: var(--kte-color-primary);
      }

      .kte-seat-detail__chip {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.16em;
        font-weight: 700;
        color: var(--kte-color-accent);
        background: var(--kte-color-primary);
        padding: 4px 10px;
        border-radius: 999px;
        display: inline-block;
      }

      .kte-seat-detail__category {
        margin: 0;
        color: #6b7280;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .kte-seat-detail__list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 0;
      }

      .kte-seat-detail__list > div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding-bottom: 8px;
        border-bottom: 1px dashed var(--kte-color-border);
      }

      .kte-seat-detail__list dt {
        margin: 0;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #6b7280;
      }

      .kte-seat-detail__list dd {
        margin: 0;
        font-weight: 600;
        color: var(--kte-color-text);
      }

      .kte-seat-detail__price {
        font-family: 'Barlow Condensed', 'Inter', sans-serif;
        font-size: 22px;
        color: var(--kte-color-primary);
      }

      .kte-seat-detail__cta {
        height: 48px;
        font-weight: 700;
      }

      .kte-seat-detail__lock {
        background: rgba(255, 201, 5, 0.18);
        border: 1px solid var(--kte-color-accent);
        border-radius: var(--kte-radius-md);
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .kte-seat-detail__lock header {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        color: var(--kte-color-primary);

        mat-icon {
          color: var(--kte-color-primary);
        }
      }

      .kte-seat-detail__lock-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .kte-seat-detail__close {
        align-self: flex-end;
      }

      .kte-seat-detail--empty {
        align-items: center;
        text-align: center;
        color: #6b7280;
        padding: 32px;

        mat-icon {
          font-size: 36px;
          width: 36px;
          height: 36px;
          color: var(--kte-color-primary);
        }
      }
    `,
  ],
})
export class SeatDetailPanelComponent {
  @Input() seat: SeatStatus | null = null;
  @Input() activeLock: LockSeatResponse | null = null;
  @Input() lockExpiresAtMs: number | null = null;
  @Input() locking = false;

  @Output() lock = new EventEmitter<SeatStatus>();
  @Output() release = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  protected readonly now = signal<number>(Date.now());
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    timer(0, 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));
  }

  protected remaining(): number {
    const total = this.totalRemainingSeconds();
    return Math.floor(total / 60);
  }

  protected remainingSeconds(): number {
    return this.totalRemainingSeconds() % 60;
  }

  protected remainingPercentage(): number {
    if (!this.activeLock || !this.lockExpiresAtMs) {
      return 0;
    }
    const total = this.activeLock.ttlSeconds * 1000;
    const remaining = Math.max(0, this.lockExpiresAtMs - this.now());
    return Math.round((remaining / total) * 100);
  }

  private totalRemainingSeconds(): number {
    if (!this.lockExpiresAtMs) {
      return 0;
    }
    return Math.max(0, Math.floor((this.lockExpiresAtMs - this.now()) / 1000));
  }

  protected categoryLabel(category: SeatStatus['category']): string {
    switch (category) {
      case 'standard':
        return 'Standard';
      case 'premium':
        return 'Prémium';
      case 'vip':
        return 'VIP';
      case 'standing':
        return 'Állóhely';
      default:
        return category;
    }
  }

  protected statusLabel(status: SeatStatus['status']): string {
    switch (status) {
      case 'available':
        return 'Szabad';
      case 'locked':
        return 'Foglalva';
      case 'sold':
        return 'Elkelt';
      case 'season_pass':
        return 'Bérletes';
      case 'disabled':
        return 'Inaktív';
      default:
        return status;
    }
  }
}
