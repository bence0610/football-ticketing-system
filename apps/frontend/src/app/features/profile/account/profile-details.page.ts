import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  WritableSignal,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../core/auth/auth.service';
import { UserProfile } from '../../../shared/models/auth.model';
import { AuthApiService } from '../../../shared/services/auth.api.service';
import {
  apiErrorCode,
  extractApiErrorMessage,
  splitFieldErrors,
} from '../../../shared/utils/api-error';
import { strictEmailValidator } from '../../../shared/validators/email.validator';
import { AuthFieldComponent } from '../../auth/components/auth-field.component';
import { AccountLayoutComponent, AccountSectionComponent } from './account-layout.component';
import { RATE_LIMITED_MESSAGE, focusFirstInvalid } from './account-form';

type DetailsField = 'lastName' | 'firstName' | 'phoneNumber' | 'dateOfBirth';
type EmailField = 'newEmail' | 'currentPassword';

/** What in a server validation message names each field (UpdateProfileDto wording or the property name). */
const DETAILS_MATCHERS: Readonly<Record<DetailsField, RegExp>> = {
  lastName: /vezetékn/i,
  firstName: /keresztn/i,
  phoneNumber: /telefon/i,
  dateOfBirth: /születés/i,
};
const EMAIL_MATCHERS: Readonly<Record<EmailField, RegExp>> = {
  newEmail: /e-mail|email/i,
  currentPassword: /jelsz|password/i,
};

/** The server's PHONE_NUMBER_PATTERN (UpdateProfileDto): digits, spaces, "+", "-", parentheses, 6-32 chars. */
const PHONE_PATTERN = /^[0-9+\-() ]{6,32}$/;
const OLDEST_BIRTH_DATE = '1900-01-01';

export const EMAIL_FIELD_MESSAGES = {
  currentPasswordIncorrect: 'A jelenlegi jelszó nem megfelelő.',
  emailUnchanged: 'Ez a jelenlegi e-mail-címed. Adj meg egy másikat.',
  emailTaken: 'Ehhez az e-mail-címhez már tartozik fiók.',
} as const;

export function pendingEmailMessage(pendingEmail: string): string {
  return (
    `Elküldtünk egy megerősítő levelet a ${pendingEmail} címre. A cím addig nem változik, ` +
    'amíg meg nem erősíted, és a régi címre is értesítést küldtünk.'
  );
}

/** Today in local time as 'YYYY-MM-DD', the upper bound of a birth date. */
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function birthDateValidator(control: AbstractControl): ValidationErrors | null {
  const value = control.value as string;
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(value).getTime())) {
    return { date: true };
  }
  if (value > todayIso()) return { future: true };
  if (value < OLDEST_BIRTH_DATE) return { tooOld: true };
  return null;
}

/**
 * /profile/details: the four editable profile fields, and - in a block of its
 * own - the e-mail address, which only changes once the link mailed to the new
 * address is opened.
 */
@Component({
  selector: 'kte-profile-details-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatIconModule,
    AccountLayoutComponent,
    AccountSectionComponent,
    AuthFieldComponent,
  ],
  template: `
    <kte-account-layout title="Adataim szerkesztése">
      @switch (load()) {
        @case ('loading') {
          <p class="kte-auth-lead" role="status" data-testid="details-loading">Adatok betöltése…</p>
        }
        @case ('failed') {
          <p class="error-block kte-auth-error" role="alert" data-testid="details-load-error">
            Nem sikerült betölteni az adataidat.
          </p>
          <button type="button" class="kte-auth-secondary" (click)="reload()">Újrapróbálom</button>
        }
        @case ('ready') {
          <!-- ───── Personal details ───── -->
          <kte-account-section heading="Személyes adatok" headingId="details-heading">
            <form
              [formGroup]="details"
              (ngSubmit)="saveDetails()"
              class="kte-auth-form kte-auth-form--card"
              novalidate
              data-testid="details-form"
            >
              <div class="kte-auth-form__row">
                <kte-auth-field label="Vezetéknév" inputId="pd-last" [invalid]="detailsInvalid('lastName')">
                  <input
                    id="pd-last"
                    formControlName="lastName"
                    autocomplete="family-name"
                    [attr.aria-invalid]="detailsInvalid('lastName')"
                    [attr.aria-describedby]="detailsInvalid('lastName') ? 'pd-last-err' : null"
                  />
                  @if (detailsInvalid('lastName')) {
                    <p msg id="pd-last-err" role="alert">{{ detailsError('lastName') }}</p>
                  }
                </kte-auth-field>
                <kte-auth-field label="Keresztnév" inputId="pd-first" [invalid]="detailsInvalid('firstName')">
                  <input
                    id="pd-first"
                    formControlName="firstName"
                    autocomplete="given-name"
                    [attr.aria-invalid]="detailsInvalid('firstName')"
                    [attr.aria-describedby]="detailsInvalid('firstName') ? 'pd-first-err' : null"
                  />
                  @if (detailsInvalid('firstName')) {
                    <p msg id="pd-first-err" role="alert">{{ detailsError('firstName') }}</p>
                  }
                </kte-auth-field>
              </div>

              <kte-auth-field
                label="Telefonszám (nem kötelező)"
                icon="call"
                inputId="pd-phone"
                [invalid]="detailsInvalid('phoneNumber')"
              >
                <input
                  id="pd-phone"
                  type="tel"
                  formControlName="phoneNumber"
                  autocomplete="tel"
                  inputmode="tel"
                  [attr.aria-invalid]="detailsInvalid('phoneNumber')"
                  aria-describedby="pd-phone-msg"
                />
                <div msg id="pd-phone-msg">
                  @if (detailsInvalid('phoneNumber')) {
                    <p role="alert">{{ detailsError('phoneNumber') }}</p>
                  } @else {
                    <p>Ha üresen hagyod, töröljük a megadott számot.</p>
                  }
                </div>
              </kte-auth-field>

              <kte-auth-field
                label="Születési dátum (nem kötelező)"
                icon="cake"
                inputId="pd-birth"
                [invalid]="detailsInvalid('dateOfBirth')"
              >
                <input
                  id="pd-birth"
                  type="date"
                  formControlName="dateOfBirth"
                  autocomplete="bday"
                  [min]="oldestBirthDate"
                  [max]="today"
                  [attr.aria-invalid]="detailsInvalid('dateOfBirth')"
                  [attr.aria-describedby]="detailsInvalid('dateOfBirth') ? 'pd-birth-err' : null"
                />
                @if (detailsInvalid('dateOfBirth')) {
                  <p msg id="pd-birth-err" role="alert">{{ detailsError('dateOfBirth') }}</p>
                }
              </kte-auth-field>

              @if (detailsSaved()) {
                <p class="kte-auth-notice" role="status" data-testid="details-saved">Mentve.</p>
              }
              @if (detailsErrorMessage(); as error) {
                <p class="error-block kte-auth-error" role="alert" data-testid="details-error">{{ error }}</p>
              }

              <button
                type="submit"
                class="kte-auth-submit"
                [disabled]="savingDetails()"
                [attr.aria-busy]="savingDetails()"
              >
                @if (savingDetails()) {
                  <span class="kte-auth-spinner" aria-hidden="true"></span>
                  Mentés…
                } @else {
                  Mentés
                }
              </button>
            </form>
          </kte-account-section>

          <!-- ───── E-mail address ───── -->
          <kte-account-section
            heading="E-mail-cím"
            headingId="email-heading"
            description="Erre a címre küldjük a visszaigazolásokat, a QR-kódokat és a meghívókat, és ezzel jelentkezel be."
          >
            <div class="current" data-testid="current-email">
              <span class="current__label" id="current-email-label">Jelenlegi cím</span>
              <span class="current__value" aria-labelledby="current-email-label">{{ currentEmail() }}</span>
            </div>

            @if (pendingEmail() && !emailFormOpen()) {
              <p class="kte-auth-notice pending" role="status" data-testid="email-pending">
                {{ pendingMessage() }}
              </p>
              <button
                type="button"
                class="kte-auth-secondary"
                data-testid="email-resend"
                (click)="openEmailForm()"
              >
                Levél újraküldése vagy másik cím
              </button>
            } @else {
              <h3 class="sub">Cím módosítása</h3>
              <p class="help" id="email-help" data-testid="email-help">
                Az új címre küldünk egy megerősítő linket; a cím csak akkor változik meg, ha azt
                megnyitod. A régi címedre értesítést küldünk. A jegyeid, a bérleteid, a hűségpontjaid
                és a meghívóid a fiókodhoz tartoznak, a cím cseréje után is megmaradnak.
              </p>
              <form
                [formGroup]="emailForm"
                (ngSubmit)="requestEmailChange()"
                class="kte-auth-form kte-auth-form--card"
                novalidate
                data-testid="email-form"
              >
                <kte-auth-field label="Új e-mail-cím" icon="mail" inputId="pd-new-email" [invalid]="emailInvalid('newEmail')">
                  <input
                    id="pd-new-email"
                    type="email"
                    formControlName="newEmail"
                    autocomplete="email"
                    inputmode="email"
                    [attr.aria-invalid]="emailInvalid('newEmail')"
                    [attr.aria-describedby]="emailInvalid('newEmail') ? 'pd-new-email-err email-help' : 'email-help'"
                  />
                  @if (emailInvalid('newEmail')) {
                    <p msg id="pd-new-email-err" role="alert">{{ emailError('newEmail') }}</p>
                  }
                </kte-auth-field>

                <kte-auth-field
                  label="Jelenlegi jelszó"
                  icon="lock"
                  inputId="pd-email-password"
                  [invalid]="emailInvalid('currentPassword')"
                >
                  <input
                    id="pd-email-password"
                    formControlName="currentPassword"
                    autocomplete="current-password"
                    [type]="showPassword() ? 'text' : 'password'"
                    [attr.aria-invalid]="emailInvalid('currentPassword')"
                    aria-describedby="pd-email-password-msg"
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
                  <div msg id="pd-email-password-msg">
                    @if (emailInvalid('currentPassword')) {
                      <p role="alert">{{ emailError('currentPassword') }}</p>
                    } @else {
                      <p>A biztonság kedvéért kérjük a jelszavadat is.</p>
                    }
                  </div>
                </kte-auth-field>

                @if (emailErrorMessage(); as error) {
                  <p class="error-block kte-auth-error" role="alert" data-testid="email-error">{{ error }}</p>
                }

                <button
                  type="submit"
                  class="kte-auth-submit"
                  [disabled]="sendingEmail()"
                  [attr.aria-busy]="sendingEmail()"
                >
                  @if (sendingEmail()) {
                    <span class="kte-auth-spinner" aria-hidden="true"></span>
                    Küldés…
                  } @else {
                    Cím módosítása
                  }
                </button>
                @if (pendingEmail()) {
                  <button type="button" class="kte-auth-secondary" (click)="closeEmailForm()">Mégse</button>
                }
              </form>
            }
          </kte-account-section>
        }
      }
    </kte-account-layout>
  `,
  styles: [
    `
      :host { display: block; }
      .current {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: var(--radius-block);
        background: var(--border-light);
      }
      .current__label {
        font-size: 12px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .current__value { font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
      .pending { margin: 16px 0 12px; overflow-wrap: anywhere; }
      .sub {
        margin: 20px 0 0;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 16px;
        color: var(--ink);
      }
      .help { margin: 6px 0 0; font-size: 14px; line-height: 1.5; color: var(--muted); }
    `,
  ],
})
export class ProfileDetailsPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AuthApiService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly load = signal<'loading' | 'failed' | 'ready'>('loading');
  protected readonly profile = signal<UserProfile | null>(null);

  protected readonly today = todayIso();
  protected readonly oldestBirthDate = OLDEST_BIRTH_DATE;

  // The same limits as the server's UpdateProfileDto (names 2-100, phone <= 32).
  protected readonly details = this.fb.nonNullable.group({
    lastName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    firstName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    phoneNumber: ['', [Validators.maxLength(32), Validators.pattern(PHONE_PATTERN)]],
    dateOfBirth: ['', [birthDateValidator]],
  });
  protected readonly savingDetails = signal(false);
  protected readonly detailsSaved = signal(false);
  protected readonly detailsErrorMessage = signal<string | null>(null);
  private readonly detailsServerErrors = signal<Partial<Record<DetailsField, string>>>({});

  protected readonly emailForm = this.fb.nonNullable.group({
    newEmail: ['', [Validators.required, strictEmailValidator, Validators.maxLength(255)]],
    currentPassword: ['', [Validators.required]],
  });
  protected readonly sendingEmail = signal(false);
  protected readonly emailErrorMessage = signal<string | null>(null);
  protected readonly emailFormOpen = signal(false);
  protected readonly showPassword = signal(false);
  private readonly emailServerErrors = signal<Partial<Record<EmailField, string>>>({});

  constructor() {
    // A server error belongs to the value it was given for: editing the field clears it.
    for (const name of Object.keys(this.details.controls) as DetailsField[]) {
      this.details.controls[name].valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.clearServerError(this.detailsServerErrors, name));
    }
    for (const name of Object.keys(this.emailForm.controls) as EmailField[]) {
      this.emailForm.controls[name].valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.clearServerError(this.emailServerErrors, name));
    }
    // "Mentve." describes the saved values, not the ones being typed now.
    this.details.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.detailsSaved.set(false));
  }

  ngOnInit(): void {
    this.reload();
  }

  protected reload(): void {
    this.load.set('loading');
    this.api.me().subscribe({
      next: (profile) => {
        this.applyProfile(profile);
        this.load.set('ready');
      },
      error: () => this.load.set('failed'),
    });
  }

  protected currentEmail(): string {
    return this.profile()?.email ?? '';
  }

  protected pendingEmail(): string | null {
    return this.profile()?.pendingEmail ?? null;
  }

  protected pendingMessage(): string {
    const pending = this.pendingEmail();
    return pending ? pendingEmailMessage(pending) : '';
  }

  // ───── Personal details ─────

  protected detailsInvalid(name: DetailsField): boolean {
    const c = this.details.controls[name];
    return (c.touched && c.invalid) || this.detailsServerErrors()[name] !== undefined;
  }

  protected detailsError(name: DetailsField): string {
    const server = this.detailsServerErrors()[name];
    if (server) return server;
    const errors = this.details.controls[name].errors;
    switch (name) {
      case 'lastName':
      case 'firstName':
        if (errors?.['required']) return 'Add meg a nevedet.';
        if (errors?.['maxlength']) return 'Legfeljebb 100 karakter lehet.';
        return 'Legalább 2 karakter kell.';
      case 'phoneNumber':
        if (errors?.['maxlength']) return 'Legfeljebb 32 karakter lehet.';
        return '6-32 karakter lehet, és csak számjegyet, szóközt, "+", "-" és zárójelet tartalmazhat.';
      case 'dateOfBirth':
        if (errors?.['future']) return 'A születési dátum nem lehet a jövőben.';
        if (errors?.['tooOld']) return 'Ellenőrizd az évszámot.';
        return 'Ez nem érvényes dátum.';
    }
  }

  protected saveDetails(): void {
    if (this.savingDetails()) return;
    if (this.details.invalid) {
      this.details.markAllAsTouched();
      focusFirstInvalid('kte-profile-details-page [data-testid="details-form"]');
      return;
    }
    this.savingDetails.set(true);
    this.detailsSaved.set(false);
    this.detailsErrorMessage.set(null);
    this.detailsServerErrors.set({});
    const { firstName, lastName, phoneNumber, dateOfBirth } = this.details.getRawValue();
    this.api
      .updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        // An empty string is how the phone number is cleared.
        phoneNumber: phoneNumber.trim(),
        // Emptied after a date was saved: null clears it. Never saved and still empty: nothing to send.
        ...(dateOfBirth ? { dateOfBirth } : this.profile()?.dateOfBirth ? { dateOfBirth: null } : {}),
      })
      .subscribe({
        next: (profile) => {
          this.savingDetails.set(false);
          this.applyProfile(profile);
          this.auth.syncProfile(profile);
          this.detailsSaved.set(true);
        },
        error: (err: unknown) => {
          this.savingDetails.set(false);
          if (err instanceof HttpErrorResponse && err.status === 429) {
            this.detailsErrorMessage.set(RATE_LIMITED_MESSAGE);
            return;
          }
          if (err instanceof HttpErrorResponse && err.status === 400 && !apiErrorCode(err)) {
            const { fields, rest } = splitFieldErrors(err, DETAILS_MATCHERS);
            if (Object.keys(fields).length > 0 || rest.length > 0) {
              this.detailsServerErrors.set(fields);
              this.detailsErrorMessage.set(rest.length > 0 ? rest.join(' ') : null);
              focusFirstInvalid('kte-profile-details-page [data-testid="details-form"]');
              return;
            }
          }
          this.detailsErrorMessage.set(extractApiErrorMessage(err, 'Nem sikerült menteni. Próbáld újra.'));
        },
      });
  }

  // ───── E-mail change ─────

  protected openEmailForm(): void {
    this.emailForm.reset({ newEmail: this.pendingEmail() ?? '', currentPassword: '' });
    this.emailServerErrors.set({});
    this.emailErrorMessage.set(null);
    this.emailFormOpen.set(true);
    setTimeout(() => document.getElementById('pd-email-password')?.focus());
  }

  protected closeEmailForm(): void {
    this.emailFormOpen.set(false);
    this.emailForm.reset();
  }

  protected emailInvalid(name: EmailField): boolean {
    const c = this.emailForm.controls[name];
    return (c.touched && c.invalid) || this.emailServerErrors()[name] !== undefined;
  }

  protected emailError(name: EmailField): string {
    const server = this.emailServerErrors()[name];
    if (server) return server;
    const errors = this.emailForm.controls[name].errors;
    if (name === 'currentPassword') return 'Add meg a jelenlegi jelszavadat.';
    if (errors?.['required']) return 'Add meg az új e-mail-címet.';
    if (errors?.['maxlength']) return 'Legfeljebb 255 karakter lehet.';
    return 'Ez nem érvényes e-mail-cím (pl. nev@pelda.hu).';
  }

  protected requestEmailChange(): void {
    if (this.sendingEmail()) return;
    const form = '[data-testid="email-form"]';
    if (this.emailForm.invalid) {
      this.emailForm.markAllAsTouched();
      focusFirstInvalid(`kte-profile-details-page ${form}`);
      return;
    }
    const newEmail = this.emailForm.controls.newEmail.value.trim();
    if (newEmail.toLowerCase() === this.currentEmail().toLowerCase()) {
      this.emailServerErrors.set({ newEmail: EMAIL_FIELD_MESSAGES.emailUnchanged });
      document.getElementById('pd-new-email')?.focus();
      return;
    }
    this.sendingEmail.set(true);
    this.emailErrorMessage.set(null);
    this.emailServerErrors.set({});
    this.api
      .requestEmailChange({ newEmail, currentPassword: this.emailForm.controls.currentPassword.value })
      .subscribe({
        next: (res) => {
          this.sendingEmail.set(false);
          const profile = this.profile();
          if (profile) this.profile.set({ ...profile, pendingEmail: res.pendingEmail });
          this.emailForm.reset();
          this.showPassword.set(false);
          this.emailFormOpen.set(false);
        },
        error: (err: unknown) => {
          this.sendingEmail.set(false);
          this.handleEmailError(err);
        },
      });
  }

  private handleEmailError(err: unknown): void {
    const code = apiErrorCode(err);
    const status = err instanceof HttpErrorResponse ? err.status : 0;
    if (code === 'current_password_incorrect') {
      this.emailServerErrors.set({ currentPassword: EMAIL_FIELD_MESSAGES.currentPasswordIncorrect });
      document.getElementById('pd-email-password')?.focus();
      return;
    }
    if (code === 'email_unchanged') {
      this.emailServerErrors.set({ newEmail: EMAIL_FIELD_MESSAGES.emailUnchanged });
      document.getElementById('pd-new-email')?.focus();
      return;
    }
    if (code === 'email_taken' || status === 409) {
      this.emailServerErrors.set({ newEmail: EMAIL_FIELD_MESSAGES.emailTaken });
      document.getElementById('pd-new-email')?.focus();
      return;
    }
    if (status === 429) {
      this.emailErrorMessage.set(RATE_LIMITED_MESSAGE);
      return;
    }
    if (status === 400 && !code) {
      const { fields, rest } = splitFieldErrors(err, EMAIL_MATCHERS);
      if (Object.keys(fields).length > 0 || rest.length > 0) {
        this.emailServerErrors.set(fields);
        this.emailErrorMessage.set(rest.length > 0 ? rest.join(' ') : null);
        return;
      }
    }
    this.emailErrorMessage.set(
      extractApiErrorMessage(err, 'Nem sikerült elküldeni a megerősítő levelet. Próbáld újra.'),
    );
  }

  // ───── helpers ─────

  private applyProfile(profile: UserProfile): void {
    this.profile.set(profile);
    this.details.reset(
      {
        lastName: profile.lastName,
        firstName: profile.firstName,
        phoneNumber: profile.phoneNumber ?? '',
        // The contract says 'YYYY-MM-DD'; a full ISO timestamp is cut to its date all the same.
        dateOfBirth: profile.dateOfBirth ? profile.dateOfBirth.slice(0, 10) : '',
      },
      { emitEvent: false },
    );
  }

  private clearServerError<F extends string>(
    store: WritableSignal<Partial<Record<F, string>>>,
    name: F,
  ): void {
    const current = store();
    if (current[name] === undefined) return;
    const next = { ...current };
    delete next[name];
    store.set(next);
  }
}
