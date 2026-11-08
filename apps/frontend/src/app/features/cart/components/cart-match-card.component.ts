import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { CartItem } from '../../../shared/models/cart.model';
import { CountdownPipe } from '../../../shared/pipes/countdown.pipe';
import { HufCurrencyPipe } from '../../../shared/pipes/huf-currency.pipe';
import { MatchGroup, seatDescription, seatShortLabel, ticketTypeLabel } from '../logic/cart-logic';

/**
 * One card per match: a tinted strip with the fixture, the kickoff and the
 * live hold pill, then one row per seat. Under one minute left the strip
 * switches to the amber palette.
 */
@Component({
  selector: 'kte-cart-match-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatIconModule, CountdownPipe, HufCurrencyPipe],
  template: `
    <article class="match" [class.match--urgent]="group.urgent" data-testid="cart-match">
      <header class="match__strip">
        <div class="match__head">
          <h2 class="match__fixture">{{ group.homeTeam }} – {{ group.awayTeam }}</h2>
          <p class="match__when">
            {{ group.kickoffAt | date: "yyyy. MMMM d., EEEE · HH:mm" : '' : 'hu-HU' }}@if (venue) {
              · {{ venue }}
            }
          </p>
        </div>
        <span class="match__hold" role="timer" aria-label="A foglalásból hátralévő idő">
          <mat-icon class="match__clock" aria-hidden="true">schedule</mat-icon>
          <span class="kte-cart__countdown">{{ group.remainingMs | countdown }}</span>
        </span>
      </header>

      <ul class="seats">
        @for (item of group.items; track item.seatId) {
          <li class="seat" data-testid="cart-seat">
            <span class="seat__chip" aria-hidden="true">{{ short(item) }}</span>
            <div class="seat__text">
              <span class="seat__desc">{{ description(item) }}</span>
              <span class="seat__type">{{ type(item) }}</span>
            </div>
            <span class="seat__price">{{ item.price | hufCurrency }}</span>
            <button
              type="button"
              class="seat__remove"
              (click)="remove.emit(item.seatId)"
              [attr.aria-label]="'Eltávolítás a kosárból: ' + description(item)"
            >
              <span class="seat__remove-dot"><mat-icon>close</mat-icon></span>
            </button>
          </li>
        }
      </ul>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .match {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        overflow: hidden;
      }

      .match__strip {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px 16px;
        flex-wrap: wrap;
        padding: 16px 20px;
        background: var(--brand-tint);
        border-bottom: 1px solid var(--brand-tint);
        color: var(--brand-deep);
      }

      .match--urgent .match__strip {
        background: var(--amber-bg);
        border-bottom-color: var(--amber-edge);
        color: var(--amber-ink);
      }

      .match__head {
        min-width: 0;
      }

      .match__fixture {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 17px;
        line-height: 1.3;
        letter-spacing: -0.01em;
        color: inherit;
        overflow-wrap: anywhere;
      }

      .match__when {
        margin: 2px 0 0;
        font-size: 13px;
        line-height: 1.5;
        color: inherit;
      }

      .match__hold {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 999px;
        background: var(--surface);
        color: var(--ink);
        font-size: 14px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .match__clock {
        width: 18px;
        height: 18px;
        font-size: 18px;
        color: var(--brand-mid);
      }

      .match--urgent .match__clock {
        color: var(--amber-icon);
      }

      .seats {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .seat {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 12px 14px 20px;
        border-top: 1px solid var(--border-light);
      }

      .seat:first-child {
        border-top: 0;
      }

      .seat__chip {
        flex: 0 0 38px;
        width: 38px;
        height: 38px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        background: var(--brand-deep);
        color: #fff;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 13px;
      }

      .seat__text {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .seat__desc {
        font-size: 15px;
        font-weight: 500;
        color: var(--ink);
      }

      .seat__type {
        font-size: 13px;
        color: var(--muted);
      }

      .seat__price {
        flex: 0 0 auto;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 16px;
        white-space: nowrap;
      }

      /* 34px visual circle inside a 44px tap target */
      .seat__remove {
        flex: 0 0 44px;
        width: 44px;
        height: 44px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        background: transparent;
        cursor: pointer;
        color: var(--muted);
      }

      .seat__remove-dot {
        width: 34px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--border);
        border-radius: 50%;
      }

      .seat__remove:hover .seat__remove-dot {
        border-color: var(--seat-sold);
        color: var(--seat-sold);
      }

      .seat__remove:focus-visible {
        outline: 2px solid var(--brand-deep);
        outline-offset: -2px;
        border-radius: 50%;
      }

      .seat__remove mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }

      @media (max-width: 599px) {
        .match__strip {
          padding: 14px 16px;
        }
        .seat {
          padding: 12px 4px 12px 16px;
          gap: 10px;
        }
      }
    `,
  ],
})
export class CartMatchCardComponent {
  @Input({ required: true }) group!: MatchGroup;
  /** From GET /matches/:id; shown once loaded. */
  @Input() venue: string | null = null;
  @Output() readonly remove = new EventEmitter<string>();

  protected short(item: CartItem): string {
    return seatShortLabel(item);
  }
  protected description(item: CartItem): string {
    return seatDescription(item);
  }
  protected type(item: CartItem): string {
    return ticketTypeLabel(item.category);
  }
}
