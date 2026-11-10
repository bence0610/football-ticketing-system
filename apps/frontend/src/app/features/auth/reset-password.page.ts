import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthApiService } from '../../shared/services/auth.api.service';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  PASSWORD_PATTERN,
  passwordChecks,
} from '../../shared/utils/password-rules';
import { AuthFieldComponent } from './components/auth-field.component';
import { AuthLayoutComponent } from './components/auth-layout.component';
import { PasswordMeterComponent } from './components/password-meter.component';

type View =
  | { kind: 'checking' }
  | { kind: 'ready' }
  /** The emailed link cannot be used: invalid, expired or already used. The server's wording is shown as is. */
  | { kind: 'refused'; code: string; message: string };

/**
 * Set-new-password page, reached from the emailed link. It checks the link on
 * arrival, so a person with an expired or used link is told before typing a
 * password, and is offered a new link instead.
 */
@Component({
  selector: 'kte-reset-password-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatIconModule,
    AuthLayoutComponent,
    AuthFieldComponent,
    PasswordMeterComponent,
  ],
  template: `
    <kte-auth-layout mode="reset">
      <h1 class="kte-auth-title">Új jelszó beállítása</h1>

      @switch (view().kind) {
        @case ('checking') {
          <p class="kte-auth-lead" role="status" data-testid="reset-checking">A link ellenőrzése…</p>
        }

        @case ('refused') {
          <p class="error-block kte-auth-error" role="alert" data-testid="reset-refused" style="margin-top: 20px">
            {{ refusedMessage() }}
          </p>
          <div class="kte-auth-actions">
            <a class="kte-auth-submit" routerLink="/forgot-password" data-testid="request-new" style="text-decoration: none">
              Új link kérése
            </a>
            <a class="kte-auth-secondary" routerLink="/login">Vissza a bejelentkezéshez</a>
          </div>
        }

        @case ('ready') {
          <p class="kte-auth-lead">Válassz új jelszót a fiókodhoz.</p>

          <form [formGroup]="form" (ngSubmit)="submit()" class="kte-auth-form" novalidate>
            <div>
              <kte-auth-field
                label="Új jelszó"
                icon="lock"
                inputId="reset-password"
                [invalid]="showError()"
              >
                <input
                  id="reset-password"
                  formControlName="password"
                  autocomplete="new-password"
                  [type]="showPassword() ? 'text' : 'password'"
                  [attr.aria-invalid]="showError()"
                  aria-describedby="reset-password-rule reset-password-err"
                />
                <button
                  trailing
                  type="button"
                  class="kte-field__toggle"
                  (click)="showPassword.set(!showPassword())"
                  [attr.aria-label]="showPassword() ? 'Jelszó elrejtése' : 'Jelszó megjelenítése'"
                  [attr.aria-pressed]="showPassword()"
                >
                  <mat-icon aria-hidden="true">{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
                <div msg id="reset-password-err">
                  @if (showError()) {
                    <p role="alert">{{ passwordError() }}</p>
                  }
                </div>
              </kte-auth-field>
              <kte-password-meter [password]="passwordValue()" ruleId="reset-password-rule" />
            </div>

            @if (errorMessage(); as error) {
              <p class="error-block kte-auth-error" role="alert" data-testid="reset-error">{{ error }}</p>
            }

            <button type="submit" class="kte-auth-submit" [disabled]="loading()" [attr.aria-busy]="loading()">
              @if (loading()) {
                <span class="kte-auth-spinner" aria-hidden="true"></span>
                Mentés…
              } @else {
                Új jelszó mentése
              }
            </button>
          </form>
        }
      }
    </kte-auth-layout>
  `,
})
export class ResetPasswordPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AuthApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly view = signal<View>({ kind: 'checking' });
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly showPassword = signal(false);

  private token = '';

  // The very rule registration uses (shared/utils/password-rules mirrors the server DTO).
  protected readonly form = this.fb.nonNullable.group({
    password: [
      '',
      [
        Validators.required,
        Validators.minLength(PASSWORD_MIN),
        Validators.maxLength(PASSWORD_MAX),
        Validators.pattern(PASSWORD_PATTERN),
      ],
    ],
  });
  protected readonly passwordValue = toSignal(this.form.controls.password.valueChanges, {
    initialValue: '',
  });

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.view.set({
        kind: 'refused',
        code: 'reset_token_invalid',
        message: 'Ez a visszaállító link érvénytelen. Kérj új linket.',
      });
      return;
    }
    this.api.checkPasswordResetToken(this.token).subscribe({
      next: () => this.view.set({ kind: 'ready' }),
      error: (err: unknown) => this.refuse(err),
    });
  }

  protected refusedMessage(): string {
    const v = this.view();
    return v.kind === 'refused' ? v.message : '';
  }

  protected showError(): boolean {
    const c = this.form.controls.password;
    return c.touched && c.invalid;
  }

  protected passwordError(): string {
    const value = this.form.controls.password.value;
    if (!value) return 'Adj meg egy jelszót.';
    const c = passwordChecks(value);
    if (!c.longEnough) return `Legalább ${PASSWORD_MIN} karakter kell.`;
    if (!c.notTooLong) return `Legfeljebb ${PASSWORD_MAX} karakter lehet.`;
    if (!c.hasLetter) return 'Kell bele legalább egy betű (a–z).';
    return 'Kell bele legalább egy szám.';
  }

  protected submit(): void {
    if (this.loading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      document.querySelector<HTMLInputElement>('kte-reset-password-page input')?.focus();
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);
    this.api.resetPassword(this.token, this.form.controls.password.value).subscribe({
      next: () => {
        void this.router.navigate(['/login'], { queryParams: { reset: '1' } });
      },
      error: (err: unknown) => {
        this.loading.set(false);
        if (this.isTokenRefusal(err)) {
          this.refuse(err);
          return;
        }
        this.errorMessage.set(serverMessage(err) ?? 'Nem sikerült beállítani az új jelszót. Próbáld újra.');
      },
    });
  }

  private isTokenRefusal(err: unknown): boolean {
    return codeOf(err)?.startsWith('reset_token_') ?? false;
  }

  /** A link the server will not accept: say why, in its own words, and offer a new one. */
  private refuse(err: unknown): void {
    this.view.set({
      kind: 'refused',
      code: codeOf(err) ?? 'reset_token_invalid',
      message: serverMessage(err) ?? 'Ez a visszaállító link nem használható. Kérj új linket.',
    });
  }
}

function codeOf(err: unknown): string | null {
  if (err instanceof HttpErrorResponse && err.error && typeof err.error === 'object') {
    const code = (err.error as Record<string, unknown>)['code'];
    return typeof code === 'string' ? code : null;
  }
  return null;
}

function serverMessage(err: unknown): string | null {
  if (err instanceof HttpErrorResponse && err.error && typeof err.error === 'object') {
    const message = (err.error as Record<string, unknown>)['message'];
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  return null;
}
