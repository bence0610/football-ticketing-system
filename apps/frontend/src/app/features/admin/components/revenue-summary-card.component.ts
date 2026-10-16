import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { HufCurrencyPipe } from '../../../shared/pipes/huf-currency.pipe';

@Component({
  selector: 'kte-revenue-summary-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, HufCurrencyPipe],
  template: `
    <article class="kte-summary">
      <div class="kte-summary__accent" aria-hidden="true"></div>
      <div class="kte-summary__body">
        <div class="kte-summary__icon" aria-hidden="true">
          <mat-icon>{{ icon }}</mat-icon>
        </div>
        <div class="kte-summary__copy">
          <span class="kte-summary__label">{{ label }}</span>
          <strong class="kte-summary__value">{{ amount | hufCurrency }}</strong>
          @if (subtitle) {
            <span class="kte-summary__subtitle">{{ subtitle }}</span>
          }
        </div>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .kte-summary {
        position: relative;
        background: var(--kte-surface);
        color: var(--kte-ink);
        border: 1px solid var(--kte-border);
        border-radius: var(--kte-radius);
        overflow: hidden;
        min-height: 124px;
        box-shadow: var(--kte-shadow-md);
      }
      .kte-summary__accent {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: var(--kte-brand-mid);
      }
      .kte-summary__body {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 20px 24px 20px 28px;
      }
      .kte-summary__icon {
        background: var(--kte-brand-tint);
        color: var(--kte-brand-deep);
        width: 48px;
        height: 48px;
        border-radius: var(--kte-radius);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .kte-summary__icon mat-icon {
        font-size: 24px;
        width: 24px;
        height: 24px;
      }
      .kte-summary__copy {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .kte-summary__label {
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--kte-muted);
      }
      .kte-summary__value {
        font-size: 26px;
        font-weight: 700;
        font-family: var(--kte-font-display);
      }
      .kte-summary__subtitle {
        font-size: 12px;
        color: var(--kte-faint);
      }
    `,
  ],
})
export class RevenueSummaryCardComponent {
  @Input({ required: true }) label!: string;
  @Input({ required: true }) amount!: number;
  @Input({ required: true }) icon!: string;
  @Input() subtitle?: string;
}
