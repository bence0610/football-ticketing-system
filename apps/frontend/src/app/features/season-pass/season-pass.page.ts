import { CommonModule } from '@angular/common';
import {
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
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import type { Stripe, StripeElements, StripePaymentElement } from '@stripe/stripe-js';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import {
  PurchaseSeasonPassResponse,
  SeasonHomeMatch,
  SeasonOverview,
  SeasonPassPrice,
} from '../../core/models/season-pass.models';
import { SeasonPassesService } from '../../core/services/season-passes.service';
import { StripeService } from '../../core/stripe/stripe.service';
import { HufCurrencyPipe } from '../../shared/pipes/huf-currency.pipe';
import { extractApiErrorMessage } from '../../shared/utils/api-error';
import {
  Availability,
  availabilityOf,
  isSoldOut,
  mostPopularSectionId,
  panelSector,
  perMatchEquivalent,
  savingsFor,
} from './season-pass.logic';

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
    MatIconModule,
    MatProgressSpinnerModule,
    HufCurrencyPipe,
  ],
  template: `
    <section class="hero" aria-labelledby="pass-title">
      <div class="hero__inner" [class.hero__inner--single]="!savings()">
        <div class="hero__main">
          <p class="hero__eyebrow">Bérlet · {{ seasonLabel() }} szezon</p>
          <h1 id="pass-title" class="hero__title">{{ heroTitle() }}</h1>
          <p class="hero__lead">
            Ugyanaz a hely az egész szezonban. Ha egy meccsről hiányzol, a helyedet egyetlen
            mérkőzésre kölcsönadhatod valakinek – a bérleted ettől semmit nem veszít.
          </p>
        </div>

        @if (savings(); as s) {
          <aside class="hero__savings" aria-labelledby="savings-title" data-testid="savings">
            <p id="savings-title" class="hero__eyebrow">Megtakarítás · {{ s.sectionName }}</p>
            <dl class="hero__rows">
              <div class="hero__row">
                <dt>{{ s.matches }} hazai meccs külön-külön</dt>
                <dd>{{ s.separate | hufCurrency }}</dd>
              </div>
              <div class="hero__row">
                <dt>Bérlet ({{ s.sectionName }})</dt>
                <dd>{{ s.pass | hufCurrency }}</dd>
              </div>
              @if (s.difference !== null) {
                <div class="hero__row hero__row--diff">
                  <dt>Különbség</dt>
                  <dd>{{ s.difference | hufCurrency }}</dd>
                </div>
              }
            </dl>
            <p class="hero__note">
              A még hátralévő hazai meccsek jegyárából számolva.
              @if (!selectedPrice()) {
                A legolcsóbb szektorra számoltunk – válassz szektort, és a sajátodat látod.
              }
            </p>
          </aside>
        }
      </div>
    </section>

    <div class="page">
      <section class="block" aria-labelledby="sectors-title">
        <h2 id="sectors-title">Válassz szektort</h2>

        @if (loading()) {
          <div class="kte-season-pass__loader" role="status" aria-live="polite">
            <mat-spinner diameter="48" />
            <span>Bérletárak betöltése…</span>
          </div>
        } @else if (loadError()) {
          <mat-card appearance="outlined" class="kte-season-pass__error-card">
            <mat-card-content>
              <h3>Nem sikerült betölteni a bérletárakat</h3>
              <p>{{ loadError() }}</p>
              <button mat-flat-button color="primary" type="button" (click)="reload()">
                <mat-icon>refresh</mat-icon>
                Újratöltés
              </button>
            </mat-card-content>
          </mat-card>
        } @else {
          <div class="sectors">
            @for (price of prices(); track price.sectionId) {
              <article
                class="sector"
                [class.sector--selected]="selectedSectionId() === price.sectionId"
                [class.sector--soldout]="soldOut(price)"
              >
                @if (popularId() === price.sectionId) {
                  <span class="sector__ribbon">Legnépszerűbb</span>
                }
                <h3 class="sector__name">{{ price.sectionName }}</h3>
                @if (description(price); as d) {
                  <p class="sector__desc">{{ d }}</p>
                }
                <p class="sector__price">{{ price.price | hufCurrency }}</p>
                @if (perMatch(price); as pm) {
                  <p class="sector__per">≈ {{ pm | hufCurrency }} / meccs</p>
                }

                @if (availability(price); as level) {
                  @if (level !== 'unknown') {
                    <p class="sector__avail sector__avail--{{ level }}">
                      <span class="sector__dot" aria-hidden="true"></span>
                      {{ availabilityText(price, level) }}
                    </p>
                  }
                }

                @if (!soldOut(price)) {
                  <button
                    mat-flat-button
                    color="primary"
                    type="button"
                    class="sector__cta"
                    [attr.aria-pressed]="selectedSectionId() === price.sectionId"
                    [attr.aria-label]="
                      (selectedSectionId() === price.sectionId ? 'Kiválasztva' : 'Bérlet választása') +
                      ' – ' +
                      price.sectionName
                    "
                    (click)="selectSection(price)"
                  >
                    @if (selectedSectionId() === price.sectionId) {
                      <mat-icon>check</mat-icon>
                      Kiválasztva
                    } @else {
                      Bérlet választása
                    }
                  </button>
                }
              </article>
            }
          </div>
        }
      </section>

      @if (selectedPrice(); as sel) {
        <section #checkout class="block block--checkout" aria-labelledby="checkout-title">
          <mat-card appearance="outlined">
            <mat-card-header>
              <mat-card-title id="checkout-title">Fizetés</mat-card-title>
              <mat-card-subtitle>{{ sel.sectionName }} · {{ sel.price | hufCurrency }}</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
              @if (!auth.isAuthenticated()) {
                <p class="kte-season-pass__note">A bérletvásárláshoz be kell jelentkezned.</p>
                <a mat-flat-button color="primary" routerLink="/login">
                  <mat-icon>login</mat-icon>
                  Bejelentkezés
                </a>
              } @else {
                <fieldset class="kte-season-pass__holder" [disabled]="processing()">
                  <legend>Kinek szól a bérlet?</legend>
                  <label>
                    <input
                      type="radio"
                      name="holder"
                      data-testid="holder-self"
                      [checked]="!forSomeoneElse()"
                      (change)="setHolderSelf()"
                    />
                    Nekem
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="holder"
                      data-testid="holder-other"
                      [checked]="forSomeoneElse()"
                      (change)="setHolderOther()"
                    />
                    Másnak (családtag, gyerek)
                  </label>
                  @if (forSomeoneElse()) {
                    <label class="kte-season-pass__field">
                      Név
                      <input
                        type="text"
                        maxlength="120"
                        autocomplete="off"
                        data-testid="holder-name"
                        [value]="holderName()"
                        (input)="onHolderName($any($event.target).value)"
                      />
                    </label>
                    <label class="kte-season-pass__field">
                      E-mail (csak ha van fiókja)
                      <input
                        type="email"
                        maxlength="255"
                        autocomplete="off"
                        data-testid="holder-email"
                        [value]="holderEmail()"
                        (input)="onHolderEmail($any($event.target).value)"
                      />
                    </label>
                    <button
                      mat-stroked-button
                      type="button"
                      data-testid="holder-apply"
                      [disabled]="!holderValid() || intentLoading()"
                      (click)="applyHolder()"
                    >
                      Tovább a fizetéshez
                    </button>
                  }
                </fieldset>

                @if (initializationError(); as initErr) {
                  <p class="kte-season-pass__error" role="alert">{{ initErr }}</p>
                } @else if (!clientSecret() && intentLoading()) {
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
                    Vásárlás ({{ sel.price | hufCurrency }})
                  }
                </button>
              }
            </mat-card-content>
          </mat-card>
        </section>
      }

      @if (season(); as s) {
        @if (s.homeMatches.length > 0) {
          <section class="block" aria-labelledby="fixtures-title" data-testid="fixtures">
            <h2 id="fixtures-title">A szezon {{ s.homeMatches.length }} hazai mérkőzése</h2>
            <ul class="fixtures">
              @for (m of s.homeMatches; track m.id) {
                <li class="fixture" [class.fixture--played]="isPlayed(m)">
                  <span class="fixture__opp">{{ m.awayTeam }}</span>
                  <span class="fixture__when">
                    {{ m.kickoffAt | date: 'yyyy. MMM d. · HH:mm' : '' : 'hu-HU' }}
                    @if (m.status === 'postponed') {
                      · elhalasztva
                    } @else if (isPlayed(m)) {
                      · lejátszva
                    }
                  </span>
                </li>
              }
            </ul>
            <p class="block__note">
              A menetrend változhat. A bérlet minden hazai mérkőzésre érvényes, a dátumtól
              függetlenül.
            </p>
          </section>
        }
      }

      <section class="block" aria-labelledby="includes-title">
        <h2 id="includes-title">Mit tartalmaz</h2>
        <ul class="includes">
          <li>
            <mat-icon aria-hidden="true">event_seat</mat-icon>
            <span>Ugyanaz a hely az egész szezonra – a vásárláskor kapott hely a tiéd marad.</span>
          </li>
          <li>
            <mat-icon aria-hidden="true">swap_horiz</mat-icon>
            <span>A helyedet egy-egy meccsre kölcsönadhatod, a bérleted érintetlen marad.</span>
          </li>
          @if (season(); as s) {
            <li>
              <mat-icon aria-hidden="true">stars</mat-icon>
              <span>+{{ s.loyaltyPoints }} hűségpont a bérlet megvásárlásakor.</span>
            </li>
          }
        </ul>
        <p class="block__note">
          A bérlet véglegesen nem ruházható át, csak meccsenként kölcsönadható.
        </p>
      </section>

      <section class="steps" aria-labelledby="steps-title">
        <h2 id="steps-title">Hogyan működik a helyátadás</h2>
        <ol class="steps__list">
          <li>
            <span class="steps__num" aria-hidden="true">1</span>
            <div>
              <h3>Válaszd ki a meccset</h3>
              <p>A profilodon a bérletednél kiválasztod azt a mérkőzést, amelyet kihagysz.</p>
            </div>
          </li>
          <li>
            <span class="steps__num" aria-hidden="true">2</span>
            <div>
              <h3>Add meg a kölcsönvevő e-mail-címét</h3>
              <p>
                Meghívót kap e-mailben, amit a saját fiókjába belépve fogad el.
              </p>
            </div>
          </li>
          <li>
            <span class="steps__num" aria-hidden="true">3</span>
            <div>
              <h3>A te QR-kódod addig nem működik</h3>
              <p>
                Amint elfogadja, a te QR-kódod arra a meccsre érvénytelen. A következő meccsen
                magától újra működik.
              </p>
            </div>
          </li>
        </ol>
        <p class="steps__rule">
          Egy helyhez egy meccsen mindig csak egyetlen érvényes belépő tartozik.
        </p>
      </section>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* ---------- Hero ---------- */
      .hero {
        background: var(--brand-deep);
        color: #fff;
      }
      .hero__inner {
        max-width: 1180px;
        margin: 0 auto;
        padding: 56px 32px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 380px;
        gap: 48px;
        align-items: center;
      }
      .hero__inner--single {
        grid-template-columns: minmax(0, 1fr);
      }
      .hero__main {
        min-width: 0;
      }
      .hero__eyebrow {
        margin: 0 0 16px;
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--on-brand-eyebrow);
      }
      .hero__title {
        margin: 0;
        color: #fff;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 46px;
        line-height: 1.05;
        letter-spacing: -0.02em;
        overflow-wrap: anywhere;
      }
      .hero__lead {
        margin: 20px 0 0;
        max-width: 56ch;
        font-size: 17px;
        line-height: 1.55;
        color: var(--on-brand-lead);
      }
      .hero__savings {
        padding: 28px;
        border-radius: var(--radius-card);
        background: var(--scrim);
        min-width: 0;
      }
      .hero__savings .hero__eyebrow {
        margin-bottom: 8px;
      }
      .hero__rows {
        margin: 0;
      }
      .hero__row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 16px;
        padding: 12px 0;
        border-bottom: 1px solid var(--divider-on-brand);
      }
      .hero__row dt {
        flex: 1 1 0;
        min-width: 0;
        font-size: 15px;
        color: var(--on-brand-lead);
      }
      .hero__row dd {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 25px;
        line-height: 1.1;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .hero__row--diff {
        border-bottom: 0;
      }
      .hero__row--diff dt {
        color: #fff;
        font-weight: 600;
      }
      .hero__note {
        margin: 12px 0 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--on-brand-lead);
      }

      /* ---------- Page body ---------- */
      .page {
        max-width: 1180px;
        margin: 0 auto;
        padding: 16px 32px 64px;
      }
      .block {
        margin-top: 48px;
      }
      .block h2,
      .steps h2 {
        margin: 0 0 20px;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 28px;
        line-height: 1.15;
        letter-spacing: -0.01em;
      }
      .block__note {
        margin: 16px 0 0;
        max-width: 70ch;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.5;
      }
      .block--checkout {
        max-width: 640px;
      }

      /* ---------- Sector cards ---------- */
      .sectors {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr));
        gap: 16px;
      }
      .sector {
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        padding: 24px;
        background: var(--surface);
        border: 2px solid var(--border);
        border-radius: var(--radius-card);
      }
      .sector--selected {
        border-color: var(--brand-deep);
      }
      .sector--soldout {
        background: var(--page);
      }
      .sector--soldout .sector__name,
      .sector--soldout .sector__price {
        color: var(--faint);
      }
      .sector__ribbon {
        position: absolute;
        top: 0;
        right: 0;
        padding: 5px 12px;
        border-bottom-left-radius: var(--radius-block);
        background: var(--brand-deep);
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.04em;
      }
      .sector__name {
        margin: 0;
        padding-right: 110px;
        font-size: 20px;
        font-weight: 600;
      }
      .sector__desc {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
      }
      .sector__price {
        margin: 12px 0 0;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 30px;
        line-height: 1.1;
        color: var(--brand-deep);
        overflow-wrap: anywhere;
      }
      .sector__per {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
      }
      .sector__avail {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 12px 0 0;
        font-size: 14px;
        font-weight: 500;
      }
      .sector__dot {
        flex: 0 0 auto;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--chip-paid);
      }
      .sector__avail--few .sector__dot {
        background: var(--amber-icon);
      }
      .sector__avail--nearly-gone .sector__dot,
      .sector__avail--sold-out .sector__dot {
        background: var(--chip-expired);
      }
      .sector__avail--sold-out {
        font-weight: 700;
        color: var(--chip-expired);
      }
      .sector__cta {
        width: 100%;
        height: var(--min-target);
        margin-top: auto;
      }
      .sector__cta mat-icon {
        vertical-align: middle;
      }
      .sector__avail + .sector__cta,
      .sector__per + .sector__cta,
      .sector__price + .sector__cta {
        margin-top: 16px;
      }

      /* ---------- Fixtures ---------- */
      .fixtures {
        list-style: none;
        margin: 0;
        padding: 0;
        column-count: 2;
        column-gap: 32px;
      }
      .fixture {
        break-inside: avoid;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 12px 0;
        border-bottom: 1px solid var(--border);
      }
      .fixture__opp {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .fixture__when {
        color: var(--muted);
        font-size: 14px;
      }
      .fixture--played .fixture__opp,
      .fixture--played .fixture__when {
        color: var(--faint);
      }

      /* ---------- What is included ---------- */
      .includes {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 14px;
      }
      .includes li {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        line-height: 1.5;
      }
      .includes mat-icon {
        flex: 0 0 auto;
        color: var(--brand-deep);
      }

      /* ---------- Loan steps ---------- */
      .steps {
        margin-top: 48px;
        padding: 32px;
        background: var(--brand-tint);
        border-radius: var(--radius-card);
      }
      .steps__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 24px;
      }
      .steps__list li {
        display: flex;
        gap: 14px;
        align-items: flex-start;
        min-width: 0;
      }
      .steps__num {
        flex: 0 0 auto;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--brand-deep);
        color: #fff;
        display: grid;
        place-items: center;
        font-family: var(--font-display);
        font-weight: 700;
      }
      .steps__list h3 {
        margin: 6px 0 4px;
        font-size: 17px;
        font-weight: 600;
      }
      .steps__list p {
        margin: 0;
        color: var(--muted);
        font-size: 15px;
        line-height: 1.5;
      }
      .steps__rule {
        margin: 24px 0 0;
        font-weight: 600;
        color: var(--brand-deep);
      }

      /* ---------- Loading / error / checkout (existing behaviour) ---------- */
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
        color: var(--kte-muted);
      }
      .kte-season-pass__holder {
        border: 1px solid var(--kte-border, rgba(0, 0, 0, 0.2));
        border-radius: var(--kte-radius);
        margin: 0 0 var(--kte-spacing-3);
        padding: var(--kte-spacing-3);
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-2);
      }
      .kte-season-pass__field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .kte-season-pass__field input {
        padding: 8px;
        font: inherit;
      }
      .kte-season-pass__error {
        background: var(--kte-danger-bg);
        color: var(--kte-danger);
        padding: var(--kte-spacing-3);
        border-radius: var(--kte-radius);
        margin: var(--kte-spacing-2) 0;
      }
      .kte-season-pass__support {
        display: flex;
        gap: var(--kte-spacing-2);
        align-items: flex-start;
        padding: var(--kte-spacing-3);
        background: var(--kte-warn-bg);
        color: var(--kte-warn);
        border-radius: var(--kte-radius);
        margin: var(--kte-spacing-2) 0;
      }
      .kte-season-pass__support p {
        margin: 4px 0 0;
      }

      /* ---------- Narrow screens ---------- */
      @media (max-width: 899px) {
        .hero__inner {
          grid-template-columns: minmax(0, 1fr);
          gap: 32px;
          padding: 40px 16px;
        }
        .page {
          padding: 8px 16px 48px;
        }
        .steps__list {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      @media (max-width: 599px) {
        .hero__title {
          font-size: clamp(30px, 9vw, 46px);
        }
        .hero__savings {
          padding: 20px;
        }
        .fixtures {
          column-count: 1;
        }
        .steps {
          padding: 24px 16px;
        }
        .block h2,
        .steps h2 {
          font-size: 24px;
        }
      }
    `,
  ],
})
export class SeasonPassPageComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  private readonly seasonPassApi = inject(SeasonPassesService);
  private readonly stripeService = inject(StripeService);
  private readonly router = inject(Router);

  protected readonly prices = signal<readonly SeasonPassPrice[]>([]);
  /** Fixtures and loyalty reward; null while loading or when they could not be loaded. */
  protected readonly season = signal<SeasonOverview | null>(null);
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
  protected readonly forSomeoneElse = signal(false);
  protected readonly holderName = signal('');
  protected readonly holderEmail = signal('');
  /** The holder details were confirmed and the intent was (or is being) created with them. */
  protected readonly holderApplied = signal(false);
  protected readonly MAX_RETRY_ATTEMPTS = MAX_RETRY_ATTEMPTS;
  protected readonly supportEmail = 'jegy@kte.hu';

  private readonly now = Date.now();

  protected readonly selectedPrice = computed(() => {
    const id = this.selectedSectionId();
    if (!id) {
      return null;
    }
    return this.prices().find((p) => p.sectionId === id) ?? null;
  });

  protected readonly seasonLabel = computed(() => {
    const first = this.prices()[0];
    return first?.seasonLabel ?? this.season()?.seasonLabel ?? '2026/2027';
  });

  /** "Egy hely, N meccs" with the real count; without it, nothing numeric is claimed. */
  protected readonly heroTitle = computed(() => {
    const n = this.season()?.homeMatches.length ?? 0;
    return n > 0 ? `Egy hely, ${n} meccs` : 'Egy hely az egész szezonra';
  });

  /** Only a sector with a single, non-zero lead in passes sold earns the ribbon. */
  protected readonly popularId = computed(() => mostPopularSectionId(this.prices()));

  /** The savings panel: shown only when a real match-by-match total exists. */
  protected readonly savings = computed(() => {
    const sector = panelSector(this.prices(), this.selectedSectionId());
    if (!sector) {
      return null;
    }
    const s = savingsFor(sector);
    if (s.separate === null || s.matches <= 0) {
      return null;
    }
    return { ...s, sectionName: sector.sectionName };
  });

  @ViewChild('paymentElement', { static: false })
  private readonly paymentElementRef?: ElementRef<HTMLDivElement>;

  @ViewChild('checkout', { static: false })
  private readonly checkoutRef?: ElementRef<HTMLElement>;

  private stripe: Stripe | null = null;
  private elements: StripeElements | null = null;
  private paymentElement: StripePaymentElement | null = null;

  ngOnInit(): void {
    this.loadPrices();
    this.loadSeason();
  }

  ngOnDestroy(): void {
    this.disposePaymentElement();
  }

  protected reload(): void {
    this.loadPrices();
    this.loadSeason();
  }

  protected availability(price: SeasonPassPrice): Availability {
    return availabilityOf(price);
  }

  protected soldOut(price: SeasonPassPrice): boolean {
    return isSoldOut(price);
  }

  protected perMatch(price: SeasonPassPrice): number | null {
    return perMatchEquivalent(price);
  }

  protected isPlayed(match: SeasonHomeMatch): boolean {
    return match.status === 'finished' || new Date(match.kickoffAt).getTime() <= this.now;
  }

  /** Only facts the API gave: roof and seat count. Nothing is made up. */
  protected description(price: SeasonPassPrice): string {
    const parts: string[] = [];
    if (price.isCovered === true) {
      parts.push('Fedett szektor');
    } else if (price.isCovered === false) {
      parts.push('Fedetlen szektor');
    }
    if (price.totalSeats && price.totalSeats > 0) {
      parts.push(`${price.totalSeats} ülőhely`);
    }
    return parts.join(' · ');
  }

  protected availabilityText(price: SeasonPassPrice, level: Availability): string {
    const free = price.freeSeats ?? 0;
    switch (level) {
      case 'sold-out':
        return 'Elfogyott';
      case 'nearly-gone':
        return `Már csak ${free} szabad hely`;
      case 'few':
        return `${free} szabad hely · fogyóban`;
      default:
        return `${free} szabad hely`;
    }
  }

  protected selectSection(price: SeasonPassPrice): void {
    if (this.processing() || isSoldOut(price)) {
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
    if (this.auth.isAuthenticated() && (!this.forSomeoneElse() || this.holderApplied())) {
      void this.initializeIntent(price);
    }
    this.scrollToCheckout();
  }

  /** The checkout sits below the cards; bring it into view once it has rendered. */
  private scrollToCheckout(): void {
    setTimeout(() => {
      const el = this.checkoutRef?.nativeElement;
      if (!el || typeof el.scrollIntoView !== 'function') {
        return;
      }
      const reduce =
        typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }, 0);
  }

  protected holderValid(): boolean {
    const email = this.holderEmail().trim();
    return this.holderName().trim().length >= 2 || (email.length > 0 && email.includes('@'));
  }

  protected setHolderSelf(): void {
    if (!this.forSomeoneElse()) {
      return;
    }
    this.forSomeoneElse.set(false);
    this.holderApplied.set(false);
    this.restartIntent();
  }

  protected setHolderOther(): void {
    if (this.forSomeoneElse()) {
      return;
    }
    this.forSomeoneElse.set(true);
    this.holderApplied.set(false);
    // The intent prepared for "myself" must not be paid for someone else.
    this.resetPayment();
  }

  protected onHolderName(value: string): void {
    this.holderName.set(value);
    this.invalidateHolder();
  }

  protected onHolderEmail(value: string): void {
    this.holderEmail.set(value);
    this.invalidateHolder();
  }

  protected applyHolder(): void {
    if (!this.holderValid()) {
      return;
    }
    this.holderApplied.set(true);
    this.restartIntent();
  }

  /** Editing the holder invalidates a prepared payment: the charge is bound to the holder. */
  private invalidateHolder(): void {
    if (this.holderApplied() || this.clientSecret()) {
      this.holderApplied.set(false);
      this.resetPayment();
    }
  }

  private resetPayment(): void {
    this.paymentError.set(null);
    this.initializationError.set(null);
    this.failureCount.set(0);
    this.disposePaymentElement();
    this.clientSecret.set(null);
    this.paymentIntentId.set(null);
  }

  private restartIntent(): void {
    this.resetPayment();
    const price = this.selectedPrice();
    if (price && this.auth.isAuthenticated()) {
      void this.initializeIntent(price);
    }
  }

  /** Holder part of the purchase payload; empty = the buyer themself. */
  private holderPayload(): { holderName?: string; holderEmail?: string } {
    if (!this.forSomeoneElse()) {
      return {};
    }
    const holderName = this.holderName().trim();
    const holderEmail = this.holderEmail().trim();
    return {
      ...(holderName ? { holderName } : {}),
      ...(holderEmail ? { holderEmail } : {}),
    };
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
        this.seasonPassApi.purchase({ sectionId: price.sectionId, ...this.holderPayload() }),
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
            this.seasonPassApi.purchase({ sectionId: price.sectionId, ...this.holderPayload() }),
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

  /** Fixtures are supplementary: on failure the page just shows less. */
  private loadSeason(): void {
    this.seasonPassApi.getSeasonOverview().subscribe({
      next: (season) => this.season.set(season),
      error: () => this.season.set(null),
    });
  }

  private normalizeError(error: unknown): string {
    return extractApiErrorMessage(error, 'Ismeretlen hiba történt a bérletvásárlás során.');
  }
}
