import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuthService } from '../../core/auth/auth.service';
import { MatchesActions, selectAllMatches } from '../../state/matches';
import { strictEmailValidator } from '../../shared/validators/email.validator';
import { availabilityOf, upcomingHomeMatches } from '../home/logic/match-availability';
import { AuthFieldComponent } from './components/auth-field.component';
import { AuthLayoutComponent } from './components/auth-layout.component';

@Component({
  selector: 'kte-login-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    MatIconModule,
    AuthLayoutComponent,
    AuthFieldComponent,
  ],
  template: `
    <kte-auth-layout mode="login">
      @if (nextMatch(); as m) {
        <div brandExtra class="next" data-testid="login-next-match">
          <span class="next__eyebrow">Következő hazai mérkőzés</span>
          <strong class="next__fixture">{{ m.homeTeam }} – {{ m.awayTeam }}</strong>
          <span class="next__meta">
            {{ m.kickoffAt | date: 'yyyy. MMMM d., HH:mm' : '' : 'hu-HU' }} · {{ m.venue }}
          </span>
          <span class="next__chip">{{ availability(m) }}</span>
        </div>
      }

      <h1 class="kte-auth-title">Bejelentkezés</h1>
      <p class="kte-auth-switch">
        Nincs még fiókod?
        <a routerLink="/register" [queryParams]="returnQuery">Regisztráció</a>
      </p>

      @if (justReset) {
        <p class="kte-auth-notice" role="status" data-testid="login-reset-done" style="margin-top: 20px">
          A jelszavad megváltozott. Jelentkezz be az új jelszóval.
        </p>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" class="kte-auth-form" novalidate>
        <kte-auth-field
          label="E-mail"
          icon="mail"
          inputId="login-email"
          [invalid]="showError('email')"
        >
          <input
            id="login-email"
            type="email"
            formControlName="email"
            autocomplete="email"
            inputmode="email"
            [attr.aria-invalid]="showError('email')"
            [attr.aria-describedby]="showError('email') ? 'login-email-err' : null"
          />
          @if (showError('email')) {
            <p msg id="login-email-err" role="alert">
              @if (form.controls.email.errors?.['required']) {
                Add meg az e-mail-címedet.
              } @else {
                Ez nem érvényes e-mail-cím (pl. nev&#64;pelda.hu).
              }
            </p>
          }
        </kte-auth-field>

        <kte-auth-field
          label="Jelszó"
          icon="lock"
          inputId="login-password"
          [invalid]="showError('password')"
        >
          <input
            id="login-password"
            formControlName="password"
            autocomplete="current-password"
            [type]="showPassword() ? 'text' : 'password'"
            [attr.aria-invalid]="showError('password')"
            [attr.aria-describedby]="showError('password') ? 'login-password-err' : null"
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
          @if (showError('password')) {
            <p msg id="login-password-err" role="alert">Add meg a jelszavadat.</p>
          }
        </kte-auth-field>

        <a class="kte-auth-forgot" routerLink="/forgot-password" data-testid="forgot-link">Elfelejtett jelszó?</a>

        @if (errorMessage(); as error) {
          <p class="error-block kte-auth-error" role="alert" data-testid="login-error">{{ error }}</p>
        }

        <button type="submit" class="kte-auth-submit" [disabled]="loading()" [attr.aria-busy]="loading()">
          @if (loading()) {
            <span class="kte-auth-spinner" aria-hidden="true"></span>
            Bejelentkezés…
          } @else {
            Bejelentkezés
          }
        </button>
      </form>
    </kte-auth-layout>
  `,
  styles: [
    `
      .next {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 16px 18px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.18);
      }
      .next__eyebrow {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--on-brand-eyebrow, rgba(255, 255, 255, 0.75));
      }
      .next__fixture { font-family: var(--font-display); font-size: 18px; font-weight: 700; }
      .next__meta { font-size: 14px; color: rgba(255, 255, 255, 0.85); }
      .next__chip {
        align-self: flex-start;
        margin-top: 4px;
        padding: 2px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        background: rgba(255, 255, 255, 0.16);
      }
    `,
  ],
})
export class LoginPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(Store);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly showPassword = signal(false);

  /** The next home match from the real match list; none means no panel at all. */
  private readonly all = toSignal(this.store.select(selectAllMatches), { initialValue: [] });
  protected readonly nextMatch = computed(() => upcomingHomeMatches(this.all(), Date.now())[0] ?? null);
  protected readonly availability = (m: Parameters<typeof availabilityOf>[0]): string =>
    availabilityOf(m).label;

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, strictEmailValidator]],
    // The server decides what a valid password is; login only needs one typed.
    password: ['', [Validators.required]],
  });

  /** Arrived from the set-new-password page: say the password was changed. */
  protected get justReset(): boolean {
    return this.route.snapshot.queryParamMap.get('reset') === '1';
  }

  protected get returnQuery(): Record<string, string> {
    const value = this.route.snapshot.queryParamMap.get('returnUrl');
    return value ? { returnUrl: value } : {};
  }

  ngOnInit(): void {
    this.store.dispatch(MatchesActions.loadMatches());
  }

  /** A field's error shows once it has been left (or after a submit), never while typing in it. */
  protected showError(name: 'email' | 'password'): boolean {
    const c = this.form.controls[name];
    return c.touched && c.invalid;
  }

  protected submit(): void {
    if (this.loading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      document
        .querySelector<HTMLInputElement>('kte-login-page input.ng-invalid')
        ?.focus();
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
