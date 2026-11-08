import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { CartItem } from '../../../shared/models/cart.model';
import { seatDescription } from '../logic/cart-logic';

/**
 * An expired hold does not vanish: it stays as its own card that says which
 * seat ran out, that nothing was charged, and offers to re-book or discard it.
 */
@Component({
  selector: 'kte-cart-expired-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
  template: `
    <article class="expired" data-testid="cart-expired" role="group" [attr.aria-label]="'Lejárt foglalás: ' + description">
      <h2 class="expired__title">
        A foglalás lejárt:
        <s class="expired__seat">{{ description }}</s>
      </h2>
      <p class="expired__match">{{ item.homeTeam }} – {{ item.awayTeam }}</p>
      <p class="expired__note">Nem történt terhelés, a szék újra szabad.</p>
      <div class="expired__actions">
        <button
          mat-flat-button
          color="primary"
          type="button"
          class="expired__relock"
          [disabled]="busy"
          (click)="relock.emit(item.seatId)"
        >
          Újra lefoglalom
        </button>
        <button mat-stroked-button color="primary" type="button" class="expired__dismiss" (click)="dismiss.emit(item.seatId)">
          Elvetem
        </button>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .expired {
        padding: 20px 24px;
        background: var(--error-bg);
        border: 1px solid var(--border);
        border-left: 3px solid var(--seat-sold);
        border-radius: var(--radius-block);
        color: var(--error-ink);
      }

      .expired__title {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 18px;
        line-height: 1.35;
        letter-spacing: -0.01em;
        color: var(--error-ink);
      }

      .expired__seat {
        font-weight: 600;
        text-decoration-thickness: 2px;
      }

      .expired__match {
        margin: 4px 0 0;
        font-size: 14px;
        color: var(--error-ink);
      }

      .expired__note {
        margin: 12px 0 0;
        font-size: 15px;
        color: var(--ink);
      }

      .expired__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 16px;
      }

      @media (max-width: 599px) {
        .expired {
          padding: 16px;
        }
        .expired__actions > * {
          flex: 1 1 100%;
        }
      }
    `,
  ],
})
export class CartExpiredCardComponent {
  @Input({ required: true }) item!: CartItem;
  /** True while a re-book request for this seat is running. */
  @Input() busy = false;
  @Output() readonly relock = new EventEmitter<string>();
  @Output() readonly dismiss = new EventEmitter<string>();

  protected get description(): string {
    return seatDescription(this.item);
  }
}
