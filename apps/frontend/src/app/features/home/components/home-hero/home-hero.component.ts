import { TierPrice, tierPrices } from '../../logic/tier-prices';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { map, timer } from 'rxjs';
import { MatchListItem } from '../../../../shared/models/match.model';
import { SectorSummary } from '../../../../shared/models/seat.model';
import { countdownParts } from '../../logic/countdown-parts';

/**
 * Full-width hero band on --brand-deep. It shows the next home match with a
 * live countdown and that match's sector prices. With no match it still shows
 * a deliberate message (see the template) instead of an empty band.
 */
@Component({
  selector: 'kte-home-hero',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIf, NgFor, DatePipe, RouterLink, MatButtonModule, MatIconModule],
  template: `
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero__inner" [class.hero__inner--single]="!match">
        <div class="hero__main">
          <p class="hero__eyebrow">Következő hazai mérkőzés</p>

          <ng-container *ngIf="match; else noMatch">
            <h1 id="hero-title" class="hero__title">
              <span class="hero__team">{{ match.homeTeam }}</span>
              <span class="hero__team">{{ match.awayTeam }}</span>
            </h1>
            <p class="hero__when">
              {{ match.kickoffAt | date: "yyyy. MMMM d., EEEE · HH:mm":'':'hu-HU' }} · {{ match.venue }}
            </p>

            <div class="hero__countdown" *ngIf="!parts().started; else started" role="timer" aria-label="Visszaszámlálás a kezdésig">
              <div class="hero__tile">
                <span class="hero__num">{{ parts().days }}</span>
                <span class="hero__unit">nap</span>
              </div>
              <div class="hero__tile">
                <span class="hero__num">{{ parts().hours }}</span>
                <span class="hero__unit">óra</span>
              </div>
              <div class="hero__tile">
                <span class="hero__num">{{ parts().minutes }}</span>
                <span class="hero__unit">perc</span>
              </div>
            </div>
            <ng-template #started>
              <p class="hero__started">A mérkőzés megkezdődött.</p>
            </ng-template>

            <div class="hero__actions">
              <a
                mat-flat-button
                class="hero__buy"
                routerLink="/stadium"
                [queryParams]="{ matchId: match.id }"
              >
                Jegyvásárlás
                <mat-icon iconPositionEnd>arrow_forward</mat-icon>
              </a>
              <a
                mat-stroked-button
                class="hero__map"
                routerLink="/stadium"
                [queryParams]="{ matchId: match.id }"
              >
                Széktérkép
              </a>
            </div>
          </ng-container>

          <ng-template #noMatch>
            <ng-container *ngIf="loading; else settled">
              <h1 id="hero-title" class="hero__title hero__title--message">Mérkőzések betöltése…</h1>
            </ng-container>
            <ng-template #settled>
              <ng-container *ngIf="error; else none">
                <h1 id="hero-title" class="hero__title hero__title--message">
                  A mérkőzések most nem érhetők el
                </h1>
                <p class="hero__when">{{ error }}</p>
                <div class="hero__actions">
                  <button mat-flat-button class="hero__buy" type="button" (click)="retry.emit()">
                    Újrapróbálom
                  </button>
                </div>
              </ng-container>
              <ng-template #none>
                <h1 id="hero-title" class="hero__title hero__title--message">
                  Még nincs meghirdetett hazai mérkőzés
                </h1>
                <p class="hero__when">
                  Amint a következő hazai meccs jegyei elérhetők, itt találod őket. Addig a bérlettel
                  az egész szezonra biztosíthatod a helyed.
                </p>
                <div class="hero__actions">
                  <a mat-flat-button class="hero__buy" routerLink="/season-pass">
                    Bérletek megtekintése
                    <mat-icon iconPositionEnd>arrow_forward</mat-icon>
                  </a>
                </div>
              </ng-template>
            </ng-template>
          </ng-template>
        </div>

        <aside class="hero__prices" *ngIf="match" aria-labelledby="hero-prices-title">
          <p id="hero-prices-title" class="hero__eyebrow">Jegyárak</p>
          <ul class="hero__price-list" *ngIf="tiers().length > 0; else noPrices">
            <li *ngFor="let t of tiers()" class="hero__price-row" data-testid="hero-tier">
              <span>{{ t.label }}</span>
              <strong>{{ priceText(t) }}</strong>
            </li>
          </ul>
          <ng-template #noPrices>
            <p class="hero__price-note">
              {{ pricesLoading ? 'Árak betöltése…' : 'Az árak jelenleg nem érhetők el.' }}
            </p>
          </ng-template>
          <p class="hero__price-note">A hűségkedvezmény a fizetésnél érvényesül.</p>
        </aside>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .hero {
        background: var(--brand-deep);
        color: #fff;
      }

      .hero__inner {
        max-width: 1180px;
        margin: 0 auto;
        padding: 64px 32px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 360px;
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
        font-size: 60px;
        line-height: 1.02;
        letter-spacing: -0.025em;
        overflow-wrap: anywhere;
      }

      .hero__team {
        display: block;
      }

      .hero__title--message {
        font-size: 44px;
        line-height: 1.1;
      }

      .hero__when {
        margin: 20px 0 0;
        font-size: 17px;
        line-height: 1.5;
        color: var(--on-brand-lead);
        max-width: 56ch;
      }

      .hero__countdown {
        display: flex;
        gap: 12px;
        margin-top: 28px;
      }

      .hero__tile {
        min-width: 84px;
        padding: 14px 18px;
        border-radius: 12px;
        background: var(--glass);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }

      .hero__num {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 30px;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
      }

      .hero__unit {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--on-brand-eyebrow);
      }

      .hero__started {
        margin: 24px 0 0;
        color: var(--on-brand-lead);
        font-size: 17px;
      }

      .hero__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 32px;
      }

      /* Solid white button, brand-deep label */
      .hero__buy.mat-mdc-button-base {
        --mdc-filled-button-container-color: #fff;
        --mdc-filled-button-label-text-color: var(--brand-deep);
      }

      /* Outlined in 45% white */
      .hero__map.mat-mdc-button-base {
        --mdc-outlined-button-outline-color: var(--glass-outline);
        --mdc-outlined-button-label-text-color: #fff;
      }

      .hero__prices {
        padding: 28px;
        border-radius: 16px;
        background: var(--scrim);
      }

      .hero__prices .hero__eyebrow {
        margin-bottom: 8px;
      }

      .hero__price-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .hero__price-row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 0;
        border-bottom: 1px solid var(--divider-on-brand);
        font-size: 16px;
      }

      .hero__price-row strong {
        font-family: var(--font-display);
        font-weight: 700;
        white-space: nowrap;
      }

      .hero__price-note {
        margin: 16px 0 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--on-brand-lead);
      }

      @media (max-width: 899px) {
        .hero__inner {
          grid-template-columns: minmax(0, 1fr);
          gap: 32px;
          padding: 48px 16px;
        }
      }

      @media (max-width: 599px) {
        .hero__title {
          font-size: clamp(34px, 11vw, 48px);
        }
        .hero__title--message {
          font-size: clamp(28px, 8.5vw, 36px);
        }
        .hero__countdown {
          gap: 8px;
        }
        .hero__tile {
          flex: 1 1 0;
          min-width: 0;
          padding: 12px 8px;
        }
        .hero__num {
          font-size: 24px;
        }
        .hero__actions > * {
          flex: 1 1 100%;
        }
        .hero__prices {
          padding: 20px;
        }
      }
    `,
  ],
})
export class HomeHeroComponent {
  @Input() match: MatchListItem | null = null;
  /** The match's sectors; the panel groups them into the three price tiers. */
  @Input() set sectors(value: readonly SectorSummary[]) {
    this.sectorList.set(value ?? []);
  }
  private readonly sectorList = signal<readonly SectorSummary[]>([]);
  protected readonly tiers = computed(() => tierPrices(this.sectorList()));
  @Input() pricesLoading = false;
  @Input() loading = false;
  @Input() error: string | null = null;
  @Output() readonly retry = new EventEmitter<void>();

  private readonly now = toSignal(timer(0, 1000).pipe(map(() => Date.now())), {
    initialValue: Date.now(),
  });

  protected readonly parts = computed(() =>
    this.match
      ? countdownParts(new Date(this.match.kickoffAt).getTime(), this.now())
      : { days: 0, hours: 0, minutes: 0, started: true },
  );

  protected priceText(s: Pick<TierPrice, 'minPrice' | 'maxPrice'>): string {
    const fmt = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 });
    return s.maxPrice > s.minPrice
      ? `${fmt.format(s.minPrice)}–${fmt.format(s.maxPrice)} Ft`
      : `${fmt.format(s.minPrice)} Ft`;
  }
}
