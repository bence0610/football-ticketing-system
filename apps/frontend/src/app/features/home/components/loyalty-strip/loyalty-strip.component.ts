import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { NgIf } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { LoyaltySnapshotResponse, TIER_LABELS } from '../../../../core/models/loyalty.models';
import { withArticle } from '../../../../shared/utils/hungarian-article';
import { loyaltyProgress } from '../../logic/loyalty-progress';

/**
 * White band under the hero for signed-in users: tier pill, points, discount,
 * progress toward the next tier and the points that are left (GET /loyalty/me).
 * At the top tier there is nothing to progress toward, so the bar gives way to
 * an achievement message on a tinted band.
 *
 * Each tier has its own identity (set as --tier-* custom properties on the
 * band, see the styles). Gold appears for the Arany tier only; every other
 * tier uses neutral or brand colours, so a gold pill always means Arany.
 */
@Component({
  selector: 'kte-loyalty-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIf, MatIconModule],
  template: `
    <section
      class="strip"
      *ngIf="snapshot as s"
      [attr.data-tier]="s.tier.tier"
      [class.strip--top]="isTop(s)"
      aria-label="Hűségprogram"
    >
      <div class="strip__inner">
        <span class="strip__pill">
          <mat-icon inline>star</mat-icon>
          {{ tierLabel(s) }}
        </span>

        <p class="strip__facts">
          <strong>{{ s.points }} pont</strong>
          <span class="strip__sep" aria-hidden="true">·</span>
          <span>{{ s.tier.discountPercent }}% kedvezmény</span>
        </p>

        <ng-container *ngIf="!isTop(s); else top">
          <div class="strip__progress">
            <div class="strip__ends" aria-hidden="true">
              <span>{{ tierLabel(s) }}</span>
              <span>{{ nextLabel(s) }}</span>
            </div>
            <div
              class="strip__bar"
              role="progressbar"
              [attr.aria-label]="'Haladás ' + withArticle(nextLabel(s)) + ' szintig'"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-valuenow]="percent(s)"
              [attr.aria-valuetext]="percent(s) + '%'"
            >
              <div class="strip__fill" [style.width.%]="percent(s)" [hidden]="percent(s) === 0"></div>
            </div>
          </div>
          <p class="strip__left">{{ leftText(s) }}</p>
        </ng-container>

        <ng-template #top>
          <div class="strip__achievement">
            <mat-icon class="strip__trophy" aria-hidden="true">emoji_events</mat-icon>
            <div>
              <strong>Elérted a legmagasabb szintet</strong>
              <span>A {{ s.tier.discountPercent }}% kedvezmény minden vásárlásnál automatikusan érvényesül.</span>
            </div>
          </div>
        </ng-template>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* The --tier-* custom properties come from the global tier stylesheet
         (styles/_tier.scss), keyed on data-tier. */
      .strip {
        --track: var(--border-light);
      }

      .strip {
        background: var(--surface);
        border-bottom: 1px solid var(--border);
      }

      .strip--top {
        background: var(--tier-soft);
      }

      .strip__inner {
        max-width: 1180px;
        margin: 0 auto;
        padding: 16px 32px;
        display: flex;
        align-items: center;
        gap: 12px 24px;
        flex-wrap: wrap;
      }

      .strip__pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        border-radius: 999px;
        border: 1.5px solid var(--tier-pill-border);
        background: var(--tier-pill-bg);
        color: var(--tier-pill-fg);
        font-size: 14px;
        font-weight: 600;
        line-height: 1.4;
      }

      .strip__pill mat-icon {
        color: var(--tier-star);
      }

      .strip__facts {
        margin: 0;
        display: flex;
        gap: 8px;
        align-items: baseline;
        font-size: 15px;
        color: var(--ink);
      }

      .strip__facts strong {
        font-family: var(--font-display);
        font-weight: 700;
      }

      .strip__sep {
        color: var(--muted);
      }

      .strip__progress {
        flex: 1 1 220px;
        min-width: 180px;
      }

      .strip__ends {
        display: flex;
        justify-content: space-between;
        margin-bottom: 4px;
        font-size: 12px;
        font-weight: 600;
        color: var(--muted);
      }

      .strip__bar {
        height: 12px;
        border-radius: 999px;
        background: var(--track);
        border: 1px solid var(--border);
        overflow: hidden;
      }

      .strip__fill {
        height: 100%;
        box-sizing: border-box;
        border-radius: 999px;
        background: var(--tier-fill);
        border: 2px solid var(--tier-fill-edge);
      }

      .strip__left {
        margin: 0;
        font-size: 14px;
        color: var(--muted);
      }

      .strip__achievement {
        flex: 1 1 280px;
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .strip__achievement > div {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .strip__achievement strong {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 17px;
        color: var(--ink);
      }

      .strip__achievement span {
        font-size: 14px;
        color: var(--muted);
      }

      .strip__trophy {
        flex-shrink: 0;
        width: 36px;
        height: 36px;
        font-size: 36px;
        color: var(--tier-star);
      }

      .strip[data-tier='platinum'] .strip__trophy {
        color: var(--brand-deep);
      }

      .strip[data-tier='silver'] .strip__trophy,
      .strip[data-tier='bronze'] .strip__trophy {
        color: var(--muted);
      }

      @media (max-width: 599px) {
        .strip__inner {
          padding: 16px;
        }
        .strip__progress,
        .strip__achievement {
          flex-basis: 100%;
        }
      }
    `,
  ],
})
export class LoyaltyStripComponent {
  @Input() snapshot: LoyaltySnapshotResponse | null = null;

  protected readonly withArticle = withArticle;

  protected isTop(s: LoyaltySnapshotResponse): boolean {
    return loyaltyProgress(s).isTopTier;
  }

  protected tierLabel(s: LoyaltySnapshotResponse): string {
    return s.tier.label || TIER_LABELS[s.tier.tier];
  }

  protected nextLabel(s: LoyaltySnapshotResponse): string {
    return s.nextTier ? s.nextTier.label || TIER_LABELS[s.nextTier.tier] : '';
  }

  protected percent(s: LoyaltySnapshotResponse): number {
    return Math.round(loyaltyProgress(s).ratio * 100);
  }

  protected leftText(s: LoyaltySnapshotResponse): string {
    const p = loyaltyProgress(s);
    const next = this.nextLabel(s);
    return `Még ${p.pointsLeft ?? 0} pont ${withArticle(next)} szintig`;
  }
}
