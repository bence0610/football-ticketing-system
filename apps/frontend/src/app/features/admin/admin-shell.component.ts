import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth/auth.service';
import { ADMIN_NAV, visibleNavGroups } from './admin-nav';
import { ReadonlyNoticeComponent } from './components/readonly-notice.component';

/**
 * The admin area's own shell. It is a sibling of the public AppShell, not a
 * child: no public header, footer or chat bubble. A fixed 236px dark sidebar
 * on desktop; on a phone it folds into a bar across the top.
 */
@Component({
  selector: 'kte-admin-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, MatIconModule, ReadonlyNoticeComponent],
  template: `
    <div class="admin">
      <aside class="admin__side" aria-label="Admin navigáció">
        <a class="admin__brand" routerLink="/admin" aria-label="KTE Admin, kezdőlap">
          <span class="admin__mark" aria-hidden="true">KTE</span>
          <span class="admin__brand-text">Admin</span>
        </a>

        <nav class="admin__nav">
          @for (group of groups; track group.label) {
            <div class="admin__group">
              <p class="admin__group-label">{{ group.label }}</p>
              @for (item of group.items; track item.route) {
                <a
                  class="admin__link"
                  [routerLink]="item.route"
                  routerLinkActive="admin__link--active"
                  [attr.data-testid]="'admin-nav-' + item.label"
                >
                  <mat-icon aria-hidden="true">{{ item.icon }}</mat-icon>
                  {{ item.label }}
                </a>
              }
            </div>
          }
        </nav>

        <div class="admin__foot">
          <a class="admin__exit" routerLink="/">
            <mat-icon aria-hidden="true">arrow_back</mat-icon>
            Jegyportál
          </a>
          @if (email(); as address) {
            <p class="admin__who" data-testid="admin-email" [title]="address">{{ address }}</p>
          }
        </div>
      </aside>

      <div class="admin__main">
        <router-outlet />
        <kte-admin-readonly-notice />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        background: var(--page);
        color: var(--ink);
        font-family: var(--font-body);
      }

      .admin__side {
        position: fixed;
        inset: 0 auto 0 0;
        width: 236px;
        display: flex;
        flex-direction: column;
        gap: 24px;
        padding: 20px 12px;
        background: var(--ink);
        color: var(--on-ink-nav);
        overflow-y: auto;
        z-index: 10;
      }

      .admin__brand {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 8px;
        color: #fff;
        text-decoration: none;
      }

      .admin__mark {
        width: 36px;
        height: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        background: var(--brand-mid);
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 14px;
      }

      .admin__brand-text {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 17px;
      }

      .admin__nav {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .admin__group {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .admin__group-label {
        margin: 0 0 6px;
        padding: 0 10px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--faint);
      }

      .admin__link {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 40px;
        padding: 0 10px;
        border-left: 3px solid transparent;
        border-radius: 0 8px 8px 0;
        color: var(--on-ink-nav);
        font-size: 14px;
        text-decoration: none;
      }

      .admin__link mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      .admin__link:hover {
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
      }

      .admin__link:focus-visible,
      .admin__exit:focus-visible,
      .admin__brand:focus-visible {
        outline: 2px solid var(--on-brand-eyebrow);
        outline-offset: 2px;
      }

      .admin__link--active {
        border-left-color: var(--brand-mid);
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
        font-weight: 600;
      }

      .admin__foot {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px 8px 0;
        border-top: 1px solid var(--divider-on-brand);
      }

      .admin__exit {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--on-ink-nav);
        font-size: 13px;
        text-decoration: none;
      }

      .admin__exit mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      .admin__who {
        margin: 0;
        font-size: 12px;
        color: var(--faint);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .admin__main {
        margin-left: 236px;
        min-width: 0;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      }

      /* A phone: the sidebar folds into a bar across the top. A desktop tool, so usable, not pretty. */
      @media (max-width: 899px) {
        .admin__side {
          position: static;
          width: auto;
          flex-direction: row;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px 16px;
          padding: 10px 12px;
        }

        .admin__nav {
          flex: 1 1 auto;
          flex-direction: row;
          flex-wrap: wrap;
          gap: 4px 12px;
        }

        .admin__group {
          flex-direction: row;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px;
        }

        .admin__group-label {
          display: none;
        }

        .admin__link {
          border-left: 0;
          border-bottom: 3px solid transparent;
          border-radius: 8px 8px 0 0;
        }

        .admin__link--active {
          border-bottom-color: var(--brand-mid);
        }

        .admin__foot {
          flex-direction: row;
          align-items: center;
          flex: 1 1 100%;
          padding: 8px 0 0;
          gap: 16px;
        }

        .admin__who {
          min-width: 0;
        }

        .admin__main {
          margin-left: 0;
          min-height: 0;
        }
      }
    `,
  ],
})
export class AdminShellComponent {
  private readonly auth = inject(AuthService);

  protected readonly groups = visibleNavGroups(ADMIN_NAV);
  protected readonly email = computed(() => this.auth.user()?.email ?? '');
}
