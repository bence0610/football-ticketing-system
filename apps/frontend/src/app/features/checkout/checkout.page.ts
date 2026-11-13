import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import type { Stripe, StripeElements, StripePaymentElement } from '@stripe/stripe-js';
import { catchError, firstValueFrom, map, of, switchMap } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { CartFacade } from '../../core/cart/cart.facade';
import { LoyaltyService } from '../../core/services/loyalty.service';
import { StripeService } from '../../core/stripe/stripe.service';
import { CheckoutStepsComponent } from '../../shared/components/checkout-steps/checkout-steps.component';
import { TierDiscount } from '../../shared/components/tier-discount-row/tier-discount-row.component';
import { SUPPORT_EMAIL } from '../../shared/constants/support';
import { MatchWeatherForecast, PaymentIntentResponse } from '../../shared/models/payment.model';
import { MatchesApiService } from '../../shared/services/matches.api.service';
import { PaymentsApiService } from '../../shared/services/payments.api.service';
import { SeatsApiService } from '../../shared/services/seats.api.service';
import { MatchPricesService } from '../home/logic/match-prices.service';
import { WeatherApiService } from '../../shared/services/weather.api.service';
import { extractApiErrorMessage } from '../../shared/utils/api-error';
import { holdRemainingText, lockExpiryFromTtl } from '../../shared/utils/hold-duration';
import { SeatsActions } from '../../state/seats';
import { shortestHoldMs } from '../cart/logic/cart-logic';
import { formatFullName } from '../../shared/utils/format-name';
import { CheckoutSummaryComponent } from './components/checkout-summary.component';
import { ExpiredHoldAlertComponent } from './components/expired-hold-alert.component';
import { WeatherBannerComponent } from './components/weather-banner.component';

const MAX_RETRY_ATTEMPTS = 3;

@Component({
  selector: 'kte-checkout-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    CheckoutStepsComponent,
    CheckoutSummaryComponent,
    ExpiredHoldAlertComponent,
    WeatherBannerComponent,
  ],
  template: `
    <kte-checkout-steps [steps]="steps" [current]="1">
      @if (items().length > 0) {
        <span class="hold" role="timer" data-testid="hold-pill">
          <mat-icon aria-hidden="true">schedule</mat-icon>
          <span class="kte-checkout__lock-status">
            A helyeid <strong>{{ holdText() }}</strong> vannak fenntartva
          </span>
        </span>
      }
    </kte-checkout-steps>

    <section class="checkout kte-checkout">
      <h1>Fizetés</h1>

      @if (items().length === 0 && lapsed().length === 0) {
        <div class="checkout__empty kte-checkout__empty" data-testid="checkout-empty">
          <h2>A kosarad üres</h2>
          <p>Válassz előbb székeket a stadiontérképen.</p>
          <a mat-flat-button color="primary" routerLink="/stadium">Helyet választok</a>
        </div>
      } @else {
        <div class="checkout__layout">
          <div class="checkout__main">
            @if (lapsed().length > 0) {
              <kte-expired-hold-alert
                [lapsed]="lapsed()"
                [remaining]="items().length"
                [matchId]="matchId()"
                [busy]="reinitializing()"
                (payRemaining)="payRemaining()"
              ></kte-expired-hold-alert>
            }

            @if (items().length > 0) {
              <kte-weather-banner [forecast]="weather()" [sectionsInCart]="sectionsInCart()" [coverage]="coverage()"></kte-weather-banner>

              <section class="card" aria-labelledby="pay-title">
                <h2 id="pay-title">Fizetés</h2>

                @if (auth.user(); as user) {
                  <p class="card__buyer" data-testid="buyer">
                    Vásárló: <strong>{{ fullName(user) }}</strong> · {{ user.email }}
                  </p>
                }

                @if (initializationError(); as initErr) {
                  <p class="error-block kte-checkout__error" role="alert">{{ initErr }}</p>
                } @else if (!intent()) {
                  <div class="card__loader kte-checkout__loader">
                    <mat-spinner diameter="32" />
                    <span>Fizetési felület előkészítése...</span>
                  </div>
                }

                <div #paymentElement class="card__element kte-checkout__payment-element"></div>

                @if (paymentError(); as msg) {
                  <p class="error-block kte-checkout__error" role="alert">{{ msg }}</p>
                }

                @if (failureCount() >= MAX_RETRY_ATTEMPTS) {
                  <div class="card__support kte-checkout__support">
                    <mat-icon aria-hidden="true">support_agent</mat-icon>
                    <div>
                      <strong>Több sikertelen próbálkozás történt.</strong>
                      <p>
                        Vedd fel a kapcsolatot az ügyfélszolgálattal:
                        <a [href]="'mailto:' + supportEmail">{{ supportEmail }}</a>
                      </p>
                    </div>
                  </div>
                }

                <hr class="card__divider" />
                <p class="card__secure" data-testid="stripe-note">
                  <mat-icon inline aria-hidden="true">lock</mat-icon>
                  A kártyaadatokat a Stripe kezeli, azok soha nem jutnak el a mi szerverünkre.
                </p>
              </section>
            }
          </div>

          @if (items().length > 0) {
            <kte-checkout-summary
              [items]="items()"
              [venue]="venue()"
              [subtotal]="subtotal()"
              [discount]="discount()"
              [total]="total()"
              [points]="points()"
              [processing]="processing()"
              [canPay]="canPay()"
              (pay)="confirmPayment()"
            ></kte-checkout-summary>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .hold {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        border-radius: 999px;
        background: var(--amber-bg);
        border: 1px solid var(--amber-edge);
        color: var(--amber-ink);
        font-size: 14px;
        line-height: 1.4;
      }

      .hold mat-icon {
        flex: 0 0 auto;
        width: 18px;
        height: 18px;
        font-size: 18px;
        color: var(--amber-icon);
      }

      .hold strong {
        font-variant-numeric: tabular-nums;
      }

      .checkout {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px 32px 64px;
      }

      .checkout h1 {
        margin: 0 0 24px;
        font-size: 36px;
      }

      .checkout__layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 380px;
        gap: 32px;
        align-items: start;
      }

      .checkout__main {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
      }

      .checkout__empty {
        padding: 32px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
      }

      .checkout__empty h2 {
        margin: 0 0 8px;
      }

      .card {
        padding: 24px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
      }

      .card h2 {
        margin: 0 0 8px;
        font-size: 22px;
      }

      .card__buyer {
        margin: 0 0 16px;
        font-size: 14px;
        color: var(--muted);
        overflow-wrap: anywhere;
      }

      .card__buyer strong {
        color: var(--ink);
        font-weight: 600;
      }

      .card__loader {
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--muted);
        margin: 12px 0;
      }

      .card__element {
        min-height: 240px;
        margin: 8px 0 12px;
      }

      .card__support {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        padding: 12px 16px;
        margin-top: 12px;
        background: var(--brand-tint);
        border-radius: var(--radius-block);
        color: var(--brand-deep);
      }

      .card__support p {
        margin: 4px 0 0;
        color: var(--ink);
      }

      .card__divider {
        margin: 16px 0 12px;
        border: 0;
        border-top: 1px solid var(--border-light);
      }

      .card__secure {
        margin: 0;
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: 13.5px;
        line-height: 1.5;
        color: var(--muted);
      }

      .card__secure mat-icon {
        flex: 0 0 auto;
        margin-top: 2px;
      }

      @media (max-width: 899px) {
        .checkout__layout {
          grid-template-columns: minmax(0, 1fr);
          gap: 24px;
        }
      }

      @media (max-width: 599px) {
        .checkout {
          padding: 24px 16px 48px;
        }
        .checkout h1 {
          font-size: 30px;
        }
        .card {
          padding: 20px 16px;
        }
      }
    `,
  ],
})
export class CheckoutPageComponent implements AfterViewInit, OnDestroy {
  protected readonly cart = inject(CartFacade);
  protected readonly auth = inject(AuthService);
  protected readonly fullName = formatFullName;
  private readonly paymentsApi = inject(PaymentsApiService);
  private readonly seatsApi = inject(SeatsApiService);
  private readonly weatherApi = inject(WeatherApiService);
  private readonly matchesApi = inject(MatchesApiService);
  private readonly stripeService = inject(StripeService);
  private readonly loyaltyService = inject(LoyaltyService);
  private readonly sectorData = inject(MatchPricesService);
  private readonly router = inject(Router);
  private readonly store = inject(Store);

  protected readonly steps: readonly string[] = ['Helyválasztás', 'Fizetés', 'Jegy'];
  protected readonly MAX_RETRY_ATTEMPTS = MAX_RETRY_ATTEMPTS;
  protected readonly supportEmail = SUPPORT_EMAIL;

  protected readonly intent = signal<PaymentIntentResponse | null>(null);
  protected readonly weather = signal<MatchWeatherForecast | null>(null);
  protected readonly processing = signal(false);
  protected readonly paymentError = signal<string | null>(null);
  protected readonly initializationError = signal<string | null>(null);
  protected readonly failureCount = signal(0);
  protected readonly paymentElementMounted = signal(false);
  protected readonly reinitializing = signal(false);
  protected readonly venue = signal<string | null>(null);

  // ---- cart ----------------------------------------------------------------
  protected readonly items = this.cart.items;
  protected readonly matchId = computed(() => this.items()[0]?.matchId ?? this.cart.expired()[0]?.matchId ?? '');
  protected readonly sectionsInCart = computed(() => this.items().map((i) => i.section));

  /** Live remaining hold: the shortest one of the seats being paid for. */
  protected readonly holdText = computed(() =>
    holdRemainingText(shortestHoldMs(this.items(), this.cart.lastTickMs()) ?? 0),
  );

  // ---- sector coverage (the real flag, from the seat map's sector summary) ---------
  protected readonly coverage = toSignal(
    toObservable(this.matchId).pipe(
      switchMap((id) => (id ? this.sectorData.forMatch(id) : of(null))),
      map((data) => Object.fromEntries((data?.sectors ?? []).map((s) => [s.section, s.covered]))),
    ),
    { initialValue: {} as Record<string, boolean | null> },
  );

  // ---- expired holds ----------------------------------------------------------
  /**
   * Every seat whose hold ran out and was not explicitly set aside. They stay
   * here until the user chooses what to do (pay for the rest, or pick again):
   * nothing is dropped silently, even if the hold ran out before the page opened.
   */
  protected readonly lapsed = computed(() => this.cart.expired());

  // ---- loyalty (signed-in users) -----------------------------------------------
  private readonly snapshot = toSignal(
    toObservable(this.auth.isAuthenticated).pipe(
      switchMap((signedIn) =>
        signedIn ? this.loyaltyService.getSnapshot().pipe(catchError(() => of(null))) : of(null),
      ),
    ),
    { initialValue: null },
  );

  // The money shown here is the server's, from the payment intent - the browser
  // does no arithmetic on it. Until the intent exists there is nothing to show
  // (null renders as an em-dash), so the screen can never display one number
  // while another is charged.
  protected readonly subtotal = computed<number | null>(() => this.intent()?.subtotal ?? null);

  protected readonly discount = computed<TierDiscount | null>(() => {
    const i = this.intent();
    const s = this.snapshot();
    if (!i || !s || i.discountAmount <= 0) {
      return null;
    }
    return {
      tier: s.tier.tier,
      label: s.tier.label,
      percent: i.discountPercent,
      amount: i.discountAmount,
    };
  });

  protected readonly total = computed<number | null>(() => this.intent()?.amount ?? null);

  protected readonly points = computed(() => {
    const perTicket = this.snapshot()?.ticketPointsPerTicket;
    return perTicket === undefined ? null : perTicket * this.items().length;
  });

  /** Payment can start only with a mounted element and every held seat still held. */
  protected readonly canPay = computed(
    () =>
      !!this.intent() &&
      this.paymentElementMounted() &&
      this.lapsed().length === 0 &&
      this.failureCount() < MAX_RETRY_ATTEMPTS,
  );

  @ViewChild('paymentElement', { static: false })
  private readonly paymentElementRef?: ElementRef<HTMLDivElement>;

  private stripe: Stripe | null = null;
  private elements: StripeElements | null = null;
  private paymentElement: StripePaymentElement | null = null;
  private requestedVenue: string | null = null;

  constructor() {
    // Venue of the match being paid for (GET /matches/:id).
    effect(() => {
      const id = this.matchId();
      untracked(() => {
        if (!id || this.requestedVenue === id) {
          return;
        }
        this.requestedVenue = id;
        this.matchesApi.detail(id).subscribe({
          next: (m) => this.venue.set(m.venue),
          error: () => (this.requestedVenue = null),
        });
      });
    });

    // Nothing left to pay for: release the Stripe element.
    effect(() => {
      if (this.items().length === 0) {
        untracked(() => this.destroyElement());
      }
    });
  }

  async ngAfterViewInit(): Promise<void> {
    if (this.cart.isEmpty()) {
      return;
    }
    await this.initialize();
  }

  ngOnDestroy(): void {
    this.destroyElement();
  }

  private destroyElement(): void {
    this.paymentElementMounted.set(false);
    this.paymentElement?.destroy();
    this.paymentElement = null;
    this.elements = null;
  }

  /** Pay only for the seats that are still held: new payment intent, new element. */
  protected async payRemaining(): Promise<void> {
    this.reinitializing.set(true);
    try {
      // The user chose to go on without these seats: set them aside explicitly.
      for (const seat of this.lapsed()) {
        this.cart.dismissExpired(seat.seatId);
      }
      this.destroyElement();
      this.intent.set(null);
      this.initializationError.set(null);
      this.paymentError.set(null);
      await this.initialize();
    } finally {
      this.reinitializing.set(false);
    }
  }

  private async initialize(): Promise<void> {
    try {
      const items = await this.cart.assertValidForCheckout();
      if (items.length === 0) {
        this.initializationError.set('A foglalt székek lejártak. Térj vissza a stadiontérképre.');
        return;
      }
      const matchId = items[0].matchId;
      const [intent, weatherForecast] = await Promise.all([
        firstValueFrom(
          this.paymentsApi.createIntent({
            matchId,
            seats: items.map((item) => ({ seatId: item.seatId, ownerToken: item.ownerToken })),
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
    // Stripe's own payment-method tabs stay.
    const paymentElement = elements.create('payment', { layout: 'tabs' });
    this.paymentElement = paymentElement;

    paymentElement.on('ready', () => {
      this.paymentElementMounted.set(true);
    });
    paymentElement.on('loaderror', (event) => {
      this.paymentElementMounted.set(false);
      const message = event?.error?.message ?? 'A fizetési mező betöltése sikertelen.';
      this.initializationError.set(message);
    });

    // Defer the mount() call to the next macrotask so the host <div> is
    // guaranteed to be attached to the document. Without this, mount() can
    // race with Angular's view commit on slower devices and Stripe later
    // refuses confirmPayment() with "elements should have a mounted Payment
    // Element or Express Checkout Element."
    setTimeout(() => {
      try {
        paymentElement.mount(target);
      } catch (error) {
        this.paymentElementMounted.set(false);
        this.initializationError.set(this.normalizeError(error));
      }
    }, 0);
  }

  protected async confirmPayment(): Promise<void> {
    if (!this.stripe || !this.elements || !this.paymentElementMounted()) {
      return;
    }
    // A hold ran out: the payment must not start (the alert offers the options).
    if (this.lapsed().length > 0) {
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
        // Frontend-driven fallback for the Stripe webhook: in development the
        // CLI listener is sometimes delayed or missed entirely, leaving the
        // user with no ticket. Hit /payments/confirm directly so the backend
        // retrieves the PaymentIntent server-side and creates the Ticket rows.
        // The endpoint is idempotent — if the webhook beat us to it, no
        // duplicates are produced.
        try {
          await firstValueFrom(this.paymentsApi.confirmPayment(paymentIntent.id));
        } catch (confirmError) {
          // Don't block the user: the confirmation page polls the payment's
          // status until the tickets exist, and the webhook is still likely to
          // fire shortly.
          console.error('[Checkout] /payments/confirm failed:', confirmError);
        }
        // Refresh the seats slice so the stadium map shows the just-paid seats
        // as SOLD on the next visit instead of the stale "locked" status carried
        // over from the user's own seat-lock.
        const matchId = this.items()[0]?.matchId;
        if (matchId) {
          this.store.dispatch(SeatsActions.loadSeatsForMatch({ matchId }));
        }
        this.cart.clearLocalOnly();
        void this.router.navigate(['/checkout/confirmation'], {
          queryParams: { payment_intent: paymentIntent.id },
        });
        return;
      }
      // Some statuses (e.g. requires_action) are handled internally by Stripe.js.
      this.paymentError.set('A fizetés további megerősítésre vár. Kövesd a banki értesítéseket.');
    } catch (error) {
      this.failureCount.update((value) => value + 1);
      this.paymentError.set(this.normalizeError(error));
      await this.handlePaymentFailure();
    } finally {
      this.processing.set(false);
    }
  }

  /**
   * KTE-037: when a payment attempt fails, restart each seat lock at the
   * server's configured hold so the user can retry without losing their seats.
   */
  private async handlePaymentFailure(): Promise<void> {
    const items = this.cart.items();
    await Promise.all(
      items.map(async (item) => {
        try {
          const extended = await firstValueFrom(
            this.seatsApi.extendLock(item.matchId, item.seatId, item.ownerToken),
          );
          this.cart.applyLockExtension(
            item.seatId,
            extended.ownerToken,
            // anchored to this device's clock, like the first lock (no clock skew)
            lockExpiryFromTtl(extended.ttlSeconds),
          );
        } catch {
          // best-effort — UI countdown will reflect whatever is in store
        }
      }),
    );
  }

  private normalizeError(error: unknown): string {
    return extractApiErrorMessage(error, 'Ismeretlen hiba történt a fizetés során.');
  }
}
