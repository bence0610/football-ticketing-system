import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../core/auth/auth.service';
import {
  apiErrorCode,
  extractApiErrorMessage,
  splitFieldErrors,
} from '../../../shared/utils/api-error';
import {
  passwordMaxBytesValidator,
  PASSWORD_MIN,
  PASSWORD_PATTERN,
  passwordRuleError,
} from '../../../shared/utils/password-rules';
import { AuthFieldComponent } from '../../auth/components/auth-field.component';
import { PasswordMeterComponent } from '../../auth/components/password-meter.component';
import { AccountLayoutComponent, AccountSectionComponent } from './account-layout.component';
import { RATE_LIMITED_MESSAGE, focusFirstInvalid } from './account-form';

type Field = 'currentPassword' | 'newPassword';

const MATCHERS: Readonly<Record<Field, RegExp>> = {
  currentPassword: /jelenlegi jelsz/i,
  newPassword: /jelszó|password/i,
};

export const CHANGE_PASSWORD_MESSAGES = {
  currentPasswordIncorrect: 'A jelenlegi jelszó nem megfelelő.',
  passwordUnchanged: 'Az új jelszó nem egyezhet a jelenlegivel.',
  success:
    'A jelszavad megváltozott. Ezen az eszközön bejelentkezve maradsz, a többi eszközről ' +
    'kiléptettünk. Értesítő levelet is küldtünk.',
} as const;

const FORM = 'kte-change-password-page form';

/**
 * /profile/password. The new password follows the registration rule and is
 * judged by the same meter (shared/utils/password-rules). The server answers a
 * change like a login, and AuthService applies that answer, so this device stays
 * signed in while every other one is signed out.
 */
@Component({
  selector: 'kte-change-password-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatIconModule,
    AccountLayoutComponent,
    AccountSectionComponent,
    AuthFieldComponent,
    PasswordMeterComponent,
  ],
  template: `
    <kte-account-layout title="Jelszó módosítása">
      <kte-account-section
        heading="Új jelszó"
        headingId="password-heading"
        description="A módosítás után ezen az eszközön bejelentkezve maradsz, a többi eszközön újra be kell jelentkezned."
      >
        @if (done()) {
          <p class="kte-auth-notice done" role="status" data-testid="password-changed">{{ successMessage }}</p>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" class="kte-auth-form kte-auth-form--card" novalidate>
          <!-- Lets a password manager file the new password under the right account. -->
          <input
            class="username"
            type="email"
            name="username"
            autocomplete="username"
            [value]="email()"
            readonly
            tabindex="-1"
            aria-hidden="true"
          />

          <kte-auth-field
            label="Jelenlegi jelszó"
            icon="lock"
            inputId="cp-current"
            [invalid]="invalid('currentPassword')"
          >
            <input
              id="cp-current"
              formControlName="currentPassword"
              autocomplete="current-password"
              [type]="showCurrent() ? 'text' : 'password'"
              [attr.aria-invalid]="invalid('currentPassword')"
              [attr.aria-describedby]="invalid('currentPassword') ? 'cp-current-err' : null"
            />
            <button
              trailing
              type="button"
              class="kte-field__toggle"
              (click)="showCurrent.set(!showCurrent())"
              [attr.aria-label]="showCurrent() ? 'Jelszó elrejtése' : 'Jelszó megjelenítése'"
              [attr.aria-pressed]="showCurrent()"
            >
              <mat-icon aria-hidden="true">{{ showCurrent() ? 'visibility_off' : 'visibility' }}</mat-icon>
            </button>
            @if (invalid('currentPassword')) {
              <p msg id="cp-current-err" role="alert">{{ error('currentPassword') }}</p>
            }
          </kte-auth-field>

          <div>
            <kte-auth-field label="Új jelszó" icon="lock" inputId="cp-new" [invalid]="invalid('newPassword')">
              <input
                id="cp-new"
                formControlName="newPassword"
                autocomplete="new-password"
                [type]="showNew() ? 'text' : 'password'"
                [attr.aria-invalid]="invalid('newPassword')"
                aria-describedby="cp-new-rule cp-new-err"
              />
              <button
                trailing
                type="button"
                class="kte-field__toggle"
                (click)="showNew.set(!showNew())"
                [attr.aria-label]="showNew() ? 'Jelszó elrejtése' : 'Jelszó megjelenítése'"
                [attr.aria-pressed]="showNew()"
              >
                <mat-icon aria-hidden="true">{{ showNew() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              <div msg id="cp-new-err">
                @if (invalid('newPassword')) {
                  <p role="alert">{{ error('newPassword') }}</p>
                }
              </div>
            </kte-auth-field>
            <kte-password-meter [password]="newPasswordValue()" ruleId="cp-new-rule" />
          </div>

          @if (errorMessage(); as message) {
            <p class="error-block kte-auth-error" role="alert" data-testid="password-error">{{ message }}</p>
          }

          <button type="submit" class="kte-auth-submit" [disabled]="loading()" [attr.aria-busy]="loading()">
            @if (loading()) {
              <span class="kte-auth-spinner" aria-hidden="true"></span>
              Mentés…
            } @else {
              Jelszó módosítása
            }
          </button>
        </form>
      </kte-account-section>
    </kte-account-layout>
  `,
  styles: [
    `
      :host { display: block; }
      .done { margin-top: 16px; }
      .username {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        border: 0;
        overflow: hidden;
        clip: rect(0 0 0 0);
        opacity: 0;
        pointer-events: none;
      }
    `,
  ],
})
export class ChangePasswordPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly successMessage = CHANGE_PASSWORD_MESSAGES.success;
  protected readonly email = computed(() => this.auth.user()?.email ?? '');

  protected readonly loading = signal(false);
  protected readonly done = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly showCurrent = signal(false);
  protected readonly showNew = signal(false);
  private readonly serverErrors = signal<Partial<Record<Field, string>>>({});

  protected readonly form = this.fb.nonNullable.group({
    currentPassword: ['', [Validators.required]],
    // The registration rule (shared/utils/password-rules mirrors the server DTO).
    newPassword: [
      '',
      [
        Validators.required,
        Validators.minLength(PASSWORD_MIN),
        passwordMaxBytesValidator,
        Validators.pattern(PASSWORD_PATTERN),
      ],
    ],
  });
  protected readonly newPasswordValue = toSignal(this.form.controls.newPassword.valueChanges, {
    initialValue: '',
  });

  constructor() {
    for (const name of ['currentPassword', 'newPassword'] as const) {
      this.form.controls[name].valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        const current = this.serverErrors();
        if (current[name] === undefined) return;
        const next = { ...current };
        delete next[name];
        this.serverErrors.set(next);
      });
    }
  }

  protected invalid(name: Field): boolean {
    const c = this.form.controls[name];
    return (c.touched && c.invalid) || this.serverErrors()[name] !== undefined;
  }

  protected error(name: Field): string {
    const server = this.serverErrors()[name];
    if (server) return server;
    if (name === 'currentPassword') return 'Add meg a jelenlegi jelszavadat.';
    return passwordRuleError(this.form.controls.newPassword.value);
  }

  protected submit(): void {
    if (this.loading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalid(FORM);
      return;
    }
    const { currentPassword, newPassword } = this.form.getRawValue();
    if (currentPassword === newPassword) {
      this.serverErrors.set({ newPassword: CHANGE_PASSWORD_MESSAGES.passwordUnchanged });
      focusFirstInvalid(FORM);
      return;
    }
    this.loading.set(true);
    this.done.set(false);
    this.errorMessage.set(null);
    this.serverErrors.set({});
    this.auth.changePassword({ currentPassword, newPassword }).subscribe({
      next: () => {
        this.loading.set(false);
        this.form.reset();
        this.showCurrent.set(false);
        this.showNew.set(false);
        this.done.set(true);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.handleError(err);
      },
    });
  }

  private handleError(err: unknown): void {
    const code = apiErrorCode(err);
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    if (code === 'current_password_incorrect') {
      this.serverErrors.set({ currentPassword: CHANGE_PASSWORD_MESSAGES.currentPasswordIncorrect });
      focusFirstInvalid(FORM);
      return;
    }
    if (code === 'password_unchanged') {
      this.serverErrors.set({ newPassword: CHANGE_PASSWORD_MESSAGES.passwordUnchanged });
      focusFirstInvalid(FORM);
      return;
    }
    if (status === 429) {
      this.errorMessage.set(RATE_LIMITED_MESSAGE);
      return;
    }
    if (status === 400 && !code) {
      const { fields, rest } = splitFieldErrors(err, MATCHERS);
      if (Object.keys(fields).length > 0 || rest.length > 0) {
        this.serverErrors.set(fields);
        this.errorMessage.set(rest.length > 0 ? rest.join(' ') : null);
        focusFirstInvalid(FORM);
        return;
      }
    }
    this.errorMessage.set(extractApiErrorMessage(err, 'Nem sikerült módosítani a jelszót. Próbáld újra.'));
  }
}
