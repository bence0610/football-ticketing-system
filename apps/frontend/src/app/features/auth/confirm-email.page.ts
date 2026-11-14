import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AuthApiService } from '../../shared/services/auth.api.service';
import {
  NETWORK_ERROR_MESSAGE,
  RATE_LIMITED_MESSAGE,
  apiErrorCode,
  apiErrorMessage,
} from '../../shared/utils/api-error';
import { AuthLayoutComponent } from './components/auth-layout.component';

/** What each refusal of POST /auth/confirm-email-change means for the person holding the link. */
export const CONFIRM_EMAIL_REFUSALS: Readonly<Record<string, string>> = {
  email_change_token_invalid: 'Ez a megerősítő link érvénytelen.',
  email_change_token_used: 'Ezt a megerősítő linket már felhasználták, vagy közben újat kértél.',
  email_change_token_expired: 'Ez a megerősítő link lejárt.',
  email_change_token_password_changed:
    'A link a jelszavad megváltoztatása előtt készült, ezért már nem érvényes.',
  email_taken: 'Ezt az e-mail-címet közben egy másik fiók már használja, ezért nem lehet a tiéd.',
};

type View =
  | { readonly kind: 'checking' }
  | { readonly kind: 'done'; readonly email: string }
  /** The server refused the link: `code` says why. */
  | { readonly kind: 'refused'; readonly code: string; readonly message: string }
  /** No answer from the server (network, 5xx): the link may still be good, so it can be retried. */
  | { readonly kind: 'failed'; readonly message: string };

/**
 * /confirm-email/:token, opened from the link mailed to the new address. There
 * is nothing to fill in: the link is confirmed on arrival. It works signed in or
 * out; when signed in, the stored user is refreshed so the new address shows up
 * everywhere at once.
 */
@Component({
  selector: 'kte-confirm-email-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthLayoutComponent],
  template: `
    <kte-auth-layout mode="email">
      <h1 class="kte-auth-title">E-mail-cím megerősítése</h1>

      @switch (view().kind) {
        @case ('checking') {
          <p class="kte-auth-lead" role="status" data-testid="confirm-checking">A link ellenőrzése…</p>
        }

        @case ('done') {
          <p class="kte-auth-notice" role="status" data-testid="confirm-done" style="margin-top: 20px">
            Az új e-mail-címed: <strong>{{ doneEmail() }}</strong>
          </p>
          <p class="kte-auth-lead">Mostantól ezzel a címmel jelentkezz be; ide küldjük a leveleidet is.</p>
          <div class="kte-auth-actions">
            @if (signedIn()) {
              <a class="kte-auth-submit" routerLink="/profile" data-testid="to-profile">Tovább a profilomhoz</a>
            } @else {
              <a class="kte-auth-submit" routerLink="/login" data-testid="to-login">Bejelentkezés</a>
            }
          </div>
        }

        @case ('refused') {
          <p class="error-block kte-auth-error" role="alert" data-testid="confirm-refused" style="margin-top: 20px">
            {{ problem() }}
          </p>
          <p class="kte-auth-lead">
            @if (signedIn()) {
              Az e-mail-címed nem változott. Új megerősítő levelet az Adataim oldalon kérhetsz.
            } @else {
              Az e-mail-címed nem változott. Új megerősítő levelet bejelentkezés után, az Adataim oldalon kérhetsz.
            }
          </p>
          <div class="kte-auth-actions">
            <a class="kte-auth-submit" routerLink="/profile/details" data-testid="request-again">
              Új megerősítő levél kérése
            </a>
          </div>
        }

        @case ('failed') {
          <p class="error-block kte-auth-error" role="alert" data-testid="confirm-failed" style="margin-top: 20px">
            {{ problem() }}
          </p>
          <div class="kte-auth-actions">
            <button type="button" class="kte-auth-submit" data-testid="confirm-retry" (click)="confirm()">
              Újrapróbálom
            </button>
          </div>
        }
      }
    </kte-auth-layout>
  `,
})
export class ConfirmEmailPageComponent implements OnInit {
  private readonly api = inject(AuthApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  protected readonly view = signal<View>({ kind: 'checking' });
  protected readonly signedIn = this.auth.isAuthenticated;

  private token = '';

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.view.set({
        kind: 'refused',
        code: 'email_change_token_invalid',
        message: CONFIRM_EMAIL_REFUSALS['email_change_token_invalid'],
      });
      return;
    }
    this.confirm();
  }

  protected confirm(): void {
    this.view.set({ kind: 'checking' });
    this.api.confirmEmailChange(this.token).subscribe({
      next: (res) => {
        this.view.set({ kind: 'done', email: res.email });
        this.refreshSignedInUser();
      },
      error: (err: unknown) => this.view.set(this.refusal(err)),
    });
  }

  protected doneEmail(): string {
    const v = this.view();
    return v.kind === 'done' ? v.email : '';
  }

  protected problem(): string {
    const v = this.view();
    return v.kind === 'refused' || v.kind === 'failed' ? v.message : '';
  }

  private refusal(err: unknown): View {
    const code = apiErrorCode(err);
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    if (code && CONFIRM_EMAIL_REFUSALS[code]) {
      return { kind: 'refused', code, message: CONFIRM_EMAIL_REFUSALS[code] };
    }
    if (status === 409) {
      return { kind: 'refused', code: 'email_taken', message: CONFIRM_EMAIL_REFUSALS['email_taken'] };
    }
    if (status === 400 || status === 404) {
      return {
        kind: 'refused',
        code: code ?? 'email_change_token_invalid',
        message: apiErrorMessage(err) ?? CONFIRM_EMAIL_REFUSALS['email_change_token_invalid'],
      };
    }
    if (status === 429) {
      return { kind: 'failed', message: RATE_LIMITED_MESSAGE };
    }
    return {
      kind: 'failed',
      message: status === 0 ? NETWORK_ERROR_MESSAGE : 'Nem sikerült megerősíteni a címet. Próbáld újra.',
    };
  }

  /**
   * The confirmed account may not be the one signed in here (a link opened on a
   * shared computer), so the profile is fetched and AuthService only applies it
   * to the matching user.
   */
  private refreshSignedInUser(): void {
    if (!this.auth.isAuthenticated()) return;
    this.api.me().subscribe({
      next: (profile) => this.auth.syncProfile(profile),
      error: () => undefined,
    });
  }
}
