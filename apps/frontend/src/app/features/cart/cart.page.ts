import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { CartFacade } from '../../core/cart/cart.facade';
import { CartItem } from '../../shared/models/cart.model';
import { HufCurrencyPipe } from '../../shared/pipes/huf-currency.pipe';
import { CountdownPipe } from '../../shared/pipes/countdown.pipe';

interface CartRow extends CartItem {
  readonly remainingMs: number;
}

@Component({
  selector: 'kte-cart-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatDividerModule,
    HufCurrencyPipe,
    CountdownPipe,
  ],
  template: `
    <section class="kte-cart">
      <header class="kte-cart__header">
        <h1>Kosár</h1>
        @if (rows().length > 0) {
          <span class="kte-cart__count">{{ rows().length }} jegy</span>
        }
      </header>

      @if (rows().length === 0) {
        <mat-card appearance="outlined" class="kte-cart__empty">
          <mat-card-content>
            <mat-icon class="kte-cart__empty-icon" aria-hidden="true">shopping_cart</mat-icon>
            <h2>A kosarad üres</h2>
            <p>Nézegesd a stadiontérképet, és válassz magadnak helyet a következő mérkőzésre.</p>
            <a mat-flat-button color="primary" routerLink="/stadium">
              <mat-icon>stadium</mat-icon>
              Stadiontérkép
            </a>
          </mat-card-content>
        </mat-card>
      } @else {
        <div class="kte-cart__items">
          @for (row of rows(); track row.seatId) {
            <mat-card appearance="outlined" class="kte-cart__row">
              <mat-card-content>
                <div class="kte-cart__row-info">
                  <strong>{{ row.homeTeam }} – {{ row.awayTeam }}</strong>
                  <span>{{ row.kickoffAt | date: "yyyy. MMM d. HH:mm" : '' : 'hu' }}</span>
                </div>
                <div class="kte-cart__row-seat">
                  <mat-chip-set>
                    <mat-chip highlighted>{{ row.section }}</mat-chip>
                  </mat-chip-set>
                  <span>Sor {{ row.row }} · Szék {{ row.seatNumber }}</span>
                </div>
                <div class="kte-cart__row-meta">
                  <span class="kte-cart__price">{{ row.price | hufCurrency }}</span>
                  <span class="kte-cart__countdown" [class.kte-cart__countdown--warn]="row.remainingMs < 60_000">
                    <mat-icon inline>timer</mat-icon>
                    {{ row.remainingMs | countdown }}
                  </span>
                </div>
                <div class="kte-cart__row-actions">
                  <button mat-icon-button color="warn" type="button" (click)="remove(row.seatId)" aria-label="Eltávolítás a kosárból">
                    <mat-icon>delete_outline</mat-icon>
                  </button>
                </div>
              </mat-card-content>
            </mat-card>
          }
        </div>

        <mat-card appearance="outlined" class="kte-cart__summary">
          <mat-card-content>
            <div class="kte-cart__summary-row">
              <span>Jegyek száma</span>
              <strong>{{ rows().length }}</strong>
            </div>
            <mat-divider />
            <div class="kte-cart__summary-row kte-cart__summary-row--total">
              <span>Végösszeg</span>
              <strong>{{ totalPrice() | hufCurrency }}</strong>
            </div>
            <p class="kte-cart__warning">
              <mat-icon inline>info</mat-icon>
              A foglalás 5 percig érvényes — ezalatt fejezd be a fizetést, különben a szék felszabadul.
            </p>
            <button
              mat-flat-button
              color="primary"
              type="button"
              class="kte-cart__checkout"
              [disabled]="rows().length === 0"
              (click)="proceedToCheckout()"
            >
              <mat-icon>payments</mat-icon>
              Tovább a pénztárhoz
            </button>
          </mat-card-content>
        </mat-card>
      }
    </section>
  `,
  styles: [
    `
      .kte-cart {
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-4);
        padding: var(--kte-spacing-6) var(--kte-spacing-4);
        max-width: 880px;
        margin: 0 auto;
      }
      .kte-cart__header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
      }
      .kte-cart__header h1 {
        margin: 0;
      }
      .kte-cart__count {
        color: rgba(0, 0, 0, 0.6);
      }
      .kte-cart__empty {
        text-align: center;
        padding: var(--kte-spacing-6);
        border-radius: var(--kte-radius-lg);
      }
      .kte-cart__empty-icon {
        font-size: 56px;
        width: 56px;
        height: 56px;
        color: var(--kte-color-primary);
      }
      .kte-cart__items {
        display: grid;
        gap: var(--kte-spacing-3);
      }
      .kte-cart__row mat-card-content {
        display: grid;
        grid-template-columns: 1.4fr 1fr 1fr auto;
        gap: var(--kte-spacing-3);
        align-items: center;
      }
      .kte-cart__row-info {
        display: flex;
        flex-direction: column;
      }
      .kte-cart__row-info strong {
        font-size: 16px;
      }
      .kte-cart__row-info span {
        color: rgba(0, 0, 0, 0.6);
        font-size: 13px;
      }
      .kte-cart__row-seat {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13px;
      }
      .kte-cart__row-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
      }
      .kte-cart__price {
        font-weight: 600;
        color: var(--kte-color-primary);
      }
      .kte-cart__countdown {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }
      .kte-cart__countdown--warn {
        color: #d32f2f;
      }
      .kte-cart__summary {
        border-radius: var(--kte-radius-lg);
        background: white;
        box-shadow: var(--kte-shadow-md);
      }
      .kte-cart__summary-row {
        display: flex;
        justify-content: space-between;
        padding: var(--kte-spacing-2) 0;
      }
      .kte-cart__summary-row--total {
        font-size: 20px;
      }
      .kte-cart__warning {
        margin: var(--kte-spacing-3) 0 var(--kte-spacing-3);
        color: rgba(0, 0, 0, 0.6);
        font-size: 13px;
        display: flex;
        gap: 6px;
        align-items: flex-start;
      }
      .kte-cart__checkout {
        width: 100%;
        height: 48px;
        font-size: 16px;
      }
      @media (max-width: 600px) {
        .kte-cart__row mat-card-content {
          grid-template-columns: 1fr;
        }
        .kte-cart__row-meta {
          align-items: flex-start;
        }
      }
    `,
  ],
})
export class CartPageComponent {
  private readonly cart = inject(CartFacade);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly rows = computed<readonly CartRow[]>(() => {
    const now = this.cart.lastTickMs();
    return this.cart.items().map((item) => ({
      ...item,
      remainingMs: Math.max(0, item.lockExpiresAtMs - now),
    }));
  });

  protected readonly totalPrice = computed(() => this.cart.total());

  /**
   * KTE-022: notify the user when an item drops out of the cart due to lock expiry.
   * We watch the cart length and the per-item countdowns to detect transitions
   * from "near-expiry" to "removed" — but a simpler signal is "lockExpiresAtMs <= now"
   * for an item that *was* present and is no longer.
   */
  private previousIds = new Set<string>();

  constructor() {
    effect(() => {
      const currentIds = new Set(this.cart.items().map((i) => i.seatId));
      const dropped: string[] = [];
      for (const prev of this.previousIds) {
        if (!currentIds.has(prev)) {
          dropped.push(prev);
        }
      }
      if (dropped.length > 0 && this.previousIds.size > 0) {
        this.snackBar.open(
          `${dropped.length} szék foglalása lejárt és kikerült a kosárból.`,
          'Bezárás',
          { duration: 6000 },
        );
      }
      this.previousIds = currentIds;
    });
  }

  protected async remove(seatId: string): Promise<void> {
    await this.cart.remove(seatId);
  }

  protected async proceedToCheckout(): Promise<void> {
    const validItems = await this.cart.assertValidForCheckout();
    if (validItems.length === 0) {
      this.snackBar.open(
        'A foglalt székek lejártak. Válassz újra a stadiontérképen.',
        'Bezárás',
        { duration: 6000 },
      );
      return;
    }

    if (!this.auth.isAuthenticated()) {
      // KTE-024: guest must log in before checkout, but cart is preserved.
      void this.router.navigate(['/login'], {
        queryParams: { returnUrl: '/checkout' },
      });
      return;
    }

    void this.router.navigate(['/checkout']);
  }
}
