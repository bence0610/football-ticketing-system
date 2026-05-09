import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'kte-login-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
  ],
  template: `
    <section class="kte-auth-page">
      <mat-card class="kte-auth-card" appearance="outlined">
        @if (loading()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <mat-card-header>
          <mat-card-title>Bejelentkezés</mat-card-title>
          <mat-card-subtitle>Üdv újra a KTE Jegyportálban</mat-card-subtitle>
        </mat-card-header>

        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="submit()" class="kte-auth-form">
            <mat-form-field appearance="outline">
              <mat-label>E-mail</mat-label>
              <input matInput type="email" formControlName="email" autocomplete="email" />
              <mat-icon matPrefix>mail</mat-icon>
              @if (form.controls.email.touched && form.controls.email.errors) {
                <mat-error>
                  @if (form.controls.email.errors?.['required']) {
                    E-mail megadása kötelező.
                  } @else {
                    Érvénytelen e-mail formátum.
                  }
                </mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Jelszó</mat-label>
              <input
                matInput
                [type]="showPassword() ? 'text' : 'password'"
                formControlName="password"
                autocomplete="current-password"
              />
              <button
                mat-icon-button
                matSuffix
                type="button"
                (click)="togglePassword()"
                [attr.aria-label]="showPassword() ? 'Jelszó elrejtése' : 'Jelszó megjelenítése'"
              >
                <mat-icon>{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              @if (form.controls.password.touched && form.controls.password.errors) {
                <mat-error>
                  @if (form.controls.password.errors?.['required']) {
                    A jelszó megadása kötelező.
                  } @else {
                    A jelszónak legalább 8 karakteresnek kell lennie.
                  }
                </mat-error>
              }
            </mat-form-field>

            @if (errorMessage(); as error) {
              <p class="kte-auth-form__error" role="alert">{{ error }}</p>
            }

            <button
              mat-flat-button
              color="primary"
              type="submit"
              class="kte-auth-form__submit"
              [disabled]="loading() || form.invalid"
            >
              Bejelentkezés
            </button>
          </form>
        </mat-card-content>

        <mat-card-actions class="kte-auth-card__actions">
          <span>Még nincs fiókod?</span>
          <a mat-button color="primary" routerLink="/register" [queryParams]="returnQuery">
            Regisztráció
          </a>
        </mat-card-actions>
      </mat-card>
    </section>
  `,
  styles: [
    `
      .kte-auth-page {
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: var(--kte-spacing-8) var(--kte-spacing-4);
        min-height: 100%;
      }
      .kte-auth-card {
        width: 100%;
        max-width: 420px;
        border-radius: var(--kte-radius-lg);
        box-shadow: var(--kte-shadow-md);
      }
      .kte-auth-form {
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-3);
      }
      .kte-auth-form__error {
        margin: 0;
        padding: var(--kte-spacing-3) var(--kte-spacing-4);
        background: rgba(244, 67, 54, 0.08);
        color: #b71c1c;
        border-radius: var(--kte-radius-md);
        font-size: 14px;
      }
      .kte-auth-form__submit {
        height: 48px;
        font-size: 16px;
      }
      .kte-auth-card__actions {
        justify-content: flex-end;
        gap: var(--kte-spacing-2);
        padding: var(--kte-spacing-3) var(--kte-spacing-4) var(--kte-spacing-4);
      }
    `,
  ],
})
export class LoginPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly showPassword = signal(false);

  protected readonly form: FormGroup<{
    email: import('@angular/forms').FormControl<string>;
    password: import('@angular/forms').FormControl<string>;
  }> = this.fb.nonNullable.group({
    email: this.fb.nonNullable.control('', [Validators.required, Validators.email]),
    password: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(8)]),
  });

  protected get returnQuery(): Record<string, string> {
    const value = this.route.snapshot.queryParamMap.get('returnUrl');
    return value ? { returnUrl: value } : {};
  }

  protected togglePassword(): void {
    this.showPassword.update((value) => !value);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);
    const { email, password } = this.form.getRawValue();
    this.auth.login({ email, password }).subscribe({
      next: () => {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
        void this.router.navigateByUrl(returnUrl);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.errorMessage.set(extractErrorMessage(err, 'Hibás e-mail vagy jelszó.'));
      },
      complete: () => this.loading.set(false),
    });
  }
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error;
    if (body && typeof body === 'object' && 'message' in body) {
      const value = (body as { message: unknown }).message;
      if (typeof value === 'string') {
        return value;
      }
      if (Array.isArray(value) && typeof value[0] === 'string') {
        return value[0];
      }
    }
  }
  return fallback;
}
