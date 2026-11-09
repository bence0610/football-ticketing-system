import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Inject,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Observable } from 'rxjs';
import { TicketsService } from '../../../core/services/tickets.service';
import { TicketQrResponse } from '../../../core/models/ticket.models';
import { ScreenWakeLock } from '../../../shared/utils/screen-wake-lock';

export interface TicketQrDialogData {
  ticketId?: string;
  matchTitle: string;
  seatLabel: string;
  /** The person entering with this QR (pass holder), shown above the code. */
  holderName?: string;
  /** When provided, the dialog uses this observable instead of fetching via ticketId. */
  qrLoader$?: Observable<TicketQrResponse>;
}

/** Side of the rendered QR image, in CSS pixels. */
export const QR_SIZE_PX = 212;

/**
 * Short, human-readable reference for a ticket: the last 8 hex digits of its
 * id, grouped `XXXX-XXXX`. Returns undefined when there is no usable id.
 */
export function shortTicketCode(ticketId: string | undefined | null): string | undefined {
  const hex = (ticketId ?? '').replace(/[^0-9a-f]/gi, '');
  if (hex.length < 8) return undefined;
  const tail = hex.slice(-8).toUpperCase();
  return `${tail.slice(0, 4)}-${tail.slice(4)}`;
}

@Component({
  selector: 'kte-ticket-qr-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatProgressSpinnerModule],
  template: `
    <div class="qr-dialog">
      <h2 mat-dialog-title class="title">{{ data.matchTitle }}</h2>
      <mat-dialog-content class="body">
        @if (data.holderName) {
          <p class="holder" data-testid="qr-holder">{{ data.holderName }}</p>
        }
        <p class="seat">{{ data.seatLabel }}</p>
        @if (loading()) {
          <div class="loader"><mat-spinner diameter="48" /></div>
        } @else if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        } @else if (dataUrl()) {
          <div class="qr-frame">
            <img
              class="qr"
              data-testid="qr-image"
              [attr.data-token]="token()"
              [src]="dataUrl()"
              [width]="size"
              [height]="size"
              alt="Belépő QR-kód"
            />
          </div>
          @if (code(); as c) {
            <p class="code" data-testid="qr-code">{{ c }}</p>
            <p class="code-note">
              Ha a kamera nem olvassa be a QR-kódot, ez a jegy azonosítója.
            </p>
          }
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" (click)="dialogRef.close()">Bezárás</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      /* Pure white, full-contrast surface: the camera needs the brightest
         possible field around the code. */
      .qr-dialog {
        background: #ffffff;
        color: #000000;
        color-scheme: light;
      }
      .title {
        font-family: var(--font-display);
        font-weight: 700;
        color: #000000;
      }
      .body {
        text-align: center;
      }
      .holder {
        font-size: 1.1em;
        font-weight: 600;
        margin: 0 0 2px;
      }
      .seat {
        color: #333333;
        margin: 0 0 16px;
      }
      .qr-frame {
        display: inline-block;
        background: #ffffff;
        padding: 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius-block);
      }
      .qr {
        display: block;
        background: #ffffff;
        image-rendering: pixelated;
      }
      .code {
        margin: 16px 0 4px;
        font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
        font-size: 22px;
        font-weight: 700;
        letter-spacing: 0.12em;
        user-select: all;
      }
      .code-note {
        margin: 0;
        font-size: 13px;
        color: #333333;
      }
      .error {
        color: var(--error-ink);
      }
      .loader {
        display: flex;
        justify-content: center;
        padding: 32px 0;
      }
    `,
  ],
})
export class TicketQrDialogComponent {
  protected readonly size = QR_SIZE_PX;
  protected readonly loading = signal<boolean>(true);
  protected readonly error = signal<string | null>(null);
  protected readonly dataUrl = signal<string | null>(null);
  protected readonly code = signal<string | undefined>(undefined);
  /** Full signed token: never shown, kept on the image for the gate test flow. */
  protected readonly token = signal<string | null>(null);

  private readonly ticketsService = inject(TicketsService);
  private readonly document = inject(DOCUMENT);

  constructor(
    public readonly dialogRef: MatDialogRef<TicketQrDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public readonly data: TicketQrDialogData,
    destroyRef: DestroyRef,
  ) {
    // A dim phone in a dark stadium does not scan: keep the screen on. Browsers
    // expose no brightness control, hence the plain white surface instead.
    const wakeLock = new ScreenWakeLock(this.document);
    wakeLock.acquire();
    destroyRef.onDestroy(() => wakeLock.release());

    const loader$ = data.qrLoader$ ?? this.ticketsService.getQr(data.ticketId!);
    loader$.subscribe({
      next: (response) => {
        this.dataUrl.set(response.dataUrl);
        this.token.set(response.token);
        this.code.set(shortTicketCode(response.ticketId ?? data.ticketId));
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
}
