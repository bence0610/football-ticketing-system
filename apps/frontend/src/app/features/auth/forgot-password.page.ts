import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { strictEmailValidator } from '../../shared/validators/email.validator';
import { AuthApiService } from '../../shared/services/auth.api.service';
import { AuthFieldComponent } from './components/auth-field.component';
import { AuthLayoutComponent } from './components/auth-layout.component';

/**
 * Asks for a password-reset link. What it shows afterwards is the server's own
 * answer, which is the same for every address: the page never says whether an
 * account exists.
 */
@Component({
  selector: 'kte-forgot-password-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, AuthLayoutComponent, AuthFieldComponent],
  template: `
    <kte-auth-layout mode="reset">
      <h1 class="kte-auth-title">Elfelejtett jelszó</h1>

      @if (sentMessage(); as message) {
        <p class="kte-auth-notice" role="status" data-testid="reset-requested" style="margin-top: 20px">
          {{ message }}
        </p>
        <p class="kte-auth-lead">
          Nem érkezett meg? Nézd meg a levélszemét mappát is. Ha ott sincs, kérhetsz új linket.
        </p>
        <div class="kte-auth-actions">
          <button type="button" class="kte-auth-secondary" data-testid="request-again" (click)="again()">
            Új link kérése
          </button>
          <a class="kte-auth-secondary" routerLink="/login">Vissza a bejelentkezéshez</a>
        </div>
      } @else {
        <p class="kte-auth-lead">
          Add meg az e-mail-címedet, és küldünk egy linket, amivel új jelszót állíthatsz be.
        </p>

        <form [formGroup]="form" (ngSubmit)="submit()" class="kte-auth-form" novalidate>
          <kte-auth-field label="E-mail" icon="mail" inputId="forgot-email" [invalid]="showError()">
            <input
              id="forgot-email"
              type="email"
              formControlName="email"
              autocomplete="email"
              inputmode="email"
              [attr.aria-invalid]="showError()"
              [attr.aria-describedby]="showError() ? 'forgot-email-err' : null"
            />
            @if (showError()) {
              <p msg id="forgot-email-err" role="alert">
                @if (form.controls.email.errors?.['required']) {
                  Add meg az e-mail-címedet.
                } @else {
                  Ez nem érvényes e-mail-cím (pl. nev&#64;pelda.hu).
                }
              </p>
            }
          </kte-auth-field>

          @if (errorMessage(); as error) {
            <p class="error-block kte-auth-error" role="alert" data-testid="forgot-error">{{ error }}</p>
          }

          <button type="submit" class="kte-auth-submit" [disabled]="loading()" [attr.aria-busy]="loading()">
            @if (loading()) {
              <span class="kte-auth-spinner" aria-hidden="true"></span>
              Küldés…
            } @else {
              Link küldése
            }
          </button>
        </form>

        <p class="kte-auth-switch">
          Eszedbe jutott? <a routerLink="/login">Bejelentkezés</a>
        </p>
      }
    </kte-auth-layout>
  `,
})
export class ForgotPasswordPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AuthApiService);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly sentMessage = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, strictEmailValidator, Validators.maxLength(255)]],
  });

  protected showError(): boolean {
    const c = this.form.controls.email;
    return c.touched && c.invalid;
  }

  protected again(): void {
    this.sentMessage.set(null);
  }

  protected submit(): void {
    if (this.loading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      document.querySelector<HTMLInputElement>('kte-forgot-password-page input')?.focus();
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);
    this.api.requestPasswordReset(this.form.controls.email.value.trim()).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.sentMessage.set(res.message);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.errorMessage.set(
          err instanceof HttpErrorResponse && err.status === 429
            ? 'Túl sok kérés érkezett. Próbáld újra egy kis idő múlva.'
            : 'Nem sikerült elküldeni a kérést. Próbáld újra.',
        );
      },
    });
  }
}
