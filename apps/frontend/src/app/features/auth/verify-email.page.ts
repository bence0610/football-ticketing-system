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

/** What each refusal of POST /auth/verify-email/confirm means for the person holding the link. */
export const VERIFY_EMAIL_REFUSALS: Readonly<Record<string, string>> = {
  verification_token_invalid: 'Ez a megerősítő link érvénytelen.',
  verification_token_used: 'Ezt a megerősítő linket már felhasználták, vagy közben újat kértél.',
  verification_token_expired: 'Ez a megerősítő link lejárt.',
};

type View =
  | { readonly kind: 'checking' }
  | { readonly kind: 'done'; readonly email: string }
  | { readonly kind: 'refused'; readonly code: string; readonly message: string }
  /** No answer from the server (network, 5xx): the link may still be good, so it can be retried. */
  | { readonly kind: 'failed'; readonly message: string };

/**
 * /verify-email/:token, opened from the link mailed at registration. Nothing to fill in: the link is
 * confirmed on arrival, signed in or out. What the verified address unlocks: seeing and accepting
 * pass-loan invitations, and being named as a pass holder.
 */
@Component({
  selector: 'kte-verify-email-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthLayoutComponent],
  template: `
    <kte-auth-layout mode="email">
      <h1 class="kte-auth-title">E-mail-cím megerősítése</h1>

      @switch (view().kind) {
        @case ('checking') {
          <p class="kte-auth-lead" role="status" data-testid="verify-checking">A link ellenőrzése…</p>
        }

        @case ('done') {
          <p class="kte-auth-notice" role="status" data-testid="verify-done" style="margin-top: 20px">
            Megerősítettük az e-mail-címedet: <strong>{{ doneEmail() }}</strong>
          </p>
          <p class="kte-auth-lead">
            Mostantól látod és elfogadhatod a bérletkölcsön-meghívókat, és bérlet birtokosának is megadhatnak.
          </p>
          <div class="kte-auth-actions">
            @if (signedIn()) {
              <a class="kte-auth-submit" routerLink="/profile" data-testid="to-profile">Tovább a profilomhoz</a>
            } @else {
              <a class="kte-auth-submit" routerLink="/login" data-testid="to-login">Bejelentkezés</a>
            }
          </div>
        }

        @case ('refused') {
          <p class="error-block kte-auth-error" role="alert" data-testid="verify-refused" style="margin-top: 20px">
            {{ problem() }}
          </p>
          <p class="kte-auth-lead">
            Új megerősítő levelet bejelentkezés után, a profilod oldalán kérhetsz.
          </p>
          <div class="kte-auth-actions">
            <a class="kte-auth-submit" routerLink="/profile" data-testid="request-again">
              Új megerősítő levél kérése
            </a>
          </div>
        }

        @case ('failed') {
          <p class="error-block kte-auth-error" role="alert" data-testid="verify-failed" style="margin-top: 20px">
            {{ problem() }}
          </p>
          <div class="kte-auth-actions">
            <button type="button" class="kte-auth-submit" data-testid="verify-retry" (click)="confirm()">
              Újrapróbálom
            </button>
          </div>
        }
      }
    </kte-auth-layout>
  `,
})
export class VerifyEmailPageComponent implements OnInit {
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
        code: 'verification_token_invalid',
        message: VERIFY_EMAIL_REFUSALS['verification_token_invalid'],
      });
      return;
    }
    this.confirm();
  }

  protected confirm(): void {
    this.view.set({ kind: 'checking' });
    this.api.verifyEmail(this.token).subscribe({
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
    if (code && VERIFY_EMAIL_REFUSALS[code]) {
      return { kind: 'refused', code, message: VERIFY_EMAIL_REFUSALS[code] };
    }
    if (status === 400 || status === 404) {
      return {
        kind: 'refused',
        code: code ?? 'verification_token_invalid',
        message: apiErrorMessage(err) ?? VERIFY_EMAIL_REFUSALS['verification_token_invalid'],
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

  /** The verified account may not be the one signed in here: AuthService applies the profile only to the matching user. */
  private refreshSignedInUser(): void {
    if (!this.auth.isAuthenticated()) return;
    this.api.me().subscribe({
      next: (profile) => this.auth.syncProfile(profile),
      error: () => undefined,
    });
  }
}
