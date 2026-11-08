import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

export const CHECKOUT_STEPS: readonly string[] = ['Helyválasztás', 'Kosár', 'Fizetés', 'Jegy'];

/**
 * Purchase step indicator on a full-width white band. `current` is the
 * zero-based index of the step the user is on: earlier steps show a green
 * check, the current one a filled number, later ones an outlined number.
 * On narrow screens only the current step keeps its label (the others stay
 * available to screen readers).
 */
@Component({
  selector: 'kte-checkout-steps',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <nav class="steps" aria-label="Vásárlás lépései">
      <div class="steps__bar">
      <ol class="steps__list">
        @for (label of steps; track label; let i = $index; let last = $last) {
          <li
            class="steps__item"
            [class.steps__item--done]="i < current"
            [class.steps__item--current]="i === current"
            [class.steps__item--last]="last"
            [attr.aria-current]="i === current ? 'step' : null"
          >
            <span class="steps__dot" aria-hidden="true">
              @if (i < current) {
                <mat-icon>check</mat-icon>
              } @else {
                {{ i + 1 }}
              }
            </span>
            <span class="steps__label">
              {{ label }}@if (i < current) {<span class="steps__sr"> (kész)</span>}
            </span>
            @if (!last) {
              <span class="steps__line" aria-hidden="true"></span>
            }
          </li>
        }
      </ol>
      <div class="steps__end"><ng-content></ng-content></div>
      </div>
    </nav>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .steps {
        background: var(--surface);
        border-bottom: 1px solid var(--border);
      }

      .steps__bar {
        max-width: 1180px;
        margin: 0 auto;
        padding: 16px 32px;
        display: flex;
        align-items: center;
        gap: 12px 32px;
        flex-wrap: wrap;
      }

      .steps__list {
        flex: 1 1 360px;
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        align-items: center;
        gap: 0;
      }

      .steps__end:empty {
        display: none;
      }

      .steps__end {
        flex: 0 0 auto;
      }

      .steps__item {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1 1 auto;
        min-width: 0;
      }

      .steps__item--last {
        flex: 0 0 auto;
      }

      .steps__dot {
        flex: 0 0 24px;
        width: 24px;
        height: 24px;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        border: 1.5px solid var(--faint);
        color: var(--muted);
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
      }

      .steps__dot mat-icon {
        width: 16px;
        height: 16px;
        font-size: 16px;
      }

      .steps__label {
        font-size: 14px;
        font-weight: 500;
        color: var(--muted);
        white-space: nowrap;
      }

      .steps__line {
        flex: 1 1 24px;
        min-width: 16px;
        height: 1px;
        margin: 0 12px;
        background: var(--border);
      }

      .steps__item--done .steps__dot {
        background: var(--chip-paid-bg);
        border-color: var(--chip-paid-bg);
        color: var(--chip-paid);
      }

      .steps__item--done .steps__label {
        color: var(--ink);
      }

      .steps__item--done .steps__line {
        background: var(--chip-paid);
      }

      .steps__item--current .steps__dot {
        background: var(--brand-deep);
        border-color: var(--brand-deep);
        color: #fff;
      }

      .steps__item--current .steps__label {
        color: var(--ink);
        font-weight: 600;
      }

      .steps__sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }

      @media (max-width: 599px) {
        .steps__bar {
          padding: 12px 16px;
        }
        .steps__end {
          flex: 1 1 100%;
        }
        .steps__line {
          margin: 0 8px;
        }
        /* only the current step keeps a visible label */
        .steps__item:not(.steps__item--current) .steps__label {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
        .steps__item:not(.steps__item--current) {
          gap: 0;
        }
      }
    `,
  ],
})
export class CheckoutStepsComponent {
  @Input() current = 0;
  /** Step labels, in order. The cart shows four; checkout shows three. */
  @Input() steps: readonly string[] = CHECKOUT_STEPS;
}
