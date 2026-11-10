import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { strictEmailValidator } from '../../shared/validators/email.validator';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  PASSWORD_PATTERN,
  passwordChecks,
} from '../../shared/utils/password-rules';
import { AuthFieldComponent } from './components/auth-field.component';
import { AuthLayoutComponent } from './components/auth-layout.component';
import { PasswordMeterComponent } from './components/password-meter.component';

type FieldName = 'lastName' | 'firstName' | 'email' | 'password';

@Component({
  selector: 'kte-register-page',
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
    <kte-auth-layout mode="register">
      <h1 class="kte-auth-title">Fiók létrehozása</h1>
      <p class="kte-auth-switch">
        Van már fiókod?
        <a routerLink="/login" [queryParams]="returnQuery">Bejelentkezés</a>
      </p>

      <form [formGroup]="form" (ngSubmit)="submit()" class="kte-auth-form" novalidate>
        <div class="kte-auth-form__row">
          <kte-auth-field label="Vezetéknév" inputId="reg-last" [invalid]="showError('lastName')">
            <input
              id="reg-last"
              formControlName="lastName"
              autocomplete="family-name"
              [attr.aria-invalid]="showError('lastName')"
              [attr.aria-describedby]="showError('lastName') ? 'reg-last-err' : null"
            />
            @if (showError('lastName')) {
              <p msg id="reg-last-err" role="alert">{{ nameError('lastName') }}</p>
            }
          </kte-auth-field>
          <kte-auth-field label="Keresztnév" inputId="reg-first" [invalid]="showError('firstName')">
            <input
              id="reg-first"
              formControlName="firstName"
              autocomplete="given-name"
              [attr.aria-invalid]="showError('firstName')"
              [attr.aria-describedby]="showError('firstName') ? 'reg-first-err' : null"
            />
            @if (showError('firstName')) {
              <p msg id="reg-first-err" role="alert">{{ nameError('firstName') }}</p>
            }
          </kte-auth-field>
        </div>

        <kte-auth-field
          label="E-mail"
          icon="mail"
          inputId="reg-email"
          [invalid]="showError('email') || emailTaken()"
        >
          <input
            id="reg-email"
            type="email"
            formControlName="email"
            autocomplete="email"
            inputmode="email"
            [attr.aria-invalid]="showError('email') || emailTaken()"
            [attr.aria-describedby]="'reg-email-msg'"
          />
          <div msg id="reg-email-msg">
            @if (emailTaken()) {
              <p role="alert" data-testid="email-taken">
                Ehhez az e-mail-címhez már tartozik fiók.
                <a routerLink="/login" [queryParams]="returnQuery">Jelentkezz be</a>
              </p>
            } @else if (showError('email')) {
              <p role="alert">{{ emailError() }}</p>
            } @else {
              <p>Ide küldjük a visszaigazolásokat és a QR-kódokat.</p>
            }
          </div>
        </kte-auth-field>

        <div>
          <kte-auth-field
            label="Jelszó"
            icon="lock"
            inputId="reg-password"
            [invalid]="showError('password')"
          >
            <input
              id="reg-password"
              formControlName="password"
              autocomplete="new-password"
              [type]="showPassword() ? 'text' : 'password'"
              [attr.aria-invalid]="showError('password')"
              aria-describedby="reg-password-rule reg-password-err"
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
            <div msg id="reg-password-err">
              @if (showError('password')) {
                <p role="alert">{{ passwordError() }}</p>
              }
            </div>
          </kte-auth-field>

          <kte-password-meter [password]="passwordValue()" ruleId="reg-password-rule" />
        </div>

        @if (errorMessage(); as error) {
          <p class="error-block kte-auth-error" role="alert" data-testid="register-error">{{ error }}</p>
        }

        <button type="submit" class="kte-auth-submit" [disabled]="loading()" [attr.aria-busy]="loading()">
          @if (loading()) {
            <span class="kte-auth-spinner" aria-hidden="true"></span>
            Fiók létrehozása…
          } @else {
            Fiók létrehozása
          }
        </button>
      </form>
    </kte-auth-layout>
  `,
})
export class RegisterPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly emailTaken = signal(false);
  protected readonly showPassword = signal(false);

  // The same limits the server's RegisterDto enforces (names 2-100, email <= 255,
  // password as in shared/utils/password-rules.ts).
  protected readonly form = this.fb.nonNullable.group({
    lastName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    firstName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    email: ['', [Validators.required, strictEmailValidator, Validators.maxLength(255)]],
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

  constructor() {
    // A different address is a different question: forget "already registered".
    this.form.controls.email.valueChanges.subscribe(() => this.emailTaken.set(false));
  }

  protected get returnQuery(): Record<string, string> {
    const value = this.route.snapshot.queryParamMap.get('returnUrl');
    return value ? { returnUrl: value } : {};
  }

  /** A field's error shows once it has been left (or after a submit), never while typing in it. */
  protected showError(name: FieldName): boolean {
    const c = this.form.controls[name];
    return c.touched && c.invalid;
  }

  protected nameError(name: 'lastName' | 'firstName'): string {
    const errors = this.form.controls[name].errors;
    if (errors?.['required']) return 'Add meg a nevedet.';
    if (errors?.['maxlength']) return 'Legfeljebb 100 karakter lehet.';
    return 'Legalább 2 karakter kell.';
  }

  protected emailError(): string {
    const errors = this.form.controls.email.errors;
    if (errors?.['required']) return 'Add meg az e-mail-címedet.';
    if (errors?.['maxlength']) return 'Legfeljebb 255 karakter lehet.';
    return 'Ez nem érvényes e-mail-cím (pl. nev@pelda.hu).';
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
      document.querySelector<HTMLInputElement>('kte-register-page input.ng-invalid')?.focus();
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);
    this.emailTaken.set(false);
    const { email, password, firstName, lastName } = this.form.getRawValue();
    this.auth.register({ email, password, firstName, lastName }).subscribe({
      next: () => {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
        void this.router.navigateByUrl(returnUrl);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        if (err instanceof HttpErrorResponse && err.status === 409) {
          // The only conflict registration reports is an address that already has an account.
          this.emailTaken.set(true);
          document.getElementById('reg-email')?.focus();
          return;
        }
        this.errorMessage.set(extractErrorMessage(err, 'A regisztráció sikertelen.'));
      },
    });
  }
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error;
    if (body && typeof body === 'object' && 'message' in body) {
      const value = (body as { message: unknown }).message;
      if (typeof value === 'string') return value;
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    }
  }
  return fallback;
}
