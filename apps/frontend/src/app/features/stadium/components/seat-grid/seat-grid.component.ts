import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SECTOR_COMPASS_LABEL, SeatStatus } from '../../../../shared/models/seat.model';

interface SeatRow {
  readonly row: string;
  readonly seats: readonly SeatStatus[];
}

@Component({
  selector: 'kte-seat-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgFor, NgIf, NgClass, MatIconModule, MatTooltipModule],
  template: `
    <section class="kte-seat-grid" *ngIf="section; else noSelection">
      <header class="kte-seat-grid__header">
        <h3>
          {{ section }} – {{ compassLabel(section) }}
        </h3>
        <p>Kattints egy szabad székre a foglaláshoz.</p>
      </header>

      <div class="kte-seat-grid__pitch-marker" aria-hidden="true">
        <span>← Pálya irány</span>
      </div>

      <div class="kte-seat-grid__rows">
        <div *ngFor="let row of rows(); trackBy: trackByRow" class="kte-seat-grid__row">
          <span class="kte-seat-grid__row-label">{{ row.row }}. sor</span>
          <div class="kte-seat-grid__row-seats">
            <button
              type="button"
              *ngFor="let seat of row.seats; trackBy: trackBySeat"
              class="kte-seat"
              [ngClass]="seatClasses(seat)"
              [matTooltip]="tooltip(seat)"
              [disabled]="!isClickable(seat)"
              (click)="onSeatClick(seat)"
              [attr.aria-label]="ariaLabel(seat)"
              [attr.aria-pressed]="selectedSeat?.id === seat.id"
            >
              <mat-icon *ngIf="seat.isAccessible" class="kte-seat__icon">accessible</mat-icon>
              <span class="kte-seat__number">{{ seat.number }}</span>
            </button>
          </div>
        </div>
      </div>

      <p *ngIf="rows().length === 0" class="kte-seat-grid__empty">
        Ebben a szektorban a szűrési feltételeknek megfelelően nincs szék.
      </p>
    </section>

    <ng-template #noSelection>
      <div class="kte-seat-grid__placeholder">
        <mat-icon>touch_app</mat-icon>
        <p>Válassz szektort a térképen az ülésrend megnyitásához.</p>
      </div>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-seat-grid {
        background: #ffffff;
        border-radius: var(--kte-radius-lg);
        padding: 24px;
        box-shadow: var(--kte-shadow-sm);
      }

      .kte-seat-grid__header {
        margin-bottom: 16px;
      }

      .kte-seat-grid__header h3 {
        margin: 0;
        font-family: 'Barlow Condensed', 'Inter', sans-serif;
        font-size: 24px;
        font-weight: 700;
        color: var(--kte-color-primary);
      }

      .kte-seat-grid__header p {
        margin: 4px 0 0;
        color: #6b7280;
        font-size: 13px;
      }

      .kte-seat-grid__pitch-marker {
        text-align: center;
        margin-bottom: 12px;
        padding: 6px;
        background: rgba(29, 131, 72, 0.12);
        color: #15803d;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        border-radius: var(--kte-radius-md);
      }

      .kte-seat-grid__rows {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .kte-seat-grid__row {
        display: grid;
        grid-template-columns: 80px 1fr;
        gap: 12px;
        align-items: center;
      }

      .kte-seat-grid__row-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--kte-color-primary);
        text-align: right;
      }

      .kte-seat-grid__row-seats {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(28px, 1fr));
        gap: 4px;
      }

      .kte-seat {
        position: relative;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: 1px solid transparent;
        background: var(--seat-bg, #cbd5e1);
        color: var(--seat-fg, #1f2937);
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }

      .kte-seat:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(10, 61, 98, 0.18);
      }

      .kte-seat:disabled {
        cursor: not-allowed;
        opacity: 0.85;
      }

      .kte-seat--available {
        --seat-bg: #34d399;
        --seat-fg: #064e3b;
      }

      .kte-seat--locked {
        --seat-bg: #fb923c;
        --seat-fg: #7c2d12;
      }

      .kte-seat--sold {
        --seat-bg: #9ca3af;
        --seat-fg: #1f2937;
      }

      .kte-seat--season_pass {
        --seat-bg: #7e22ce;
        --seat-fg: #ffffff;
        background-image: repeating-linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.18) 0,
          rgba(255, 255, 255, 0.18) 3px,
          transparent 3px,
          transparent 6px
        );
      }
      .kte-seat--season-pass-taken {
        /* Alternate class name kept for visual parity with existing CSS naming. */
      }

      .kte-seat--disabled {
        --seat-bg: #ffffff;
        --seat-fg: #9ca3af;
        border-color: var(--kte-color-border);
      }

      .kte-seat--selected {
        outline: 3px solid var(--kte-color-accent);
        outline-offset: 2px;
        transform: translateY(-2px);
      }

      .kte-seat--accessible {
        background-image:
          linear-gradient(45deg, transparent 45%, rgba(10, 61, 98, 0.4) 45%, rgba(10, 61, 98, 0.4) 55%, transparent 55%);
      }

      .kte-seat__icon {
        position: absolute;
        top: -4px;
        right: -4px;
        font-size: 12px;
        width: 12px;
        height: 12px;
        background: var(--kte-color-primary);
        color: #ffffff;
        border-radius: 50%;
      }

      .kte-seat__number {
        line-height: 1;
      }

      .kte-seat-grid__empty {
        margin: 16px 0 0;
        text-align: center;
        color: #6b7280;
      }

      .kte-seat-grid__placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 48px 24px;
        background: #ffffff;
        border-radius: var(--kte-radius-lg);
        box-shadow: var(--kte-shadow-sm);
        color: #6b7280;
        text-align: center;

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
export class SeatGridComponent implements OnChanges {
  @Input() seats: readonly SeatStatus[] = [];
  @Input() section: string | null = null;
  @Input() selectedSeat: SeatStatus | null = null;
  @Output() seatSelected = new EventEmitter<SeatStatus>();

  protected readonly rows = signal<readonly SeatRow[]>([]);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['seats'] || changes['section']) {
      this.rows.set(this.buildRows(this.seats));
    }
  }

  private buildRows(seats: readonly SeatStatus[]): readonly SeatRow[] {
    const map = new Map<string, SeatStatus[]>();
    for (const seat of seats) {
      let row = map.get(seat.row);
      if (!row) {
        row = [];
        map.set(seat.row, row);
      }
      row.push(seat);
    }
    return Array.from(map.entries())
      .map(([row, rowSeats]) => ({
        row,
        seats: [...rowSeats].sort((a, b) => a.number - b.number),
      }))
      .sort((a, b) => Number(a.row) - Number(b.row));
  }

  protected seatClasses(seat: SeatStatus): Record<string, boolean> {
    return {
      [`kte-seat--${seat.status}`]: true,
      'kte-seat--season-pass-taken': seat.status === 'season_pass',
      'kte-seat--accessible': seat.isAccessible,
      'kte-seat--selected': this.selectedSeat?.id === seat.id,
    };
  }

  protected isClickable(seat: SeatStatus): boolean {
    return seat.status === 'available';
  }

  protected onSeatClick(seat: SeatStatus): void {
    if (!this.isClickable(seat)) {
      return;
    }
    this.seatSelected.emit(seat);
  }

  protected tooltip(seat: SeatStatus): string {
    const labels: Record<SeatStatus['status'], string> = {
      available: 'Szabad',
      locked: 'Foglalás folyamatban',
      sold: 'Elkelt',
      season_pass: 'Bérletes hely',
      disabled: 'Inaktív',
    };
    return `${seat.row}. sor / ${seat.number}. szék — ${labels[seat.status]}`;
  }

  protected ariaLabel(seat: SeatStatus): string {
    return `${seat.section} szektor, ${seat.row}. sor, ${seat.number}. szék, állapot: ${seat.status}`;
  }

  protected trackByRow(_index: number, row: SeatRow): string {
    return row.row;
  }

  protected trackBySeat(_index: number, seat: SeatStatus): string {
    return seat.id;
  }

  protected compassLabel(section: string): string {
    return SECTOR_COMPASS_LABEL[section] ?? section;
  }
}
