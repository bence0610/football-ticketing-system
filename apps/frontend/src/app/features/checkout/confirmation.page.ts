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
  readonly seats: readonly {
    readonly section: string;
    readonly row: string;
    readonly seatNumber: number;
    readonly price: number;
  }[];
  readonly totalPaid: number;
}

@Component({
  selector: 'kte-confirmation-page',
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
    <section class="kte-confirmation">
      @if (state(); as confirmation) {
        <mat-card appearance="outlined" class="kte-confirmation__card">
          <mat-card-content>
            <div class="kte-confirmation__icon" aria-hidden="true">
              <mat-icon>check_circle</mat-icon>
            </div>
            <h1>Sikeres fizetés!</h1>
            <p class="kte-confirmation__lead">
              Köszönjük a vásárlást. Az e-jegyek hamarosan megérkeznek a regisztrált e-mail
              címedre.
            </p>

            <div class="kte-confirmation__order-id">
              <span>Rendelés azonosító</span>
              <strong>{{ confirmation.paymentIntentId }}</strong>
            </div>

            <mat-divider />

            <ul class="kte-confirmation__seats">
              @for (seat of confirmation.seats; track $index) {
                <li>
                  <strong>{{ seat.section }}</strong>
                  <span>Sor {{ seat.row }} · Szék {{ seat.seatNumber }}</span>
                  <span class="kte-confirmation__price">{{ seat.price | hufCurrency }}</span>
                </li>
              }
            </ul>

            <mat-divider />

            <div class="kte-confirmation__total">
              <span>Fizetett végösszeg</span>
              <strong>{{ confirmation.totalPaid | hufCurrency }}</strong>
            </div>

            <div class="kte-confirmation__actions">
              <a mat-flat-button color="primary" routerLink="/profile">
                <mat-icon>person</mat-icon>
                Profil megnyitása
              </a>
              <a mat-stroked-button routerLink="/">
                <mat-icon>home</mat-icon>
                Vissza a kezdőlapra
              </a>
            </div>
          </mat-card-content>
        </mat-card>
      } @else {
        <mat-card appearance="outlined" class="kte-confirmation__guard">
          <mat-card-content>
            <h2>Nincs megerősíthető fizetés</h2>
            <p>
              Ez az oldal csak sikeres fizetés után érhető el. Ha most fejeztél be egy vásárlást,
              ellenőrizd a profilodat.
            </p>
            <a mat-flat-button color="primary" routerLink="/profile">Profil megnyitása</a>
          </mat-card-content>
        </mat-card>
      }
    </section>
  `,
  styles: [
    `
      .kte-confirmation {
        display: flex;
        justify-content: center;
        padding: var(--kte-spacing-6) var(--kte-spacing-4);
      }
      .kte-confirmation__card,
      .kte-confirmation__guard {
        width: 100%;
        max-width: 720px;
        border-radius: var(--kte-radius-lg);
        box-shadow: var(--kte-shadow-md);
      }
      .kte-confirmation__card mat-card-content,
      .kte-confirmation__guard mat-card-content {
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-3);
        padding: var(--kte-spacing-6);
        text-align: center;
      }
      .kte-confirmation__icon mat-icon {
        font-size: 64px;
        width: 64px;
        height: 64px;
        color: #2e7d32;
      }
      .kte-confirmation__lead {
        color: rgba(0, 0, 0, 0.7);
      }
      .kte-confirmation__order-id {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      .kte-confirmation__order-id strong {
        font-family: 'Roboto Mono', monospace;
        font-size: 13px;
      }
      .kte-confirmation__seats {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-2);
      }
      .kte-confirmation__seats li {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: var(--kte-spacing-3);
        align-items: center;
        text-align: left;
        padding: var(--kte-spacing-2);
        border-radius: var(--kte-radius-md);
        background: rgba(10, 61, 98, 0.05);
      }
      .kte-confirmation__price {
        font-weight: 600;
      }
      .kte-confirmation__total {
        display: flex;
        justify-content: space-between;
        font-size: 18px;
      }
      .kte-confirmation__actions {
        display: flex;
        gap: var(--kte-spacing-3);
        justify-content: center;
        flex-wrap: wrap;
      }
    `,
  ],
})
export class ConfirmationPageComponent implements OnInit {
  private readonly router = inject(Router);

  protected readonly state = signal<ConfirmationState | null>(null);

  ngOnInit(): void {
    const navState = this.router.getCurrentNavigation()?.extras.state ??
      (typeof window !== 'undefined' ? (window.history.state as ConfirmationState | null) : null);
    if (
      navState &&
      typeof navState === 'object' &&
      'paymentIntentId' in navState &&
      'seats' in navState
    ) {
      this.state.set(navState as ConfirmationState);
    }
  }
}
