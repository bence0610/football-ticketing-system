import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BehaviorSubject, catchError, map, of, startWith, switchMap } from 'rxjs';
import { Overview, OverviewPeriod } from '../../../shared/models/admin.model';
import { HufCurrencyPipe } from '../../../shared/pipes/huf-currency.pipe';
import { AdminApiService } from '../../../shared/services/admin.api.service';
import { extractApiErrorMessage } from '../../../shared/utils/api-error';
import { AdminPageHeaderComponent } from '../components/admin-page-header.component';
import { RevenueBarChartComponent } from '../components/revenue-bar-chart.component';
import {
  fixtureLabel,
  headerSubtitle,
  matchesCsv,
  occupancyTone,
  periodOptions,
} from '../logic/admin-logic';

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly data: Overview };

interface MetricCard {
  readonly testId: string;
  readonly label: string;
  readonly value: string;
  readonly context: string;
}

const percentText = (value: number | null): string => (value === null ? '—' : `${value}%`);

@Component({
  selector: 'kte-admin-revenue-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    MatIconModule,
    MatProgressSpinnerModule,
    HufCurrencyPipe,
    AdminPageHeaderComponent,
    RevenueBarChartComponent,
  ],
  template: `
    <kte-admin-page-header title="Bevétel" [subtitle]="subtitle()">
      <label class="period">
        <span class="period__label">Időszak</span>
        <select
          class="period__select"
          data-testid="period-select"
          [value]="period()"
          (change)="onPeriod($event)"
        >
          @for (option of options(); track option.value) {
            <option [value]="option.value" [selected]="option.value === period()">
              {{ option.label }}
            </option>
          }
        </select>
      </label>
      <button
        type="button"
        class="csv"
        data-testid="csv-export"
        [disabled]="!ready()"
        (click)="exportCsv()"
      >
        <mat-icon aria-hidden="true">download</mat-icon>
        CSV
      </button>
    </kte-admin-page-header>

    <div class="page">
      @switch (state().status) {
        @case ('loading') {
          <div class="state" role="status" aria-live="polite">
            <mat-spinner diameter="32" />
            <span>Betöltés…</span>
          </div>
        }
        @case ('error') {
          <div class="state state--error" role="alert">
            <mat-icon aria-hidden="true">error</mat-icon>
            <span>{{ errorMessage() }}</span>
            <button type="button" class="csv" (click)="reload()">Újra</button>
          </div>
        }
        @default {
          @if (data(); as d) {
            <section class="cards" aria-label="Mérőszámok">
              @for (card of cards(); track card.testId) {
                <article class="card metric" [attr.data-testid]="card.testId">
                  <p class="metric__label">{{ card.label }}</p>
                  <p class="metric__value" data-testid="metric-value">{{ card.value }}</p>
                  <p class="metric__context" data-testid="metric-context">{{ card.context }}</p>
                </article>
              }
            </section>

            <section class="card" aria-labelledby="chart-title">
              <h2 id="chart-title" class="card__title">Bevétel meccsenként</h2>
              <kte-revenue-bar-chart [data]="d.matches" />
              <p class="card__fine">
                A bérletes belépők nem hoznak meccsenkénti bevételt: a bérlet ára egy összeg a szezonra, ezért nincs
                meccshez rendelhető forintértékük. A számuk a táblázatban látható.
              </p>
            </section>

            <section class="card" aria-labelledby="table-title">
              <h2 id="table-title" class="card__title">Mérkőzések</h2>
              @if (d.matches.length === 0) {
                <p class="card__fine">Nincs mérkőzés ebben az időszakban.</p>
              } @else {
                <div class="table-wrap">
                  <table class="table" data-testid="matches-table">
                    <thead>
                      <tr>
                        <th scope="col">Mérkőzés</th>
                        <th scope="col" class="num">Jegyek</th>
                        <th scope="col" class="num">Foglaltság</th>
                        <th scope="col" class="num">Bevétel</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (m of d.matches; track m.matchId) {
                        <tr data-testid="match-row">
                          <th scope="row" class="fixture">
                            <span>{{ fixture(m) }}</span>
                            <span class="fixture__when">
                              {{ m.kickoffAt | date: 'yyyy. MM. dd. HH:mm' : '' : 'hu-HU' }}
                              @if (!m.final) {
                                <span class="chip" data-testid="not-final">nem végleges</span>
                              }
                            </span>
                          </th>
                          <td class="num">
                            {{ m.ticketCount }}
                            @if (m.passEntryCount > 0) {
                              <span class="sub">+ {{ m.passEntryCount }} bérletes</span>
                            }
                          </td>
                          <td class="num">
                            <span class="occ" [attr.data-tone]="tone(m.occupancyPercent)" data-testid="occupancy">
                              {{ m.occupancyPercent }}%
                            </span>
                          </td>
                          <td class="num">{{ m.revenue | hufCurrency }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </section>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      .page {
        display: flex;
        flex-direction: column;
        gap: 20px;
        padding: 24px 32px;
      }

      .period {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--muted);
      }

      .period__select {
        min-height: 40px;
        padding: 0 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius-block);
        background: var(--surface);
        color: var(--ink);
        font: inherit;
      }

      .csv {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 40px;
        padding: 0 14px;
        border: 1px solid var(--border);
        border-radius: var(--radius-block);
        background: var(--surface);
        color: var(--brand-deep);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }

      .csv:disabled {
        color: var(--faint);
        cursor: default;
      }

      .csv:hover:not(:disabled) {
        border-color: var(--brand-mid);
      }

      .period__select:focus-visible,
      .csv:focus-visible {
        outline: 2px solid var(--brand-mid);
        outline-offset: 2px;
      }

      .state {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 24px;
        color: var(--muted);
      }

      .state--error {
        color: var(--error-ink);
        background: var(--error-bg);
        border: 1px solid var(--error-edge);
        border-radius: var(--radius-block);
      }

      .cards {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
      }

      .card {
        padding: 20px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
      }

      .metric__label {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .metric__value {
        margin: 8px 0 4px;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 28px;
        line-height: 1.15;
        color: var(--ink);
        overflow-wrap: anywhere;
      }

      .metric__context {
        margin: 0;
        font-size: 13px;
        color: var(--muted);
      }

      .card__title {
        margin: 0 0 16px;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 16px;
      }

      .card__fine {
        margin: 12px 0 0;
        font-size: 12px;
        color: var(--muted);
      }

      .table-wrap {
        overflow-x: auto;
      }

      .table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }

      .table th,
      .table td {
        padding: 10px 12px;
        border-bottom: 1px solid var(--border-light);
        text-align: left;
        vertical-align: top;
      }

      .table thead th {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .table .num {
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      .fixture {
        font-weight: 600;
      }

      .fixture span {
        display: block;
      }

      .fixture__when {
        font-weight: 400;
        font-size: 12px;
        color: var(--muted);
      }

      .sub {
        display: block;
        font-size: 12px;
        color: var(--muted);
      }

      .chip {
        display: inline-block;
        margin-left: 6px;
        padding: 1px 8px;
        border-radius: 999px;
        background: var(--chip-used-bg);
        color: var(--chip-used);
        font-size: 11px;
        font-weight: 600;
      }

      .occ {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 6px;
        font-weight: 600;
      }

      .occ[data-tone='full'] {
        background: var(--chip-expired-bg);
        color: var(--seat-sold);
      }

      .occ[data-tone='low'] {
        background: var(--amber-bg);
        color: var(--amber-ink);
      }

      @media (max-width: 1099px) {
        .cards {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 899px) {
        .page {
          padding: 16px;
        }
      }

      @media (max-width: 479px) {
        .cards {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ],
})
export class RevenueStatsPageComponent {
  private readonly api = inject(AdminApiService);
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  protected readonly period = signal<OverviewPeriod>('season');
  protected readonly state = signal<State>({ status: 'loading' });

  protected readonly data = computed(() => {
    const s = this.state();
    return s.status === 'ready' ? s.data : null;
  });
  protected readonly ready = computed(() => this.data() !== null);
  protected readonly errorMessage = computed(() => {
    const s = this.state();
    return s.status === 'error' ? s.message : '';
  });

  protected readonly options = computed(() => periodOptions(this.data()?.season?.label ?? null));
  protected readonly subtitle = computed(() =>
    headerSubtitle(this.data()?.season?.label ?? null, this.data()?.generatedAt ?? null),
  );

  protected readonly cards = computed<readonly MetricCard[]>(() => {
    const d = this.data();
    if (!d) return [];
    const m = d.metrics;
    const huf = new HufCurrencyPipe();
    return [
      {
        testId: 'metric-revenue',
        label: 'Bevétel',
        value: huf.transform(m.revenue),
        context: `${d.matches.length} meccs, a ténylegesen terhelt összeg`,
      },
      {
        testId: 'metric-tickets',
        label: 'Eladott jegy',
        value: String(m.ticketsSold),
        context:
          m.passEntries > 0 ? `és ${m.passEntries} bérletes belépő` : 'bérletes belépő nélkül',
      },
      {
        testId: 'metric-occupancy',
        label: 'Átlagos foglaltság',
        value: percentText(m.averageOccupancyPercent),
        context:
          m.finalMatchCount > 0
            ? `${m.finalMatchCount} lejátszott meccs átlaga`
            : 'Még nincs lejátszott meccs',
      },
      {
        testId: 'metric-redemption',
        label: 'Beváltási arány',
        value: percentText(m.redemptionPercent),
        context:
          m.playedTickets > 0
            ? `${m.scannedTickets} / ${m.playedTickets} eladott jegyet olvastak be`
            : 'Még nem volt lejátszott meccs',
      },
    ];
  });

  protected readonly fixture = fixtureLabel;
  protected readonly tone = occupancyTone;

  constructor() {
    toObservable(this.period)
      .pipe(
        switchMap((period) =>
          this.refresh$.pipe(
            switchMap(() =>
              this.api.overview(period).pipe(
                map((data): State => ({ status: 'ready', data })),
                catchError((error: unknown) =>
                  of<State>({ status: 'error', message: extractApiErrorMessage(error, 'A mérőszámok betöltése nem sikerült.') }),
                ),
                startWith<State>({ status: 'loading' }),
              ),
            ),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((next) => this.state.set(next));
  }

  protected onPeriod(event: Event): void {
    this.period.set((event.target as HTMLSelectElement).value as OverviewPeriod);
  }

  protected reload(): void {
    this.refresh$.next();
  }

  protected exportCsv(): void {
    const d = this.data();
    if (!d) return;
    // The BOM makes Excel read the accents as UTF-8.
    const blob = new Blob(['﻿', matchesCsv(d.matches)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bevetel-${d.period}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
