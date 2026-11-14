import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { HufCurrencyPipe } from '../../../shared/pipes/huf-currency.pipe';

/** What the summary says about the held seat. */
export interface HeldSeatView {
  readonly sectorName: string;
  readonly row: string;
  readonly number: number;
}

/**
 * The seat a season-pass buyer holds: where it is, the season price, how long it is
 * kept for them, and the way on to the payment.
 *
 * Wide screens: a card beside the board that sticks while the page scrolls. Phones:
 * a bar glued to the bottom edge, so the button is always in reach over the board.
 */
@Component({
  selector: 'kte-season-hold-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatIconModule, HufCurrencyPipe],
  template: `
    <aside class="hold" aria-label="A választott hely" data-testid="hold-summary">
      @if (seat; as s) {
        <p class="hold__seat" data-testid="hold-seat">{{ s.sectorName }} · {{ s.row }}. sor · {{ s.number }}. hely</p>
        <p class="hold__price">{{ price | hufCurrency }} <span>/ szezon</span></p>
        @if (live) {
          <p class="hold__muted" data-testid="hold-countdown">
            Neked tartjuk még <strong>{{ countdown }}</strong>
          </p>
        }
      } @else if (expired) {
        <p class="hold__note" role="status" data-testid="hold-expired">
          Lejárt az idő, a helyet már nem tartjuk neked. Válassz újra helyet.
        </p>
      } @else {
        <p class="hold__muted">Még nem választottál helyet.</p>
      }
      @if (message) {
        <p class="hold__note" role="alert" data-testid="seat-message">{{ message }}</p>
      }
      @if (!signedIn) {
        <a mat-flat-button color="primary" routerLink="/login" class="hold__go">
          <mat-icon>login</mat-icon>
          Bejelentkezés a helyválasztáshoz
        </a>
      } @else {
        <button
          mat-flat-button
          color="primary"
          type="button"
          class="hold__go"
          data-testid="hold-continue"
          [disabled]="!live"
          (click)="proceed.emit()"
        >
          Tovább a fizetéshez
        </button>
      }
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
        position: sticky;
        top: 88px;
      }
      .hold {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 20px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        box-shadow: var(--kte-shadow-sm);
      }
      .hold p {
        margin: 0;
      }
      .hold__seat {
        font-weight: 700;
        font-size: 17px;
        overflow-wrap: anywhere;
      }
      .hold__price {
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 24px;
        color: var(--brand-deep);
      }
      .hold__price span {
        font-size: 14px;
        font-weight: 500;
        color: var(--muted);
      }
      .hold__muted {
        color: var(--muted);
        font-size: 14px;
      }
      .hold__muted strong {
        color: var(--ink);
        font-variant-numeric: tabular-nums;
      }
      .hold__note {
        padding: 10px 12px;
        border-radius: var(--kte-radius);
        background: var(--kte-warn-bg);
        color: var(--kte-warn);
        font-size: 14px;
      }
      .hold__go {
        width: 100%;
        min-height: 48px;
      }
      @media (max-width: 899px) {
        :host {
          top: auto;
          bottom: 0;
          z-index: 20;
          margin: 12px -16px 0;
        }
        .hold {
          gap: 6px;
          padding: 12px 16px;
          border-radius: var(--radius-card) var(--radius-card) 0 0;
          box-shadow: 0 -4px 16px rgba(20, 18, 26, 0.18);
        }
        .hold__price {
          font-size: 20px;
        }
      }
    `,
  ],
})
export class SeasonHoldSummaryComponent {
  /** The held seat; null = none. */
  @Input() seat: HeldSeatView | null = null;
  /** The tier's season price. */
  @Input() price = 0;
  /** The hold has not run out: paying is possible. */
  @Input() live = false;
  /** "9:41". */
  @Input() countdown = '';
  /** The last hold ran out. */
  @Input() expired = false;
  /** Why the last tap did not hold a seat, in plain words. */
  @Input() message: string | null = null;
  @Input() signedIn = false;
  @Output() readonly proceed = new EventEmitter<void>();
}
