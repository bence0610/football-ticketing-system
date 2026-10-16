import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { TIER_LABELS, LoyaltyTier } from '../../../core/models/loyalty.models';

export interface DiscountBreakdown {
  originalAmount: number;
  discountAmount: number;
  discountPercent: number;
  amount: number;
  currency: string;
  tier?: LoyaltyTier;
}

@Component({
  selector: 'kte-discount-breakdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  template: `
    @if (breakdown) {
      <div class="breakdown" [class.with-discount]="breakdown.discountPercent > 0">
        <div class="row">
          <span class="label">Listaár</span>
          <span class="value">{{ breakdown.originalAmount | number: '1.0-0' }} {{ breakdown.currency }}</span>
        </div>
        @if (breakdown.discountPercent > 0) {
          <div class="row discount">
            <span class="label">
              <mat-icon inline>star</mat-icon>
              Hűségkedvezmény
              @if (breakdown.tier) { ({{ tierLabel(breakdown.tier) }} - {{ breakdown.discountPercent }}%) }
            </span>
            <span class="value">-{{ breakdown.discountAmount | number: '1.0-0' }} {{ breakdown.currency }}</span>
          </div>
        }
        <div class="row total">
          <span class="label">Fizetendő</span>
          <span class="value">{{ breakdown.amount | number: '1.0-0' }} {{ breakdown.currency }}</span>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .breakdown { background: var(--kte-surface); border: 1px solid var(--kte-border); border-radius: var(--kte-radius); padding: 18px; color: var(--kte-ink); }
      .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
      .row.discount { color: var(--kte-success); }
      .row.total { border-top: 1px solid var(--kte-line); margin-top: 6px; padding-top: 12px; font-size: 18px; font-weight: 700; color: var(--kte-brand-deep); font-family: var(--kte-font-display); }
      .label { display: flex; align-items: center; gap: 6px; }
      .value { font-variant-numeric: tabular-nums; }
    `,
  ],
})
export class DiscountBreakdownComponent {
  @Input({ required: true }) breakdown!: DiscountBreakdown;

  protected tierLabel(tier: LoyaltyTier): string {
    return TIER_LABELS[tier];
  }
}
