import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { HufCurrencyPipe } from '../../shared/pipes/huf-currency.pipe';

interface ConfirmationState {
  readonly paymentIntentId: string;
  readonly seasonPassId: string | null;
  readonly sectionName: string;
  readonly seasonLabel: string;
  readonly amount: number;
}

@Component({
  selector: 'kte-season-pass-confirmation-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    HufCurrencyPipe,
  ],
  template: `
    <section class="kte-season-pass-confirmation">
      @if (state(); as confirmation) {
        <mat-card appearance="outlined" class="kte-season-pass-confirmation__card">
          <mat-card-content>
            <div class="kte-season-pass-confirmation__icon" aria-hidden="true">
              <mat-icon>check_circle</mat-icon>
            </div>
            <h1>Sikeres bérletvásárlás!</h1>
            <p class="kte-season-pass-confirmation__lead">
              Köszönjük, hogy idén is velünk tartasz. A bérleted aktív, a
              visszaigazoló e-mail hamarosan megérkezik.
            </p>

            <div class="kte-season-pass-confirmation__order-id">
              <span>Tranzakció azonosító</span>
              <strong>{{ confirmation.paymentIntentId }}</strong>
            </div>

            <mat-divider />

            <dl class="kte-season-pass-confirmation__grid">
              <dt>Szektor</dt>
              <dd>{{ confirmation.sectionName }}</dd>
              <dt>Szezon</dt>
              <dd>{{ confirmation.seasonLabel }}</dd>
              <dt>Fizetett összeg</dt>
              <dd>{{ confirmation.amount | hufCurrency }}</dd>
              @if (confirmation.seasonPassId) {
                <dt>Bérlet azonosító</dt>
                <dd class="kte-season-pass-confirmation__mono">
                  {{ confirmation.seasonPassId }}
                </dd>
              }
            </dl>

            <mat-divider />

            <div class="kte-season-pass-confirmation__actions">
              <a mat-flat-button color="primary" routerLink="/profile">
                <mat-icon>confirmation_number</mat-icon>
                Bérleteim megtekintése
              </a>
              <a mat-stroked-button routerLink="/">
                <mat-icon>home</mat-icon>
                Vissza a kezdőlapra
              </a>
            </div>
          </mat-card-content>
        </mat-card>
      } @else {
        <mat-card appearance="outlined" class="kte-season-pass-confirmation__guard">
          <mat-card-content>
            <h2>Nincs megerősíthető bérletvásárlás</h2>
            <p>
              Ez az oldal csak sikeres bérletvásárlás után érhető el. Ha most fejeztél be
              egy vásárlást, ellenőrizd a profilodat.
            </p>
            <a mat-flat-button color="primary" routerLink="/profile">Profil megnyitása</a>
          </mat-card-content>
        </mat-card>
      }
    </section>
  `,
  styles: [
    `
      .kte-season-pass-confirmation {
        display: flex;
        justify-content: center;
        padding: var(--kte-spacing-6) var(--kte-spacing-4);
      }
      .kte-season-pass-confirmation__card,
      .kte-season-pass-confirmation__guard {
        width: 100%;
        max-width: 720px;
        border-radius: var(--kte-radius-lg);
        box-shadow: var(--kte-shadow-md);
      }
      .kte-season-pass-confirmation__card mat-card-content,
      .kte-season-pass-confirmation__guard mat-card-content {
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-3);
        padding: var(--kte-spacing-6);
        text-align: center;
      }
      .kte-season-pass-confirmation__icon mat-icon {
        font-size: 64px;
        width: 64px;
        height: 64px;
        color: #2e7d32;
      }
      .kte-season-pass-confirmation__lead {
        color: rgba(0, 0, 0, 0.7);
      }
      .kte-season-pass-confirmation__order-id {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      .kte-season-pass-confirmation__order-id strong {
        font-family: 'Roboto Mono', monospace;
        font-size: 13px;
      }
      .kte-season-pass-confirmation__grid {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 6px var(--kte-spacing-4);
        margin: 0;
        text-align: left;
      }
      .kte-season-pass-confirmation__grid dt {
        font-weight: 600;
        color: rgba(0, 0, 0, 0.6);
      }
      .kte-season-pass-confirmation__grid dd {
        margin: 0;
      }
      .kte-season-pass-confirmation__mono {
        font-family: 'Roboto Mono', monospace;
        font-size: 12px;
        word-break: break-all;
      }
      .kte-season-pass-confirmation__actions {
        display: flex;
        gap: var(--kte-spacing-3);
        justify-content: center;
        flex-wrap: wrap;
      }
    `,
  ],
})
export class SeasonPassConfirmationPageComponent implements OnInit {
  private readonly router = inject(Router);

  protected readonly state = signal<ConfirmationState | null>(null);

  ngOnInit(): void {
    const navState =
      this.router.getCurrentNavigation()?.extras.state ??
      (typeof window !== 'undefined' ? (window.history.state as ConfirmationState | null) : null);
    if (
      navState &&
      typeof navState === 'object' &&
      'paymentIntentId' in navState &&
      'sectionName' in navState
    ) {
      this.state.set(navState as ConfirmationState);
    }
  }
}
