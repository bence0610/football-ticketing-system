import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import {
  TICKET_STATUS_COLORS,
  TICKET_STATUS_LABELS,
  TicketResponse,
} from '../../../core/models/ticket.models';
import { HufCurrencyPipe } from '../../../shared/pipes/huf-currency.pipe';
import { TicketQrDialogComponent } from './ticket-qr-dialog.component';

@Component({
  selector: 'kte-ticket-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule, HufCurrencyPipe],
  template: `
    @if (ticket) {
      <mat-card class="ticket-card" appearance="outlined">
        <header class="ticket-card__band">
          <span class="ticket-card__title">{{ ticket.match.homeTeam }} – {{ ticket.match.awayTeam }}</span>
          <span class="ticket-card__subtitle">
            {{ ticket.match.kickoffAt | date: "yyyy. MMM d. HH:mm" : '' : 'hu-HU' }}
            · {{ ticket.match.venue }}
          </span>
          <span class="status-badge" [style.background]="statusColor">{{ statusLabel }}</span>
        </header>
        <mat-card-content>
          <div class="row">
            <span class="label">Ülés</span>
            <span>{{ ticket.seat.section }} / {{ ticket.seat.row }}. sor / {{ ticket.seat.number }}. szék</span>
          </div>
          <div class="row">
            <span class="label">Kategória</span>
            <span>{{ ticket.seat.category }}</span>
          </div>
          <div class="row">
            <span class="label">Ár</span>
            <span>{{ ticket.pricePaid | hufCurrency }}</span>
          </div>
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
      :host {
        display: block;
      }
      .ticket-card {
        position: relative;
        overflow: hidden;
        background: var(--kte-surface);
        color: var(--kte-ink);
        border: 1px solid var(--kte-border);
      }
      .ticket-card__band {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 16px 20px;
        background: var(--kte-brand-deep);
        color: var(--kte-surface);
        position: relative;
      }
      .ticket-card__title {
        font-family: var(--kte-font-display);
        font-weight: 700;
        font-size: 18px;
        padding-right: 120px;
      }
      .ticket-card__subtitle {
        font-size: 13px;
        opacity: 0.88;
        padding-right: 120px;
      }
      .status-badge {
        position: absolute;
        top: 12px;
        right: 12px;
        padding: 4px 10px;
        border-radius: var(--kte-radius);
        font-size: 12px;
        font-weight: 600;
        color: var(--kte-ink);
      }
      .row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        border-bottom: 1px solid var(--kte-line);
        font-size: 14px;
        color: var(--kte-ink);
      }
      .row:last-child {
        border-bottom: none;
      }
      .label {
        color: var(--kte-muted);
        font-weight: 500;
      }
      mat-card-actions {
        padding: 0 16px 16px;
      }
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
        matchTitle: `${this.ticket.match.homeTeam} – ${this.ticket.match.awayTeam}`,
        seatLabel: `${this.ticket.seat.section} / ${this.ticket.seat.row}. sor / ${this.ticket.seat.number}.`,
      },
    });
  }
}
