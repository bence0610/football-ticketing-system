import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CartItem } from '../../../shared/models/cart.model';
import { seatDescription } from '../../cart/logic/cart-logic';

/**
 * A seat's hold ran out before payment. The seat is not dropped silently: this
 * alert names it, says the payment was not started and the card not charged,
 * and offers the two real options - pick a new seat, or pay only for the seats
 * that are still held.
 */
@Component({
  selector: 'kte-expired-hold-alert',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgFor, NgIf, RouterLink, MatButtonModule, MatIconModule],
  template: `
    <section class="alert" role="alert" data-testid="expired-alert">
      <mat-icon class="alert__icon" aria-hidden="true">error_outline</mat-icon>
      <div class="alert__body">
        <h2 class="alert__title">
          {{ lapsed.length === 1 ? 'Lejárt a foglalás' : 'Lejárt ' + lapsed.length + ' foglalás' }}
        </h2>
        <ul class="alert__seats">
          <li *ngFor="let seat of lapsed"><s>{{ describe(seat) }}</s></li>
        </ul>
        <p class="alert__text">
          A fizetés nem indult el, a kártyádat nem terheltük.
          <ng-container *ngIf="remaining === 0"> Már egy fenntartott helyed sincs.</ng-container>
        </p>
        <div class="alert__actions">
          <button
            *ngIf="remaining > 0"
            mat-flat-button
            color="primary"
            type="button"
            class="alert__remaining"
            [disabled]="busy"
            (click)="payRemaining.emit()"
          >
            Fizetés a megmaradt {{ remaining }} helyre
          </button>
          <a
            mat-stroked-button
            color="primary"
            class="alert__choose"
            routerLink="/stadium"
            [queryParams]="{ matchId: matchId }"
          >
            Másik szék választása
          </a>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .alert {
        display: flex;
        gap: 14px;
        padding: 18px 20px;
        background: var(--error-bg);
        border: 1.5px solid var(--seat-sold);
        border-radius: var(--radius-card);
        color: var(--error-ink);
      }

      .alert__icon {
        flex: 0 0 auto;
        width: 28px;
        height: 28px;
        font-size: 28px;
        color: var(--seat-sold);
      }

      .alert__body {
        min-width: 0;
      }

      .alert__title {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 18px;
        color: var(--error-ink);
      }

      .alert__seats {
        list-style: none;
        margin: 6px 0 0;
        padding: 0;
        font-weight: 600;
      }

      .alert__text {
        margin: 8px 0 0;
        color: var(--ink);
        font-size: 15px;
      }

      .alert__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 14px;
      }

      @media (max-width: 599px) {
        .alert {
          padding: 16px;
        }
        .alert__actions > * {
          flex: 1 1 100%;
        }
      }
    `,
  ],
})
export class ExpiredHoldAlertComponent {
  @Input({ required: true }) lapsed!: readonly CartItem[];
  /** How many seats are still held. */
  @Input() remaining = 0;
  @Input() matchId = '';
  @Input() busy = false;
  @Output() readonly payRemaining = new EventEmitter<void>();

  protected describe(item: CartItem): string {
    return seatDescription(item);
  }
}
