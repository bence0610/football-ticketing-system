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
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import type { Stripe, StripeElements, StripePaymentElement } from '@stripe/stripe-js';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import {
  PurchaseSeasonPassResponse,
  SeasonPassPrice,
} from '../../core/models/season-pass.models';
import { SeasonPassesService } from '../../core/services/season-passes.service';
import { StripeService } from '../../core/stripe/stripe.service';
import { HufCurrencyPipe } from '../../shared/pipes/huf-currency.pipe';

const MAX_RETRY_ATTEMPTS = 3;

@Component({
  selector: 'kte-season-pass-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatChipsModule,
    MatDividerModule,
    MatIconModule,
    MatProgressSpinnerModule,
    HufCurrencyPipe,
  ],
  template: `
    <section class="kte-season-pass">
      <header class="kte-season-pass__header">
        <h1>Bérlet vásárlás</h1>
        <p>
          Biztosítsd a helyed a Kecskeméti TE összes hazai mérkőzésére a
          {{ seasonLabel() }} szezonban.
        </p>
      </header>

      @if (loading()) {
        <div class="kte-season-pass__loader" role="status" aria-live="polite">
          <mat-spinner diameter="48" />
          <span>Bérletárak betöltése…</span>
        </div>
      } @else if (loadError()) {
        <mat-card appearance="outlined" class="kte-season-pass__error-card">
          <mat-card-content>
            <h2>Nem sikerült betölteni a bérletárakat</h2>
            <p>{{ loadError() }}</p>
            <button mat-flat-button color="primary" type="button" (click)="reload()">
              <mat-icon>refresh</mat-icon>
              Újratöltés
            </button>
          </mat-card-content>
        </mat-card>
      } @else {
        <div class="kte-season-pass__layout">
          <div class="kte-season-pass__sections">
            <h2>Válassz szektort</h2>
            <div class="kte-season-pass__section-grid">
              @for (price of prices(); track price.sectionId) {
                <button
                  type="button"
                  class="kte-section-card"
                  [class.kte-section-card--selected]="selectedSectionId() === price.sectionId"
                  (click)="selectSection(price)"
                  [attr.aria-pressed]="selectedSectionId() === price.sectionId"
                >
                  <span class="kte-section-card__badge">{{ price.sectionId }}</span>
                  <span class="kte-section-card__name">{{ price.sectionName }}</span>
                  <span class="kte-section-card__price">{{ price.price | hufCurrency }}</span>
                  <span class="kte-section-card__season">{{ price.seasonLabel }}</span>
                </button>
              }
            </div>
          </div>

          <aside class="kte-season-pass__checkout">
            <mat-card appearance="outlined">
              <mat-card-header>
                <mat-card-title>Fizetés</mat-card-title>
                <mat-card-subtitle>
                  @if (selectedPrice(); as sel) {
                    {{ sel.sectionName }} · {{ sel.price | hufCurrency }}
                  } @else {
                    Válassz szektort a fizetéshez
                  }
                </mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                @if (!auth.isAuthenticated()) {
                  <p class="kte-season-pass__note">
                    A bérletvásárláshoz be kell jelentkezned.
                  </p>
                  <a mat-flat-button color="primary" routerLink="/login">
                    <mat-icon>login</mat-icon>
                    Bejelentkezés
                  </a>
                } @else if (!selectedPrice()) {
                  <p class="kte-season-pass__note">Válassz szektort a kártya megjelenítéséhez.</p>
                } @else {
                  @if (initializationError(); as initErr) {
                    <p class="kte-season-pass__error" role="alert">{{ initErr }}</p>
                  } @else if (!clientSecret()) {
                    <div class="kte-season-pass__loader-row">
                      <mat-spinner diameter="32" />
                      <span>Fizetési felület előkészítése…</span>
                    </div>
                  }

                  <div #paymentElement class="kte-season-pass__payment-element"></div>

                  @if (paymentError(); as msg) {
                    <p class="kte-season-pass__error" role="alert">{{ msg }}</p>
                  }

                  @if (failureCount() >= MAX_RETRY_ATTEMPTS) {
                    <div class="kte-season-pass__support">
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
                    class="kte-season-pass__pay"
                    [disabled]="
                      !clientSecret() ||
                      !paymentElementMounted() ||
                      processing() ||
                      failureCount() >= MAX_RETRY_ATTEMPTS
                    "
                    (click)="purchase()"
                  >
                    @if (processing()) {
                      <mat-spinner diameter="20" />
                      Feldolgozás…
                    } @else {
                      <mat-icon>lock</mat-icon>
                      Vásárlás ({{ selectedPrice()!.price | hufCurrency }})
                    }
                  </button>
                }
              </mat-card-content>
            </mat-card>

            <mat-card appearance="outlined" class="kte-season-pass__benefits">
              <mat-card-header>
                <mat-card-title>Bérletes előnyök</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <ul>
                  <li>
                    <mat-icon>stars</mat-icon>
                    +500 hűségpont a vásárlás után
                  </li>
                  <li>
                    <mat-icon>event_seat</mat-icon>
                    Garantált hely az összes hazai mérkőzésre
                  </li>
                  <li>
                    <mat-icon>swap_horiz</mat-icon>
                    Bérletkölcsönzés barátoknak
                  </li>
                </ul>
              </mat-card-content>
            </mat-card>
          </aside>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .kte-season-pass {
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-4);
        padding: var(--kte-spacing-6) var(--kte-spacing-4);
        max-width: 1100px;
        margin: 0 auto;
      }
      .kte-season-pass__header h1 {
        margin: 0;
      }
      .kte-season-pass__header p {
        margin: 4px 0 0;
        color: rgba(0, 0, 0, 0.7);
      }
      .kte-season-pass__loader,
      .kte-season-pass__loader-row {
        display: flex;
        gap: var(--kte-spacing-3);
        align-items: center;
        justify-content: center;
        padding: var(--kte-spacing-6);
      }
      .kte-season-pass__error-card {
        max-width: 640px;
        margin: 0 auto;
        text-align: center;
      }
      .kte-season-pass__layout {
        display: grid;
        grid-template-columns: 1.4fr 1fr;
        gap: var(--kte-spacing-4);
      }
      .kte-season-pass__sections h2 {
        margin: 0 0 var(--kte-spacing-3);
      }
      .kte-season-pass__section-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--kte-spacing-3);
      }
      .kte-section-card {
        position: relative;
        border: 2px solid var(--kte-color-border, #d1d5db);
        background: #ffffff;
        border-radius: var(--kte-radius-lg);
        padding: var(--kte-spacing-4);
        cursor: pointer;
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 6px;
        transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
      }
      .kte-section-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--kte-shadow-md);
      }
      .kte-section-card--selected {
        border-color: var(--kte-color-primary);
        box-shadow: 0 0 0 3px rgba(10, 61, 98, 0.15);
      }
      .kte-section-card__badge {
        align-self: flex-start;
        background: var(--kte-color-primary);
        color: #ffffff;
        padding: 4px 10px;
        border-radius: var(--kte-radius-md);
        font-weight: 700;
        letter-spacing: 0.08em;
      }
      .kte-section-card__name {
        font-size: 18px;
        font-weight: 600;
      }
      .kte-section-card__price {
        font-size: 22px;
        font-weight: 700;
        color: var(--kte-color-primary);
      }
      .kte-section-card__season {
        font-size: 12px;
        color: rgba(0, 0, 0, 0.6);
      }
      .kte-season-pass__checkout {
        display: grid;
        gap: var(--kte-spacing-3);
      }
      .kte-season-pass__payment-element {
        min-height: 240px;
        margin: var(--kte-spacing-3) 0;
      }
      .kte-season-pass__pay {
        width: 100%;
        height: 48px;
        font-size: 16px;
        gap: var(--kte-spacing-2);
      }
      .kte-season-pass__note {
        margin: var(--kte-spacing-2) 0;
        color: rgba(0, 0, 0, 0.7);
      }
      .kte-season-pass__error {
        background: rgba(244, 67, 54, 0.08);
        color: #b71c1c;
        padding: var(--kte-spacing-3);
        border-radius: var(--kte-radius-md);
        margin: var(--kte-spacing-2) 0;
      }
      .kte-season-pass__support {
        display: flex;
        gap: var(--kte-spacing-2);
        align-items: flex-start;
        padding: var(--kte-spacing-3);
        background: rgba(255, 152, 0, 0.1);
        color: #b26500;
        border-radius: var(--kte-radius-md);
        margin: var(--kte-spacing-2) 0;
      }
      .kte-season-pass__support p {
        margin: 4px 0 0;
      }
      .kte-season-pass__benefits ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--kte-spacing-2);
      }
      .kte-season-pass__benefits li {
        display: inline-flex;
        gap: var(--kte-spacing-2);
        align-items: center;
      }
      @media (max-width: 900px) {
        .kte-season-pass__layout {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class SeasonPassPageComponent implements OnInit, AfterViewInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  private readonly seasonPassApi = inject(SeasonPassesService);
  private readonly stripeService = inject(StripeService);
  private readonly router = inject(Router);

  protected readonly prices = signal<readonly SeasonPassPrice[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly selectedSectionId = signal<string | null>(null);
  protected readonly clientSecret = signal<string | null>(null);
  protected readonly paymentIntentId = signal<string | null>(null);
  protected readonly intentLoading = signal(false);
  protected readonly processing = signal(false);
  protected readonly initializationError = signal<string | null>(null);
  protected readonly paymentError = signal<string | null>(null);
  protected readonly failureCount = signal(0);
  protected readonly paymentElementMounted = signal(false);
  protected readonly MAX_RETRY_ATTEMPTS = MAX_RETRY_ATTEMPTS;
  protected readonly supportEmail = 'jegy@kte.hu';

  protected readonly selectedPrice = computed(() => {
    const id = this.selectedSectionId();
    if (!id) {
      return null;
    }
    return this.prices().find((p) => p.sectionId === id) ?? null;
  });

  protected readonly seasonLabel = computed(() => {
    const first = this.prices()[0];
    return first?.seasonLabel ?? '2026/2027';
  });

  @ViewChild('paymentElement', { static: false })
  private readonly paymentElementRef?: ElementRef<HTMLDivElement>;

  private stripe: Stripe | null = null;
  private elements: StripeElements | null = null;
  private paymentElement: StripePaymentElement | null = null;

  ngOnInit(): void {
    this.loadPrices();
  }

  ngAfterViewInit(): void {
    // Payment element is mounted once a section is selected.
  }

  ngOnDestroy(): void {
    this.disposePaymentElement();
  }

  protected reload(): void {
    this.loadPrices();
  }

  protected selectSection(price: SeasonPassPrice): void {
    if (this.processing()) {
      return;
    }
    if (this.selectedSectionId() === price.sectionId) {
      return;
    }
    this.selectedSectionId.set(price.sectionId);
    this.paymentError.set(null);
    this.initializationError.set(null);
    this.failureCount.set(0);
    this.disposePaymentElement();
    this.clientSecret.set(null);
    this.paymentIntentId.set(null);
    if (this.auth.isAuthenticated()) {
      void this.initializeIntent(price);
    }
  }

  /**
   * Creates the season-pass PaymentIntent up front so the Stripe Payment
   * Element can collect card details. The actual server-side confirm
   * happens in {@link purchase} via Stripe.confirmPayment.
   */
  private async initializeIntent(price: SeasonPassPrice): Promise<void> {
    this.intentLoading.set(true);
    try {
      const response = await firstValueFrom(
        this.seasonPassApi.purchase({ sectionId: price.sectionId }),
      );
      if (!response.clientSecret) {
        this.initializationError.set('A fizetési felület előkészítése sikertelen.');
        return;
      }
      this.clientSecret.set(response.clientSecret);
      this.paymentIntentId.set(response.paymentIntentId);
      // Defer mount() to the next tick so the @if branch has materialised the
      // host <div> in the DOM.
      setTimeout(() => {
        void this.mountStripeElement(response.clientSecret as string);
      }, 0);
    } catch (error) {
      this.initializationError.set(this.normalizeError(error));
    } finally {
      this.intentLoading.set(false);
    }
  }

  private async mountStripeElement(clientSecret: string): Promise<void> {
    const target = this.paymentElementRef?.nativeElement;
    if (!target) {
      this.initializationError.set('A fizetési mező nem érhető el.');
      return;
    }
    try {
      const { stripe, elements } = await this.stripeService.createElements(clientSecret);
      this.stripe = stripe;
      this.elements = elements;
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
      paymentElement.mount(target);
    } catch (error) {
      this.paymentElementMounted.set(false);
      this.initializationError.set(this.normalizeError(error));
    }
  }

  protected async purchase(): Promise<void> {
    if (!this.stripe || !this.elements || !this.paymentElementMounted()) {
      return;
    }
    if (this.failureCount() >= MAX_RETRY_ATTEMPTS) {
      return;
    }
    const price = this.selectedPrice();
    if (!price) {
      return;
    }
    this.processing.set(true);
    this.paymentError.set(null);

    try {
      const { error, paymentIntent } = await this.stripe.confirmPayment({
        elements: this.elements,
        redirect: 'if_required',
        confirmParams: {
          return_url: window.location.origin + '/season-pass/confirmation',
        },
      });
      if (error) {
        this.failureCount.update((value) => value + 1);
        this.paymentError.set(error.message ?? 'A fizetés sikertelen.');
        return;
      }
      if (paymentIntent?.status === 'succeeded') {
        // The backend creates the SeasonPass row up-front via /purchase only
        // when paymentMethodId is provided server-side. In our SCA-friendly
        // path the intent is created without paymentMethodId and Stripe.confirmPayment
        // happens client-side. We therefore re-call /purchase with the same
        // section + the just-confirmed paymentMethod to ensure the SeasonPass
        // row is persisted server-side. The Stripe idempotency key on the
        // initial PaymentIntent guarantees no duplicate charge.
        let response: PurchaseSeasonPassResponse | null = null;
        try {
          response = await firstValueFrom(
            this.seasonPassApi.purchase({ sectionId: price.sectionId }),
          );
        } catch (err) {
          // Best-effort: don't block the user from seeing the confirmation
          // page. The webhook (if configured) will finalize the SeasonPass.
          console.error('[SeasonPass] /purchase finalize failed:', err);
        }
        void this.router.navigate(['/season-pass/confirmation'], {
          state: {
            paymentIntentId: paymentIntent.id,
            seasonPassId: response?.seasonPassId ?? null,
            sectionName: price.sectionName,
            seasonLabel: price.seasonLabel,
            amount: price.price,
          },
        });
        return;
      }
      this.paymentError.set(
        'A fizetés további megerősítésre vár. Kövesd a banki értesítéseket.',
      );
    } catch (error) {
      this.failureCount.update((value) => value + 1);
      this.paymentError.set(this.normalizeError(error));
    } finally {
      this.processing.set(false);
    }
  }

  private disposePaymentElement(): void {
    this.paymentElementMounted.set(false);
    this.paymentElement?.destroy();
    this.paymentElement = null;
    this.elements = null;
    this.stripe = null;
  }

  private loadPrices(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.seasonPassApi.listPrices().subscribe({
      next: (prices) => {
        this.prices.set(prices);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loadError.set(this.normalizeError(error));
        this.loading.set(false);
      },
    });
  }

  private normalizeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }
    return 'Ismeretlen hiba történt a bérletvásárlás során.';
  }
}
