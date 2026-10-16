import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { catchError, of } from 'rxjs';
import {
  PassLoanResponse,
  PassLoanStatus,
  SeasonPassResponse,
} from '../../../../core/models/season-pass.models';
import { MatchResource, MatchesService } from '../../../../core/services/matches.service';
import { SeasonPassesService } from '../../../../core/services/season-passes.service';

export interface LoanInitiationDialogData {
  pass: SeasonPassResponse;
}

export interface LoanInitiationDialogResult {
  created: boolean;
  loan?: PassLoanResponse;
}

type DialogStep = 1 | 2 | 3 | 4;

interface MatchOption {
  match: MatchResource;
  occupied: boolean;
}

const ACTIVE_LOAN_STATUSES: ReadonlySet<PassLoanStatus> = new Set<PassLoanStatus>([
  'pending',
  'accepted',
]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'kte-loan-initiation-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    DatePipe,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="loan-dialog">
      <header class="loan-dialog__header">
        <h2>{{ stepTitle() }}</h2>
        <button
          type="button"
          class="loan-dialog__close"
          aria-label="Bezárás"
          (click)="close()"
        >
          <mat-icon>close</mat-icon>
        </button>
      </header>

      <ol class="loan-dialog__steps" aria-label="Folyamat lépései">
        @for (step of [1, 2, 3, 4]; track step; let isLast = $last) {
          <li
            class="loan-dialog__step"
            [class.is-active]="currentStep() === step"
            [class.is-done]="currentStep() > step"
          >
            <span class="loan-dialog__step-dot"></span>
            @if (!isLast) {
              <span class="loan-dialog__step-line"></span>
            }
          </li>
        }
      </ol>

      <div class="loan-dialog__body">
        <!-- STEP 1: MATCH SELECTION -->
        @if (currentStep() === 1) {
          <p class="loan-dialog__description">
            Válaszd ki azt a mérkőzést, amelyre kölcsönadnád a bérleted. A felsorolt
            időpontokra a barátod a saját QR-jével léphet be.
          </p>

          @if (matchesLoading()) {
            <div class="loan-dialog__loader">
              <mat-spinner diameter="40"></mat-spinner>
            </div>
          } @else if (matchesError()) {
            <div class="loan-dialog__banner loan-dialog__banner--error">
              {{ matchesError() }}
            </div>
          } @else if (matchOptions().length === 0) {
            <p class="loan-dialog__empty">
              Jelenleg nincs olyan jövőbeli mérkőzés, amelyre kölcsönadhatnád a bérleted.
            </p>
          } @else {
            <ul class="loan-dialog__match-list" role="listbox">
              @for (option of matchOptions(); track option.match.id) {
                <li
                  role="option"
                  class="loan-dialog__match"
                  [class.is-selected]="selectedMatchId() === option.match.id"
                  [class.is-occupied]="option.occupied"
                  [attr.aria-selected]="selectedMatchId() === option.match.id"
                  [attr.aria-disabled]="option.occupied"
                  (click)="onSelectMatch(option)"
                  (keydown.enter)="onSelectMatch(option)"
                  (keydown.space)="onSelectMatch(option); $event.preventDefault()"
                  [attr.tabindex]="option.occupied ? -1 : 0"
                >
                  <span class="loan-dialog__match-bar"></span>
                  <div class="loan-dialog__match-info">
                    <div class="loan-dialog__match-title">
                      {{ option.match.homeTeam }} - {{ option.match.awayTeam }}
                    </div>
                    <div class="loan-dialog__match-meta">
                      {{ option.match.kickoffAt | date: 'EEEE, MMM d. HH:mm' : '' : 'hu-HU' }}
                      &middot; {{ option.match.venue }}
                    </div>
                  </div>
                  @if (option.occupied) {
                    <span class="loan-dialog__match-tag">KÖLCSÖNZÉS FOLYAMATBAN</span>
                  } @else if (selectedMatchId() === option.match.id) {
                    <mat-icon class="loan-dialog__match-check">check_circle</mat-icon>
                  }
                </li>
              }
            </ul>
          }
        }

        <!-- STEP 2: BORROWER EMAIL -->
        @if (currentStep() === 2) {
          <p class="loan-dialog__description">
            Add meg annak a barátodnak az email-címét, akinek átadnád a bérleted erre a
            mérkőzésre. Egy meghívólevelet fog kapni a részletekkel.
          </p>

          @if (selectedMatch(); as match) {
            <div class="loan-dialog__chip">
              <mat-icon>sports_soccer</mat-icon>
              <span>
                {{ match.homeTeam }} - {{ match.awayTeam }}
                &middot; {{ match.kickoffAt | date: 'MMM d. HH:mm' : '' : 'hu-HU' }}
              </span>
            </div>
          }

          <label class="loan-dialog__field">
            <span class="loan-dialog__label">Fogadó email-címe</span>
            <div
              class="loan-dialog__input-wrapper"
              [class.is-valid]="emailValid()"
              [class.is-invalid]="emailTouched() && !emailValid()"
            >
              <input
                type="email"
                class="loan-dialog__input"
                placeholder="barat@example.com"
                autocomplete="email"
                inputmode="email"
                [value]="borrowerEmail()"
                (input)="onEmailInput($event)"
                (blur)="onEmailBlur()"
              />
              @if (emailValid()) {
                <mat-icon class="loan-dialog__input-icon loan-dialog__input-icon--ok">
                  check_circle
                </mat-icon>
              } @else if (emailTouched() && borrowerEmail().length > 0) {
                <mat-icon class="loan-dialog__input-icon loan-dialog__input-icon--err">
                  error
                </mat-icon>
              }
            </div>
            @if (emailTouched() && emailErrorMessage(); as msg) {
              <span class="loan-dialog__field-error">{{ msg }}</span>
            }
          </label>
        }

        <!-- STEP 3: SUMMARY -->
        @if (currentStep() === 3) {
          <p class="loan-dialog__description">
            Ellenőrizd az alábbi adatokat. A "Kölcsönzés indítása" gombbal elküldjük a
            meghívót a fogadó félnek.
          </p>

          <div class="loan-dialog__summary">
            @if (selectedMatch(); as match) {
              <div class="loan-dialog__summary-row">
                <span class="loan-dialog__summary-label">MÉRKŐZÉS</span>
                <span class="loan-dialog__summary-value">
                  {{ match.homeTeam }} - {{ match.awayTeam }}
                </span>
              </div>
              <div class="loan-dialog__summary-row">
                <span class="loan-dialog__summary-label">DÁTUM ÉS HELYSZÍN</span>
                <span class="loan-dialog__summary-value">
                  {{ match.kickoffAt | date: 'yyyy. MMM d. HH:mm' : '' : 'hu-HU' }}
                  &middot; {{ match.venue }}
                </span>
              </div>
            }
            <div class="loan-dialog__summary-row">
              <span class="loan-dialog__summary-label">SZÉK</span>
              <span class="loan-dialog__summary-value">{{ data.pass.seatLabel ?? '-' }}</span>
            </div>
            <div class="loan-dialog__summary-row">
              <span class="loan-dialog__summary-label">FOGADÓ EMAIL-CÍME</span>
              <span class="loan-dialog__summary-value">{{ borrowerEmail() }}</span>
            </div>
          </div>

          <p class="loan-dialog__hint">
            A meghívó 48 órán át érvényes. Ha a fogadó nem fogadja el ezen az időszakon
            belül, a bérleted automatikusan visszakerül hozzád.
          </p>

          @if (submitError()) {
            <div class="loan-dialog__banner loan-dialog__banner--error">
              {{ submitError() }}
            </div>
          }
        }

        <!-- STEP 4: SUCCESS -->
        @if (currentStep() === 4 && createdLoan(); as loan) {
          <div class="loan-dialog__success">
            <div class="loan-dialog__success-icon">
              <mat-icon>check</mat-icon>
            </div>
            <h3 class="loan-dialog__success-title">KÖLCSÖNZÉS ELINDÍTVA</h3>
            <p class="loan-dialog__success-text">
              Elküldtük a meghívót {{ loan.borrowerEmail }} címre. Amint a fogadó fél
              elfogadja, értesítést kapsz.
            </p>

            <div class="loan-dialog__qr">
              <div class="loan-dialog__qr-frame">
                <div class="loan-dialog__qr-placeholder">
                  <mat-icon>qr_code_2</mat-icon>
                </div>
              </div>
              <div class="loan-dialog__qr-meta">
                <span class="loan-dialog__qr-label">LOAN ID</span>
                <span class="loan-dialog__qr-id">{{ loan.id }}</span>
              </div>
            </div>

            <p class="loan-dialog__success-note">
              A QR kódot a fogadó email-jében és a profil oldalon is elérheti, miután
              elfogadta a kölcsönzést.
            </p>
          </div>
        }
      </div>

      <footer class="loan-dialog__footer">
        @switch (currentStep()) {
          @case (1) {
            <button type="button" class="kte-btn kte-btn--secondary" (click)="close()">
              Mégsem
            </button>
            <button
              type="button"
              class="kte-btn kte-btn--primary"
              [disabled]="!selectedMatchId()"
              (click)="goToStep(2)"
            >
              Tovább
            </button>
          }
          @case (2) {
            <button
              type="button"
              class="kte-btn kte-btn--secondary"
              (click)="goToStep(1)"
            >
              Vissza
            </button>
            <button
              type="button"
              class="kte-btn kte-btn--primary"
              [disabled]="!emailValid()"
              (click)="goToStep(3)"
            >
              Tovább
            </button>
          }
          @case (3) {
            <button
              type="button"
              class="kte-btn kte-btn--secondary"
              [disabled]="submitting()"
              (click)="goToStep(2)"
            >
              Vissza
            </button>
            <button
              type="button"
              class="kte-btn kte-btn--primary"
              [class.is-loading]="submitting()"
              [disabled]="submitting()"
              (click)="submit()"
            >
              @if (submitting()) {
                <mat-spinner diameter="18" class="loan-dialog__btn-spinner"></mat-spinner>
              }
              <span>Kölcsönzés indítása</span>
            </button>
          }
          @case (4) {
            <button type="button" class="kte-btn kte-btn--secondary" (click)="close()">
              Bezárás
            </button>
          }
        }
      </footer>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        color: #ffffff;
        font-family: var(--kte-font-body);
      }

      .loan-dialog {
        width: 560px;
        max-width: 100%;
        background: #222222;
        border-radius: 8px;
        padding: 32px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .loan-dialog__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 16px;
        border-bottom: 1px solid #2e2e2e;
      }
      .loan-dialog__header h2 {
        margin: 0;
        font-family: var(--kte-font-display);
        font-weight: 700;
        font-size: 20px;
        line-height: 1.2;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #ffffff;
      }
      .loan-dialog__close {
        background: transparent;
        border: 0;
        color: #ababab;
        cursor: pointer;
        padding: 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .loan-dialog__close:hover {
        background: #2e2e2e;
        color: #ffffff;
      }

      .loan-dialog__steps {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        align-items: center;
        gap: 0;
      }
      .loan-dialog__step {
        display: flex;
        align-items: center;
        flex: 1;
      }
      .loan-dialog__step:last-child {
        flex: 0;
      }
      .loan-dialog__step-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #3a3a3a;
        flex-shrink: 0;
        transition: background 0.2s ease, transform 0.2s ease;
      }
      .loan-dialog__step.is-active .loan-dialog__step-dot,
      .loan-dialog__step.is-done .loan-dialog__step-dot {
        background: var(--kte-brand-mid);
      }
      .loan-dialog__step.is-active .loan-dialog__step-dot {
        transform: scale(1.15);
      }
      .loan-dialog__step-line {
        flex: 1;
        height: 1px;
        background: #2e2e2e;
        margin: 0 8px;
      }

      .loan-dialog__body {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-height: 240px;
      }

      .loan-dialog__description {
        margin: 0;
        font-size: 14px;
        font-weight: 400;
        color: #ababab;
        line-height: 1.5;
      }

      .loan-dialog__loader {
        display: flex;
        justify-content: center;
        padding: 32px 0;
      }
      .loan-dialog__empty {
        margin: 0;
        padding: 24px;
        text-align: center;
        color: #6b6b6b;
        font-size: 14px;
      }

      .loan-dialog__banner {
        padding: 12px 14px;
        border-radius: 4px;
        font-size: 13px;
        line-height: 1.4;
      }
      .loan-dialog__banner--error {
        border: 1px solid var(--kte-danger);
        background: rgba(138, 28, 28, 0.12); /* --kte-danger tint */
        color: var(--kte-danger);
      }

      /* Match list */
      .loan-dialog__match-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 320px;
        overflow-y: auto;
      }
      .loan-dialog__match-list::-webkit-scrollbar {
        width: 6px;
      }
      .loan-dialog__match-list::-webkit-scrollbar-thumb {
        background: #3a3a3a;
        border-radius: 3px;
      }
      .loan-dialog__match {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        background: #2e2e2e;
        border: 1px solid #3a3a3a;
        border-radius: 4px;
        padding: 12px 16px;
        cursor: pointer;
        transition: border-color 0.15s ease, background 0.15s ease;
        outline: none;
      }
      .loan-dialog__match:hover:not(.is-occupied) {
        border-color: #5a5a5a;
      }
      .loan-dialog__match:focus-visible:not(.is-occupied) {
        border-color: var(--kte-brand-mid);
      }
      .loan-dialog__match.is-selected {
        border-color: var(--kte-brand-mid);
        background: #2a2625;
      }
      .loan-dialog__match.is-occupied {
        cursor: not-allowed;
        opacity: 0.7;
      }
      .loan-dialog__match-bar {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: transparent;
        border-radius: 4px 0 0 4px;
        transition: background 0.15s ease;
      }
      .loan-dialog__match.is-selected .loan-dialog__match-bar {
        background: var(--kte-brand-mid);
      }
      .loan-dialog__match-info {
        flex: 1;
        min-width: 0;
      }
      .loan-dialog__match-title {
        font-size: 14px;
        font-weight: 600;
        color: #ffffff;
        line-height: 1.3;
      }
      .loan-dialog__match-meta {
        font-size: 12px;
        color: #ababab;
        margin-top: 4px;
        line-height: 1.3;
      }
      .loan-dialog__match-check {
        color: var(--kte-brand-mid);
        flex-shrink: 0;
      }
      .loan-dialog__match-tag {
        flex-shrink: 0;
        padding: 4px 8px;
        border-radius: 12px;
        background: rgba(138, 28, 28, 0.18); /* --kte-danger tint */
        color: var(--kte-danger);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }

      /* Email step */
      .loan-dialog__chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: #2e2e2e;
        border-radius: 4px;
        padding: 8px 12px;
        font-size: 13px;
        color: #ffffff;
        align-self: flex-start;
        max-width: 100%;
      }
      .loan-dialog__chip mat-icon {
        color: var(--kte-brand-mid);
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      .loan-dialog__field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .loan-dialog__label {
        font-size: 12px;
        font-weight: 600;
        color: #ababab;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .loan-dialog__input-wrapper {
        display: flex;
        align-items: center;
        background: #2e2e2e;
        border: 1px solid #3a3a3a;
        border-radius: 4px;
        padding: 0 12px;
        transition: border-color 0.15s ease;
      }
      .loan-dialog__input-wrapper:focus-within {
        border-color: var(--kte-brand-mid);
      }
      .loan-dialog__input-wrapper.is-valid {
        border-color: var(--kte-success);
      }
      .loan-dialog__input-wrapper.is-invalid {
        border-color: var(--kte-danger);
      }
      .loan-dialog__input {
        flex: 1;
        background: transparent;
        border: 0;
        outline: none;
        color: #ffffff;
        font-size: 14px;
        padding: 12px 0;
        font-family: inherit;
      }
      .loan-dialog__input::placeholder {
        color: #6b6b6b;
      }
      .loan-dialog__input-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
      .loan-dialog__input-icon--ok {
        color: var(--kte-success);
      }
      .loan-dialog__input-icon--err {
        color: var(--kte-danger);
      }
      .loan-dialog__field-error {
        font-size: 12px;
        color: var(--kte-danger);
      }

      /* Summary step */
      .loan-dialog__summary {
        background: #1a1a1a;
        border: 1px solid #2e2e2e;
        border-radius: 4px;
        padding: 20px 24px;
        display: flex;
        flex-direction: column;
      }
      .loan-dialog__summary-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px 0;
        border-bottom: 1px solid #2e2e2e;
      }
      .loan-dialog__summary-row:first-child {
        padding-top: 0;
      }
      .loan-dialog__summary-row:last-child {
        padding-bottom: 0;
        border-bottom: none;
      }
      .loan-dialog__summary-label {
        font-size: 11px;
        font-weight: 600;
        color: #6b6b6b;
        letter-spacing: 0.5px;
      }
      .loan-dialog__summary-value {
        font-size: 14px;
        color: #ffffff;
        font-weight: 500;
        word-break: break-word;
      }
      .loan-dialog__hint {
        margin: 0;
        padding-left: 12px;
        border-left: 2px solid var(--kte-brand-mid);
        font-size: 13px;
        color: #ababab;
        font-weight: 400;
        line-height: 1.5;
      }

      /* Success step */
      .loan-dialog__success {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 8px 0;
      }
      .loan-dialog__success-icon {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        border: 2px solid var(--kte-success);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
      }
      .loan-dialog__success-icon mat-icon {
        font-size: 32px;
        width: 32px;
        height: 32px;
        color: var(--kte-success);
      }
      .loan-dialog__success-title {
        margin: 0;
        font-family: var(--kte-font-display);
        font-weight: 700;
        font-size: 22px;
        color: var(--kte-success);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        text-align: center;
      }
      .loan-dialog__success-text {
        margin: 0;
        font-size: 14px;
        color: #ababab;
        text-align: center;
        line-height: 1.5;
      }
      .loan-dialog__qr {
        background: #1a1a1a;
        border: 1px solid #2e2e2e;
        border-radius: 4px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        width: 100%;
        max-width: 240px;
      }
      .loan-dialog__qr-frame {
        width: 160px;
        height: 160px;
        background: #ffffff;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .loan-dialog__qr-placeholder {
        color: #1a1a1a;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .loan-dialog__qr-placeholder mat-icon {
        font-size: 120px;
        width: 120px;
        height: 120px;
      }
      .loan-dialog__qr-meta {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        text-align: center;
      }
      .loan-dialog__qr-label {
        font-size: 10px;
        font-weight: 600;
        color: #6b6b6b;
        letter-spacing: 1px;
      }
      .loan-dialog__qr-id {
        font-size: 11px;
        color: #ababab;
        font-family: 'JetBrains Mono', 'Consolas', monospace;
        word-break: break-all;
      }
      .loan-dialog__success-note {
        margin: 0;
        font-size: 13px;
        color: #6b6b6b;
        text-align: center;
        font-weight: 400;
        line-height: 1.5;
      }

      /* Footer & buttons */
      .loan-dialog__footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 12px;
        padding-top: 16px;
        border-top: 1px solid #2e2e2e;
      }
      .kte-btn {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 10px 20px;
        border-radius: 4px;
        border: 1px solid transparent;
        font-family: var(--kte-font-display);
        font-weight: 700;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
        min-height: 40px;
      }
      .kte-btn:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }
      .kte-btn--primary {
        background: var(--kte-brand-mid);
        color: #ffffff;
      }
      .kte-btn--primary:not(:disabled):hover {
        background: var(--kte-brand-deep);
      }
      .kte-btn--primary.is-loading {
        opacity: 0.7;
      }
      .kte-btn--secondary {
        background: transparent;
        color: #ababab;
        border-color: #3a3a3a;
      }
      .kte-btn--secondary:not(:disabled):hover {
        background: #2e2e2e;
        color: #ffffff;
      }
      .loan-dialog__btn-spinner {
        --mdc-circular-progress-active-indicator-color: #ffffff;
      }
    `,
  ],
})
export class LoanInitiationDialogComponent implements OnInit {
  protected readonly currentStep = signal<DialogStep>(1);

  protected readonly matchesLoading = signal<boolean>(true);
  protected readonly matchesError = signal<string | null>(null);
  protected readonly matchOptions = signal<MatchOption[]>([]);
  protected readonly selectedMatchId = signal<string | null>(null);

  protected readonly borrowerEmail = signal<string>('');
  protected readonly emailTouched = signal<boolean>(false);

  protected readonly submitting = signal<boolean>(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly createdLoan = signal<PassLoanResponse | null>(null);

  protected readonly emailValid = computed<boolean>(() => {
    const value = this.borrowerEmail().trim();
    return EMAIL_REGEX.test(value);
  });

  protected readonly emailErrorMessage = computed<string | null>(() => {
    const value = this.borrowerEmail().trim();
    if (value.length === 0) {
      return 'Add meg a fogadó email-címét.';
    }
    if (!EMAIL_REGEX.test(value)) {
      return 'Érvénytelen email-cím formátum.';
    }
    return null;
  });

  protected readonly selectedMatch = computed<MatchResource | null>(() => {
    const id = this.selectedMatchId();
    if (!id) {
      return null;
    }
    const option = this.matchOptions().find((opt) => opt.match.id === id);
    return option ? option.match : null;
  });

  protected readonly stepTitle = computed<string>(() => {
    switch (this.currentStep()) {
      case 1:
        return 'Meccs kiválasztása';
      case 2:
        return 'Fogadó email megadása';
      case 3:
        return 'Összefoglaló';
      case 4:
        return 'Kölcsönzés sikeres';
      default:
        return '';
    }
  });

  private readonly matchesService = inject(MatchesService);
  private readonly seasonPassesService = inject(SeasonPassesService);

  constructor(
    public readonly dialogRef: MatDialogRef<LoanInitiationDialogComponent, LoanInitiationDialogResult>,
    @Inject(MAT_DIALOG_DATA) public readonly data: LoanInitiationDialogData,
  ) {
    this.dialogRef.disableClose = true;
  }

  ngOnInit(): void {
    this.loadMatches();
  }

  close(): void {
    this.dialogRef.close({
      created: this.createdLoan() !== null,
      loan: this.createdLoan() ?? undefined,
    });
  }

  goToStep(step: DialogStep): void {
    if (step === this.currentStep()) {
      return;
    }
    if (step === 2 && !this.selectedMatchId()) {
      return;
    }
    if (step === 3 && !this.emailValid()) {
      this.emailTouched.set(true);
      return;
    }
    if (step < this.currentStep()) {
      this.submitError.set(null);
    }
    this.currentStep.set(step);
  }

  onSelectMatch(option: MatchOption): void {
    if (option.occupied) {
      return;
    }
    this.selectedMatchId.set(option.match.id);
  }

  onEmailInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.borrowerEmail.set(input.value);
  }

  onEmailBlur(): void {
    this.emailTouched.set(true);
  }

  submit(): void {
    if (this.submitting()) {
      return;
    }
    const matchId = this.selectedMatchId();
    if (!matchId || !this.emailValid()) {
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);

    this.seasonPassesService
      .createLoan(this.data.pass.id, {
        matchId,
        borrowerEmail: this.borrowerEmail().trim(),
      })
      .subscribe({
        next: (loan) => {
          this.createdLoan.set(loan);
          this.submitting.set(false);
          this.currentStep.set(4);
        },
        error: (err: HttpErrorResponse) => {
          this.submitting.set(false);
          this.submitError.set(this.extractErrorMessage(err));
        },
      });
  }

  private loadMatches(): void {
    this.matchesLoading.set(true);
    this.matchesError.set(null);

    this.matchesService
      .listAll()
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.matchesError.set(
            this.extractErrorMessage(err, 'Nem sikerült betölteni a mérkőzéseket.'),
          );
          return of<MatchResource[]>([]);
        }),
      )
      .subscribe((matches) => {
        const now = Date.now();
        const blockedMatchIds = new Set(
          this.data.pass.loans
            .filter((loan) => ACTIVE_LOAN_STATUSES.has(loan.status))
            .map((loan) => loan.matchId),
        );

        const options: MatchOption[] = matches
          .filter(
            (m) =>
              m.isSeasonPassEligible &&
              new Date(m.kickoffAt).getTime() > now &&
              m.status !== 'cancelled' &&
              m.status !== 'finished' &&
              m.status !== 'postponed',
          )
          .sort(
            (a, b) =>
              new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime(),
          )
          .map((m) => ({
            match: m,
            occupied: blockedMatchIds.has(m.id),
          }));

        this.matchOptions.set(options);
        this.matchesLoading.set(false);
      });
  }

  private extractErrorMessage(err: HttpErrorResponse, fallback?: string): string {
    const apiMessage = err?.error?.message;
    if (typeof apiMessage === 'string' && apiMessage.length > 0) {
      return apiMessage;
    }
    if (Array.isArray(apiMessage) && apiMessage.length > 0) {
      return apiMessage.join(', ');
    }
    if (typeof err?.message === 'string' && err.message.length > 0 && !fallback) {
      return err.message;
    }
    return fallback ?? 'Ismeretlen hiba történt.';
  }
}
