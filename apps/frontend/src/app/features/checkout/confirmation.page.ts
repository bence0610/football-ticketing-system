import { DatePipe, NgFor, NgIf } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { CheckoutStepsComponent } from '../../shared/components/checkout-steps/checkout-steps.component';
import { SUPPORT_EMAIL } from '../../shared/constants/support';
import { PaymentStatusResponse } from '../../shared/models/payment.model';
import { HufCurrencyPipe } from '../../shared/pipes/huf-currency.pipe';
import { PaymentsApiService } from '../../shared/services/payments.api.service';
import { seatDescription } from '../cart/logic/cart-logic';
import {
  CONFIRMATION_POLLING,
  isSlow,
  nextDelayMs,
  paymentIntentIdFrom,
  shouldGiveUp,
} from './logic/confirmation-polling';

type View = 'checking' | 'issued' | 'processing' | 'failed' | 'missing';

/**
 * Confirmation. The result comes from the server, not from the browser's
 * return: the page asks for the payment's status and shows
 *  - "Megvan a jegyed" once the tickets exist (amount and points from records),
 *  - "Feldolgozás alatt" while the webhook has not arrived - calm, no retry,
 *    no second payment button, it refreshes by itself and shows the way to
 *    support if it takes too long,
 *  - a plain "did not go through" if Stripe says so.
 */
@Component({
  selector: 'kte-confirmation-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgIf,
    NgFor,
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    CheckoutStepsComponent,
    HufCurrencyPipe,
  ],
  template: `
    <kte-checkout-steps [steps]="steps" [current]="view() === 'issued' ? 3 : 2"></kte-checkout-steps>

    <section class="confirm kte-confirmation" [attr.data-view]="view()">
      <div class="panel kte-confirmation__card" *ngIf="view() !== 'missing'; else missing">
        <!-- issued -->
        <ng-container *ngIf="view() === 'issued' && status() as s">
          <div class="badge badge--ok" aria-hidden="true"><mat-icon>check</mat-icon></div>
          <h2 class="confirm__title" data-testid="confirm-title">Megvan a jegyed</h2>
          <!-- The email is only mentioned once the server says it was sent -->
          <p class="confirm__lead" data-testid="confirm-lead" *ngIf="emailSent(); else noEmailClaim">
            A visszaigazolást elküldtük a <strong>{{ email() }}</strong> címre, a QR-kód pedig a
            profilodban található.
          </p>
          <ng-template #noEmailClaim>
            <p class="confirm__lead" data-testid="confirm-lead">
              A jegyed elkészült, a QR-kódot a profilodban találod.
            </p>
          </ng-template>

          <p class="confirm__match" *ngIf="s.match" data-testid="confirm-match">
            {{ s.match.homeTeam }} – {{ s.match.awayTeam }} ·
            {{ s.match.kickoffAt | date: "yyyy. MMMM d., HH:mm" : '' : 'hu-HU' }}
          </p>
          <ul class="confirm__seats" *ngIf="s.seats.length > 0">
            <li *ngFor="let seat of s.seats">{{ describe(seat) }}</li>
          </ul>

          <div class="confirm__actions">
            <a mat-flat-button color="primary" routerLink="/profile" class="confirm__open">Jegy megnyitása</a>
            <a mat-stroked-button color="primary" routerLink="/" class="confirm__back">
              Vissza a mérkőzésekhez
            </a>
          </div>
        </ng-container>

        <!-- still being issued: calm, nothing to click, nothing to pay -->
        <ng-container *ngIf="view() === 'processing' || view() === 'checking'">
          <div class="badge badge--wait" aria-hidden="true"><mat-icon>hourglass_top</mat-icon></div>
          <h2 class="confirm__title" data-testid="confirm-title">Feldolgozás alatt</h2>
          <p class="confirm__lead" data-testid="confirm-lead" role="status">
            Megkaptuk a fizetésedet, és most készítjük a jegyedet. Ez általában csak néhány
            másodperc. Nincs teendőd – <strong>ne fizess újra</strong>, az oldal magától frissül.
          </p>
          <mat-progress-bar mode="indeterminate" class="confirm__bar" aria-label="A jegy készül"></mat-progress-bar>

          <div class="support" *ngIf="slow()" data-testid="confirm-support">
            <mat-icon aria-hidden="true">support_agent</mat-icon>
            <div>
              <strong>Tovább tart a szokásosnál.</strong>
              <p>
                A fizetésed rendben van, a jegy akkor is megérkezik. Ha egy idő után sem látod a
                profilodban, írj nekünk: <a [href]="supportHref()">{{ supportEmail }}</a> – és add meg a
                lenti tranzakcióazonosítót.
              </p>
            </div>
          </div>
          <p class="confirm__stopped" *ngIf="gaveUp()" data-testid="confirm-gaveup">
            Már nem frissítjük automatikusan az oldalt. A jegyed a profilodban fog megjelenni; ha nem,
            írj a <a [href]="supportHref()">{{ supportEmail }}</a> címre.
          </p>
        </ng-container>

        <!-- Stripe says the payment did not go through -->
        <ng-container *ngIf="view() === 'failed'">
          <div class="badge badge--fail" aria-hidden="true"><mat-icon>close</mat-icon></div>
          <h2 class="confirm__title" data-testid="confirm-title">A fizetés nem sikerült</h2>
          <p class="confirm__lead" data-testid="confirm-lead">
            A kártyádat nem terheltük meg, jegy nem készült. Visszamehetsz a kosárhoz, és újra
            próbálhatod.
          </p>
          <div class="confirm__actions">
            <a mat-flat-button color="primary" routerLink="/cart">Vissza a kosárhoz</a>
          </div>
        </ng-container>

        <!-- footer row -->
        <footer class="foot" *ngIf="paymentIntentId() as id">
          <div class="foot__item">
            <span class="foot__label">Tranzakcióazonosító</span>
            <span class="foot__mono kte-confirmation__order-id" data-testid="confirm-id">{{ id }}</span>
          </div>
          <ng-container *ngIf="view() === 'issued' && status() as s">
            <div class="foot__item">
              <span class="foot__label">Fizetett összeg</span>
              <strong data-testid="confirm-amount">{{ s.amountPaid | hufCurrency }}</strong>
            </div>
            <div class="foot__item">
              <span class="foot__label">Jóváírt pont</span>
              <strong data-testid="confirm-points">+{{ s.pointsCredited }} pont</strong>
            </div>
          </ng-container>
        </footer>
      </div>

      <ng-template #missing>
        <div class="panel kte-confirmation__guard" data-testid="confirm-missing">
          <h2 class="confirm__title">Nincs megerősíthető fizetés</h2>
          <p class="confirm__lead">
            Ez az oldal csak egy fizetés után érhető el. Ha most fejeztél be egy vásárlást, nézd meg a
            profilodat.
          </p>
          <div class="confirm__actions">
            <a mat-flat-button color="primary" routerLink="/profile">Profil megnyitása</a>
          </div>
        </div>
      </ng-template>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .confirm {
        max-width: 680px;
        margin: 0 auto;
        padding: 40px 16px 64px;
      }

      .panel {
        padding: 40px 32px 28px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        text-align: center;
      }

      .badge {
        width: 70px;
        height: 70px;
        margin: 0 auto 20px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .badge mat-icon {
        width: 38px;
        height: 38px;
        font-size: 38px;
      }

      .badge--ok {
        background: var(--chip-paid);
        color: #fff;
      }

      .badge--wait {
        background: var(--brand-tint);
        color: var(--brand-deep);
      }

      .badge--fail {
        background: var(--error-bg);
        color: var(--seat-sold);
      }

      .confirm__title {
        margin: 0 0 8px;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 28px;
        line-height: 1.2;
        letter-spacing: -0.02em;
      }

      .confirm__lead {
        margin: 0 auto;
        max-width: 52ch;
        color: var(--muted);
      }

      .confirm__lead strong {
        color: var(--ink);
        overflow-wrap: anywhere;
      }

      .confirm__match {
        margin: 20px 0 0;
        font-weight: 600;
      }

      .confirm__seats {
        list-style: none;
        margin: 6px 0 0;
        padding: 0;
        color: var(--muted);
        font-size: 15px;
      }

      .confirm__actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 12px;
        margin-top: 24px;
      }

      .confirm__bar {
        max-width: 320px;
        margin: 24px auto 0;
        border-radius: 999px;
      }

      .support {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        text-align: left;
        margin-top: 24px;
        padding: 14px 16px;
        background: var(--brand-tint);
        border-radius: var(--radius-block);
        color: var(--brand-deep);
      }

      .support p {
        margin: 4px 0 0;
        color: var(--ink);
        font-size: 14.5px;
      }

      .confirm__stopped {
        margin: 16px 0 0;
        font-size: 14px;
        color: var(--muted);
      }

      .foot {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 16px 24px;
        margin-top: 32px;
        padding-top: 20px;
        border-top: 1px solid var(--border-light);
        text-align: left;
      }

      .foot__item {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .foot__label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }

      .foot__mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 13px;
        overflow-wrap: anywhere;
      }

      @media (max-width: 599px) {
        .panel {
          padding: 28px 16px 20px;
        }
        .confirm__actions > * {
          flex: 1 1 100%;
        }
      }
    `,
  ],
})
export class ConfirmationPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PaymentsApiService);
  private readonly auth = inject(AuthService);
  private readonly policy = inject(CONFIRMATION_POLLING);

  protected readonly steps: readonly string[] = ['Helyválasztás', 'Fizetés', 'Jegy'];
  protected readonly supportEmail = SUPPORT_EMAIL;

  protected readonly paymentIntentId = signal<string | null>(null);
  protected readonly status = signal<PaymentStatusResponse | null>(null);
  protected readonly view = signal<View>('checking');
  protected readonly slow = signal(false);
  protected readonly gaveUp = signal(false);
  protected readonly email = computed(() => this.auth.user()?.email ?? '');
  /** True only when the server reports the confirmation email as sent. */
  protected readonly emailSent = computed(
    () => !!this.status()?.confirmationEmailSentAt && this.email() !== '',
  );

  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nudged = false;

  ngOnInit(): void {
    const id = paymentIntentIdFrom(
      this.route.snapshot.queryParamMap,
      typeof window !== 'undefined' ? window.history.state : null,
    );
    this.paymentIntentId.set(id);
    if (!id) {
      this.view.set('missing');
      return;
    }
    void this.poll(id, Date.now());
  }

  ngOnDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  protected supportHref(): string {
    const id = this.paymentIntentId() ?? '';
    return `mailto:${this.supportEmail}?subject=${encodeURIComponent('Fizetés – ' + id)}`;
  }

  protected describe(seat: PaymentStatusResponse['seats'][number]): string {
    return seatDescription({ section: seat.section, row: seat.row, seatNumber: seat.number });
  }

  private async poll(id: string, startedAt: number): Promise<void> {
    let issuedAt: number | null = null;
    while (!this.stopped) {
      const elapsed = Date.now() - startedAt;
      try {
        const status = await firstValueFrom(this.api.status(id));
        this.status.set(status);
        if (status.status === 'issued') {
          this.view.set('issued');
          issuedAt ??= Date.now();
          // The email goes out just after the tickets exist. Look a little longer
          // so the page can say so once it is true - and never before.
          if (status.confirmationEmailSentAt || Date.now() - issuedAt >= this.policy.emailGraceMs) {
            return;
          }
          await new Promise<void>((resolve) => {
            this.timer = setTimeout(resolve, this.policy.intervalMs);
          });
          continue;
        }
        if (status.status === 'failed') {
          this.view.set('failed');
          return;
        }
        this.view.set('processing');
      } catch (error) {
        if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 400)) {
          // Not our payment / not a payment: nothing to confirm here.
          this.view.set('missing');
          return;
        }
        // A network hiccup must not look like a failure: keep waiting.
        this.view.set('processing');
      }

      if (isSlow(this.policy, elapsed)) {
        this.slow.set(true);
      }
      if (!this.nudged && elapsed >= this.policy.nudgeAfterMs) {
        // Still no tickets: ask the server to finalise. It re-checks the
        // payment with Stripe and is idempotent, so this can never charge
        // anyone or issue twice.
        this.nudged = true;
        void firstValueFrom(this.api.confirmPayment(id)).catch(() => undefined);
      }
      if (shouldGiveUp(this.policy, elapsed)) {
        this.gaveUp.set(true);
        return;
      }
      await new Promise<void>((resolve) => {
        this.timer = setTimeout(resolve, nextDelayMs(this.policy, elapsed));
      });
    }
  }
}
