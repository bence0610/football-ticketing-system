import { NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { LoyaltyTier } from '../../../core/models/loyalty.models';
import { HufCurrencyPipe } from '../../pipes/huf-currency.pipe';

export interface TierDiscount {
  readonly tier: LoyaltyTier;
  readonly label: string;
  readonly percent: number;
  /** Forints deducted. */
  readonly amount: number;
  /** The discount applies to at most this many tickets per match; null when unknown. */
  readonly limit?: number | null;
}

/**
 * The loyalty discount row of the cart and checkout summaries: star, tier
 * name and percentage, and the amount taken off. It takes the tier's own
 * identity from the global `data-tier` styles, so it is gold only for Arany.
 */
@Component({
  selector: 'kte-tier-discount-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIf, MatIconModule, HufCurrencyPipe],
  template: `
    <div class="row" [attr.data-tier]="discount.tier" data-testid="summary-discount">
      <span class="row__label">
        <mat-icon inline aria-hidden="true">star</mat-icon>
        {{ discount.label }} kedvezmény · {{ discount.percent }}%
      </span>
      <strong>−{{ discount.amount | hufCurrency }}</strong>
    </div>
    <p class="limit" *ngIf="discount.limit" data-testid="discount-limit">
      A kedvezmény meccsenként legfeljebb {{ discount.limit }} jegyre jár (a már megvett jegyeket is
      beleszámolva), a többi jegy teljes áron megy.
    </p>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .row {
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

      .limit {
        margin: 6px 2px 0;
        font-size: 12.5px;
        color: var(--muted);
      }

      .row__label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      mat-icon {
        color: var(--tier-star);
      }

      strong {
        white-space: nowrap;
        font-family: var(--font-display);
      }
    `,
  ],
})
export class TierDiscountRowComponent {
  @Input({ required: true }) discount!: TierDiscount;
}
