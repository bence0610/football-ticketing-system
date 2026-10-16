import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TicketsService } from '../../core/services/tickets.service';
import { ScanResult, TicketScanResponse } from '../../core/models/ticket.models';

const RESULT_LABELS: Record<ScanResult, string> = {
  ok: 'Belépés engedélyezve',
  already_used: 'A jegy már be lett mutatva',
  invalid: 'Érvénytelen jegy',
  expired: 'A jegy lejárt',
  wrong_match: 'A jegy más mérkőzésre szól',
};

const RESULT_ICONS: Record<ScanResult, string> = {
  ok: 'check_circle',
  already_used: 'block',
  invalid: 'cancel',
  expired: 'schedule',
  wrong_match: 'swap_horiz',
};

function extractTicketId(token: string): string | null {
  try {
    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded);
    const payload = JSON.parse(json) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}

@Component({
  selector: 'kte-gate-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
  ],
  template: `
    <section class="kte-gate-page">
      <mat-card class="kte-gate-card" appearance="outlined">
        @if (loading()) {
          <mat-progress-bar mode="indeterminate" />
        }

        <mat-card-header>
          <mat-card-title>
            <mat-icon>door_front</mat-icon>
            Beléptető
          </mat-card-title>
          <mat-card-subtitle
            >A tokent a szurkoló profiloldalán lévő QR-párbeszédből lehet másolni</mat-card-subtitle
          >
        </mat-card-header>

        <mat-card-content>
          @if (!scanResult()) {
            <mat-form-field appearance="outline" class="kte-gate-token-field">
              <mat-label>QR token</mat-label>
              <textarea
                matInput
                rows="4"
                placeholder="eyJhbGciOi..."
                [(ngModel)]="tokenInput"
                [disabled]="loading()"
                (keydown.enter)="$event.preventDefault(); scan()"
              ></textarea>
              <mat-hint
                >Nyisd meg a jegyet a profilon → QR ikon → Másolás gomb → illeszd be ide</mat-hint
              >
            </mat-form-field>

            @if (parseError()) {
              <p class="kte-gate-error">
                <mat-icon>error_outline</mat-icon>
                {{ parseError() }}
              </p>
            }
          }

          @if (scanResult(); as result) {
            <div
              class="kte-gate-result"
              [class.kte-gate-result--ok]="result.result === 'ok'"
              [class.kte-gate-result--fail]="result.result !== 'ok'"
            >
              <mat-icon class="kte-gate-result__icon">{{ resultIcon(result.result) }}</mat-icon>
              <p class="kte-gate-result__label">{{ resultLabel(result.result) }}</p>

              @if (result.result === 'ok' && result.match && result.seat) {
                <div class="kte-gate-result__details">
                  <p>
                    <strong>{{ result.match.homeTeam }} – {{ result.match.awayTeam }}</strong>
                  </p>
                  <p>{{ result.match.venue }}</p>
                  <p>{{ result.match.kickoffAt | date: 'yyyy. MM. dd. HH:mm' }}</p>
                  <p>
                    Szektor: <strong>{{ result.seat.section }}</strong>
                    &nbsp;Sor: <strong>{{ result.seat.row }}</strong>
                    &nbsp;Szék: <strong>{{ result.seat.number }}</strong>
                  </p>
                </div>
              }

              @if (result.scannedAt) {
                <p class="kte-gate-result__time">
                  {{ result.scannedAt | date: 'HH:mm:ss' }}
                </p>
              }
            </div>
          }
        </mat-card-content>

        <mat-card-actions>
          @if (!scanResult()) {
            <button
              mat-flat-button
              color="primary"
              [disabled]="!tokenInput.trim() || loading()"
              (click)="scan()"
            >
              <mat-icon>qr_code_scanner</mat-icon>
              Ellenőrzés
            </button>
          } @else {
            <button mat-flat-button color="accent" (click)="reset()">
              <mat-icon>refresh</mat-icon>
              Következő jegy
            </button>
          }
        </mat-card-actions>
      </mat-card>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        background: var(--kte-ink);
        min-height: 100%;
        color: #ffffff;
      }

      .kte-gate-page {
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: 2rem 1rem;
        min-height: 60vh;
        background: var(--kte-ink);
        color: #ffffff;
      }

      .kte-gate-card {
        width: 100%;
        max-width: 480px;
        background: var(--kte-ink);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.12);
      }

      .kte-gate-card mat-card-title,
      .kte-gate-card mat-card-subtitle {
        color: #ffffff;
      }

      .kte-gate-card mat-card-title {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .kte-gate-token-field {
        width: 100%;
        margin-top: 0.5rem;
      }

      .kte-gate-error {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        color: var(--kte-danger-bg);
        font-size: 0.875rem;
        margin-top: 0.5rem;
      }

      .kte-gate-result {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 1.5rem 1rem;
        border-radius: var(--kte-radius-sm);
        text-align: center;
        gap: 0.5rem;
      }

      .kte-gate-result--ok {
        background: var(--kte-success-bg);
        color: var(--kte-success);
      }

      .kte-gate-result--fail {
        background: var(--kte-danger-bg);
        color: var(--kte-danger-ink);
      }

      .kte-gate-result__icon {
        font-size: 3rem;
        width: 3rem;
        height: 3rem;
      }

      .kte-gate-result__label {
        font-size: 1.25rem;
        font-weight: 600;
        margin: 0;
      }

      .kte-gate-result__details {
        margin-top: 0.5rem;
        font-size: 0.95rem;
        line-height: 1.6;
      }

      .kte-gate-result__details p {
        margin: 0;
      }

      .kte-gate-result__time {
        font-size: 0.8rem;
        opacity: 0.7;
        margin: 0;
      }

      mat-card-actions {
        display: flex;
        justify-content: flex-end;
        padding: 0.5rem 1rem 1rem;
      }
    `,
  ],
})
export class GatePageComponent {
  private readonly ticketsService = inject(TicketsService);

  tokenInput = '';
  loading = signal(false);
  scanResult = signal<TicketScanResponse | null>(null);
  parseError = signal<string | null>(null);

  resultLabel(result: ScanResult): string {
    return RESULT_LABELS[result] ?? result;
  }

  resultIcon(result: ScanResult): string {
    return RESULT_ICONS[result] ?? 'help';
  }

  scan(): void {
    const token = this.tokenInput.trim();
    if (!token) return;

    const ticketId = extractTicketId(token);
    if (!ticketId) {
      this.parseError.set('A megadott szöveg nem érvényes QR token. Ellenőrizd és próbáld újra.');
      return;
    }

    this.parseError.set(null);
    this.loading.set(true);

    this.ticketsService.scan(ticketId, token).subscribe({
      next: (response) => {
        this.scanResult.set(response);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        const message =
          err.status === 403
            ? 'Nincs jogosultságod a beléptetéshez.'
            : err.error?.message ?? 'Hiba történt a kiszolgálóval való kommunikáció során.';
        this.scanResult.set({ success: false, result: 'invalid', message });
      },
    });
  }

  reset(): void {
    this.tokenInput = '';
    this.scanResult.set(null);
    this.parseError.set(null);
  }
}
