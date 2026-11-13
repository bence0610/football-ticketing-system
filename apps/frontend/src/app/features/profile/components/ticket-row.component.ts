import { gateLabel } from '../../../shared/utils/gate';
import { sectorName } from '../../../shared/utils/sector-name';
import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import {
  TICKET_STATUS_LABELS,
  TicketResponse,
  TicketStatus,
} from '../../../core/models/ticket.models';
import { TicketQrDialogComponent } from './ticket-qr-dialog.component';

/** Chip tone per ticket status (maps to the --chip-* design tokens). */
export type ChipTone = 'paid' | 'pending' | 'expired' | 'used';

export const TICKET_STATUS_TONE: Readonly<Record<TicketStatus, ChipTone>> = {
  paid: 'paid',
  pending_payment: 'pending',
  expired: 'expired',
  cancelled: 'used',
  refunded: 'used',
  used: 'used',
};

export function seatText(ticket: TicketResponse): string {
  return `${sectorName(ticket.seat.section, ticket.seat.sectorName)} · ${ticket.seat.row}. sor · ${ticket.seat.number}. szék`;
}

/** Opens the gate QR dialog for a ticket. Shared by the row and the next-match card. */
export function openTicketQr(dialog: MatDialog, ticket: TicketResponse): void {
  dialog.open(TicketQrDialogComponent, {
    width: '380px',
    maxWidth: '94vw',
    panelClass: 'kte-qr-panel',
    data: {
      ticketId: ticket.id,
      matchTitle: `${ticket.match.homeTeam} – ${ticket.match.awayTeam}`,
      seatLabel: seatText(ticket),
    },
  });
}

@Component({
  selector: 'kte-ticket-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatIconModule],
  template: `
    @if (ticket) {
      <article class="row" [class.row--used]="ticket.status === 'used'" data-testid="ticket-row">
        <div class="tile" aria-hidden="true">
          <span class="tile__month">{{ ticket.match.kickoffAt | date: 'MMM' : '' : 'hu-HU' }}</span>
          <span class="tile__day">{{ ticket.match.kickoffAt | date: 'd' : '' : 'hu-HU' }}</span>
        </div>
        <div class="main">
          <h3 class="fixture">{{ ticket.match.homeTeam }} – {{ ticket.match.awayTeam }}</h3>
          <p class="meta">
            {{ seat }} · {{ ticket.match.kickoffAt | date: 'HH:mm' : '' : 'hu-HU' }}
          </p>
          @if (gate; as g) {
            <p class="meta" data-testid="ticket-gate">Belépés: <strong>{{ g }}</strong></p>
          }
          @if (ticket.status === 'used' && ticket.scannedAt) {
            <p class="meta" data-testid="scanned-at">
              Beolvasva: {{ ticket.scannedAt | date: 'yyyy. MMM d. HH:mm' : '' : 'hu-HU' }}
            </p>
          }
          @if (ticket.source === 'loan') {
            <span class="loan-badge" data-testid="borrowed-badge">
              <mat-icon>swap_horiz</mat-icon> Kölcsönkapott belépő – más bérlete
            </span>
          }
        </div>
        <div class="side">
          <span class="chip" [class]="'chip chip--' + tone">{{ statusLabel }}</span>
          @if (ticket.status === 'paid') {
            <button type="button" class="open" (click)="open()">Megnyitás</button>
          }
        </div>
      </article>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .row {
        display: grid;
        grid-template-columns: 44px 1fr auto;
        gap: 14px;
        align-items: center;
        padding: 14px 16px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-block);
      }
      .row--used {
        opacity: 0.62;
      }
      .tile {
        width: 44px;
        height: 48px;
        border-radius: var(--radius-block);
        background: var(--brand-tint);
        color: var(--brand-deep);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        line-height: 1;
      }
      .tile__month {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .tile__day {
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 20px;
        margin-top: 2px;
      }
      .main {
        min-width: 0;
      }
      .fixture {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 16px;
        color: var(--ink);
      }
      .meta {
        margin: 2px 0 0;
        font-size: 13px;
        color: var(--muted);
      }
      .side {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
      }
      .chip {
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
      }
      .chip--paid { color: var(--chip-paid); background: var(--chip-paid-bg); }
      .chip--pending { color: var(--chip-pending); background: var(--chip-pending-bg); }
      .chip--expired { color: var(--chip-expired); background: var(--chip-expired-bg); }
      .chip--used { color: var(--chip-used); background: var(--chip-used-bg); }
      .open {
        min-height: var(--min-target);
        padding: 0 4px;
        border: 0;
        background: none;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: var(--brand-deep);
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      .open:hover { color: var(--brand-mid); }
      .loan-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-top: 6px;
        padding: 2px 10px 2px 6px;
        border: 1px solid var(--seat-pass);
        border-radius: var(--radius-block);
        font-size: 12px;
        font-weight: 600;
        color: var(--seat-pass);
      }
      .loan-badge mat-icon { font-size: 16px; width: 16px; height: 16px; }
      @media (max-width: 480px) {
        .row {
          grid-template-columns: 44px 1fr;
        }
        .side {
          grid-column: 1 / -1;
          flex-direction: row;
          justify-content: space-between;
          align-items: center;
        }
      }
    `,
  ],
})
export class TicketRowComponent {
  @Input({ required: true }) ticket!: TicketResponse;

  private readonly dialog = inject(MatDialog);

  /** "3-as kapu": where this ticket's holder enters; null when the gate is unknown. */
  protected get gate(): string | null {
    return gateLabel(this.ticket.seat.gate);
  }

  protected get seat(): string {
    return seatText(this.ticket);
  }

  protected get statusLabel(): string {
    return TICKET_STATUS_LABELS[this.ticket.status];
  }

  protected get tone(): ChipTone {
    return TICKET_STATUS_TONE[this.ticket.status];
  }

  protected open(): void {
    openTicketQr(this.dialog, this.ticket);
  }
}
