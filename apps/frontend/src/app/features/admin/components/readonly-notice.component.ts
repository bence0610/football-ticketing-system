import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * Why the admin area only reads. This is a decision, not a gap: with no audit
 * log, a price change, a deleted match or a revoked ticket could not be traced
 * afterwards, so none of them can be done from here yet.
 */
@Component({
  selector: 'kte-admin-readonly-notice',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <aside class="note" role="note" data-testid="readonly-notice">
      <mat-icon aria-hidden="true">lock</mat-icon>
      <p>
        <strong>Csak olvasható felület.</strong> Innen nem módosítható ár, nem törölhető mérkőzés és nem
        vonható vissza jegy, amíg nincs naplózás (audit log): egy utólagos módosítás ugyanis nyomon
        követhetetlen lenne. Ez tudatos döntés, nem hiányzó funkció.
      </p>
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
        margin: auto 32px 32px;
        padding-top: 8px;
      }

      .note {
        display: flex;
        gap: 12px;
        padding: 14px 16px;
        background: var(--brand-tint);
        border: 1px solid var(--border);
        border-radius: var(--radius-block);
        color: var(--ink);
        font-size: 13px;
        line-height: 1.5;
      }

      .note mat-icon {
        flex-shrink: 0;
        color: var(--brand-mid);
      }

      .note p {
        margin: 0;
      }

      @media (max-width: 899px) {
        :host {
          margin: auto 16px 16px;
        }
      }
    `,
  ],
})
export class ReadonlyNoticeComponent {}
