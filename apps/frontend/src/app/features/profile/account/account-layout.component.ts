import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

/**
 * The frame of the two account pages (/profile/details, /profile/password): a
 * 44px "back to the profile" link, the page title, and a single narrow column of
 * {@link AccountSectionComponent} cards. The fields and buttons inside are the
 * auth forms' own (kte-auth-field, .kte-auth-submit, styles/_auth.scss), so the
 * account forms look and behave exactly like login and registration.
 */
@Component({
  selector: 'kte-account-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatIconModule],
  template: `
    <section class="account">
      <a class="account__back" routerLink="/profile" data-testid="back-to-profile">
        <mat-icon aria-hidden="true">arrow_back</mat-icon>
        Vissza a profilhoz
      </a>
      <h1 class="kte-auth-title account__title">{{ title }}</h1>
      @if (lead) {
        <p class="kte-auth-lead">{{ lead }}</p>
      }
      <div class="account__body">
        <ng-content />
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .account {
        max-width: 560px;
        margin: 0 auto;
        padding: 24px 16px 48px;
        box-sizing: border-box;
      }
      .account__back {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: var(--min-target, 44px);
        margin-bottom: 8px;
        font-weight: 600;
        font-size: 15px;
        color: var(--brand-deep);
        text-decoration: none;
      }
      .account__back:hover { text-decoration: underline; }
      .account__back mat-icon { width: 20px; height: 20px; font-size: 20px; }
      .account__title { overflow-wrap: anywhere; }
      .account__body { display: flex; flex-direction: column; gap: 20px; margin-top: 24px; }
      @media (max-width: 480px) {
        .account { padding: 12px 16px 40px; }
        .account__title { font-size: 26px; }
      }
    `,
  ],
})
export class AccountLayoutComponent {
  @Input({ required: true }) title = '';
  @Input() lead = '';
}

/** One card of an account page: an h2, an optional explanation, then the projected form. */
@Component({
  selector: 'kte-account-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" [attr.aria-labelledby]="headingId">
      <h2 class="card__title" [id]="headingId">{{ heading }}</h2>
      @if (description) {
        <p class="card__desc">{{ description }}</p>
      }
      <ng-content />
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        padding: 20px;
      }
      .card__title {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 19px;
        color: var(--ink);
      }
      .card__desc { margin: 8px 0 0; font-size: 14px; line-height: 1.5; color: var(--muted); }
      @media (max-width: 480px) {
        .card { padding: 16px; }
      }
    `,
  ],
})
export class AccountSectionComponent {
  @Input({ required: true }) heading = '';
  @Input({ required: true }) headingId = '';
  @Input() description = '';
}
