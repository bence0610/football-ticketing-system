import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Inject,
  Input,
  Output,
} from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA } from '@angular/material/bottom-sheet';
import { LockSeatResponse, SeatStatus } from '../../../../shared/models/seat.model';
import { SeatDetailPanelComponent } from '../seat-detail-panel/seat-detail-panel.component';

export interface SeatDetailBottomSheetData {
  readonly seat: SeatStatus | null;
  readonly covered: boolean | null;
  readonly activeLock: LockSeatResponse | null;
  readonly lockExpiresAtMs: number | null;
  readonly locking: boolean;
}

@Component({
  selector: 'kte-seat-detail-bottom-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SeatDetailPanelComponent],
  template: `
    <kte-seat-detail-panel
      [seat]="seat"
      [covered]="covered"
      [activeLock]="activeLock"
      [lockExpiresAtMs]="lockExpiresAtMs"
      [locking]="locking"
      (lock)="lock.emit($event)"
      (release)="release.emit()"
      (closed)="closed.emit()"
    ></kte-seat-detail-panel>
  `,
  styles: [
    `
      :host {
        display: block;
        background: transparent;
      }
    `,
  ],
})
export class SeatDetailBottomSheetComponent {
  @Input() seat: SeatStatus | null = null;
  @Input() covered: boolean | null = null;
  @Input() activeLock: LockSeatResponse | null = null;
  @Input() lockExpiresAtMs: number | null = null;
  @Input() locking = false;

  @Output() lock = new EventEmitter<SeatStatus>();
  @Output() release = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  constructor(@Inject(MAT_BOTTOM_SHEET_DATA) data: SeatDetailBottomSheetData) {
    this.seat = data.seat;
    this.covered = data.covered;
    this.activeLock = data.activeLock;
    this.lockExpiresAtMs = data.lockExpiresAtMs;
    this.locking = data.locking;
  }
}
