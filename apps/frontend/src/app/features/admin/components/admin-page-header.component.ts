import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** White page header: title and subtitle on the left, page controls (projected) on the right. */
@Component({
  selector: 'kte-admin-page-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <div class="head__text">
        <h1 class="head__title">{{ title }}</h1>
        <p class="head__sub" data-testid="admin-subtitle">{{ subtitle }}</p>
      </div>
      <div class="head__actions"><ng-content /></div>
    </header>
  `,
  styles: [
    `
      .head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px 24px;
        padding: 20px 32px;
        background: var(--surface);
        border-bottom: 1px solid var(--border);
      }

      .head__title {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 24px;
        color: var(--ink);
      }

      .head__sub {
        margin: 4px 0 0;
        font-size: 13px;
        color: var(--muted);
      }

      .head__actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
      }

      @media (max-width: 899px) {
        .head {
          padding: 16px;
        }
      }
    `,
  ],
})
export class AdminPageHeaderComponent {
  @Input({ required: true }) title = '';
  @Input() subtitle = '';
}
