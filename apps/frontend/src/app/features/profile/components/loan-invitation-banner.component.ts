import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { IncomingLoan } from '../../../core/models/season-pass.models';
import { kickoffLabel, loanSeatLabel, timeLeft } from '../../../shared/utils/loan-format';

/**
 * Pending lending invitations, one banner each, at the top of the profile -
 * above the tabs, not behind one. The emailed link still works; this is the way
 * to find the invitation when that email never arrived or went to spam.
 */
@Component({
  selector: 'kte-loan-invitation-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatIconModule],
  template: `
    @for (inv of invitations; track inv.id) {
      <section class="banner" data-testid="loan-invitation" [attr.aria-label]="inv.lenderName + ' átadja neked a helyét'">
        <mat-icon class="banner__glyph" aria-hidden="true">mail</mat-icon>
        <div class="banner__body">
          <h2 class="banner__title">{{ inv.lenderName }} átadja neked a helyét</h2>
          <p class="banner__fixture">
            {{ inv.matchTitle }} · {{ kickoff(inv) }} · {{ seat(inv) }}
          </p>
          <p class="banner__left" data-testid="loan-invitation-left">{{ left(inv) }}</p>
        </div>
        <a
          mat-flat-button
          color="primary"
          class="banner__cta"
          data-testid="loan-invitation-open"
          [routerLink]="['/loans/accept', inv.invitationToken]"
        >
          Megnézem
        </a>
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      :host:empty { display: none; }

      .banner {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 16px;
        background: var(--kte-brand-tint);
        border: 1px solid var(--kte-brand-edge);
        border-radius: var(--kte-radius-lg);
      }
      .banner__glyph {
        flex: none;
        width: 28px;
        height: 28px;
        font-size: 28px;
        color: var(--kte-brand-deep);
      }
      .banner__body { flex: 1; min-width: 0; }
      .banner__title {
        margin: 0;
        font-family: var(--kte-font-display);
        font-size: 16px;
        font-weight: 700;
        color: var(--kte-ink);
        overflow-wrap: anywhere;
      }
      .banner__fixture {
        margin: 2px 0 0;
        font-size: 13px;
        color: var(--kte-ink);
        overflow-wrap: anywhere;
      }
      .banner__left {
        margin: 4px 0 0;
        font-size: 13px;
        font-weight: 600;
        color: var(--amber-ink);
      }
      .banner__cta { flex: none; min-height: 44px; }

      @media (max-width: 480px) {
        .banner {
          display: grid;
          grid-template-columns: 28px minmax(0, 1fr);
          align-items: start;
        }
        .banner__cta { grid-column: 1 / -1; width: 100%; }
      }
    `,
  ],
})
export class LoanInvitationBannerComponent {
  @Input({ required: true }) invitations: readonly IncomingLoan[] = [];
  /** Clock for the "time left" line; overridable so tests are deterministic. */
  @Input() now: number = Date.now();

  protected kickoff(inv: IncomingLoan): string {
    return kickoffLabel(inv.kickoffAt);
  }
  protected seat(inv: IncomingLoan): string {
    return loanSeatLabel(inv);
  }
  protected left(inv: IncomingLoan): string {
    const left = timeLeft(inv.expiresAt, this.now);
    return left ? `még ${left} az elfogadásra` : 'Az elfogadási idő lejárt';
  }
}
