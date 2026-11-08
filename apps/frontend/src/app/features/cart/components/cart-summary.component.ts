import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { NgIf } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { LoyaltyTier } from '../../../core/models/loyalty.models';
import { CountdownPipe } from '../../../shared/pipes/countdown.pipe';
import { HufCurrencyPipe } from '../../../shared/pipes/huf-currency.pipe';

export interface CartDiscount {
  readonly tier: LoyaltyTier;
  readonly label: string;
  readonly percent: number;
  /** Forints deducted. */
  readonly amount: number;
}

/**
 * Sticky summary card: ticket count and subtotal, the loyalty discount row
 * (when one applies), the amount to pay, the checkout button, a note on the
 * shortest hold and the loyalty points this purchase earns.
 *
 * The discount row takes the tier's own identity (global `data-tier` styles),
 * so it is gold only for the Arany tier.
 */
@Component({
  selector: 'kte-cart-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIf, MatButtonModule, MatIconModule, CountdownPipe, HufCurrencyPipe],
  template: `
    <aside class="summary" aria-label="Összesítő">
      <dl class="summary__rows">
        <div class="summary__row">
          <dt>Jegyek</dt>
          <dd data-testid="summary-count">{{ count }} db</dd>
        </div>
        <div class="summary__row">
          <dt>Részösszeg</dt>
          <dd data-testid="summary-subtotal">{{ subtotal | hufCurrency }}</dd>
        </div>
      </dl>

      <div class="summary__discount" *ngIf="discount as d" [attr.data-tier]="d.tier" data-testid="summary-discount">
        <span class="summary__discount-label">
          <mat-icon inline aria-hidden="true">star</mat-icon>
          {{ d.label }} kedvezmény · {{ d.percent }}%
        </span>
        <strong>−{{ d.amount | hufCurrency }}</strong>
      </div>

      <div class="summary__total">
        <span>Fizetendő</span>
        <strong data-testid="summary-total">{{ total | hufCurrency }}</strong>
      </div>

      <button
        mat-flat-button
        color="primary"
        type="button"
        class="summary__checkout"
        [disabled]="count === 0"
        (click)="checkout.emit()"
      >
        Tovább a fizetéshez
      </button>

      <p class="summary__hold" *ngIf="shortestMs !== null" data-testid="summary-hold">
        <mat-icon inline aria-hidden="true">schedule</mat-icon>
        <span>
          A legrövidebb foglalás <strong>{{ shortestMs | countdown }}</strong> múlva lejár. Ha lejár,
          csak az a szék esik ki, a többi a kosárban marad.
        </span>
      </p>

      <p class="summary__points" *ngIf="points !== null && points > 0" data-testid="summary-points">
        <mat-icon inline aria-hidden="true">check_circle</mat-icon>
        <span>Ezzel a vásárlással <strong>{{ points }} hűségpontot</strong> gyűjtesz.</span>
      </p>
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .summary {
        position: sticky;
        top: calc(var(--header-h) + 16px);
        padding: 24px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .summary__rows {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .summary__row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 15px;
        color: var(--muted);
      }

      .summary__row dd {
        margin: 0;
        color: var(--ink);
        font-weight: 500;
      }

      .summary__discount {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border-radius: var(--radius-block);
        border: 1px solid var(--tier-pill-border);
        background: var(--tier-pill-bg);
        color: var(--tier-pill-fg);
        font-size: 14px;
        font-weight: 600;
      }

      .summary__discount-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .summary__discount mat-icon {
        color: var(--tier-star);
      }

      .summary__discount strong {
        white-space: nowrap;
        font-family: var(--font-display);
      }

      .summary__total {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        padding-top: 16px;
        border-top: 1px solid var(--border-light);
        font-size: 16px;
        font-weight: 600;
      }

      .summary__total strong {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 28px;
        line-height: 1.1;
      }

      .summary__checkout.mat-mdc-button-base {
        --mdc-filled-button-container-height: 54px;
        height: 54px;
        min-height: 54px;
        width: 100%;
        font-size: 16px;
      }

      .summary__hold {
        margin: 0;
        display: flex;
        gap: 8px;
        align-items: flex-start;
        padding: 12px;
        border-radius: var(--radius-block);
        border: 1px solid var(--amber-edge);
        background: var(--amber-bg);
        color: var(--amber-ink);
        font-size: 14px;
        line-height: 1.5;
      }

      .summary__hold mat-icon {
        flex: 0 0 auto;
        margin-top: 3px;
        color: var(--amber-icon);
      }

      .summary__hold strong {
        font-variant-numeric: tabular-nums;
      }

      .summary__points {
        margin: 0;
        display: flex;
        gap: 8px;
        align-items: flex-start;
        font-size: 14px;
        line-height: 1.5;
        color: var(--chip-paid);
      }

      .summary__points mat-icon {
        flex: 0 0 auto;
        margin-top: 3px;
      }

      @media (max-width: 899px) {
        .summary {
          position: static;
          padding: 20px 16px;
        }
      }
    `,
  ],
})
export class CartSummaryComponent {
  @Input() count = 0;
  @Input() subtotal = 0;
  @Input() discount: CartDiscount | null = null;
  @Input() total = 0;
  /** Shortest remaining hold in ms, or null with nothing in the cart. */
  @Input() shortestMs: number | null = null;
  /** Loyalty points this purchase earns; null when unknown (guest). */
  @Input() points: number | null = null;
  @Output() readonly checkout = new EventEmitter<void>();
}
