import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import {
  TICKET_STATUS_COLORS,
  TICKET_STATUS_LABELS,
  TicketResponse,
} from '../../../core/models/ticket.models';
import { TicketQrDialogComponent } from './ticket-qr-dialog.component';

@Component({
  selector: 'kte-ticket-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DatePipe, MatCardModule, MatButtonModule, MatIconModule],
  template: `
    @if (ticket) {
      <mat-card class="ticket-card">
        <div class="status" [style.background]="statusColor">{{ statusLabel }}</div>
        <mat-card-header>
          <mat-card-title>{{ ticket.match.homeTeam }} - {{ ticket.match.awayTeam }}</mat-card-title>
          <mat-card-subtitle>{{ ticket.match.kickoffAt | date: "EEEE, MMMM d, y 'klipp' HH:mm" : '' : 'hu-HU' }}</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <div class="row"><span class="label">Helyszín</span><span>{{ ticket.match.venue }}</span></div>
          <div class="row"><span class="label">Ülés</span><span>{{ ticket.seat.section }} szektor / {{ ticket.seat.row }}. sor / {{ ticket.seat.number }}. szék</span></div>
          <div class="row"><span class="label">Ár</span><span>{{ ticket.pricePaid }} {{ ticket.currency }}</span></div>
        </mat-card-content>
        <mat-card-actions>
          <button
            mat-flat-button
            color="primary"
            [disabled]="ticket.status !== 'paid'"
            (click)="showQr()"
          >
            <mat-icon>qr_code_2</mat-icon>
            QR mutatása
          </button>
        </mat-card-actions>
      </mat-card>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .ticket-card {
        background: #1a1a1a;
        color: #f5f5f5;
        border: 1px solid #2e2e2e;
        position: relative;
        overflow: hidden;
      }
      .status {
        position: absolute;
        top: 12px;
        right: 12px;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
        color: #0f0f0f;
      }
      .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #2e2e2e; font-size: 14px; }
      .row:last-child { border-bottom: none; }
      .label { color: #aaaaaa; }
      mat-card-actions { padding: 0 16px 16px; }
    `,
  ],
})
export class TicketCardComponent {
  @Input({ required: true }) ticket!: TicketResponse;

  private readonly dialog = inject(MatDialog);

  protected get statusLabel(): string {
    return TICKET_STATUS_LABELS[this.ticket.status];
  }

  protected get statusColor(): string {
    return TICKET_STATUS_COLORS[this.ticket.status];
  }

  showQr(): void {
    this.dialog.open(TicketQrDialogComponent, {
      width: '380px',
      panelClass: 'kte-qr-panel',
      data: {
        ticketId: this.ticket.id,
        matchTitle: `${this.ticket.match.homeTeam} - ${this.ticket.match.awayTeam}`,
        seatLabel: `${this.ticket.seat.section} / ${this.ticket.seat.row}. sor / ${this.ticket.seat.number}.`,
      },
    });
  }
}
