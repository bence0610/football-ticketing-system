import { ChangeDetectionStrategy, Component, Inject, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Observable } from 'rxjs';
import { TicketsService } from '../../../core/services/tickets.service';
import { TicketQrResponse } from '../../../core/models/ticket.models';

export interface TicketQrDialogData {
  ticketId?: string;
  matchTitle: string;
  seatLabel: string;
  /** The person entering with this QR (pass holder), shown above the code. */
  holderName?: string;
  /** When provided, the dialog uses this observable instead of fetching via ticketId. */
  qrLoader$?: Observable<TicketQrResponse>;
}

@Component({
  selector: 'kte-ticket-qr-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="qr-dialog">
      <h2 mat-dialog-title>{{ data.matchTitle }}</h2>
      <mat-dialog-content>
        @if (data.holderName) {
          <p class="holder" data-testid="qr-holder">{{ data.holderName }}</p>
        }
        <p class="seat">{{ data.seatLabel }}</p>
        @if (loading()) {
          <div class="loader">
            <mat-spinner diameter="48"></mat-spinner>
          </div>
        } @else if (error()) {
          <p class="error">{{ error() }}</p>
        } @else if (dataUrl()) {
          <img class="qr" [src]="dataUrl()" alt="QR kód" />
          <p class="hint">Mutasd be a beléptetésnél</p>

          <div class="token-section">
            <p class="token-label">Token (beléptető oldal teszteléséhez)</p>
            <div class="token-row">
              <span class="token-text" [title]="token()!">{{ token() }}</span>
              <button
                mat-icon-button
                class="copy-btn"
                [attr.aria-label]="'Token másolása'"
                (click)="copyToken()"
              >
                <mat-icon>content_copy</mat-icon>
              </button>
            </div>
          </div>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button (click)="dialogRef.close()">Bezárás</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .qr-dialog {
        color: var(--kte-ink);
      }
      .qr {
        display: block;
        margin: 16px auto;
        width: 280px;
        height: 280px;
        background: var(--kte-surface);
        border: 1px solid var(--kte-border);
        border-radius: var(--kte-radius);
        padding: 12px;
      }
      .holder {
        font-size: 1.2em;
        font-weight: 600;
        margin: 0 0 4px;
      }
      .seat {
        color: var(--kte-muted);
        margin: 0 0 12px;
      }
      .hint {
        color: var(--kte-muted);
        font-size: 13px;
        text-align: center;
      }
      .error {
        color: var(--kte-danger);
      }
      .loader {
        display: flex;
        justify-content: center;
        padding: 32px 0;
      }
      .token-section {
        margin-top: 16px;
        border-top: 1px solid var(--kte-line);
        padding-top: 12px;
      }
      .token-label {
        color: var(--kte-muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin: 0 0 6px;
      }
      .token-row {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--kte-page);
        border-radius: 6px;
        padding: 6px 8px;
      }
      .token-text {
        flex: 1;
        font-family: monospace;
        font-size: 11px;
        color: var(--kte-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        user-select: all;
      }
      .copy-btn {
        flex-shrink: 0;
        width: 32px;
        height: 32px;
        line-height: 32px;
        color: var(--kte-muted);
      }
      .copy-btn mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        line-height: 16px;
      }
    `,
  ],
})
export class TicketQrDialogComponent {
  protected readonly loading = signal<boolean>(true);
  protected readonly error = signal<string | null>(null);
  protected readonly dataUrl = signal<string | null>(null);
  protected readonly token = signal<string | null>(null);

  private readonly ticketsService = inject(TicketsService);
  private readonly snackBar = inject(MatSnackBar);

  constructor(
    public readonly dialogRef: MatDialogRef<TicketQrDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public readonly data: TicketQrDialogData,
  ) {
    const loader$ = data.qrLoader$ ?? this.ticketsService.getQr(data.ticketId!);
    loader$.subscribe({
      next: (response) => {
        this.dataUrl.set(response.dataUrl);
        this.token.set(response.token);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        if ((err as { status?: number })?.status === 409) {
          this.dialogRef.close({ loanConflict: true });
          return;
        }
        this.error.set('A QR kód betöltése sikertelen. Próbáld újra később.');
        this.loading.set(false);
      },
    });
  }

  copyToken(): void {
    const t = this.token();
    if (!t) return;
    navigator.clipboard.writeText(t).then(
      () => this.snackBar.open('Token másolva a vágólapra', undefined, { duration: 2000 }),
      () => this.snackBar.open('Másolás sikertelen – jelöld ki és másold kézzel', undefined, { duration: 3000 }),
    );
  }
}
