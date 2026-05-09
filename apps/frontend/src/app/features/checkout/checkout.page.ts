import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import type { Stripe, StripeElements, StripePaymentElement } from '@stripe/stripe-js';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { CartFacade } from '../../core/cart/cart.facade';
import { LoyaltyService } from '../../core/services/loyalty.service';
import { StripeService } from '../../core/stripe/stripe.service';
import {
  MatchWeatherForecast,
  PaymentIntentResponse,
} from '../../shared/models/payment.model';
import { HufCurrencyPipe } from '../../shared/pipes/huf-currency.pipe';
import { CountdownPipe } from '../../shared/pipes/countdown.pipe';
import { PaymentsApiService } from '../../shared/services/payments.api.service';
import { SeatsApiService } from '../../shared/services/seats.api.service';
import { WeatherApiService } from '../../shared/services/weather.api.service';
import {
  DiscountBreakdown,
  DiscountBreakdownComponent,
} from './components/discount-breakdown.component';
import { WeatherBannerComponent } from './components/weather-banner.component';

const MAX_RETRY_ATTEMPTS = 3;

@Component({
  selector: 'kte-checkout-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatProgressSpinnerModule,
    HufCurrencyPipe,
    CountdownPipe,
    WeatherBannerComponent,
    DiscountBreakdownComponent,
  ],
  template: `
    <section class="kte-checkout">
      <header class="kte-checkout__header">
        <h1>Fizetés</h1>
        <a mat-button routerLink="/cart">
          <mat-icon>arrow_back</mat-icon>
          Vissza a kosárhoz
        </a>
      </header>

      @if (cart.isEmpty()) {
        <mat-card appearance="outlined" class="kte-checkout__empty">
          <mat-card-content>
            <h2>A kosarad üres</h2>
            <p>Válassz előbb székeket a stadiontérképen.</p>
            <a mat-flat-button color="primary" routerLink="/stadium">Stadiontérkép</a>
          </mat-card-content>
        </mat-card>
      } @else {
        <kte-weather-banner
          [forecast]="weather()"
          [sectionsInCart]="sectionsInCart()"
        />

        <div class="kte-checkout__layout">
          <div class="kte-checkout__form">
            <mat-card appearance="outlined">
              <mat-card-header>
                <mat-card-title>Vásárló adatai</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                @if (auth.user(); as user) {
                  <dl class="kte-checkout__user-grid">
                    <dt>Név</dt>
                    <dd>{{ user.lastName }} {{ user.firstName }}</dd>
                    <dt>E-mail</dt>
                    <dd>{{ user.email }}</dd>
                  </dl>
                }
              </mat-card-content>
            </mat-card>

            <mat-card appearance="outlined">
              <mat-card-header>
                <mat-card-title>Bankkártya</mat-card-title>
                <mat-card-subtitle>A kártyaadatokat a Stripe biztonságosan kezeli.</mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                @if (initializationError(); as initErr) {
                  <p class="kte-checkout__error" role="alert">{{ initErr }}</p>
                } @else if (!intent()) {
                  <div class="kte-checkout__loader">
                    <mat-spinner diameter="32" />
                    <span>Fizetési felület előkészítése...</span>
                  </div>
                }
                <div #paymentElement class="kte-checkout__payment-element"></div>

                @if (paymentError(); as msg) {
                  <p class="kte-checkout__error" role="alert">{{ msg }}</p>
                }

                @if (failureCount() >= MAX_RETRY_ATTEMPTS) {
                  <div class="kte-checkout__support">
                    <mat-icon>support_agent</mat-icon>
                    <div>
                      <strong>Több sikertelen próbálkozás történt.</strong>
                      <p>
                        Vegye fel a kapcsolatot az ügyfélszolgálattal:
                        <a [href]="'mailto:' + supportEmail">{{ supportEmail }}</a>
                      </p>
                    </div>
                  </div>
                }

                <button
                  mat-flat-button
                  color="primary"
                  type="button"
                  class="kte-checkout__pay"
                  [disabled]="!intent() || processing()"
                  (click)="confirmPayment()"
                >
                  @if (processing()) {
                    <mat-spinner diameter="20" />
                    Feldolgozás...
                  } @else {
                    <mat-icon>lock</mat-icon>
                    Biztonságos fizetés ({{ totalAmount() | hufCurrency }})
                  }
                </button>
              </mat-card-content>
            </mat-card>
          </div>

          <aside class="kte-checkout__summary">
            <mat-card appearance="outlined">
              <mat-card-header>
                <mat-card-title>Összesítő</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                @for (item of cart.items(); track item.seatId) {
                  <div class="kte-checkout__line">
                    <div>
                      <strong>{{ item.section }}</strong>
                      <span>Sor {{ item.row }} · Szék {{ item.seatNumber }}</span>
                    </div>
                    <span>{{ item.price | hufCurrency }}</span>
                  </div>
                }
                <mat-divider />
                <div class="kte-checkout__line kte-checkout__line--total">
                  <strong>Végösszeg</strong>
                  <strong>{{ totalAmount() | hufCurrency }}</strong>
                </div>

                @if (discountPreview(); as preview) {
                  <kte-discount-breakdown [breakdown]="preview" />
                }

                <div class="kte-checkout__lock-status">
                  <mat-icon inline>timer</mat-icon>
                  Foglalás lejár: <strong>{{ minRemainingMs() | countdown }}</strong>
                </div>
              </mat-card-content>
            </mat-card>
          </aside>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .kte-checkout {
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-4);
        padding: var(--kte-spacing-6) var(--kte-spacing-4);
        max-width: 1100px;
        margin: 0 auto;
      }
      .kte-checkout__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .kte-checkout__header h1 {
        margin: 0;
      }
      .kte-checkout__empty {
        text-align: center;
        padding: var(--kte-spacing-6);
      }
      .kte-checkout__layout {
        display: grid;
        grid-template-columns: 1.4fr 1fr;
        gap: var(--kte-spacing-4);
      }
      .kte-checkout__form {
        display: grid;
        gap: var(--kte-spacing-3);
      }
      .kte-checkout__user-grid {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 6px var(--kte-spacing-3);
        margin: 0;
      }
      .kte-checkout__user-grid dt {
        font-weight: 600;
        color: rgba(0, 0, 0, 0.6);
      }
      .kte-checkout__user-grid dd {
        margin: 0;
      }
      .kte-checkout__payment-element {
        min-height: 240px;
        margin: var(--kte-spacing-3) 0;
      }
      .kte-checkout__loader {
        display: flex;
        align-items: center;
        gap: var(--kte-spacing-2);
        color: rgba(0, 0, 0, 0.6);
        margin: var(--kte-spacing-3) 0;
      }
      .kte-checkout__error {
        background: rgba(244, 67, 54, 0.08);
        color: #b71c1c;
        padding: var(--kte-spacing-3);
        border-radius: var(--kte-radius-md);
        margin: var(--kte-spacing-2) 0;
      }
      .kte-checkout__support {
        display: flex;
        gap: var(--kte-spacing-2);
        align-items: flex-start;
        padding: var(--kte-spacing-3);
        background: rgba(255, 152, 0, 0.1);
        color: #b26500;
        border-radius: var(--kte-radius-md);
        margin: var(--kte-spacing-2) 0;
      }
      .kte-checkout__support p {
        margin: 4px 0 0;
      }
      .kte-checkout__pay {
        width: 100%;
        height: 48px;
        font-size: 16px;
        gap: var(--kte-spacing-2);
      }
      .kte-checkout__line {
        display: flex;
        justify-content: space-between;
        padding: var(--kte-spacing-2) 0;
        font-size: 14px;
      }
      .kte-checkout__line div {
        display: flex;
        flex-direction: column;
      }
      .kte-checkout__line div span {
        color: rgba(0, 0, 0, 0.6);
        font-size: 12px;
      }
      .kte-checkout__line--total {
        font-size: 18px;
      }
      .kte-checkout__lock-status {
        margin-top: var(--kte-spacing-3);
        color: rgba(0, 0, 0, 0.6);
        font-size: 13px;
        display: inline-flex;
        gap: 6px;
        align-items: center;
      }
      @media (max-width: 900px) {
        .kte-checkout__layout {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class CheckoutPageComponent implements OnInit, AfterViewInit, OnDestroy {
  protected readonly cart = inject(CartFacade);
  protected readonly auth = inject(AuthService);
  private readonly paymentsApi = inject(PaymentsApiService);
  private readonly seatsApi = inject(SeatsApiService);
  private readonly weatherApi = inject(WeatherApiService);
  private readonly stripeService = inject(StripeService);
  private readonly loyaltyService = inject(LoyaltyService);
  private readonly router = inject(Router);

  protected readonly intent = signal<PaymentIntentResponse | null>(null);
  protected readonly weather = signal<MatchWeatherForecast | null>(null);
  protected readonly processing = signal(false);
  protected readonly paymentError = signal<string | null>(null);
  protected readonly initializationError = signal<string | null>(null);
  protected readonly failureCount = signal(0);
  protected readonly discountPreview = signal<DiscountBreakdown | null>(null);
  protected readonly MAX_RETRY_ATTEMPTS = MAX_RETRY_ATTEMPTS;
  protected readonly supportEmail = 'jegy@kte.hu';

  protected readonly totalAmount = computed(() => this.cart.total());
  protected readonly sectionsInCart = computed(() =>
    this.cart.items().map((item) => item.section),
  );
  protected readonly minRemainingMs = computed(() => {
    const items = this.cart.items();
    const tick = this.cart.lastTickMs();
    if (items.length === 0) {
      return 0;
    }
    return items.reduce((min, item) => {
      const remaining = Math.max(0, item.lockExpiresAtMs - tick);
      return Math.min(min, remaining);
    }, Number.POSITIVE_INFINITY);
  });

  @ViewChild('paymentElement', { static: false })
  private readonly paymentElementRef?: ElementRef<HTMLDivElement>;

  private stripe: Stripe | null = null;
  private elements: StripeElements | null = null;
  private paymentElement: StripePaymentElement | null = null;

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) {
      return;
    }
    this.loadDiscountPreview();
  }

  async ngAfterViewInit(): Promise<void> {
    if (this.cart.isEmpty()) {
      return;
    }
    await this.initialize();
  }

  ngOnDestroy(): void {
    this.paymentElement?.destroy();
  }

  /**
   * Loads the loyalty discount preview for the current cart total. Best-effort:
   * if the snapshot call fails (e.g. anon user or backend hiccup), we just
   * skip the breakdown card.
   */
  private loadDiscountPreview(): void {
    this.loyaltyService.getSnapshot().subscribe({
      next: (snapshot) => {
        const original = this.cart.total();
        const discountPercent = snapshot.tier.discountPercent;
        const discountAmount = Math.round((original * discountPercent) / 100);
        this.discountPreview.set({
          originalAmount: original,
          discountAmount,
          discountPercent,
          amount: original - discountAmount,
          currency: 'HUF',
          tier: snapshot.tier.tier,
        });
      },
      error: () => {
        this.discountPreview.set(null);
      },
    });
  }

  private async initialize(): Promise<void> {
    try {
      const items = await this.cart.assertValidForCheckout();
      if (items.length === 0) {
        this.initializationError.set(
          'A foglalt székek lejártak. Térj vissza a stadiontérképre.',
        );
        return;
      }
      const matchId = items[0].matchId;
      const [intent, weatherForecast] = await Promise.all([
        firstValueFrom(
          this.paymentsApi.createIntent({
            matchId,
            seats: items.map((item) => ({
              seatId: item.seatId,
              ownerToken: item.ownerToken,
            })),
          }),
        ),
        firstValueFrom(this.weatherApi.forMatch(matchId)).catch(() => null),
      ]);
      this.intent.set(intent);
      this.weather.set(weatherForecast);
      await this.mountStripeElement(intent.clientSecret);
    } catch (error) {
      this.initializationError.set(this.normalizeError(error));
    }
  }

  private async mountStripeElement(clientSecret: string): Promise<void> {
    const target = this.paymentElementRef?.nativeElement;
    if (!target) {
      this.initializationError.set('A fizetési mező nem érhető el.');
      return;
    }
    const { stripe, elements } = await this.stripeService.createElements(clientSecret);
    this.stripe = stripe;
    this.elements = elements;
    this.paymentElement = elements.create('payment', {
      layout: 'tabs',
    });
    this.paymentElement.mount(target);
  }

  protected async confirmPayment(): Promise<void> {
    if (!this.stripe || !this.elements) {
      return;
    }
    if (this.failureCount() >= MAX_RETRY_ATTEMPTS) {
      return;
    }
    this.processing.set(true);
    this.paymentError.set(null);
    try {
      const { error, paymentIntent } = await this.stripe.confirmPayment({
        elements: this.elements,
        redirect: 'if_required',
        confirmParams: {
          return_url: window.location.origin + '/checkout/confirmation',
        },
      });
      if (error) {
        this.failureCount.update((value) => value + 1);
        this.paymentError.set(error.message ?? 'A fizetés sikertelen.');
        await this.handlePaymentFailure();
        return;
      }
      if (paymentIntent?.status === 'succeeded') {
        const seats = this.cart.items().map((item) => ({
          section: item.section,
          row: item.row,
          seatNumber: item.seatNumber,
          price: item.price,
        }));
        const totalPaid = this.cart.total();
        this.cart.clearLocalOnly();
        void this.router.navigate(['/checkout/confirmation'], {
          state: {
            paymentIntentId: paymentIntent.id,
            seats,
            totalPaid,
          },
        });
        return;
      }
      // Some statuses (e.g. requires_action) are handled internally by Stripe.js.
      this.paymentError.set(
        'A fizetés további megerősítésre vár. Kövesd a banki értesítéseket.',
      );
    } catch (error) {
      this.failureCount.update((value) => value + 1);
      this.paymentError.set(this.normalizeError(error));
      await this.handlePaymentFailure();
    } finally {
      this.processing.set(false);
    }
  }

  /**
   * KTE-037: when a payment attempt fails, extend each seat lock by 120s
   * so the user can retry without losing their seats.
   */
  private async handlePaymentFailure(): Promise<void> {
    const items = this.cart.items();
    await Promise.all(
      items.map(async (item) => {
        try {
          const extended = await firstValueFrom(
            this.seatsApi.extendLock(item.matchId, item.seatId, item.ownerToken, 120),
          );
          this.cart.applyLockExtension(
            item.seatId,
            extended.ownerToken,
            new Date(extended.expiresAt).getTime(),
          );
        } catch {
          // best-effort — UI countdown will reflect whatever is in store
        }
      }),
    );
  }

  private normalizeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Ismeretlen hiba történt a fizetés során.';
  }
}
